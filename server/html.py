"""Minimaler, toleranter HTML-DOM (nur Standardbibliothek)."""
import html as _html
import re
import unicodedata
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SKIP = {"script", "style", "noscript", "svg", "template", "iframe"}
BLOCK = {"p", "div", "li", "ul", "ol", "tr", "table", "tbody", "thead", "section", "article", "header", "footer",
         "h1", "h2", "h3", "h4", "h5", "h6", "br", "dt", "dd", "dl", "main", "aside", "nav", "form", "figure",
         "figcaption", "blockquote", "hr", "caption", "label", "summary", "details"}
CELL = {"td", "th"}


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag, self.attrs, self.children, self.parent = tag, dict(attrs or {}), [], parent

    def cls(self):
        return (self.attrs.get("class") or "").split()

    def has_class(self, name):
        return name in self.cls()

    def iter(self):
        for ch in self.children:
            if isinstance(ch, Node):
                yield ch
                yield from ch.iter()

    def find_all(self, tag=None, cls=None, pred=None):
        out = []
        for n in self.iter():
            if tag and n.tag != tag:
                continue
            if cls and cls not in n.cls():
                continue
            if pred and not pred(n):
                continue
            out.append(n)
        return out

    def find(self, tag=None, cls=None, pred=None):
        for n in self.iter():
            if tag and n.tag != tag:
                continue
            if cls and cls not in n.cls():
                continue
            if pred and not pred(n):
                continue
            return n
        return None

    def text(self, sep=" "):
        parts = []

        def walk(n):
            for ch in n.children:
                if isinstance(ch, str):
                    parts.append(ch)
                elif ch.tag not in SKIP:
                    if ch.tag in BLOCK or ch.tag in CELL:
                        parts.append(sep)
                    walk(ch)
                    if ch.tag in BLOCK or ch.tag in CELL:
                        parts.append(sep)
        walk(self)
        return clean("".join(parts))

    def lines(self, with_context=False):
        """Text als Zeilen; Tabellenzellen (auch Div-Raster mit .row/.col) werden mit ' | ' verbunden.

        with_context=True fügt Markerzeilen '\\x00ctx <klassen>' ein, wenn ein Tabellen-/Tarif-Container
        betreten bzw. verlassen wird (z. B. 'table-container hs family'), damit Varianten erkannt werden.
        """
        buf, lines = [], []

        def flush():
            t = clean("".join(buf))
            if t:
                lines.append(t)
            buf.clear()

        def is_row(n):
            cl = n.cls()
            if not any(c in ("row", "tr", "table-row", "price-row", "tarif-row") for c in cl):
                return False
            kids = [c for c in n.children if isinstance(c, Node) and c.tag not in SKIP]
            return len(kids) >= 2 and all(c.tag in BLOCK for c in kids)

        def walk(n, in_cell=False, ctx=""):
            for ch in n.children:
                if isinstance(ch, str):
                    buf.append(ch)
                elif ch.tag in SKIP:
                    continue
                elif in_cell:
                    if ch.tag in BLOCK or ch.tag in CELL:
                        buf.append(" ")
                    walk(ch, True, ctx)
                elif ch.tag in CELL:
                    buf.append(" | ")
                    walk(ch, True, ctx)
                    buf.append(" ")
                elif ch.tag in BLOCK:
                    flush()
                    cls = " ".join(ch.cls())
                    new_ctx = ctx
                    if with_context and cls and re.search(r"table|tarif|price|preis", cls, re.I):
                        new_ctx = (ctx + " " + cls).strip()
                        lines.append("\x00ctx " + new_ctx)
                    if is_row(ch):
                        for cell in ch.children:
                            if isinstance(cell, Node) and cell.tag not in SKIP:
                                buf.append(" | ")
                                walk(cell, True, new_ctx)
                                buf.append(" ")
                    else:
                        walk(ch, False, new_ctx)
                    flush()
                    if new_ctx != ctx:
                        lines.append("\x00ctx " + ctx)
                else:
                    walk(ch, False, ctx)
        walk(self)
        flush()
        out = []
        for l in lines:
            l = re.sub(r"^\|\s*", "", l).strip()
            if l.startswith("\x00ctx") and out and out[-1].startswith("\x00ctx"):
                out[-1] = l  # aufeinanderfolgende Marker zusammenfassen
            else:
                out.append(l)
        return out


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, [(k, v or "") for k, v in attrs], self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, [(k, v or "") for k, v in attrs], self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse(text):
    b = _Builder()
    try:
        b.feed(text)
        b.close()
    except Exception:
        pass
    return b.root


def clean(s):
    s = unicodedata.normalize("NFC", _html.unescape(s or "")).replace("\xa0", " ").replace("​", "").replace("\xad", "")
    return re.sub(r"\s+", " ", s).strip()
