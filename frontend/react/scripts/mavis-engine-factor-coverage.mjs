/**
 * mavis-engine-factor-coverage.mjs
 *
 * Which factors the engine actually applies, and which of them the
 * evaluation CSV can possibly test. The CSV carries opponent, team, date and
 * season only - no home flag, no rest days, no regime shifts - so this
 * counts what is testable and what is not, instead of quietly dropping it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const CSV = path.join(REPO, "frontend", "react", ".tmp-audit", "projection-evaluation.csv");

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = parseCsv(fs.readFileSync(CSV, "utf8"));
const header = raw[0];
const recs = raw.slice(1).filter((r) => r.length === header.length)
  .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));

const TESTABLE = new Set(["opponent", "team", "month"]);
const reasons = new Map();
const keyCounts = new Map();
let floor = 0, empty = 0, parsedAny = 0;

for (const r of recs) {
  const cond = (r.model_factor_condition || "").trim();
  if (!cond) { empty++; continue; }
  if (cond.includes("even-split floor")) { floor++; continue; }
  const m = /^(opponent|team|month|decade|isHome|restDays|regimeShifts)(\s*!?=|\s*<|\s*>)/.exec(cond);
  if (!m) {
    const reason = "unrecognised condition form";
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
    continue;
  }
  const key = m[1];
  keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  if (!TESTABLE.has(key)) {
    const reason = "factor key '" + key + "' is not in the evaluation CSV";
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  } else {
    parsedAny++;
  }
}

console.log("total rows:", recs.length);
console.log("rows with no condition at all:", empty);
console.log("rows using the even-split floor (no factor found):", floor);
console.log("rows with a testable condition (opponent/team/month):", parsedAny);
console.log("condition keys seen:", JSON.stringify([...keyCounts.entries()].sort((a, b) => b[1] - a[1])));
console.log("why the rest cannot be evaluated:");
for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + n + "  " + reason);

// what the engine's own factor column says, and the outcome split
const factorCol = new Map();
for (const r of recs) {
  const f = (r.model_factor || "").trim();
  if (!f) continue;
  factorCol.set(f, (factorCol.get(f) || 0) + 1);
}
console.log("model_factor column:", JSON.stringify([...factorCol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)));
const pathCol = new Map();
for (const r of recs) {
  const p = (r.model_path || "").trim();
  if (!p) continue;
  pathCol.set(p, (pathCol.get(p) || 0) + 1);
}
console.log("model_path column:", JSON.stringify([...pathCol.entries()].sort((a, b) => b[1] - a[1])));

// ---- PERSIST: the coverage figures the write-up cites ----
const coverageOut = {
  totalRows: recs.length,
  rowsWithNoCondition: empty,
  rowsEvenSplitFloor: floor,
  rowsWithTestableCondition: parsedAny,
  conditionKeys: Object.fromEntries([...keyCounts.entries()].sort((a, b) => b[1] - a[1])),
  untestableReasons: Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1])),
  modelFactorColumn: Object.fromEntries([...factorCol.entries()].sort((a, b) => b[1] - a[1])),
  modelPathColumn: Object.fromEntries([...pathCol.entries()].sort((a, b) => b[1] - a[1])),
};
fs.writeFileSync(path.join(REPO, "frontend", "react", ".tmp-audit", "engine-factor-coverage.json"), JSON.stringify(coverageOut, null, 1));
console.log("");
console.log("wrote frontend/react/.tmp-audit/engine-factor-coverage.json");
