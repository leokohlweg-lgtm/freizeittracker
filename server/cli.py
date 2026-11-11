"""Kommandozeile für den Preiskatalog.

  python -m server.cli build-static   Wochen-Update: Katalog laden -> Partner-Abgleich -> Preisrecherche -> Katalog schreiben
  python -m server.cli export-static  Nur Katalog aus der lokalen Datenbank schreiben
  python -m server.cli sync           Nur Partner-Abgleich mit freizeitticket.at
  python -m server.cli prices         Nur Preisrecherche für alle Partner
  python -m server.cli price <slug>   Preisrecherche für einen Partner (mit Ausgabe der Tarife)
"""
import json
import os
import sys
import tempfile

from . import db, importer, crawler, static_export


def main(argv):
    cmd = argv[0] if argv else "help"
    pr = lambda m: print(m, flush=True)
    if cmd == "build-static":
        # frische Arbeitsdatenbank, aufgebaut aus dem zuletzt veröffentlichten Katalog
        work = os.path.join(tempfile.mkdtemp(), "build.db")
        db.init(work)
        n = static_export.restore_catalog()
        pr(f"Katalog geladen: {n} Partner")
        started = db.now()
        try:
            res = importer.sync_partners(progress=pr)
            msg = f"{res['total']} Partner, {res['new']} neu, {res['archived']} archiviert" + (f", {len(res['errors'])} Fehler" if res["errors"] else "")
            static_export.record_job("partner_sync", "ok" if res["total"] else "error", msg, started)
            pr(msg)
        except Exception as e:  # Katalog trotzdem neu schreiben (letzte bestätigte Daten bleiben)
            static_export.record_job("partner_sync", "error", f"{type(e).__name__}: {e}", started)
            pr(f"Partner-Abgleich fehlgeschlagen: {e}")
        started = db.now()
        res = crawler.crawl_all(progress=pr)
        msg = f"{res['ok']} mit Preisen, {res['not_found']} ohne, {res['unreachable']} nicht erreichbar, {res['changes']} Änderungen"
        static_export.record_job("price_crawl", "ok", msg, started)
        pr(msg)
        pr("Katalog geschrieben: " + static_export.export_catalog())
        return
    db.init()
    if cmd == "export-static":
        print(static_export.export_catalog())
    elif cmd == "sync":
        print(json.dumps(importer.sync_partners(progress=pr), ensure_ascii=False, indent=1))
    elif cmd == "prices":
        print(json.dumps(crawler.crawl_all(progress=pr), ensure_ascii=False, indent=1))
    elif cmd == "price":
        key = argv[1]
        f = db.q1("SELECT id FROM facilities WHERE id=? OR slug=?", (key, key))
        print(json.dumps(crawler.check_facility(f["id"]), ensure_ascii=False, indent=1))
        for t in db.q("SELECT label,age_group,ticket_type,day_type,price,confidence FROM tariffs WHERE facility_id=? AND archived_at IS NULL", (f["id"],)):
            print(t)
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
