"""HTTP-Abruf für Sync und Preisrecherche: robots.txt, Drosselung pro Host, Zeichensatz-Erkennung."""
import gzip
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import zlib

USER_AGENT = "FreizeitTracker/1.0 (+self-hosted Preisvergleich; respektiert robots.txt)"
TIMEOUT = 20
MAX_BYTES = 8 * 1024 * 1024
MIN_INTERVAL = 1.0  # Sekunden zwischen Anfragen an denselben Host

_host_lock = threading.Lock()
_host_last = {}
_robots = {}


class FetchError(Exception):
    def __init__(self, msg, kind="unreachable"):
        super().__init__(msg)
        self.kind = kind


class Response:
    def __init__(self, url, status, ctype, body):
        self.url, self.status, self.content_type, self.body = url, status, ctype, body

    @property
    def is_pdf(self):
        return "pdf" in (self.content_type or "") or self.body[:5] == b"%PDF-"

    def text(self):
        enc = None
        m = re.search(r"charset=([\w-]+)", self.content_type or "", re.I)
        if m:
            enc = m.group(1)
        if not enc:
            m = re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", self.body[:4000], re.I)
            if m:
                enc = m.group(1).decode("ascii", "ignore")
        for e in (enc, "utf-8", "cp1252"):
            if not e:
                continue
            try:
                return self.body.decode(e)
            except (LookupError, UnicodeDecodeError):
                continue
        return self.body.decode("utf-8", "replace")


def _wait_host(host):
    while True:
        with _host_lock:
            last = _host_last.get(host, 0)
            delta = time.time() - last
            if delta >= MIN_INTERVAL:
                _host_last[host] = time.time()
                return
        time.sleep(MIN_INTERVAL - delta)


def allowed(url):
    p = urllib.parse.urlsplit(url)
    base = f"{p.scheme}://{p.netloc}"
    rp = _robots.get(base)
    if rp is None:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = _raw_get(base + "/robots.txt", check_robots=False)
            if r.status >= 400:
                rp.parse([])
            else:
                rp.parse(r.text().splitlines())
        except Exception:
            rp.parse([])  # robots.txt nicht erreichbar -> erlauben
        _robots[base] = rp
    try:
        return rp.can_fetch(USER_AGENT, url)
    except Exception:
        return True


def _raw_get(url, check_robots=True, accept="text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5"):
    if check_robots and not allowed(url):
        raise FetchError("Durch robots.txt gesperrt", "blocked")
    host = urllib.parse.urlsplit(url).netloc
    _wait_host(host)
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": accept,
        "Accept-Language": "de-AT,de;q=0.9,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read(MAX_BYTES + 1)
            enc = (resp.headers.get("Content-Encoding") or "").lower()
            if enc == "gzip":
                body = gzip.decompress(body)
            elif enc == "deflate":
                try:
                    body = zlib.decompress(body)
                except zlib.error:
                    body = zlib.decompress(body, -zlib.MAX_WBITS)
            return Response(resp.geturl(), resp.status, resp.headers.get("Content-Type", ""), body[:MAX_BYTES])
    except urllib.error.HTTPError as e:
        return Response(url, e.code, e.headers.get("Content-Type", "") if e.headers else "", b"")
    except Exception as e:  # DNS, Timeout, TLS ...
        raise FetchError(f"{type(e).__name__}: {e}", "unreachable")


def get(url, check_robots=True):
    r = _raw_get(url, check_robots=check_robots)
    if r.status >= 400:
        raise FetchError(f"HTTP {r.status}", "unreachable" if r.status >= 500 else "not_found")
    return r


def normalize_url(href, base):
    if not href:
        return None
    href = href.strip()
    if href.startswith(("mailto:", "tel:", "javascript:", "#")):
        return None
    u = urllib.parse.urljoin(base, href)
    u, _ = urllib.parse.urldefrag(u)
    if not u.startswith(("http://", "https://")):
        return None
    return u


def same_site(a, b):
    def root(u):
        h = urllib.parse.urlsplit(u).netloc.lower().split(":")[0]
        h = h[4:] if h.startswith("www.") else h
        parts = h.split(".")
        return ".".join(parts[-2:]) if len(parts) >= 2 else h
    return root(a) == root(b)
