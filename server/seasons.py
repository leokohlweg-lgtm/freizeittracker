"""Saisonlogik und Ermittlung der Freizeitticket-Kategorie über Geburtsjahrgänge."""
import datetime as dt
from . import db


def season_id_for_date(d):
    """Saison läuft vom 1.10. bis 30.9. des Folgejahres."""
    if isinstance(d, str):
        d = dt.date.fromisoformat(d)
    start = d.year if d.month >= 10 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def season_bounds(season_id):
    start = int(season_id[:4])
    return dt.date(start, 10, 1), dt.date(start + 1, 9, 30)


def get_season(season_id):
    s = db.q1("SELECT * FROM seasons WHERE id=?", (season_id,))
    if not s:
        return None
    s["categories"] = db.q("SELECT * FROM season_categories WHERE season_id=? ORDER BY sort", (season_id,))
    return s


def list_seasons():
    out = db.q("SELECT * FROM seasons ORDER BY start_date DESC")
    for s in out:
        s["categories"] = db.q("SELECT * FROM season_categories WHERE season_id=? ORDER BY sort", (s["id"],))
    return out


def category_for(season_id, birth_date, disability=False):
    """Ermittelt die Kategorie ausschließlich über den Geburtsjahrgang laut Tarif der Saison.

    Gibt (category_row, erklärung) zurück. Das aktuelle Alter wird bewusst NICHT verwendet.
    """
    if isinstance(birth_date, str):
        birth_date = dt.date.fromisoformat(birth_date)
    season = get_season(season_id)
    if not season:
        return None, "Saison unbekannt"
    year = birth_date.year
    cats = season["categories"]
    if disability:
        for c in cats:
            if c["requires_flag"] == "disability":
                return c, f"Ermäßigung für Menschen mit Behinderung (GdB/MdE ab 60 %) laut Tarif {season['label']}"
    for c in cats:
        if c["requires_flag"]:
            continue
        lo, hi = c["birth_year_from"], c["birth_year_to"]
        if (lo is None or year >= lo) and (hi is None or year <= hi):
            return c, f"Jahrgang {year} → {c['label']} ({describe_range(lo, hi)}) laut Tarif {season['label']}"
    return None, f"Für Jahrgang {year} ist in der Saison {season['label']} keine Kategorie hinterlegt"


def describe_range(lo, hi):
    if lo is None and hi is None:
        return "alle Jahrgänge"
    if lo is None:
        return f"Jahrgang {hi} und älter"
    if hi is None:
        return f"Jahrgang {lo} und jünger"
    return f"Jahrgänge {lo} bis {hi}"


def ensure_season_exists(season_id):
    """Legt eine Saison an, falls sie fehlt. Ohne offizielle Daten werden die Jahrgangsgrenzen
    von der nächstgelegenen bekannten Saison verschoben übernommen und als UNBESTÄTIGT markiert."""
    if db.q1("SELECT id FROM seasons WHERE id=?", (season_id,)):
        return get_season(season_id)
    start = int(season_id[:4])
    ref = db.q1("SELECT * FROM seasons WHERE verified=1 ORDER BY ABS(CAST(substr(id,1,4) AS INTEGER) - ?) LIMIT 1", (start,))
    if not ref:
        raise ValueError("Keine Referenzsaison vorhanden")
    shift = start - int(ref["id"][:4])
    s, e = season_bounds(season_id)
    with db.tx() as c:
        c.execute(
            "INSERT INTO seasons(id,label,start_date,end_date,source_url,verified,notes,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            (season_id, f"{start}/{str(start + 1)[-2:]}", s.isoformat(), e.isoformat(), None, 0,
             f"Jahrgangsgrenzen aus Saison {ref['label']} um {shift:+d} Jahr(e) verschoben – nicht offiziell bestätigt. Preise unbekannt.",
             db.now()),
        )
        for cat in db.q("SELECT * FROM season_categories WHERE season_id=?", (ref["id"],)):
            c.execute(
                "INSERT INTO season_categories(season_id,key,label,birth_year_from,birth_year_to,requires_flag,price_presale,price_regular,presale_until,sort) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (season_id, cat["key"], cat["label"],
                 cat["birth_year_from"] + shift if cat["birth_year_from"] is not None else None,
                 cat["birth_year_to"] + shift if cat["birth_year_to"] is not None else None,
                 cat["requires_flag"], None, None, None, cat["sort"]),
            )
    return get_season(season_id)


def upsert_official_season(season_id, label, start, end, categories, source_url, notes=None):
    """Vom Sync aus der offiziellen Preisseite gelesene Regeln speichern."""
    with db.tx() as c:
        if db.q1("SELECT id FROM seasons WHERE id=?", (season_id,)):
            c.execute("UPDATE seasons SET label=?,start_date=?,end_date=?,source_url=?,verified=1,notes=COALESCE(?,notes),updated_at=? WHERE id=?",
                      (label, start, end, source_url, notes, db.now(), season_id))
        else:
            c.execute("INSERT INTO seasons(id,label,start_date,end_date,source_url,verified,notes,updated_at) VALUES(?,?,?,?,?,1,?,?)",
                      (season_id, label, start, end, source_url, notes, db.now()))
        for i, cat in enumerate(categories):
            c.execute(
                """INSERT INTO season_categories(season_id,key,label,birth_year_from,birth_year_to,requires_flag,price_presale,price_regular,presale_until,sort)
                   VALUES(?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(season_id,key) DO UPDATE SET label=excluded.label,birth_year_from=excluded.birth_year_from,
                   birth_year_to=excluded.birth_year_to,requires_flag=excluded.requires_flag,
                   price_presale=COALESCE(excluded.price_presale,price_presale),price_regular=COALESCE(excluded.price_regular,price_regular),
                   presale_until=COALESCE(excluded.presale_until,presale_until)""",
                (season_id, cat["key"], cat["label"], cat.get("birth_year_from"), cat.get("birth_year_to"), cat.get("requires_flag"),
                 cat.get("price_presale"), cat.get("price_regular"), cat.get("presale_until"), i),
            )
