"""Partner-Sync mit https://www.freizeitticket.at/ (zentrale Datenquelle).

- liest alle Rubriken (Winter, Sommer, Bonus) ein
- lädt jede Detailseite (Name, Adresse, Website, Beschreibung, Konditionen)
- erkennt neue Partner, archiviert entfernte Partner, reaktiviert zurückgekehrte
- liest die offiziellen Tarifbestimmungen (Jahrgänge, Preise) der aktuellen Saison
- geokodiert Adressen über OpenStreetMap/Nominatim für die Karte
"""
import datetime as dt
import json
import os
import re
import urllib.parse

from . import db, net, html, seasons
from .categories import LISTINGS, BONUS_LISTINGS, classify, norm

BASE = "https://www.freizeitticket.at"
SNAPSHOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_partners.json")
COND_RX = re.compile(r"freizeitticket|inkludiert|inklusive|nicht enthalten|nicht inkludiert|ausgenommen|zuschlag|aufpreis|ermäßig", re.I)


def log(kind, msg, facility_id=None):
    with db.tx() as c:
        c.execute("INSERT INTO sync_log(at,kind,facility_id,message) VALUES(?,?,?,?)", (db.now(), kind, facility_id, msg))


# ---------------------------------------------------------------- Parser

def parse_listing(text):
    root = html.parse(text)
    slugs = []
    for item in root.find_all(cls="jsPartnerItem"):
        a = item.find("a", pred=lambda n: n.attrs.get("href", "").startswith("/"))
        if a:
            href = a.attrs["href"]
            slug = href.strip("/").split("/")[0]
            if slug and slug not in slugs:
                slugs.append(slug)
    return slugs


def parse_detail(text, slug):
    root = html.parse(text)
    box = root.find(cls="texticon") or root.find("main") or root
    h1 = box.find("h1")
    if h1:
        parts = [d.text() for d in h1.children if isinstance(d, html.Node)]
        name = " ".join(p for p in parts if p) or h1.text()
    else:
        t = root.find("title")
        name = t.text().split("|")[0].strip() if t else slug
    out = {"slug": slug, "name": html.clean(name), "source_url": f"{BASE}/{slug}/"}
    for a in box.find_all("a"):
        href = a.attrs.get("href", "")
        label = a.text().lower()
        title = (a.attrs.get("title") or "").lower()
        if re.search(r"zur web(site|seite)|^website$|^webseite$|^homepage$", label.strip()) or re.search(r"zur web(site|seite)", title):
            out["website"] = href.strip()
        elif href.startswith("tel:"):
            out["phone"] = a.text()
        elif "öffnungszeiten" in label or "öffnungszeiten" in title:
            out["hours_url"] = href.strip()
    for img in box.find_all("img"):
        if "adresse" in (img.attrs.get("alt") or "").lower() and img.parent is not None:
            out["address"] = img.parent.text()
            break
    if out.get("address"):
        m = re.search(r"\b(\d{4})\s+([^,]+)$", out["address"])
        if m:
            out["town"] = m.group(2).strip()
    desc_parts = []
    for d in box.find_all("div", cls="mt-3"):
        for p in d.find_all("p"):
            t = p.text()
            if t:
                desc_parts.append(t)
    out["description"] = "\n\n".join(desc_parts) or None
    conds = []
    for para in desc_parts:
        for sent in re.split(r"(?<=[.!?])\s+", para):
            if COND_RX.search(sent) and len(sent) < 400:
                conds.append(sent.strip())
    out["conditions"] = " ".join(conds) or None
    # Sonderregelungen (auf freizeitticket.at mit * gekennzeichnet)
    rules = {}
    star = [p.lstrip("* ").strip() for p in desc_parts if p.strip().startswith("*")]
    if star or "*" in out["name"]:
        rules["special"] = True
        rules["note"] = " ".join(star) or "Sonderregelung laut freizeitticket.at – Details beim Partnerbetrieb"
    joined = " ".join(desc_parts)
    m = re.search(r"gilt\s+(?:für|fuer)\s+(\d{1,2})\s*(?:Zutritt|Eintritt|Besuch|Fahrt)", joined, re.I)
    if m:
        rules["max_entries"] = int(m.group(1))
    if re.search(r"nicht\s+(?:im\s+freizeitticket\s+)?(?:inkludiert|enthalten)|ausgenommen", joined, re.I):
        rules["has_exclusions"] = True
    out["special_rules"] = json.dumps(rules, ensure_ascii=False) if rules else None
    out["name"] = re.sub(r"\s*\*\s*", " ", out["name"]).strip()
    return out


def parse_bonus(text, tag):
    root = html.parse(text)
    items = []
    for it in root.find_all(cls="bonus-item"):
        head = it.find(cls="bonus-headline")
        if not head:
            continue
        name = head.text()
        disc = it.find(cls="bonus-discount")
        body = it.find(cls="bonus-text")
        link = it.find("a", cls="bonus-link")
        text_ = body.text() if body else ""
        d_label = disc.text() if disc else None
        pct, amount = parse_discount(d_label, text_)
        items.append({
            "slug": "bonus-" + norm(name).replace(" ", "-")[:60],
            "name": name,
            "website": link.attrs.get("href") if link else None,
            "description": text_ or None,
            "conditions": text_ or None,
            "discount_label": d_label,
            "discount_percent": pct,
            "discount_amount": amount,
            "special_rules": json.dumps(parse_restrictions(text_), ensure_ascii=False),
            "tags": [tag],
            "source_url": BASE + "/bonus/",
        })
    return items


def _num(s):
    return float(s.replace(".", "").replace(",", ".")) if "," in s else float(s)


def parse_discount(label, text):
    for src in (label or "", text or ""):
        m = re.search(r"(\d{1,2}(?:[.,]\d)?)\s*%", src)
        if m:
            return _num(m.group(1)), None
    for src in (label or "", text or ""):
        m = re.search(r"(?:€|EUR)\s*(\d{1,3}(?:,\d{1,2})?)|(\d{1,3}(?:,\d{1,2})?)\s*(?:€|Euro)", src)
        if m:
            return None, _num(m.group(1) or m.group(2))
    return None, None


WD = {"mo": 0, "di": 1, "mi": 2, "do": 3, "fr": 4, "sa": 5, "so": 6,
      "montag": 0, "dienstag": 1, "mittwoch": 2, "donnerstag": 3, "freitag": 4, "samstag": 5, "sonntag": 6}
MONTHS = {"jänner": 1, "januar": 1, "februar": 2, "feber": 2, "märz": 3, "april": 4, "mai": 5, "juni": 6, "juli": 7,
          "august": 8, "september": 9, "oktober": 10, "november": 11, "dezember": 12}


def parse_restrictions(text):
    """Zeitliche Einschränkungen / Ausschlüsse aus dem Bonus-Text maschinenlesbar machen."""
    t = (text or "").lower()
    r = {}
    m = re.search(r"\b(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\.?\s*(?:-|–|bis)\s*(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b", t)
    if m:
        a, b = WD[m.group(1)], WD[m.group(2)]
        r["weekdays"] = list(range(a, b + 1)) if a <= b else list(range(a, 7)) + list(range(0, b + 1))
    dates = re.findall(r"(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})", t)
    if len(dates) >= 2:
        (d1, m1, y1), (d2, m2, y2) = dates[0], dates[1]
        try:
            r["valid_from"] = dt.date(int(y1), int(m1), int(d1)).isoformat()
            r["valid_to"] = dt.date(int(y2), int(m2), int(d2)).isoformat()
        except ValueError:
            pass
    else:
        mm = re.findall(r"(anfang|mitte|ende)?\s*(" + "|".join(MONTHS) + r")\s+(\d{4})", t)
        if len(mm) >= 2:
            def to_date(part, mon, year, end):
                y, mo = int(year), MONTHS[mon]
                if part == "mitte":
                    return dt.date(y, mo, 15)
                if part == "ende" or (end and not part):
                    nxt = dt.date(y + (mo == 12), mo % 12 + 1, 1)
                    return nxt - dt.timedelta(days=1)
                return dt.date(y, mo, 1)
            r["valid_from"] = to_date(*mm[0], end=False).isoformat()
            r["valid_to"] = to_date(*mm[1], end=True).isoformat()
            r["approximate_dates"] = True
    if re.search(r"nicht (mit anderen|kombinierbar)|keine doppelrabatt", t):
        r["not_combinable"] = True
    if re.search(r"nur bei|nur gültig|nur für|ausgenommen|nicht gültig", t):
        r["has_conditions"] = True
    m = re.search(r"code:?\s*([a-z0-9-]{4,})", text or "", re.I)
    if m:
        r["code"] = m.group(1)
    return r


def parse_official_prices(text):
    """Liest Jahrgangsgrenzen + Einzelpreise von /ticket/preise/."""
    root = html.parse(text)
    full = root.text()
    m = re.search(r"(?:gilt|g\S{1,3}ltig)\s+vom\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*bis\s*(\d{1,2})\.(\d{1,2})\.(\d{4})", full)
    if not m:
        return None
    start = dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    end = dt.date(int(m.group(6)), int(m.group(5)), int(m.group(4)))
    sid = f"{start.year}-{str(start.year + 1)[-2:]}"
    cats = {}
    main = root.find("main") or root
    mode = "presale"
    for node in main.iter():
        if node.tag in ("h2", "h3"):
            h = node.text().lower()
            if "vorverkauf" in h:
                mode = "presale"
            elif "tarif" in h or "normal" in h or "preise" in h:
                mode = "regular"
        if node.has_class("price-item-wrapper"):
            title = node.find(cls="price-title-item")
            if title and "einzel" not in title.text().lower():
                continue
            for box in node.find_all(cls="price-inner-item-box-wrap"):
                header = box.find(cls="price-inner-item-box-header")
                if not header:
                    continue
                divs = [c for c in header.children if isinstance(c, html.Node)]
                label = divs[0].text() if divs else header.text()
                rule = divs[1].text() if len(divs) > 1 else ""
                key = _cat_key(label)
                if not key:
                    continue
                entry = cats.setdefault(key, {"key": key, "label": _cat_label(key)})
                if key == "behinderung":
                    entry["requires_flag"] = "disability"
                else:
                    fy, ty = _parse_years(rule)
                    if fy is None and ty is None:
                        continue
                    entry["birth_year_from"], entry["birth_year_to"] = fy, ty
                for item in box.find_all(cls="price-inner-item"):
                    pm = re.search(r"€\s*(\d{2,4})", item.text())
                    if not pm:
                        continue
                    is_pre = item.has_class("presale") or "vorverkauf" in item.text().lower()
                    if is_pre or mode == "presale":
                        entry["price_presale"] = float(pm.group(1))
                    else:
                        entry["price_regular"] = float(pm.group(1))
    mp = re.search(r"Vorverkaufspreis\s*(\d{1,2})\.(?:\d{1,2}\.)?\s?[–-]\s?(\d{1,2})\.(\d{1,2})\.(\d{4})", full)
    presale_until = None
    if mp:
        try:
            presale_until = dt.date(int(mp.group(4)), int(mp.group(3)), int(mp.group(2))).isoformat()
        except ValueError:
            pass
    for e in cats.values():
        e["presale_until"] = presale_until
    order = ["kinder", "jugend", "u23", "erwachsene", "senioren", "behinderung"]
    lst = [cats[k] for k in order if k in cats]
    if len([c for c in lst if c["key"] != "behinderung"]) < 4:
        return None
    return {"id": sid, "label": f"{start.year}/{str(start.year + 1)[-2:]}", "start": start.isoformat(), "end": end.isoformat(), "categories": lst}


def _cat_key(label):
    l = label.lower()
    if "kind" in l:
        return "kinder"
    if "jugend" in l:
        return "jugend"
    if "u23" in l or "u 23" in l:
        return "u23"
    if "erwachsen" in l:
        return "erwachsene"
    if "senior" in l:
        return "senioren"
    if "behinder" in l:
        return "behinderung"
    return None


def _cat_label(key):
    return {"kinder": "Kinder", "jugend": "Jugend", "u23": "U23", "erwachsene": "Erwachsene",
            "senioren": "Senioren", "behinderung": "Menschen mit Behinderung"}[key]


def _parse_years(rule):
    r = rule.lower()
    m = re.search(r"(\d{4})\s*bis\s*(\d{4})", r)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return min(a, b), max(a, b)
    m = re.search(r"(\d{4})\s*und\s*jünger", r)
    if m:
        return int(m.group(1)), None
    m = re.search(r"(\d{4})\s*und\s*älter", r)
    if m:
        return None, int(m.group(1))
    return None, None


# ---------------------------------------------------------------- Sync

def upsert_facility(data, kind, tags, season_id):
    tags = sorted(set(tags))
    cat = classify(data["name"], tags, kind)
    existing = db.q1("SELECT * FROM facilities WHERE slug=?", (data["slug"],))
    now = db.now()
    fields = ["name", "address", "town", "description", "website", "phone", "hours_url", "conditions",
              "discount_label", "discount_percent", "discount_amount", "special_rules", "source_url"]
    with db.tx() as c:
        if existing:
            changes = []
            sets = {f: data.get(f) for f in fields if data.get(f) is not None}
            if existing.get("conditions") != data.get("conditions") and data.get("conditions") and existing.get("conditions"):
                changes.append("Konditionen geändert")
            if existing.get("discount_label") != data.get("discount_label") and existing.get("discount_label"):
                changes.append(f"Rabatt geändert: {existing.get('discount_label')} → {data.get('discount_label')}")
            sets.update({"kind": kind, "category": cat, "tags": json.dumps(tags), "last_seen": now, "updated_at": now})
            if existing["status"] == "archived":
                sets.update({"status": "active", "archived_at": None})
                changes.append("wieder im Angebot")
            c.execute("UPDATE facilities SET " + ",".join(f"{k}=?" for k in sets) + " WHERE id=?", list(sets.values()) + [existing["id"]])
            fid = existing["id"]
            for ch in changes:
                c.execute("INSERT INTO sync_log(at,kind,facility_id,message) VALUES(?,?,?,?)", (now, "changed", fid, f"{data['name']}: {ch}"))
        else:
            cols = fields + ["slug", "kind", "category", "tags", "status", "first_seen", "last_seen", "updated_at"]
            vals = [data.get(f) for f in fields] + [data["slug"], kind, cat, json.dumps(tags), "active", now, now, now]
            cur = c.execute(f"INSERT INTO facilities({','.join(cols)}) VALUES({','.join('?' * len(cols))})", vals)
            fid = cur.lastrowid
            c.execute("INSERT INTO sync_log(at,kind,facility_id,message) VALUES(?,?,?,?)", (now, "new", fid, f"Neuer Partner: {data['name']}"))
        c.execute("INSERT OR IGNORE INTO facility_seasons(facility_id,season_id) VALUES(?,?)", (fid, season_id))
    return fid


def sync_partners(progress=None, geocode_new=True):
    """Kompletter Abgleich. Gibt eine Zusammenfassung zurück."""
    def p(msg):
        if progress:
            progress(msg)

    season_id = seasons.season_id_for_date(dt.date.today())
    summary = {"new": 0, "archived": 0, "total": 0, "errors": [], "season_rules": None}

    # 1. Tarifbestimmungen
    try:
        p("Lese offizielle Tarifbestimmungen …")
        r = net.get(BASE + "/ticket/preise/")
        rules = parse_official_prices(r.text())
        if rules:
            seasons.upsert_official_season(rules["id"], rules["label"], rules["start"], rules["end"], rules["categories"],
                                           BASE + "/ticket/preise/")
            summary["season_rules"] = rules["id"]
            season_id = rules["id"] if rules["start"] <= db.today() else season_id
    except net.FetchError as e:
        summary["errors"].append(f"Preise: {e}")
    seasons.ensure_season_exists(season_id)

    # 2. Rubriken
    tags_by_slug = {}
    listing_ok = True
    for path, tag in LISTINGS:
        p(f"Lese Rubrik {path} …")
        try:
            r = net.get(BASE + path)
            for slug in parse_listing(r.text()):
                tags_by_slug.setdefault(slug, set()).add(tag)
        except net.FetchError as e:
            listing_ok = False
            summary["errors"].append(f"{path}: {e}")
    for slug, tg in tags_by_slug.items():
        if len(tg) > 1:
            tg.discard("winter")
            tg.discard("sommer")

    before = {f["slug"]: f for f in db.q("SELECT * FROM facilities")}
    seen = set()
    n = len(tags_by_slug)
    for i, (slug, tags) in enumerate(sorted(tags_by_slug.items()), 1):
        p(f"Partner {i}/{n}: {slug}")
        try:
            r = net.get(f"{BASE}/{slug}/")
            data = parse_detail(r.text(), slug)
        except net.FetchError as e:
            summary["errors"].append(f"{slug}: {e}")
            if slug in before:
                seen.add(slug)  # nicht erreichbar != entfernt
            continue
        if slug not in before:
            summary["new"] += 1
        upsert_facility(data, "included", tags, season_id)
        seen.add(slug)

    # 3. Bonuspartner
    bonus = {}
    for path, tag in BONUS_LISTINGS:
        p(f"Lese Bonuspartner {path} …")
        try:
            r = net.get(BASE + path)
            for item in parse_bonus(r.text(), tag):
                if item["slug"] in bonus:
                    bonus[item["slug"]]["tags"] = sorted(set(bonus[item["slug"]]["tags"]) | set(item["tags"]))
                else:
                    bonus[item["slug"]] = item
        except net.FetchError as e:
            listing_ok = False
            summary["errors"].append(f"{path}: {e}")
    for slug, item in bonus.items():
        tg = set(item["tags"])
        if len(tg) > 1:
            tg.discard("bonus")
        if slug not in before:
            summary["new"] += 1
        upsert_facility(item, "bonus", tg, season_id)
        seen.add(slug)

    # 4. Entfernte Partner archivieren (nur wenn der Abgleich vollständig und plausibel war)
    prev_active = [f for f in before.values() if f["status"] == "active" and not f["manual"]]
    if listing_ok and len(seen) >= 0.7 * len(prev_active):
        for f in prev_active:
            if f["slug"] not in seen:
                with db.tx() as c:
                    c.execute("UPDATE facilities SET status='archived', archived_at=?, updated_at=? WHERE id=?", (db.now(), db.now(), f["id"]))
                log("archived", f"Nicht mehr im Angebot: {f['name']}", f["id"])
                summary["archived"] += 1
    elif prev_active:
        summary["errors"].append("Abgleich unvollständig – keine Partner archiviert")

    summary["total"] = len(seen)
    if geocode_new:
        geocode_missing(progress)
    return summary


# ---------------------------------------------------------------- Geokodierung

TIROL_BOX = (46.6, 47.8, 10.0, 13.0)  # lat_min, lat_max, lon_min, lon_max (Nord- und Osttirol)


def geocode_missing(progress=None, limit=400):
    la0, la1, lo0, lo1 = TIROL_BOX
    with db.tx() as c:  # Fehlgeokodierungen außerhalb Tirols verwerfen und neu versuchen
        c.execute("UPDATE facilities SET lat=NULL, lon=NULL, geo_source=NULL WHERE lat IS NOT NULL AND NOT (lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?)",
                  (la0, la1, lo0, lo1))
    rows = db.q("SELECT id,name,address,town FROM facilities WHERE lat IS NULL AND status='active' AND (geo_source IS NULL OR geo_source<>'failed') LIMIT ?", (limit,))
    for i, f in enumerate(rows, 1):
        if progress:
            progress(f"Geokodiere {i}/{len(rows)}: {f['name']}")
        queries = []
        if f["address"]:
            queries.append((f["address"] + ", Österreich", "address"))
        queries.append((f"{f['name']}, Tirol, Österreich", "name"))
        if f["town"]:
            queries.append((f"{f['town']}, Tirol, Österreich", "town"))
        found = None
        for qs, src in queries:
            try:
                url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
                    {"q": qs, "format": "json", "limit": 1, "countrycodes": "at", "viewbox": f"{lo0},{la1},{lo1},{la0}", "bounded": 1})
                r = net.get(url, check_robots=False)
                res = json.loads(r.text())
                if res:
                    found = (float(res[0]["lat"]), float(res[0]["lon"]), f"nominatim:{src}")
                    break
            except Exception:
                continue
        with db.tx() as c:
            if found:
                c.execute("UPDATE facilities SET lat=?,lon=?,geo_source=? WHERE id=?", (*found, f["id"]))
            else:
                c.execute("UPDATE facilities SET geo_source='failed' WHERE id=?", (f["id"],))


# ---------------------------------------------------------------- Snapshot (Offline-Erststart)

SNAP_FIELDS = ["slug", "kind", "name", "category", "tags", "address", "town", "lat", "lon", "geo_source", "description",
               "website", "phone", "hours_url", "conditions", "discount_label", "discount_percent", "discount_amount",
               "special_rules", "source_url", "first_seen", "last_seen"]


def export_snapshot(path=SNAPSHOT):
    rows = db.q("SELECT * FROM facilities WHERE status='active' AND manual=0 ORDER BY slug")
    data = {"exported_at": db.now(), "source": BASE, "facilities": [{k: r.get(k) for k in SNAP_FIELDS} for r in rows]}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def load_snapshot(path=SNAPSHOT):
    if not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    season_id = seasons.season_id_for_date(dt.date.today())
    seasons.ensure_season_exists(season_id)
    n = 0
    with db.tx() as c:
        for f in data["facilities"]:
            if db.q1("SELECT id FROM facilities WHERE slug=?", (f["slug"],)):
                continue
            cols = [k for k in SNAP_FIELDS] + ["status", "updated_at"]
            vals = [f.get(k) for k in SNAP_FIELDS] + ["active", db.now()]
            cur = c.execute(f"INSERT INTO facilities({','.join(cols)}) VALUES({','.join('?' * len(cols))})", vals)
            c.execute("INSERT OR IGNORE INTO facility_seasons(facility_id,season_id) VALUES(?,?)", (cur.lastrowid, season_id))
            n += 1
    if n:
        log("snapshot", f"{n} Partner aus Snapshot vom {data.get('exported_at')} geladen (Quelle: {data.get('source')})")
    return n
