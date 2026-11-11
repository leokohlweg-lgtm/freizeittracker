"""Offizielle Tarifbestimmungen (Stand: freizeitticket.at/ticket/preise/, abgerufen 11.11.2026).

Diese Werte wurden 1:1 von der offiziellen Preisseite übernommen. Der wöchentliche
Partner-Sync liest die Seite erneut ein und aktualisiert bzw. ergänzt Saisonen.
"""
from . import db

OFFICIAL_SOURCE = "https://www.freizeitticket.at/ticket/preise/"

SEASONS = [
    {
        "id": "2026-27",
        "label": "2026/27",
        "start_date": "2026-10-01",
        "end_date": "2027-09-30",
        "source_url": OFFICIAL_SOURCE,
        "verified": 1,
        "notes": "Einzelpreise inkl. MwSt., zzgl. 3 € Keycard-Pfand. Vorverkauf 1.–31.10.2026.",
        "categories": [
            # key, label, Jahrgang von, Jahrgang bis, Flag, Vorverkauf, Normaltarif
            ("kinder", "Kinder", 2011, None, None, 410, 472),
            ("jugend", "Jugend", 2008, 2010, None, 631, 726),
            ("u23", "U23", 2003, 2007, None, 710, 817),
            ("erwachsene", "Erwachsene", 1962, 2002, None, 789, 908),
            ("senioren", "Senioren", None, 1961, None, 750, 862),
            ("behinderung", "Menschen mit Behinderung", None, None, "disability", 592, 681),
        ],
        "presale_until": "2026-10-31",
    }
]


def ensure_seasons():
    for s in SEASONS:
        if db.q1("SELECT id FROM seasons WHERE id=?", (s["id"],)):
            continue
        with db.tx() as c:
            c.execute(
                "INSERT INTO seasons(id,label,start_date,end_date,source_url,verified,notes,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                (s["id"], s["label"], s["start_date"], s["end_date"], s["source_url"], s["verified"], s["notes"], db.now()),
            )
            for i, (key, label, fy, ty, flag, pre, reg) in enumerate(s["categories"]):
                c.execute(
                    "INSERT INTO season_categories(season_id,key,label,birth_year_from,birth_year_to,requires_flag,price_presale,price_regular,presale_until,sort) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (s["id"], key, label, fy, ty, flag, pre, reg, s["presale_until"], i),
                )
