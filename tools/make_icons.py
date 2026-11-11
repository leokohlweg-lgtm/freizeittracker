"""Erzeugt die App-Icons (PNG) ohne Zusatzbibliotheken: python tools/make_icons.py"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
MOUNTAIN = [(96, 360), (196, 196), (256, 288), (302, 226), (416, 360)]
SUN = (360, 150, 38)


def inside(px, py, poly):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def color(x, y):
    """x, y in 0..512"""
    # Verlauf: oben rechts hellgrün -> unten links dunkelgrün
    d = min(1.0, math.hypot(512 - x, y) / 640)
    bg = tuple(round(a + (b - a) * d) for a, b in zip((52, 199, 89), (15, 59, 42)))
    if inside(x, y, MOUNTAIN):
        return (255, 255, 255)
    sx, sy, r = SUN
    if (x - sx) ** 2 + (y - sy) ** 2 <= r * r:
        return tuple(round(255 * 0.9 + c * 0.1) for c in bg)
    return bg


def png(size, path):
    f = 512 / size
    rows = []
    for py in range(size):
        row = bytearray(b"\x00")
        for px in range(size):
            acc = [0, 0, 0]
            for oy in (0.25, 0.75):
                for ox in (0.25, 0.75):
                    c = color((px + ox) * f, (py + oy) * f)
                    for k in range(3):
                        acc[k] += c[k]
            row += bytes(round(a / 4) for a in acc)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(data)


if __name__ == "__main__":
    for s in (180, 192, 512):
        png(s, os.path.join(OUT, f"icon-{s}.png"))
        print("icon", s)
