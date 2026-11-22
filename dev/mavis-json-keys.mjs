import fs from "node:fs";
const base = "C:\\Users\\D\\mavis-fantasy-grinder\\frontend\\react\\.tmp-audit\\";
for (const f of ["projection-evaluation.json", "projection-significance.json"]) {
  const p = base + f;
  if (!fs.existsSync(p)) { console.log(f + ": MISSING"); continue; }
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  console.log("=== " + f + " ===");
  const shape = (obj, prefix, depth) => {
    if (depth > 2 || !obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? prefix + "." + k : k;
      if (Array.isArray(v)) console.log(p + " : array[" + v.length + "]");
      else if (v && typeof v === "object") { console.log(p + " : object"); shape(v, p, depth + 1); }
      else console.log(p + " : " + typeof v + " = " + String(v).slice(0, 90));
    }
  };
  shape(j, "", 0);
}
