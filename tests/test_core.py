"""Tests der Python-Seite (Partner-Sync, Preisrecherche, Katalog): python -m unittest discover -s tests -v

Die Preis- und Sparlogik läuft in der App (JavaScript) und wird mit web/selftest.html geprüft.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import db, seasons, crawler, importer, static_export  # noqa: E402


def setUpModule():
    global TMP
    TMP = tempfile.mkdtemp()
    db.init(os.path.join(TMP, "test.db"))


class SeasonTests(unittest.TestCase):
    def test_season_bounds(self):
        self.assertEqual(seasons.season_id_for_date("2026-10-01"), "2026-27")
        self.assertEqual(seasons.season_id_for_date("2027-09-30"), "2026-27")
        self.assertEqual(seasons.season_id_for_date("2027-10-01"), "2027-28")

    def test_category_by_birth_year_not_age(self):
        cases = {"2011-12-31": "kinder", "2010-01-01": "jugend", "2007-12-31": "u23", "2003-01-01": "u23",
                 "2002-12-31": "erwachsene", "1962-01-01": "erwachsene", "1961-12-31": "senioren"}
        for birth, key in cases.items():
            cat, why = seasons.category_for("2026-27", birth)
            self.assertEqual(cat["key"], key, f"{birth}: {why}")


class CrawlerTests(unittest.TestCase):
    def test_price_parsing(self):
        self.assertEqual(crawler.find_prices("Tageskarte € 67,00"), [67.0])
        self.assertEqual(crawler.find_prices("Saisonkarte € 1.272,00"), [1272.0])
        self.assertEqual(crawler.find_prices("Eintritt 12,- €"), [12.0])
        self.assertEqual(crawler.find_prices("ab 9 Uhr"), [])

    def test_table_with_birth_year_headers(self):
        lines = ["\x00ctx table-container hs normal", "ERW. 2002-1962 | JUGEND 2010 - 2008 | KIND 2020 - 2011",
                 "Tageskarte | 67,00 | 53,50 | 40,00", "2 Tageskarte | 131,00 | 105,00 | 78,50",
                 "\x00ctx table-container hs family", "Tageskarte | 53,50 | 43,00 | 32,00"]
        c = crawler.extract(lines, "https://x.at/tarife", "ski")
        got = sorted((x["age_group"], x["price"], x["birth_year_from"], x["season_type"]) for x in c)
        self.assertEqual(got, [("erwachsene", 67.0, 1962, "haupt"), ("jugend", 53.5, 2008, "haupt"), ("kind", 40.0, 2011, "haupt")])

    def test_exclusions(self):
        lines = ["Preise", "Erwachsene 4 Fahrten € 30,00", "1 Tag mit FZT Erwachsene € 21,00", "Saisonkarte Erwachsene € 400,00",
                 "Familienkarte € 50,00", "Gepäcktransport Erwachsene € 8,10", "Tageskarte Erwachsene € 38,00"]
        c = crawler.extract(lines, "https://x.at", "ski")
        self.assertEqual([(x["price"], x["ticket_type"]) for x in c], [(38.0, "tageskarte")])

    def test_group_definitions_footnote(self):
        lines = ["4-Stunden-Karte | Erwachsene | Senioren", "Preis | € 9,50 | € 7,60", "Senioren: ab vollendetem 65. Lebensjahr"]
        c = {x["age_group"]: x for x in crawler.extract(lines, "https://x.at", "hallenbad")}
        self.assertEqual(c["senior"]["age_min"], 65)

    def test_bonus_restrictions(self):
        r = importer.parse_restrictions("10 % Ermäßigung auf Tageskarten (DI-FR). Nicht mit anderen Rabatten kombinierbar.")
        self.assertEqual(r["weekdays"], [1, 2, 3, 4])
        self.assertTrue(r["not_combinable"])
        self.assertEqual(importer.parse_discount("20 %", ""), (20.0, None))
        self.assertEqual(importer.parse_discount("", "€ 4,00 Ermäßigung"), (None, 4.0))


class CatalogTests(unittest.TestCase):
    def test_export_restore_roundtrip(self):
        with db.tx() as c:
            fid = c.execute("INSERT INTO facilities(slug,kind,name,category,tags,status,special_rules) VALUES(?,?,?,?,?,?,?)",
                            ("roundtrip", "included", "Roundtrip", "museum", '["sommer:kunst-kultur"]', "active", '{"max_entries": 3}')).lastrowid
            c.execute("INSERT INTO tariffs(facility_id,label,price,status,ticket_type,found_at) VALUES(?,?,?,?,?,?)", (fid, "Eintritt", 7, "auto", "einzeleintritt", db.now()))
            c.execute("INSERT INTO tariffs(facility_id,label,price,status,ticket_type,found_at,archived_at,archive_reason) VALUES(?,?,?,?,?,?,?,?)",
                      (fid, "Eintritt alt", 6, "auto", "einzeleintritt", db.now(), db.now(), "Preisänderung"))
        path = os.path.join(TMP, "catalog.json")
        static_export.export_catalog(path)
        with open(path, encoding="utf-8") as fh:
            cat = json.load(fh)
        self.assertTrue(any(f["slug"] == "roundtrip" for f in cat["facilities"]))
        self.assertEqual(len([t for t in cat["tariffs"] if t["facility_id"] == fid]), 1)
        self.assertEqual(len([t for t in cat["history"] if t["facility_id"] == fid]), 1)
        # in eine frische Datenbank laden: IDs und Preisverlauf bleiben erhalten
        old = db.DB_PATH
        db.init(os.path.join(TMP, "restore.db"))
        try:
            static_export.restore_catalog(path)
            f = db.q1("SELECT * FROM facilities WHERE slug='roundtrip'")
            self.assertEqual(f["id"], fid)
            self.assertEqual(db.q1("SELECT COUNT(*) n FROM tariffs WHERE facility_id=?", (fid,))["n"], 2)
            self.assertIsNotNone(seasons.get_season("2026-27"))
        finally:
            db.init(old)


if __name__ == "__main__":
    unittest.main()
