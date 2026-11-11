"""Automatische Preisrecherche auf den offiziellen Websites der Partnerbetriebe.

Grundsätze:
- Es werden nur Preise gespeichert, die wörtlich auf einer Quelle stehen (inkl. Textauszug + URL).
- Nichts wird geschätzt oder erfunden. Nicht gefundene Preise bleiben "nicht verfügbar".
- Preisänderungen archivieren den alten Tarif (Historie bleibt erhalten).
- Nicht erreichbare Websites: letzte bestätigte Preise bleiben erhalten und gelten als möglicherweise veraltet.
- Unklare Fälle landen im Prüfprozess (review_needed) und können manuell bestätigt/ergänzt werden.
"""
import datetime as dt
import io
import json
import os
import re
import sys
import urllib.parse
import concurrent.futures as cf

from . import db, net, html, seasons
from .categories import CATEGORIES

try:
    import pypdf  # optional (requirements.txt), für PDF-Preislisten
except Exception:  # pragma: no cover
    pypdf = None

MAX_PAGES = 9
MAX_CANDIDATES = 80

LINK_POS = re.compile(r"preis|tarif|ticket|eintritt|kassa|skipass|ski-pass|karten|price|rates|preisliste|lift-?tickets|bergbahn-?tickets", re.I)
LINK_NEG = re.compile(r"warenkorb|cart|login|newsletter|jobs|karriere|gutschein|impressum|datenschutz|privacy|agb|presse|webcam|facebook|instagram|youtube|twitter|booking|hotel|zimmer|unterkunft|immobil|veranstaltung|events?/|blog|news|cookie|kontakt|anfahrt|gastronomie|speisekarte|menue|wetter", re.I)
FOREIGN = re.compile(r"/(en|it|nl|fr|cs|pl|es|da|sv|hu)(/|$)|[?&]lang=(en|it|nl)|\.(com|it)/en/", re.I)

_N = r"(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,4}(?:[.,]\d{1,2})?)(?![\d])"
PRICE_RXS = [
    re.compile(r"(?:€|EUR|Euro)\s?" + _N + r"(?:\s?,[-–])?", re.I),
    re.compile(r"(?<![\d.,])" + _N + r"(?:\s?,[-–])?\s?(?:€|EUR\b|Euro\b)", re.I),
]
# Plausible Bereiche je Kategorie (nur zur Qualitätskontrolle automatischer Funde, nie zum Schätzen)
PLAUSIBLE = {
    "ski": (8, 95), "bergbahn": (4, 75), "nacht": (3, 60), "rodeln": (3, 60), "hallenbad": (1, 35), "freibad": (0.5, 30),
    "badesee": (0.5, 25), "sauna": (5, 70), "eislaufen": (1, 25), "museum": (1, 45), "sehenswert": (1, 60),
}
BARE_PRICE = re.compile(r"^\s*(?:€\s?)?(\d{1,3}(?:[.,]\d{2}|,[-–]))\s*(?:€)?\s*$")

EXCLUDE = re.compile(
    r"saison(karte|pass|ticket|abo)|jahres(karte|abo|pass)|10er|zehner|\b\d{1,2}er[- ]?(block|karte)|block|abo\b|abonnement|"
    r"mehrtag|\b[2-9]\s?[-,½]?\s?tage|\b1[0-9]\s?-?\s?tage|wochen(karte|pass)|famil|gruppe|schul|kurs|verleih|leih|miete|mieten|"
    r"park(en|platz|gebühr)|pfand|keycard|key card|gutschein|führung|kaution|menü|kaffee|getränk|bier|essen|frühstück|"
    r"übernachtung|zimmer|pauschal|paket|hund|fahrrad|bike|e-bike|kinderwagen|garderobe|kästchen|spind|solarium|"
    r"massage|geburtstag|feier|miete|versand|porto|liefer|bonus|rabatt|ermäßigung mit|zuschlag|aufpreis|ab €|ab eur|"
    r"punkte|wertkarte|guthaben|aufladen|freizeitticket|superskicard|snow card|ski plus city|punktekarte|skikurs|skischule|"
    r"jede weitere|überschreit|angefangene|nachzahl|aufzahl|anhänger|recycling|abfall|müll|"
    r"chip|\bfzt\b|mit (dem )?freizeit|freizeit ?card|kombi|kwh|grundpreis|netzentgelt|cent\b|/monat|monatlich|jährlich|pro jahr|"
    r"mitglied|vorverkauf|online-?vorteil|statt\b|aktion|gratis|kostenlos|frei\b|inkl\. skipass|"
    r"\b([2-9]|\d{2})\s?x?\s?(fahrten|punkte|einheiten|eintritte|zutritte)\b|wertabo|sammelkarte|unlimited|unlimitiert|flatrate|"
    r"gepäck|transport|depot|shuttle|taxi|skibus|garage|aufbewahrung|schließfach|reservierung|stornogebühr|versicherung",
    re.I)

GROUPS = [
    ("ermaessigt", re.compile(r"ermäßig|ermässig|reduziert|behinder|\bbeh\.|invalid|begleitperson", re.I)),
    ("kind", re.compile(r"\bkind(er)?\b|\bkids?\b|\bchild|kinder\s?\(|knirps|bambini", re.I)),
    ("jugend", re.compile(r"jugend|junior|teen|youth|\bjgdl\b|jugendliche", re.I)),
    ("u23", re.compile(r"\bu\s?2[3-6]\b|unter 2[3-6]", re.I)),
    ("student", re.compile(r"student|studierende|lehrling|azubi|präsenzdien|zivildien", re.I)),
    ("senior", re.compile(r"senior|pension|rentner|\b6[05]\+", re.I)),
    ("erwachsene", re.compile(r"erwachsen|\badult|\berw\.?\b|\berw\b|vollpreis|normalpreis|normaltarif|standard(eintritt|preis|tarif|ticket)", re.I)),
]
# Kontext-Klassen von Tabellen-Containern (z. B. Varianten per Filter ein-/ausgeblendet)
CTX_SKIP = re.compile(r"\b(family|familie|familien|fam|jk|jahreskarte|season-?pass|saisonkarte|vvk|jk_vvk|group|gruppe|cards|fzt|spc|sc)\b", re.I)
CTX_HAUPT = re.compile(r"\b(hs|hauptsaison|high|peak|hochsaison)\b", re.I)
CTX_NEBEN = re.compile(r"\b(ns|nebensaison|low|vs|vorsaison|nachsaison)\b", re.I)
TIME_RANGE = re.compile(r"\b(\d{1,2})[:.](\d{2})\s?(?:-|–|bis)\s?(\d{1,2})[:.](\d{2})\b")
TICKETS = [
    ("stundenkarte", re.compile(r"\b(\d(?:[.,]5)?)\s?-?\s?(std|stunden|h)\b|stundenkarte|stundenticket", re.I)),
    ("halbtag", re.compile(r"halbtag|nachmittag|vormittag|ab\s?1[0-4][.:]?\d{0,2}\s?uhr|1/2[- ]?tag|½", re.I)),
    ("abend", re.compile(r"abend|nacht|night|flutlicht", re.I)),
    ("berg_tal", re.compile(r"berg-?\s?(und|&|/|u\.|\+)\s?tal|hin\s?(und|&|\+)\s?(zurück|retour)|retour|round ?trip|fußgänger|fussgänger|wanderer|pedestrian|panorama ?(karte|ticket)", re.I)),
    ("bergfahrt", re.compile(r"bergfahrt|talfahrt|einzelfahrt|einfache fahrt|one ?way|\b1\s?fahrt|\bfahrt\b|abfahrt|\b1\s?x\b", re.I)),
    ("tageskarte", re.compile(r"tages(ski)?(karte|pass|ticket|eintritt|skipass)|\b1[- ]?tag(es)?|ganztag|day ?pass|tageskarten", re.I)),
    ("einzeleintritt", re.compile(r"einzel(eintritt|karte|ticket)|eintritt|einzelperson|einmalig", re.I)),
]
DAY_WE = re.compile(r"wochenend|sa\.?\s?(,|/|und|&|-)\s?so|samstag|sonntag|feiertag", re.I)
DAY_WD = re.compile(r"mo\.?\s?[-–]\s?fr|montag bis freitag|werktag|wochentag", re.I)
SEASON_H = re.compile(r"hauptsaison|hochsaison|peak", re.I)
SEASON_N = re.compile(r"nebensaison|vorsaison|nachsaison|low season", re.I)
SEASON_TOKEN = re.compile(r"(?:winter|saison|sommer)?\s?(20\d{2})\s?/\s?(?:20)?(\d{2})(?!\d)", re.I)


def _num(s):
    s = s.replace("–", "-").replace(",-", "").replace(".-", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    return float(s)


def find_prices(s):
    out = []
    for rx in PRICE_RXS:
        for m in rx.finditer(s):
            try:
                v = _num(m.group(1))
            except ValueError:
                continue
            if not any(abs(a - m.start()) < 3 for a, _ in out):
                out.append((m.start(), v))
    out.sort()
    return [v for _, v in out]


def detect_group(text):
    found = [g for g, rx in GROUPS if rx.search(text)]
    return found


def detect_ticket(text):
    m = TIME_RANGE.search(text)
    if m:
        try:
            h = (int(m.group(3)) * 60 + int(m.group(4)) - int(m.group(1)) * 60 - int(m.group(2))) / 60
            if 0 < h <= 6.5:
                return "halbtag", None
        except ValueError:
            pass
    for t, rx in TICKETS:
        m = rx.search(text)
        if m:
            dur = None
            if t == "stundenkarte" and m.group(1):
                try:
                    dur = _num(m.group(1))
                except ValueError:
                    dur = None
            return t, dur
    return None, None


def detect_ages(text):
    t = text.lower()
    r = {}
    m = re.search(r"(?:jg\.?|jahrg\w*|geb\.?|geboren)\s*(?:ab\s*)?((?:19|20)\d{2})\s*(?:-|–|bis|und)\s*((?:19|20)\d{2})", t)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        r["birth_year_from"], r["birth_year_to"] = min(a, b), max(a, b)
        return r
    m = re.search(r"((?:19|20)\d{2})\s*(?:und|u\.)\s*(jünger|später|danach)", t)
    if m:
        r["birth_year_from"] = int(m.group(1))
        return r
    m = re.search(r"((?:19|20)\d{2})\s*(?:und|u\.)\s*(älter|früher|davor)", t)
    if m:
        r["birth_year_to"] = int(m.group(1))
        return r
    if detect_group(t) and not re.search(r"\d{4}\s?/\s?\d{2}", t):
        # z. B. Spaltenkopf "ERW. 2002-1962" oder "KIND 2020 - 2011"
        m = re.search(r"(?<!\d)((?:19|20)\d{2})\s*(?:-|–|bis)\s*((?:19|20)\d{2})(?!\d)", t)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if a != b and 1900 < min(a, b) and max(a, b) <= dt.date.today().year:
                r["birth_year_from"], r["birth_year_to"] = min(a, b), max(a, b)
                return r
    m = re.search(r"(?:ab\s+(?:dem\s+)?|nach\s+(?:dem\s+)?)?vollendet\w*\s+(\d{1,2})\.?\s*lebensjahr", t)
    if m and "bis" not in t[max(0, m.start() - 12):m.start()]:
        r["age_min"] = int(m.group(1))
    m = re.search(r"bis\s+(?:zum\s+)?(?:vollendet\w*\s+)?(\d{1,2})\.\s*lebensjahr", t)
    if m:
        r["age_max"] = int(m.group(1)) - 1 if "vollendet" in m.group(0) else int(m.group(1))
    if r:
        return r
    if re.search(r"\bu\s?23\b|unter 23", t):
        return {"age_max": 22}
    m = re.search(r"(\d{1,2})\s*(?:-|–|bis)\s*(\d{1,2})\s*(?:j\b|j\.|jahr|jhr|jähr|yrs|years)", t)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if a < b <= 99:
            r["age_min"], r["age_max"] = a, b
            return r
    m = re.search(r"(?:ab|über|from)\s*(\d{1,2})\s*(?:j\b|j\.|jahr|jhr|yrs|years)", t)
    if m:
        r["age_min"] = int(m.group(1)) + (1 if "über" in m.group(0) else 0)
    m = re.search(r"(?:bis|unter|under)\s*(\d{1,2})\s*(?:j\b|j\.|jahr|jhr|yrs|years)", t)
    if m:
        r["age_max"] = int(m.group(1)) - (1 if ("unter" in m.group(0) or "under" in m.group(0)) else 0)
    m = re.search(r"(?<![\d.,])(\d{1,2})\s?\+(?!\s?\d)", t)
    if m and "age_min" not in r and detect_group(t):
        r["age_min"] = int(m.group(1))
    return r


def detect_dates(text):
    ds = re.findall(r"(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d{2})", text)
    if len(ds) >= 2:
        try:
            a = dt.date(int(ds[0][2]), int(ds[0][1]), int(ds[0][0]))
            b = dt.date(int(ds[1][2]), int(ds[1][1]), int(ds[1][0]))
            if a <= b:
                return a.isoformat(), b.isoformat()
        except ValueError:
            pass
    return None, None


def page_seasons(lines):
    found = {}
    for l in lines:
        for m in SEASON_TOKEN.finditer(l):
            y1, y2 = int(m.group(1)), int(m.group(2)) % 100
            if (y1 + 1) % 100 == y2:
                sid = f"{y1}-{y2:02d}"
                found[sid] = found.get(sid, 0) + 1
    return found


def extract(lines, url, category="sonstiges"):
    """Extrahiert Preis-Kandidaten aus Textzeilen. Jeder Kandidat enthält den Original-Textauszug."""
    cands = []
    heading = ""
    header_cells = None
    header_has_eur = False
    ctx = ""
    text_lines = [l for l in lines if not l.startswith("\x00ctx")]
    page_euro = sum(1 for l in text_lines if "€" in l or re.search(r"\bEUR\b|\bEuro\b", l)) > 0
    defs = group_definitions(text_lines)
    for i, line in enumerate(lines):
        if line.startswith("\x00ctx"):
            new = line[4:].strip()
            if new and not ctx:
                heading = ""  # neuer Tabellen-Container: Überschriften außerhalb (z. B. Filter-Buttons) nicht übernehmen
            ctx = new
            continue
        skip_ctx = bool(ctx and CTX_SKIP.search(ctx))
        cells = [c.strip() for c in line.split(" | ")] if " | " in line else None
        prices = find_prices(line)
        bare_cells = []
        if cells:
            bare = [(j, _num(BARE_PRICE.match(c).group(1))) for j, c in enumerate(cells) if BARE_PRICE.match(c)]
            hdr_groups = bool(header_cells and detect_group(" ".join(header_cells)))
            if header_has_eur or "€" in line or (len(bare) >= 2 and (hdr_groups or detect_ticket(line)[0]) and (page_euro or hdr_groups)):
                bare_cells = bare
        if not prices and not bare_cells:
            if cells and len(cells) >= 2:
                header_cells = cells
                header_has_eur = bool(re.search(r"€|\beur\b|preis|tarif", line, re.I))
            elif len(line) < 90:
                heading = line
                if not cells:
                    header_cells = None
            continue
        if skip_ctx:
            continue
        ctx_prev = " ".join(l for l in lines[max(0, i - 2):i] if not l.startswith("\x00ctx"))
        season_ctx = "haupt" if CTX_HAUPT.search(ctx) else ("neben" if CTX_NEBEN.search(ctx) else None)
        if cells and len(cells) >= 2:
            # Tabellenzeile: Zellen mit Preisen den Spaltenköpfen zuordnen (rechtsbündig, falls Kopf ohne Labelspalte)
            label_cells = [c for c in cells if not find_prices(c) and not BARE_PRICE.match(c)]
            row_label = " ".join(label_cells)
            price_cells = [(j, find_prices(c)[0]) for j, c in enumerate(cells) if find_prices(c)] or bare_cells
            for j, v in price_cells:
                col = ""
                if header_cells:
                    k = j + (len(header_cells) - len(cells))
                    if 0 <= k < len(header_cells):
                        col = header_cells[k]
                label = " / ".join(x for x in (row_label, col) if x)
                cands.append(_candidate(label, heading, ctx_prev, v, line, url, category, from_table=True, season_ctx=season_ctx, defs=defs))
        else:
            if len(prices) > 3 or len(line) > 260:
                # Fließtext mit vielen Preisen: in Segmente zerlegen
                segs = re.split(r"(?<=[€\d-])\s*[,;•·]\s+|\s{2,}|\s[-–]\s", line)
                for seg in segs:
                    for v in find_prices(seg)[:1]:
                        cands.append(_candidate(seg, heading, ctx_prev, v, line, url, category, from_table=False, penalty=0.1,
                                                season_ctx=season_ctx, defs=defs))
            else:
                for v in prices:
                    cands.append(_candidate(line, heading, ctx_prev, v, line, url, category, from_table=False, season_ctx=season_ctx, defs=defs))
    out, seen = [], set()
    for c in cands:
        if not c:
            continue
        key = (c["label_norm"], c["price"])
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    out.sort(key=lambda c: -c["confidence"])
    return out[:MAX_CANDIDATES]


def group_definitions(lines):
    """Fußnoten wie 'Senioren: ab vollendetem 65. Lebensjahr' oder 'Kinder (6–14 Jahre)' auswerten."""
    defs = {}
    for l in lines:
        if len(l) > 220:
            continue
        m = re.match(r"^\W{0,3}(kinder|kind|jugendliche|jugend|senioren|senior|studierende|studenten|erwachsene)\b\s*(?:\d\s*)?[:(–-]\s*(.+)", l, re.I)
        if not m or find_prices(l):
            continue
        groups = detect_group(m.group(1))
        ages = detect_ages(m.group(2))
        if groups and ages and groups[0] not in defs:
            defs[groups[0]] = ages
    return defs


def _candidate(label, heading, ctx_prev, price, line, url, category, from_table, penalty=0.0, season_ctx=None, defs=None):
    label = html.clean(re.sub(r"\s*\|\s*", " ", label)).strip(" /")
    if re.match(r"^\+", label) or re.search(r"\+\s?\d\s?(h|std)\b|verlängerung|zusatzstunde|je weitere", label, re.I):
        return None  # Aufpreise / Verlängerungen sind keine Eintrittspreise
    full = f"{heading} {ctx_prev} {label}"
    if not (0.5 <= price <= 250):
        return None
    if EXCLUDE.search(label) or EXCLUDE.search(heading or ""):
        return None
    if re.search(r"%|prozent|ersparnis|sparen|statt\s", label, re.I):
        return None
    groups = detect_group(label)
    group_src = "label"
    if not groups:
        groups = detect_group(heading + " " + ctx_prev[-120:])
        group_src = "context"
    ttype, dur = detect_ticket(label)
    tsrc = "label"
    if not ttype:
        ttype, dur = detect_ticket(heading + " " + ctx_prev[-160:])
        tsrc = "context"
    if not groups and not ttype:
        return None
    if len(set(groups)) > 1 and group_src == "label":
        # "Erwachsene / Kinder" in einer Zelle mit nur einem Preis -> mehrdeutig
        if not re.search(r"[|/]", label):
            groups = groups[:1]
    group = groups[0] if groups else "unbekannt"
    if not ttype:
        ttype = CATEGORIES.get(category, CATEGORIES["sonstiges"])["default_ticket"]
        tsrc = "kategorie"
    # Zusatzleistungen (z. B. Sauna im Hallenbad) nicht als Standard-Eintritt werten
    if category not in ("sauna",) and re.search(r"sauna|dampfbad|wellness", label + " " + heading, re.I):
        ttype = "sonstiges"
    ages = detect_ages(label) or detect_ages(heading)
    if not ages and defs and group in defs:
        ages = defs[group]
    day_type = "wochenende" if DAY_WE.search(full) else ("werktag" if DAY_WD.search(full) else "alle")
    season_type = "haupt" if SEASON_H.search(label + " " + heading) else ("neben" if SEASON_N.search(label + " " + heading) else "alle")
    if season_type == "alle" and season_ctx:
        season_type = season_ctx
        label = f"{label} ({'Hauptsaison' if season_ctx == 'haupt' else 'Nebensaison'})"
    vf, vt = detect_dates(label + " " + heading)
    conf = 0.45
    conf += 0.2 if group_src == "label" and groups else (0.05 if groups else 0)
    conf += 0.15 if tsrc == "label" else (0.05 if tsrc == "context" else -0.1)
    conf += 0.1 if from_table else 0
    conf += 0.05 if ages else 0
    conf -= penalty
    if len(line) > 200:
        conf -= 0.1
    lo, hi = PLAUSIBLE.get(category, (0.5, 150))
    implausible = not (lo <= price <= hi) and ttype != "sonstiges"
    if implausible:
        conf -= 0.4
    nice = label if len(label) <= 120 else label[:117] + "…"
    ctx_label = nice
    if group_src == "context" or tsrc == "context":
        hl = heading if len(heading) < 60 else ""
        ctx_label = (hl + " – " + nice) if hl and hl.lower() not in nice.lower() else nice
    return {
        "label": ctx_label,
        "label_norm": re.sub(r"[^a-z0-9äöüß]+", " ", ctx_label.lower()).strip()[:80],
        "age_group": group,
        "age_min": ages.get("age_min"), "age_max": ages.get("age_max"),
        "birth_year_from": ages.get("birth_year_from"), "birth_year_to": ages.get("birth_year_to"),
        "ticket_type": ttype, "duration_hours": dur,
        "day_type": day_type, "season_type": season_type,
        "valid_from": vf, "valid_to": vt,
        "price": round(price, 2),
        "confidence": round(max(0.05, min(conf, 0.95)), 2),
        "source_url": url,
        "source_snippet": (heading + " › " if heading and heading not in line else "") + line[:300],
        "note": f"Preis außerhalb des üblichen Bereichs ({lo:g}–{hi:g} €) – bitte prüfen" if implausible else None,
    }


# ---------------------------------------------------------------- Seiten finden

def discover(start_url, start_text, max_pages=MAX_PAGES, must=None):
    root = html.parse(start_text)
    links = []
    # Tiefe Start-URL (z. B. ikb.at/baeder/hallenbad-...): nur im selben Bereich suchen
    segs = [s for s in urllib.parse.urlsplit(start_url).path.split("/") if s]
    prefix = "/" + segs[0] + "/" if len(segs) >= 2 else None
    for a in root.find_all("a"):
        u = net.normalize_url(a.attrs.get("href"), start_url)
        if not u or not net.same_site(u, start_url):
            continue
        if prefix and not urllib.parse.urlsplit(u).path.startswith(prefix):
            continue
        text = a.text() + " " + (a.attrs.get("title") or "")
        if must:
            from .categories import norm
            hay = norm(text + " " + u)
            if not any(w in hay for w in must):
                continue
        score = 2 if must else 0
        if LINK_POS.search(text):
            score += 3
        if LINK_POS.search(u):
            score += 2
        if score == 0:
            continue
        if LINK_NEG.search(u) or LINK_NEG.search(text):
            score -= 3
        if FOREIGN.search(u):
            score -= 4
        if u.lower().endswith(".pdf"):
            score += 1
        if re.search(r"winter|sommer|20\d\d", u + text, re.I):
            score += 1
        if score > 0:
            links.append((score, u))
    best = {}
    for s, u in links:
        best[u] = max(best.get(u, 0), s)
    return [u for u, _ in sorted(best.items(), key=lambda kv: -kv[1])][:max_pages]


def page_lines(resp):
    if resp.is_pdf:
        if not pypdf:
            return None
        try:
            reader = pypdf.PdfReader(io.BytesIO(resp.body))
            text = "\n".join((p.extract_text() or "") for p in reader.pages[:12])
        except Exception:
            return None
        lines = []
        for l in text.splitlines():
            l = html.clean(l)
            if l:
                # PDF-Spalten (mehrere Leerzeichen) als Zellen behandeln
                lines.append(re.sub(r"\s{3,}", " | ", l))
        return lines
    root = html.parse(resp.text())
    main = root.find("main") or root.find("body") or root
    for tag in ("nav", "footer", "header"):
        for n in main.find_all(tag):
            n.children = []
    return main.lines(with_context=True)


# ---------------------------------------------------------------- Ablauf je Betrieb

def check_facility(fid):
    f = db.q1("SELECT * FROM facilities WHERE id=?", (fid,))
    started = db.now()
    with db.tx() as c:
        cid = c.execute("INSERT INTO price_checks(facility_id,started_at,status) VALUES(?,?,?)", (fid, started, "running")).lastrowid
    result = {"status": None, "pages": 0, "found": 0, "changes": 0, "message": "", "sources": []}
    try:
        _run_check(f, result)
    except Exception as e:  # nie die gesamte Recherche abbrechen
        result["status"] = "error"
        result["message"] = f"Interner Fehler: {type(e).__name__}: {e}"
    status = result["status"]
    fac_status = {"ok": "ok", "not_found": "not_found", "unreachable": "unreachable", "blocked": "blocked",
                  "no_website": "not_found", "error": "unreachable"}.get(status, "not_found")
    has_tariffs = db.q1("SELECT COUNT(*) n FROM tariffs WHERE facility_id=? AND archived_at IS NULL", (fid,))["n"]
    if fac_status in ("unreachable", "blocked") and has_tariffs:
        fac_status = "stale"
        result["message"] += " – letzte bestätigte Preise bleiben erhalten (möglicherweise veraltet)."
    review = 1 if fac_status != "ok" or result.get("review") else 0
    with db.tx() as c:
        c.execute("UPDATE price_checks SET finished_at=?,status=?,pages_checked=?,prices_found=?,changes=?,message=?,sources=? WHERE id=?",
                  (db.now(), status, result["pages"], result["found"], result["changes"], result["message"], json.dumps(result["sources"]), cid))
        c.execute("UPDATE facilities SET price_status=?,price_checked_at=?,price_check_message=?,review_needed=? WHERE id=?",
                  (fac_status, db.now(), result["message"], review, fid))
        c.execute("DELETE FROM price_checks WHERE facility_id=? AND id NOT IN (SELECT id FROM price_checks WHERE facility_id=? ORDER BY id DESC LIMIT 20)", (fid, fid))
    return result


def _run_check(f, result):
    start = f["price_url"] or f["website"]
    if not start:
        result.update(status="no_website", message="Keine offizielle Website hinterlegt")
        return
    if not start.startswith("http"):
        start = "http://" + start
    # Fallbacks: veraltete Deep-Links (404) -> Startseite; nicht existierende www-Subdomain -> ohne www
    p = urllib.parse.urlsplit(start)
    host_nowww = p.netloc[4:] if p.netloc.startswith("www.") else None
    tries = [start, f"{p.scheme}://{p.netloc}/"]
    if host_nowww:
        tries += [urllib.parse.urlunsplit((p.scheme, host_nowww, p.path, p.query, "")), f"{p.scheme}://{host_nowww}/"]
    first, err, seen_t = None, None, set()
    for u in tries:
        if u in seen_t:
            continue
        seen_t.add(u)
        try:
            first = net.get(u)
            if u != start:
                result["sources"].append({"url": u, "prices": 0, "fallback_for": start})
            break
        except net.FetchError as e:
            err = e
            if e.kind == "blocked":
                break
    if first is None:
        e = err
        result.update(status=e.kind if e.kind in ("blocked", "unreachable") else "unreachable", message=f"Website nicht erreichbar ({e})")
        return
    fallback = bool(result["sources"])
    must = None
    deep = len([s for s in urllib.parse.urlsplit(first.url).path.split("/") if s]) >= 2
    if fallback or deep:
        # Sammel-Websites (Gemeinde, Stadtwerke …): nur Seiten, die erkennbar zu diesem Betrieb gehören
        from .categories import norm
        generic = {"innsbruck", "tirol", "hall", "bahn", "bahnen", "museum", "skilift", "lift", "platz", "bergbahnen", "familie",
                   "schwimmbad", "hallenbad", "freibad", "eislaufplatz", "badesee", "strasse"}
        must = [w for w in norm(f["name"]).split() if len(w) >= 4 and w not in generic] or None
        if fallback:
            result["review"] = True
    pages = [(first.url, first)]
    targets = []
    if not first.is_pdf:
        targets = discover(first.url, first.text(), must=must)
        # zweite Ebene: Preisseiten verlinken oft auf Unterseiten (z. B. /tickets/ -> /tickets/tageskarten/)
        for u in targets[:2]:
            if len(targets) >= MAX_PAGES:
                break
            try:
                r = net.get(u)
                pages.append((r.url, r))
                if not r.is_pdf:
                    for v in discover(r.url, r.text(), 5, must=must):
                        if v not in targets and v != first.url:
                            targets.append(v)
            except net.FetchError:
                continue
    fetched = {p[0] for p in pages}
    for u in targets[:MAX_PAGES]:
        if u in fetched or len(pages) > MAX_PAGES:
            continue
        try:
            r = net.get(u)
            pages.append((r.url, r))
            fetched.add(r.url)
        except net.FetchError:
            continue

    current = seasons.season_id_for_date(dt.date.today())
    all_cands, pdf_skipped = [], []
    for url, resp in pages:
        lines = page_lines(resp)
        result["pages"] += 1
        if lines is None:
            pdf_skipped.append(url)
            continue
        if fallback and url == first.url:
            continue  # Startseite einer Sammel-Website enthält oft Preise anderer Einrichtungen
        cands = extract(lines, url, f["category"])
        if fallback:
            for c in cands:
                c["confidence"] = round(max(0.05, c["confidence"] - 0.2), 2)
                c["note"] = "Über die Startseite gefunden (ursprünglicher Link veraltet) – bitte prüfen"
        if not cands:
            continue
        found_seasons = page_seasons(lines)
        src_season = max(found_seasons, key=found_seasons.get) if found_seasons else None
        for c in cands:
            c["source_season"] = src_season
            if src_season and src_season < current:
                c["confidence"] = round(max(0.05, c["confidence"] - 0.25), 2)
                c["note"] = f"Quelle nennt Saison {src_season.replace('-', '/')} – möglicherweise nicht aktuell"
            if src_season == current:
                c["season_id"] = current
        all_cands.extend(cands)
        result["sources"].append({"url": url, "prices": len(cands), "season": src_season})

    # Duplikate seitenübergreifend entfernen
    uniq, seen = [], set()
    for c in sorted(all_cands, key=lambda c: -c["confidence"]):
        k = (c["label_norm"], c["price"], c["ticket_type"])
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    uniq = uniq[:MAX_CANDIDATES]
    result["found"] = len(uniq)
    if pdf_skipped:
        result["sources"].extend({"url": u, "prices": 0, "pdf_unreadable": True} for u in pdf_skipped)
    if not uniq:
        msg = f"{result['pages']} Seite(n) geprüft, keine eindeutigen Preise gefunden"
        if pdf_skipped:
            msg += f"; PDF-Preisliste gefunden: {pdf_skipped[0]}"
        # Quelle war erreichbar, frühere automatische Funde sind dort nicht mehr auffindbar -> archivieren (Historie bleibt)
        with db.tx() as c:
            n = c.execute("UPDATE tariffs SET archived_at=?, archive_reason=? WHERE facility_id=? AND status='auto' AND archived_at IS NULL",
                          (db.now(), "Bei der letzten Prüfung nicht mehr auf der Quelle gefunden", f["id"])).rowcount
        if n:
            msg += f"; {n} ältere automatische Preise archiviert"
            result["changes"] = n
        result.update(status="not_found", message=msg)
        return
    result["changes"], result["review"] = merge(f["id"], uniq)
    result.update(status="ok", message=f"{len(uniq)} Preis(e) auf {len(result['sources'])} Quelle(n) gefunden, {result['changes']} Änderung(en)")


def _key(t):
    return (t["label_norm"] if "label_norm" in t else re.sub(r"[^a-z0-9äöüß]+", " ", t["label"].lower()).strip()[:80],
            t["ticket_type"], t.get("age_min"), t.get("age_max"), t.get("birth_year_from"), t.get("birth_year_to"),
            t["day_type"], t["season_type"])


def merge(fid, cands):
    """Neue Kandidaten mit gespeicherten Auto-Tarifen abgleichen. Gibt (#Änderungen, review_needed) zurück."""
    now = db.now()
    existing = db.q("SELECT * FROM tariffs WHERE facility_id=? AND archived_at IS NULL", (fid,))
    auto = {}
    for t in existing:
        if t["status"] == "auto":
            auto.setdefault(_key(t), []).append(t)
    protected = {_key(t): t for t in existing if t["status"] in ("verified", "user")}
    changes, review, matched = 0, False, set()
    with db.tx() as c:
        for cand in cands:
            k = _key(cand)
            olds = auto.get(k, [])
            same = next((o for o in olds if abs(o["price"] - cand["price"]) < 0.005 and o["id"] not in matched), None)
            if same:
                matched.add(same["id"])
                c.execute("UPDATE tariffs SET last_confirmed_at=?, source_url=?, source_snippet=?, confidence=?, source_season=?, note=? WHERE id=?",
                          (now, cand["source_url"], cand["source_snippet"], cand["confidence"], cand.get("source_season"), cand.get("note"), same["id"]))
                continue
            new_id = _insert(c, fid, cand, now)
            changed = next((o for o in olds if o["id"] not in matched), None)
            if changed:
                matched.add(changed["id"])
                c.execute("UPDATE tariffs SET archived_at=?, archive_reason=?, replaced_by=? WHERE id=?",
                          (now, f"Preisänderung erkannt: {changed['price']:.2f} € → {cand['price']:.2f} €", new_id, changed["id"]))
                c.execute("INSERT INTO sync_log(at,kind,facility_id,message) VALUES(?,?,?,?)",
                          (now, "price_change", fid, f"{cand['label']}: {changed['price']:.2f} € → {cand['price']:.2f} €"))
                changes += 1
            elif auto:
                changes += 1
            p = protected.get(k)
            if p and abs(p["price"] - cand["price"]) >= 0.005:
                review = True
                c.execute("INSERT INTO sync_log(at,kind,facility_id,message) VALUES(?,?,?,?)",
                          (now, "review", fid, f"Bestätigter Preis {p['price']:.2f} € weicht von Quelle ab ({cand['price']:.2f} €): {cand['label']}"))
        # Auto-Tarife, die auf der Quelle nicht mehr vorkommen, archivieren (Historie bleibt)
        for lst in auto.values():
            for o in lst:
                if o["id"] not in matched:
                    c.execute("UPDATE tariffs SET archived_at=?, archive_reason=? WHERE id=?", (now, "Nicht mehr auf der Quelle gefunden", o["id"]))
                    changes += 1
    if any(c["confidence"] < 0.5 for c in cands):
        review = True
    return changes, review


def _insert(c, fid, cand, now):
    return c.execute(
        """INSERT INTO tariffs(facility_id,season_id,label,age_group,age_min,age_max,birth_year_from,birth_year_to,ticket_type,
           duration_hours,day_type,season_type,valid_from,valid_to,price,status,confidence,source_url,source_snippet,source_season,
           found_at,last_confirmed_at,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (fid, cand.get("season_id"), cand["label"], cand["age_group"], cand["age_min"], cand["age_max"], cand["birth_year_from"],
         cand["birth_year_to"], cand["ticket_type"], cand["duration_hours"], cand["day_type"], cand["season_type"],
         cand["valid_from"], cand["valid_to"], cand["price"], "auto", cand["confidence"], cand["source_url"],
         cand["source_snippet"], cand.get("source_season"), now, now, cand.get("note"))).lastrowid


def crawl_all(progress=None, workers=4, only_ids=None):
    ids = only_ids or [r["id"] for r in db.q("SELECT id FROM facilities WHERE status='active' ORDER BY price_checked_at IS NOT NULL, price_checked_at")]
    stats = {"total": len(ids), "ok": 0, "not_found": 0, "unreachable": 0, "changes": 0}
    done = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(check_facility, i): i for i in ids}
        for fut in cf.as_completed(futs):
            done += 1
            try:
                r = fut.result()
                st = r["status"]
                stats["ok" if st == "ok" else ("not_found" if st in ("not_found", "no_website") else "unreachable")] += 1
                stats["changes"] += r["changes"]
            except Exception:
                stats["unreachable"] += 1
            if progress:
                progress(f"Preisrecherche {done}/{len(ids)}")
    return stats
