"""Kategorien der Freizeitangebote und Zuordnung anhand der offiziellen Rubriken + Namen."""
import re
import unicodedata

CATEGORIES = {
    "ski":        {"label": "Skigebiet & Skilift", "icon": "ski",      "default_ticket": "tageskarte"},
    "bergbahn":   {"label": "Bergbahn",            "icon": "gondola",  "default_ticket": "berg_tal"},
    "nacht":      {"label": "Nachtrodeln & Nachtski", "icon": "moon",  "default_ticket": "abend"},
    "rodeln":     {"label": "Rodelbahn",           "icon": "sled",     "default_ticket": "tageskarte"},
    "hallenbad":  {"label": "Hallenbad",           "icon": "swim",     "default_ticket": "einzeleintritt"},
    "freibad":    {"label": "Freibad",             "icon": "sun",      "default_ticket": "einzeleintritt"},
    "badesee":    {"label": "Badesee",             "icon": "wave",     "default_ticket": "einzeleintritt"},
    "sauna":      {"label": "Sauna & Therme",      "icon": "steam",    "default_ticket": "einzeleintritt"},
    "eislaufen":  {"label": "Eislaufplatz & Eishalle", "icon": "skate", "default_ticket": "einzeleintritt"},
    "museum":     {"label": "Museum",              "icon": "museum",   "default_ticket": "einzeleintritt"},
    "sehenswert": {"label": "Sehenswürdigkeit",    "icon": "landmark", "default_ticket": "einzeleintritt"},
    "sport":      {"label": "Sport & Freizeit",    "icon": "sport",    "default_ticket": "einzeleintritt"},
    "einkaufen":  {"label": "Einkaufen",           "icon": "bag",      "default_ticket": "sonstiges"},
    "sonstiges":  {"label": "Weitere Angebote",    "icon": "star",     "default_ticket": "einzeleintritt"},
}

TICKET_TYPES = {
    "tageskarte": "Tageskarte",
    "halbtag": "Halbtag",
    "stundenkarte": "Stundenkarte",
    "einzeleintritt": "Einzeleintritt",
    "berg_tal": "Berg & Tal",
    "bergfahrt": "Einzelfahrt",
    "abend": "Abend/Nacht",
    "sonstiges": "Sonstiges",
}

# Offizielle Rubriken auf freizeitticket.at
LISTINGS = [
    ("/winter/ski-snowboard/", "winter:ski-snowboard"),
    ("/winter/bei-nacht/", "winter:bei-nacht"),
    ("/winter/rodeln/", "winter:rodeln"),
    ("/winter/eislaufen/", "winter:eislaufen"),
    ("/winter/schwimmen/", "winter:schwimmen"),
    ("/winter/kunst-kultur/", "winter:kunst-kultur"),
    ("/sommer/wandern/", "sommer:wandern"),
    ("/sommer/schwimmen/", "sommer:schwimmen"),
    ("/sommer/kunst-kultur/", "sommer:kunst-kultur"),
    ("/winter/", "winter"),
    ("/sommer/", "sommer"),
]
BONUS_LISTINGS = [
    ("/bonus/erlebnisse/", "bonus:erlebnisse"),
    ("/bonus/einkaufen/", "bonus:einkaufen"),
    ("/bonus/", "bonus"),
]

TAG_LABELS = {
    "winter:ski-snowboard": "Ski & Snowboard", "winter:bei-nacht": "Bei Nacht", "winter:rodeln": "Rodeln",
    "winter:eislaufen": "Eislaufen", "winter:schwimmen": "Schwimmen (Winter)", "winter:kunst-kultur": "Kunst & Kultur (Winter)",
    "sommer:wandern": "Wandern & Bergbahnen", "sommer:schwimmen": "Schwimmen (Sommer)", "sommer:kunst-kultur": "Kunst & Kultur (Sommer)",
    "bonus:erlebnisse": "Bonus: Erlebnisse", "bonus:einkaufen": "Bonus: Einkaufen", "winter": "Winter", "sommer": "Sommer",
}


def norm(s):
    s = (s or "").lower().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


NAME_RULES = [
    (r"eishalle|eislauf|eisplatz|eisstock|eis arena|eisarena|icemagic|ice magic|olympiaworld", "eislaufen"),
    (r"hallenbad|hallen bad", "hallenbad"),
    (r"badesee|\bsee\b|strandbad|baggersee|weiher", "badesee"),
    (r"freibad|waldbad|schwimmbad|erlebnisbad|\bbad\b|baeder", "freibad"),
    (r"sauna|therme|wellness|dampfbad", "sauna"),
    (r"museum|muesum|museen|galerie|ausstellung|kunsthalle|audioversum|zeughaus|kristallwelten|panorama", "museum"),
    (r"rodel", "rodeln"),
    (r"kletter|boulder|trampolin|minigolf|bogen|kart|bowling|fitness|gym|airparc|hochseil|golf|tennis|squash", "sport"),
]


def classify(name, tags, kind="included"):
    n = norm(name)
    tags = set(tags or [])
    if "winter:ski-snowboard" in tags:
        return "ski"
    for rx, cat in NAME_RULES:
        if re.search(rx, n):
            if cat == "freibad" and "winter:schwimmen" in tags and "sommer:schwimmen" not in tags:
                return "hallenbad"
            return cat
    if "sommer:wandern" in tags:
        return "bergbahn"
    if "winter:rodeln" in tags:
        return "rodeln"
    if "winter:eislaufen" in tags:
        return "eislaufen"
    if "winter:schwimmen" in tags and "sommer:schwimmen" not in tags:
        return "hallenbad"
    if "sommer:schwimmen" in tags:
        return "freibad"
    if any(t.endswith("kunst-kultur") for t in tags):
        return "museum" if re.search(r"museum|kunst|galerie|volkskunst|stadt", n) else "sehenswert"
    if "winter:bei-nacht" in tags:
        return "nacht"
    if "bonus:einkaufen" in tags:
        return "einkaufen"
    if "bonus:erlebnisse" in tags:
        return "sport"
    return "sonstiges"


def default_ticket_type(category, tags, visit_date, name=""):
    """Standard-Ticketart abhängig von Kategorie und Jahreszeit (z. B. Nordkette: Winter Skipass, Sommer Berg-/Talfahrt).
    Gletscherskigebiete haben eine lange Skisaison (Oktober bis Juni)."""
    month = visit_date.month
    glacier = "gletscher" in norm(name)
    winter = month in ((10, 11, 12, 1, 2, 3, 4, 5, 6) if glacier else (11, 12, 1, 2, 3, 4))
    tags = set(tags or [])
    if category == "ski" and not winter and "sommer:wandern" in tags:
        return "berg_tal"
    return CATEGORIES.get(category, CATEGORIES["sonstiges"])["default_ticket"]
