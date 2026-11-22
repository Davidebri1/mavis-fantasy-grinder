// mavis-csv-self-consistency.mjs
// Built by mavis, 2026-11-17.
//
// The CSV must reproduce its own labels. Every verdict the harness stores
// (outcome_class, model_contained, model_direction, baseline_direction) is
// recomputed here from the numeric columns in the same file and compared.
//
// If any row disagrees, the file lies about itself. The report says how many
// rows disagree, by which verdict, and prints the first few of them.
//
// Reads:  frontend/react/.tmp-audit/projection-evaluation.csv

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const csvPath = path.join(root, "frontend", "react", ".tmp-audit", "projection-evaluation.csv");

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const EPS = 1e-9;
const raw = fs.readFileSync(csvPath, "utf8");
const [header, ...body] = parseCsv(raw);
const ix = Object.fromEntries(header.map((h, i) => [h, i]));

const mismatches = { outcome_class: [], model_contained: [], model_direction: [], baseline_direction: [], band_position: [] };
let rows = 0, firstGames = 0, evaluations = 0, scored = 0, noLimits = 0;
let containRecomputedSame = 0, containStoredSame = 0;
let modelUp = 0, modelDown = 0, modelNoCall = 0;
let baseUp = 0, baseDown = 0, baseNoCall = 0;

for (const r of body) {
  if (!r.length) continue;
  rows++;
  if (r[ix.status] === "first game of record") { firstGames++; continue; }
  evaluations++;
  const R = num(r[ix.control_range]);
  const lower = num(r[ix.control_low]);
  const upper = num(r[ix.control_high]);
  const actual = num(r[ix.actual_dk_points]);
  if (R === null || R === null || R <= 0 || lower === null || upper === null) { noLimits++; continue; }
  scored++;

  const key = r[ix.player] + " " + r[ix.date] + " (" + r[ix.athlete_id] + ")";

  // 1. outcome class: boom above the upper limit, bust below the lower one.
  // The same 1e-9 tolerance the harness publishes: a tie on the limit is
  // inside the band, not a break of it.
  const outcome = actual > upper + EPS ? "boom (outlier high)"
    : actual < lower - EPS ? "bust (outlier low)" : "inside the band";
  if (outcome !== r[ix.outcome_class]) {
    mismatches.outcome_class.push({ key, stored: r[ix.outcome_class], recomputed: outcome, actual, lower, upper });
  }

  // 2. containment: the actual inside the engine's 90% interval
  const low90 = num(r[ix.model_low90]);
  const high90 = num(r[ix.model_high90]);
  const contained = low90 === null || high90 === null ? ""
    : (actual >= low90 - EPS && actual <= high90 + EPS ? "same" : "different");
  if (contained) {
    if (contained === "same") containRecomputedSame++;
    if (r[ix.model_contained] === "same") containStoredSame++;
  }
  if (contained && contained !== r[ix.model_contained]) {
    mismatches.model_contained.push({ key, stored: r[ix.model_contained], recomputed: contained, actual, low90, high90 });
  }

  // 3. direction: the verdict from the band position, with the midpoint tolerance
  const direction = (pos) => {
    if (pos === null) return "";
    if (Math.abs(pos - 0.5) <= EPS) return "no call";
    return pos > 0.5 ? "up" : "down";
  };
  const modelPos = num(r[ix.model_band_position]);
  const basePos = num(r[ix.baseline_band_position]);
  const mDir = direction(modelPos);
  const bDir = direction(basePos);
  if (mDir === "up") modelUp++; else if (mDir === "down") modelDown++; else modelNoCall++;
  if (bDir === "up") baseUp++; else if (bDir === "down") baseDown++; else baseNoCall++;
  if (mDir !== r[ix.model_direction]) {
    mismatches.model_direction.push({ key, stored: r[ix.model_direction], recomputed: mDir, modelPos });
  }
  if (bDir !== r[ix.baseline_direction]) {
    mismatches.baseline_direction.push({ key, stored: r[ix.baseline_direction], recomputed: bDir, basePos });
  }

  // 4. the band positions themselves, recomputed from the limits
  const pos = (v) => (v - lower) / R;
  const check = (label, stored, v) => {
    const s = num(stored);
    const c = pos(v);
    if (s === null || c === null) return;
    if (Math.abs(s - c) > 1e-9) mismatches.band_position.push({ key, label, stored: s, recomputed: c });
  };
  check("model", r[ix.model_band_position], num(r[ix.model_projection]));
  check("baseline", r[ix.baseline_band_position], num(r[ix.baseline_projection]));
  check("actual", r[ix.actual_band_position], actual);
}

const total = Object.values(mismatches).reduce((a, m) => a + m.length, 0);
const L = [];
L.push("CSV SELF-CONSISTENCY (mavis, 2026-11-17)");
L.push("");
L.push("rows " + rows + " | first games of record " + firstGames + " | evaluations " + evaluations +
  " | with control limits " + scored + " | no control limits yet (n<4) " + noLimits);
L.push("");
L.push("verdict mismatches: " + total);
for (const [k, v] of Object.entries(mismatches)) {
  L.push("  " + k.padEnd(20) + v.length);
  for (const m of v.slice(0, 3)) L.push("      " + JSON.stringify(m));
}
L.push("");
L.push("containment recomputed from the interval columns: " + containRecomputedSame + " same");
L.push("containment as stored in the verdict column:        " + containStoredSame + " same");
L.push("");
L.push("model direction recomputed: up " + modelUp + " / down " + modelDown + " / no call " + modelNoCall);
L.push("baseline direction recomputed: up " + baseUp + " / down " + baseDown + " / no call " + baseNoCall);
L.push("");
L.push(total === 0 ? "RESULT: the CSV reproduces every one of its own verdicts." : "RESULT: MISMATCHES FOUND");
console.log(L.join("\n"));
process.exitCode = total === 0 ? 0 : 1;
