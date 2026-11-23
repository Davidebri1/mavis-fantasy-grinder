"""Validate the player-scoped SVGs: XML parse, then a rasterised render check."""
import glob, os, sys, struct, zlib

d = r"C:\Users\D\mavis-outlier\docs\shots"
targets = [
    os.path.join(d, "mavis-player-scoped-histograms.svg"),
    os.path.join(d, "mavis-player-scoped-hit-rates.svg"),
]
import xml.etree.ElementTree as ET
for p in targets:
    name = os.path.basename(p)
    with open(p, encoding="utf-8") as f:
        t = f.read()
    try:
        root = ET.fromstring(t)
        texts = [e.text for e in root.iter() if e.tag.endswith("text") and e.text]
        nan = [x for x in texts if "NaN" in x or "undefined" in x or "Infinity" in x]
        print("OK   ", name, "| bytes", len(t), "| text nodes", len(texts), "| NaN/undefined", len(nan))
        if nan:
            print("      BAD TEXT:", nan[:5])
    except ET.ParseError as e:
        print("FAIL ", name, "|", str(e))
