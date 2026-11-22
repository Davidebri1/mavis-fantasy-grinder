import { readFileSync } from "node:fs";
import { join } from "node:path";
const DIR = "C:\\Users\\D\\mavis-fantasy-grinder\\docs\\shots";
const bad = readFileSync(join(DIR, "mavis-eval-direction.svg"), "utf8");
const good = readFileSync(join(DIR, "mavis-eval-agreement.svg"), "utf8");
const bi = bad.indexOf("<line");
const gi = good.indexOf("<line");
console.log("BAD  idx", bi, JSON.stringify(bad.slice(bi, bi + 120)));
console.log("GOOD idx", gi, JSON.stringify(good.slice(gi, gi + 120)));
console.log("");
// show the exact byte codes of the bad tag, char by char, up to the first >
const end = bad.indexOf(">", bi);
const tag = bad.slice(bi, end + 1);
let line = "";
for (let i = 0; i < tag.length; i++) {
  const c = tag[i];
  const code = c.charCodeAt(0);
  line += (code > 126 || code < 32) ? "[" + code + "]" : c;
}
console.log("BAD TAG:", line);
console.log("");
const attrRe = /\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const rest = tag.slice(4).replace(/\/$/, "");
let m;
while ((m = attrRe.exec(rest)) !== null) {
  console.log("attr:", JSON.stringify(m[1]), "value:", JSON.stringify(m[2] ?? m[4] ?? m[5]), "at", m.index, "len", m[0].length);
}