import { readFileSync } from "node:fs";
import { join } from "node:path";
const DIR = "C:\\Users\\D\\mavis-fantasy-grinder\\docs\\shots";
const bad = readFileSync(join(DIR, "mavis-eval-direction.svg"), "utf8");
const good = readFileSync(join(DIR, "mavis-eval-agreement.svg"), "utf8");
const n = Math.min(bad.length, good.length);
let first = -1;
for (let i = 0; i < n; i++) { if (bad[i] !== good[i]) { first = i; break; } }
console.log("first differing index:", first);
console.log("");
const a = first >= 0 ? first - 60 : 0;
console.log("BAD  [" + a + "..]:", JSON.stringify(bad.slice(a, a + 160)));
console.log("GOOD [" + a + "..]:", JSON.stringify(good.slice(a, a + 160)));
console.log("");
// char-by-char dump of bad around 240..280
let out = "";
for (let i = 240; i < 280; i++) {
  const c = bad[i];
  out += i + ":" + (c.charCodeAt(0) > 126 ? "[U+" + c.charCodeAt(0).toString(16) + "]" : c) + " ";
}
console.log(out);
console.log("");
// Does bad contain any tag name starting with a quote? or any stray quote outside attr values?
console.log("bad has \"</\" :", bad.includes("<\""));
console.log("bad has \"/> \"> :", bad.includes("\"/> \">"));
const tail = bad.slice(-200);
console.log("bad tail:", JSON.stringify(tail));