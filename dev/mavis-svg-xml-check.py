import glob, os, sys
import xml.etree.ElementTree as ET

d = r"C:\Users\D\mavis-outlier\docs\shots"
for p in sorted(glob.glob(os.path.join(d, "mavis-eval-*.svg"))):
    name = os.path.basename(p)
    with open(p, encoding="utf-8") as f:
        t = f.read()
    try:
        ET.fromstring(t)
        print("OK   ", name)
    except ET.ParseError as e:
        line, col = e.position
        lines = t.split("\n")
        s = lines[line-1] if line-1 < len(lines) else ""
        print("FAIL ", name, "|", str(e))
        print("      line", line, "col", col)
        print("      ctx: ...", s[max(0,col-100):col+100].replace("\n"," "), "...")
