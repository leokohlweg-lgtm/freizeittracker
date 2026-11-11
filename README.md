# FreizeitTracker – der Freizeitticket-Tirol-Spartracker

Handy-App (installierbare Web-App), die automatisch berechnet, wie viel du mit dem
**Freizeitticket Tirol** gegenüber regulären Eintrittspreisen sparst.

- **Kein eigener Server, kein Account:** Profil, Besuche und Statistiken liegen nur auf deinem Handy.
- **Preise aktualisieren sich von selbst:** Jeden Montag läuft kostenlos ein Cloud-Job (GitHub Actions),
  gleicht alle Partner mit freizeitticket.at ab, recherchiert die regulären Preise auf den Websites der
  Betriebe und veröffentlicht einen neuen Preiskatalog. Die App lädt ihn beim nächsten Öffnen.
- **Funktioniert offline**, hat ein eigenes Symbol am Home-Bildschirm und startet im Vollbild.

---

## App aufs Handy bringen (einmalig, ca. 15 Minuten)

Du brauchst nur einen Browser. Programmierkenntnisse sind nicht nötig.

### 1. GitHub-Konto anlegen
Auf <https://github.com/signup> kostenlos registrieren.

### 2. Neues Repository erstellen
1. Oben rechts **+** → **New repository**
2. Name: `freizeittracker`
3. **Public** auswählen (GitHub Pages ist für öffentliche Repositories kostenlos.
   Öffentlich ist nur der Programmcode und der Preiskatalog – deine persönlichen Daten sind nie darin.)
4. **Create repository**

### 3. Dateien hochladen
1. Im neuen Repository auf **uploading an existing file** klicken
2. **Den gesamten Inhalt dieses Projektordners** (alle Ordner und Dateien, auch `.github`) in das Fenster ziehen
3. Unten **Commit changes**

### 4. Veröffentlichung einschalten
1. **Settings** → links **Pages**
2. Bei **Source** „**GitHub Actions**“ wählen
3. Oben auf **Actions** → links „Wöchentliches Preis-Update & Veröffentlichung“ → **Run workflow** → **Run workflow**
4. Nach ca. 10–15 Minuten ist alles grün. Die Adresse deiner App lautet:
   **`https://<dein-github-name>.github.io/freizeittracker/`**

### 5. Aufs Handy legen
- **iPhone (Safari):** Adresse öffnen → Teilen-Symbol → **Zum Home-Bildschirm**
- **Android (Chrome):** Adresse öffnen → Menü ⋮ → **App installieren** bzw. **Zum Startbildschirm hinzufügen**

Ab jetzt aktualisiert sich alles selbst: neue Preise jeden Montag, neue App-Versionen sobald Dateien
im Repository geändert werden.

### Bestehende Daten übernehmen
In der alten Installation **Profil → Daten → Sicherung exportieren**, die Datei aufs Handy schicken
(AirDrop, Mail …) und in der neuen App beim Start **„Sicherung wiederherstellen“** wählen.

---

## Wichtig zu wissen

- **Sicherung:** Deine Daten liegen nur auf dem Gerät. Wird die App gelöscht oder geht das Handy verloren,
  sind sie weg. Die App erinnert dich nach 30 Tagen an eine Sicherung (Profil → Daten).
- **iPhone:** Nutze die App über das Symbol am Home-Bildschirm. Nur dann behält Safari die Daten dauerhaft.
- **Mehrere Geräte:** Jedes Gerät hat seine eigenen Daten (Übertragung per Sicherungsdatei).
- **Wochenjob:** GitHub pausiert geplante Jobs nach 60 Tagen ohne Änderungen. Weil der Job jede Woche
  den neuen Katalog speichert, bleibt er aktiv. Manuell anstoßen: Actions → Run workflow.

## Was die App kann

- Kategorie (Kinder / Jugend / U23 / Erwachsene / Senioren / Behinderung) über die **Geburtsjahrgänge der
  offiziellen Tarifbestimmungen** der Saison – nicht über das aktuelle Alter
- Alle Partner von freizeitticket.at inkl. **Bonuspartner** (Rabatte, Wochentage, Aktionszeiträume) und
  Sonderregelungen (z. B. „gilt für 3 Zutritte“); neue Partner werden erkannt, entfernte archiviert
- **Automatische Preisrecherche** mit Quelle, Textauszug, Datum und Sicherheit je Preis; Preisverlauf;
  nicht erreichbare Websites behalten die letzten Preise und werden als „möglicherweise veraltet“ markiert
- **Keine erfundenen Preise** – fehlt ein Preis, steht „nicht verfügbar“ und du kannst ihn selbst ergänzen
- Preisauswahl nach den **Altersgrenzen des Betreibers**, Datum, Wochenende/Feiertag, Haupt-/Nebensaison,
  Ticketart – bei Mehrdeutigkeit der niedrigste verlässliche Preis mit Hinweis „Bitte prüfen“
- Besuche in wenigen Taps, rückwirkend, mehrere pro Tag, bearbeiten, löschen, Notizen, Preis anpassen,
  Schutz vor Doppelzählung
- Bruttoersparnis, Nettovorteil, Amortisation mit exaktem Datum, Statistiken, Highlights,
  Saisonrückblick, Saisonvergleich, Karte, heller/dunkler Modus, Export (JSON/CSV) und Import

## Aufbau

```
web/                    Die App (wird veröffentlicht)
  data/catalog.json     Preiskatalog – vom Wochenjob erzeugt
  js/local/engine.js    Kategorie, Preisauswahl, Ersparnis (läuft am Handy)
  js/local/local.js     Speicherung auf dem Gerät, Statistik, Export/Import
  selftest.html         Selbsttest der Rechenlogik (im Browser öffnen)
server/                 Wochenjob in Python (läuft nur in der Cloud)
  importer.py           Partner-Abgleich freizeitticket.at, Tarifbestimmungen, Geokodierung
  crawler.py            Preisrecherche auf den Betreiber-Websites (robots.txt, Drosselung)
  static_export.py      Katalog schreiben / wiederherstellen
.github/workflows/      Wochenjob + Veröffentlichung auf GitHub Pages
tests/                  Python-Tests
```

Lokal ausprobieren (Python 3.10+):

```bash
python -m http.server 8080 --directory web
```

Wochenjob lokal ausführen: `python -m server.cli build-static` · Tests: `python -m unittest discover -s tests`

Unabhängiges Projekt, kein offizielles Angebot des Freizeitticket Tirol. Keine Gewähr für Preisangaben.
