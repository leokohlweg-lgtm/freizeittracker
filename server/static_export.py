"""Preiskatalog als statische Datei (web/data/catalog.json).

Die Handy-App braucht keinen Server: Ein wöchentlicher Cloud-Job (GitHub Actions) stellt die Datenbank
aus dem letzten Katalog wieder her, gleicht Partner ab, recherchiert Preise und schreibt den neuen
Katalog. Persönliche Daten kommen darin nicht vor – die bleiben auf dem Handy.
"""
import datetime as dt
import json
import os

from . import db, seasons
from .categories import CATEGORIES, TICKET_TYPES, TAG_LABELS
from .crawler import PLAUSIBLE

CATALOG = os.path.join(db.ROOT, "web", "data", "catalog.json")
HISTORY_DAYS = 400

FAC_FIELDS = ["id", "slug", "kind", "name", "category", "tags", "town", "address", "lat", "lon", "geo_source", "description", "website",
              "price_url", "phone", "hours_url", "conditions", "discount_label", "discount_percent", "discount_amount", "special_rules",
              "source_url", "status", "manual", "first_seen", "last_seen", "archived_at", "updated_at", "price_status", "price_checked_at",
              "price_check_message", "review_needed"]
TAR_FIELDS = ["id", "facility_id", "season_id", "label", "age_group", "age_min", "age_max", "birth_year_from", "birth_year_to", "ticket_type",
              "duration_hours", "day_type", "season_type", "valid_from", "valid_to", "price", "status", "confidence", "source_url",
              "source_snippet", "source_season", "found_at", "last_confirmed_at", "archived_at", "archive_reason", "replaced_by", "note"]


def export_catalog(path=CATALOG):
    cutoff = (dt.datetime.now() - dt.timedelta(days=HISTORY_DAYS)).isoformat(sep=" ")
    facs = db.q("SELECT * FROM facilities ORDER BY name COLLATE NOCASE")
    for f in facs:
        f["seasons"] = [r["season_id"] for r in db.q("SELECT season_id FROM facility_seasons WHERE facility_id=?", (f["id"],))]
        last = db.q1("SELECT sources FROM price_checks WHERE facility_id=? ORDER BY id DESC LIMIT 1", (f["id"],))
        f["sources"] = json.loads(last["sources"]) if last and last["sources"] else []
    out = {
        "format": 1,
        "generated_at": db.now(),
        "source": "https://www.freizeitticket.at/",
        "current_season": seasons.season_id_for_date(dt.date.today()),
        "seasons": seasons.list_seasons(),
        "categories": [{"key": k, **v} for k, v in CATEGORIES.items()],
        "ticket_types": TICKET_TYPES,
        "tag_labels": TAG_LABELS,
        "plausible": PLAUSIBLE,
        "facilities": [{k: f.get(k) for k in FAC_FIELDS + ["seasons", "sources"]} for f in facs],
        "tariffs": [{k: t.get(k) for k in TAR_FIELDS} for t in db.q("SELECT * FROM tariffs WHERE archived_at IS NULL ORDER BY facility_id, id")],
        "history": [{k: t.get(k) for k in TAR_FIELDS} for t in
                    db.q("SELECT * FROM tariffs WHERE archived_at IS NOT NULL AND archived_at >= ? ORDER BY facility_id, archived_at DESC", (cutoff,))],
        "log": db.q("SELECT at, kind, facility_id, message FROM sync_log ORDER BY id DESC LIMIT 150"),
        "jobs": db.q("SELECT name, last_run_at, last_finished_at, last_status, last_message FROM jobs WHERE name IN ('partner_sync','price_crawl')"),
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    return path


def restore_catalog(path=CATALOG):
    """Datenbank aus dem letzten Katalog aufbauen (IDs bleiben stabil, Preisverlauf bleibt erhalten)."""
    if not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8") as fh:
        cat = json.load(fh)
    with db.tx() as c:
        for s in cat["seasons"]:
            c.execute("INSERT OR REPLACE INTO seasons(id,label,start_date,end_date,source_url,verified,notes,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                      (s["id"], s["label"], s["start_date"], s["end_date"], s.get("source_url"), s["verified"], s.get("notes"), s.get("updated_at")))
            for k in s["categories"]:
                c.execute("""INSERT OR REPLACE INTO season_categories(season_id,key,label,birth_year_from,birth_year_to,requires_flag,price_presale,
                             price_regular,presale_until,sort) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                          (s["id"], k["key"], k["label"], k.get("birth_year_from"), k.get("birth_year_to"), k.get("requires_flag"),
                           k.get("price_presale"), k.get("price_regular"), k.get("presale_until"), k.get("sort", 0)))
        for f in cat["facilities"]:
            cols = [k for k in FAC_FIELDS if k in f]
            c.execute(f"INSERT OR REPLACE INTO facilities({','.join(cols)}) VALUES({','.join('?' * len(cols))})", [f[k] for k in cols])
            for sid in f.get("seasons", []):
                c.execute("INSERT OR IGNORE INTO facility_seasons(facility_id,season_id) VALUES(?,?)", (f["id"], sid))
        for t in cat["tariffs"] + cat.get("history", []):
            cols = [k for k in TAR_FIELDS if k in t]
            c.execute(f"INSERT OR REPLACE INTO tariffs({','.join(cols)}) VALUES({','.join('?' * len(cols))})", [t[k] for k in cols])
        for l in reversed(cat.get("log", [])):
            c.execute("INSERT INTO sync_log(at,kind,facility_id,message) VALUES(?,?,?,?)", (l["at"], l["kind"], l.get("facility_id"), l["message"]))
        for j in [j for j in cat.get("jobs", []) if j["name"] in ("partner_sync", "price_crawl")]:
            c.execute("INSERT OR REPLACE INTO jobs(name,last_run_at,last_finished_at,last_status,last_message,running) VALUES(?,?,?,?,?,0)",
                      (j["name"], j["last_run_at"], j["last_finished_at"], j["last_status"], j["last_message"]))
    return len(cat["facilities"])


def record_job(name, status, message, started):
    with db.tx() as c:
        c.execute("INSERT OR REPLACE INTO jobs(name,last_run_at,last_finished_at,last_status,last_message,running) VALUES(?,?,?,?,?,0)",
                  (name, started, db.now(), status, message))
