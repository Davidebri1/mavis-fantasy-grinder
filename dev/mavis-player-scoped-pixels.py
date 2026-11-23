"""Pixel-measure the rendered charts: they must contain real ink, not a blank page."""
import json
import os
from PIL import Image

d = r"C:\Users\D\mavis-outlier\docs\shots"
out = {}
for name in ["mavis-player-scoped-histograms.png", "mavis-player-scoped-hit-rates.png"]:
    p = os.path.join(d, name)
    if not os.path.exists(p):
        print(name, "MISSING")
        continue
    im = Image.open(p).convert("RGB")
    w, h = im.size
    px = im.load()
    nonwhite = 0
    ink_rows = set()
    ink_cols = set()
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if r < 245 or g < 245 or b < 245:
                nonwhite += 1
                ink_rows.add(y)
                ink_cols.add(x)
    sampled = len(range(0, h, 2)) * len(range(0, w, 2))
    pct = round(100 * nonwhite / sampled, 2)
    br = sum(1 for y in range(h - 12, h) for x in range(w - 12, w) if px[x, y][0] < 235)
    print(name, "| size", w, "x", h,
          "| non-white", pct, "% of sampled pixels",
          "| ink row span", (min(ink_rows), max(ink_rows)) if ink_rows else None,
          "| ink col span", (min(ink_cols), max(ink_cols)) if ink_cols else None)
    print("   bottom-right 12x12 non-white pixels:", br)
    out[name] = {
        "width": w, "height": h, "nonWhitePercent": pct,
        "inkRowSpan": [min(ink_rows), max(ink_rows)] if ink_rows else None,
        "inkColSpan": [min(ink_cols), max(ink_cols)] if ink_cols else None,
        "bottomRightNonWhite": br,
    }

with open(r"C:\Users\D\mavis-outlier\frontend\react\.tmp-audit\player-scoped-pixels.json", "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)
print("")
print("wrote frontend/react/.tmp-audit/player-scoped-pixels.json")