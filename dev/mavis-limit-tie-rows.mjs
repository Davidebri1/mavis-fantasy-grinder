// mavis-limit-tie-rows.mjs — counts and identities for the published 1e-9 tie tolerance.
import { readFileSync } from "node:fs";

const csv = readFileSync("C:/Users/D/mavis-outlier/frontend/react/.tmp-audit/projection-evaluation.csv", "utf8");
function parseLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const lines = csv.trim().split(/\r?\n/);
const header = parseLine(lines[0]);
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const EPS = 1e-9;
let scored = 0, zeroWidthScored = 0, exactTies = 0;
const near = [], zeroRows = [];
for (const line of lines.slice(1)) {
  const f = parseLine(line);
  const cls = f[idx.outcome_class];
  if (!cls || cls === "no control limits yet (n<4)") continue;
  scored++;
  const lo = Number(f[idx.control_low]), hi = Number(f[idx.control_high]);
  const act = Number(f[idx.actual_dk_points]);
  if (hi - lo === 0) {
    zeroWidthScored++;
    zeroRows.push(f[idx.player] + " " + f[idx.date] + " earlier_n=" + f[idx.earlier_n] + " class=" + cls);
  }
  let hit = false;
  for (const [name, lim] of [["low", lo], ["high", hi]]) {
    const d = Math.abs(act - lim);
    if (d === 0) { exactTies++; hit = true; }
    else if (d <= EPS) { near.push(f[idx.player] + " " + f[idx.date] + " (" + name + ", diff " + d.toExponential(2) + ")"); hit = true; }
  }
}
console.log("scored rows (with control limits): " + scored);
console.log("zero-width bands among scored rows: " + zeroWidthScored);
for (const z of zeroRows) console.log("  " + z);
console.log("actual exactly ON a limit: " + exactTies);
console.log("actual within 1e-9 of a limit but NOT on it: " + near.length);
for (const n of near) console.log("  " + n);
