import fs from "node:fs";
const h = JSON.parse(fs.readFileSync("C:/Users/D/mavis-fantasy-grinder/frontend/react/.tmp-audit/projection-evaluation.json", "utf8"));
const cov = h.coverage || {};
const out = {};
for (const [k, v] of Object.entries(cov)) {
  if (Array.isArray(v)) out[k] = "[" + v.length + " entries]";
  else if (v && typeof v === "object") out[k] = v;
  else out[k] = v;
}
console.log(JSON.stringify({ generatedAt: h.generatedAt, config: h.config, coverage: out, definitions: h.definitions ? Object.keys(h.definitions) : null }, null, 1));
