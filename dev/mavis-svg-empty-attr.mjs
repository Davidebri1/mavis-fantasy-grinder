import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const DIR = "C:\\Users\\D\\mavis-fantasy-grinder\\docs\\shots";
for (const f of readdirSync(DIR).filter(x => x.endsWith(".svg")).sort()) {
  const s = readFileSync(join(DIR, f), "utf8");
  const hits = [];
  for (let i = 0; i + 1 < s.length; i++) {
    if (s[i] === "=" && s[i+1] === "\"") {
      const prev = s[i-1];
      if (!/[A-Za-z0-9_:-]/.test(prev)) {
        hits.push([i, JSON.stringify(s.slice(Math.max(0, i - 70), i + 30))]);
      }
    }
  }
  if (hits.length) {
    console.log("=== " + f + " -> " + hits.length + " empty-name attrs");
    for (const h of hits.slice(0, 4)) console.log("   idx", h[0], h[1]);
  } else {
    console.log("=== " + f + " -> no empty-name attrs");
  }
}