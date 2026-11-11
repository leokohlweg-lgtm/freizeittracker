"""SQLite-Datenbank: Schema, Verbindungen, Transaktionen."""
import os
import sqlite3
import threading
import contextlib
import datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("FT_DATA_DIR", os.path.join(ROOT, "data"))
DB_PATH = os.environ.get("FT_DB_PATH", os.path.join(DATA_DIR, "freizeittracker.db"))

_local = threading.local()
_write_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  pw_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  disability INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  active_season_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS seasons(
  id TEXT PRIMARY KEY,               -- z.B. '2026-27'
  label TEXT NOT NULL,               -- '2026/27'
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  source_url TEXT,
  verified INTEGER NOT NULL DEFAULT 0,  -- 1 = aus offizieller Quelle übernommen
  notes TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS season_categories(
  id INTEGER PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  key TEXT NOT NULL,                 -- kinder|jugend|u23|erwachsene|senioren|behinderung
  label TEXT NOT NULL,
  birth_year_from INTEGER,           -- inklusive, NULL = offen
  birth_year_to INTEGER,             -- inklusive, NULL = offen
  requires_flag TEXT,                -- z.B. 'disability'
  price_presale REAL,
  price_regular REAL,
  presale_until TEXT,
  sort INTEGER DEFAULT 0,
  UNIQUE(season_id, key)
);

CREATE TABLE IF NOT EXISTS user_seasons(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  purchase_price REAL NOT NULL,
  category_key TEXT NOT NULL,
  amortized_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, season_id)
);

CREATE TABLE IF NOT EXISTS facilities(
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('included','bonus')),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  address TEXT,
  town TEXT,
  lat REAL,
  lon REAL,
  geo_source TEXT,
  description TEXT,
  website TEXT,
  price_url TEXT,                    -- manuell hinterlegte Preisseite
  phone TEXT,
  hours_url TEXT,
  conditions TEXT,                   -- Freizeitticket-Konditionen
  discount_label TEXT,
  discount_percent REAL,
  discount_amount REAL,
  special_rules TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active|archived
  manual INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT,
  last_seen TEXT,
  archived_at TEXT,
  updated_at TEXT,
  price_status TEXT NOT NULL DEFAULT 'pending', -- pending|ok|not_found|unreachable|blocked|stale
  price_checked_at TEXT,
  price_check_message TEXT,
  review_needed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS facility_seasons(
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  PRIMARY KEY(facility_id, season_id)
);

CREATE TABLE IF NOT EXISTS tariffs(
  id INTEGER PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  season_id TEXT,
  label TEXT NOT NULL,
  age_group TEXT NOT NULL DEFAULT 'unbekannt', -- kind|jugend|erwachsene|senior|student|alle|unbekannt
  age_min INTEGER,
  age_max INTEGER,
  birth_year_from INTEGER,
  birth_year_to INTEGER,
  ticket_type TEXT NOT NULL DEFAULT 'tageskarte',
  duration_hours REAL,
  day_type TEXT NOT NULL DEFAULT 'alle',     -- alle|werktag|wochenende
  season_type TEXT NOT NULL DEFAULT 'alle',  -- alle|haupt|neben
  valid_from TEXT,
  valid_to TEXT,
  price REAL NOT NULL CHECK(price >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL CHECK(status IN ('verified','auto','user')),
  confidence REAL,
  source_url TEXT,
  source_snippet TEXT,
  source_season TEXT,                -- auf der Quelle genannte Saison
  created_by INTEGER,
  found_at TEXT NOT NULL,
  last_confirmed_at TEXT,
  archived_at TEXT,
  archive_reason TEXT,
  replaced_by INTEGER,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_tariffs_fac ON tariffs(facility_id, archived_at);

CREATE TABLE IF NOT EXISTS price_checks(
  id INTEGER PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,
  pages_checked INTEGER DEFAULT 0,
  prices_found INTEGER DEFAULT 0,
  changes INTEGER DEFAULT 0,
  message TEXT,
  sources TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_fac ON price_checks(facility_id, started_at);

CREATE TABLE IF NOT EXISTS visits(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  visit_date TEXT NOT NULL,
  ticket_type TEXT NOT NULL,
  tariff_id INTEGER REFERENCES tariffs(id) ON DELETE SET NULL,
  regular_price REAL NOT NULL CHECK(regular_price >= 0),
  paid_price REAL NOT NULL CHECK(paid_price >= 0),
  saving REAL NOT NULL CHECK(saving >= 0),
  inclusion_share REAL NOT NULL DEFAULT 1,
  price_source TEXT,
  price_explanation TEXT,
  manual_price INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  dup_index INTEGER NOT NULL DEFAULT 0,
  client_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, facility_id, visit_date, ticket_type, dup_index),
  UNIQUE(user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(user_id, season_id, visit_date);

CREATE TABLE IF NOT EXISTS favorites(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  created_at TEXT,
  PRIMARY KEY(user_id, facility_id)
);

CREATE TABLE IF NOT EXISTS jobs(
  name TEXT PRIMARY KEY,
  last_run_at TEXT,
  last_finished_at TEXT,
  last_status TEXT,
  last_message TEXT,
  running INTEGER NOT NULL DEFAULT 0,
  progress TEXT
);

CREATE TABLE IF NOT EXISTS sync_log(
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  facility_id INTEGER,
  message TEXT NOT NULL
);
"""


def now():
    return dt.datetime.now().replace(microsecond=0).isoformat(sep=" ")


def today():
    return dt.date.today().isoformat()


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=30000")
    return c


def conn():
    c = getattr(_local, "c", None)
    if c is None or getattr(_local, "path", None) != DB_PATH:
        c = _connect()
        _local.c = c
        _local.path = DB_PATH
        _local.depth = 0
    return c


@contextlib.contextmanager
def tx():
    """Schreibtransaktion (verschachtelbar). Serialisiert Schreibzugriffe."""
    c = conn()
    with _write_lock:
        depth = getattr(_local, "depth", 0)
        _local.depth = depth + 1
        if depth == 0:
            c.execute("BEGIN IMMEDIATE")
        try:
            yield c
            if depth == 0:
                c.execute("COMMIT")
        except BaseException:
            if depth == 0:
                c.execute("ROLLBACK")
            raise
        finally:
            _local.depth = depth


def q(sql, args=()):
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def q1(sql, args=()):
    r = conn().execute(sql, args).fetchone()
    return dict(r) if r else None


def init(path=None):
    global DB_PATH
    if path:
        DB_PATH = path
        _local.c = None
    c = conn()
    c.executescript(SCHEMA)
    from . import seed
    seed.ensure_seasons()


def backup(dest_dir=None, keep=14):
    """Konsistente Sicherung über die SQLite-Backup-API."""
    dest_dir = dest_dir or os.path.join(DATA_DIR, "backups")
    os.makedirs(dest_dir, exist_ok=True)
    name = "freizeittracker-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S") + ".db"
    target = os.path.join(dest_dir, name)
    dst = sqlite3.connect(target)
    try:
        conn().backup(dst)
    finally:
        dst.close()
    files = sorted(f for f in os.listdir(dest_dir) if f.startswith("freizeittracker-") and f.endswith(".db"))
    for old in files[:-keep]:
        try:
            os.remove(os.path.join(dest_dir, old))
        except OSError:
            pass
    return target
