/**
 * mavis-player-scoped-audit.mjs
 *
 * Three checks that the per-player evaluation needs before it can be written up:
 *
 *  A. What the old evaluation's fields actually mean. The old report's
 *     "boom lift +0.8 pts" has to be pinned down: is it points above the
 *     high mean, or a rate lift in percentage points?
 *  B. The engine's own applied factor, measured against the new taxonomy
 *     (the player's own clusters), with an empirical null: the same test
 *     run on randomly chosen conditions, so the false-positive rate is
 *     measured rather than assumed.
 *  C. Worked examples a human can check by eye.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const CSV = path.join(REPO, "frontend", "react", ".tmp-audit", "projection-evaluation.csv");
const JSON_IN = path.join(REPO, "frontend", "react", ".tmp-audit", "player-scoped-evaluation.json");

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

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN);
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
function erf(x) {
  const sign = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}
const pFromZ = (z) => Math.max(0, Math.min(1, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)))));
function twoProportion(aHit, aN, bHit, bN) {
  if (!aN || !bN) return { z: NaN, p: NaN };
  const p1 = aHit / aN, p2 = bHit / bN, pooled = (aHit + bHit) / (aN + bN);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / aN + 1 / bN));
  if (se === 0) return { z: 0, p: 1 };
  const z = (p1 - p2) / se;
  return { z, p: pFromZ(z) };
}
const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const raw = parseCsv(fs.readFileSync(CSV, "utf8"));
const header = raw[0];
const recs = raw.slice(1).filter((r) => r.length === header.length)
  .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
const payload = JSON.parse(fs.readFileSync(JSON_IN, "utf8"));
// The taxonomy the engine's factor is measured against is the player's own
// hump split. The strict gate leaves a small population, so the split that
// actually exists - the humps Dave's method reads off the histogram - is the
// one used here, and the strict population is reported alongside.
const thresholdsByKey = new Map(payload.players.map((p) => [p.key, p.distribution.looseThresholds]));
const classOf = (v, th) => { let c = 0; for (const t of th) if (v >= t) c++; return c; };

// ---- A. what the old fields mean -----------------------------------------
const withLimits = recs.filter((r) => num(r.control_high) !== null && num(r.peeled_high) !== null);
const diffCH_PH = withLimits.map((r) => num(r.control_high) - num(r.peeled_high));
const equalCH_PH = withLimits.filter((r) => Math.abs(num(r.control_high) - num(r.peeled_high)) < 0.001).length;
const p1 = recs.filter((r) => num(r.model_P) === 1 && num(r.peeled_high) !== null);
const p1vsPeeled = p1.map((r) => num(r.model_projection) - num(r.peeled_high));
const p1vsControl = p1.map((r) => num(r.model_projection) - num(r.control_high));
const oldBoom = recs.filter((r) => r.outcome_class === "boom (outlier high)" && num(r.control_high) !== null);
const boomAboveControl = oldBoom.map((r) => num(r.actual_dk_points) - num(r.control_high));
const boomAboveHigh = oldBoom.map((r) => num(r.actual_dk_points) - num(r.peeled_high));
const projAboveControl = recs.filter((r) => num(r.model_projection) !== null && num(r.control_high) !== null)
  .map((r) => num(r.model_projection) - num(r.control_high));

console.log("=== A. FIELD SEMANTICS ===");
console.log("rows with both control_high and peeled_high:", withLimits.length);
console.log("control_high == peeled_high in", equalCH_PH, "of them");
console.log("control_high - peeled_high: median", r3(median(diffCH_PH)), "p10", r3(quantile(diffCH_PH, 0.1)), "p90", r3(quantile(diffCH_PH, 0.9)));
console.log("P=1 rows:", p1.length);
console.log("P=1 projection - peeled_high: median", r3(median(p1vsPeeled)), "p90", r3(quantile(p1vsPeeled, 0.9)), "max", r3(Math.max(...p1vsPeeled)));
console.log("P=1 projection - control_high: median", r3(median(p1vsControl)), "max", r3(Math.max(...p1vsControl)));
console.log("old boom rows:", oldBoom.length);
console.log("old boom actual - control_high: median", r3(median(boomAboveControl)), "p10", r3(quantile(boomAboveControl, 0.1)), "p90", r3(quantile(boomAboveControl, 0.9)));
console.log("old boom actual - peeled_high: median", r3(median(boomAboveHigh)), "p90", r3(quantile(boomAboveHigh, 0.9)));
console.log("projection - control_high across all scored rows: median", r3(median(projAboveControl)), "max", r3(Math.max(...projAboveControl)));

// ---- B. the engine's applied factor vs the new taxonomy, with a null ------
const monthOf = (d) => Number(d.slice(5, 7));

/**
 * model_factor_condition holds a full prose sentence, e.g.
 *   month=October (two-sample t-test t=2.31, df=15.83; scores average ...)
 * The value ends at the first whitespace or parenthesis. "!=" is a valid
 * operator. A condition that does not parse is the engine's even-split floor
 * ("no candidate factor reached |t| >= 2"), which is not a factor at all.
 */
function parseCondition(condition) {
  if (!condition) return null;
  const m = /^(opponent|team|month|decade|isHome|restDays|regimeShifts)(\s*!?=|\s*<|\s*>)([^\s(]+)/.exec(condition.trim());
  if (!m) return null;
  const key = m[1];
  const op = m[2].replace(/\s+/g, "").replace("!==", "!=").replace("!=", "!=");
  const val = m[3];
  if (!["opponent", "team", "month"].includes(key)) return null; // not in the evaluation CSV
  return { key, op, val, raw: condition };
}
function condHolds(parsed, row) {
  if (!parsed) return null;
  let actual = null;
  if (parsed.key === "opponent") actual = row.opponent;
  else if (parsed.key === "team") actual = row.team;
  else if (parsed.key === "month") actual = String(monthOf(row.date));
  else return null;
  const eq = actual === parsed.val;
  if (parsed.op === "=") return eq;
  if (parsed.op === "!=") return !eq;
  if (parsed.op === "<") return Number(actual) < Number(parsed.val);
  if (parsed.op === ">") return Number(actual) > Number(parsed.val);
  return null;
}
function testCondition(rows, parsed, inTop) {
  const idx = rows.map((r, i) => ({ h: condHolds(parsed, r), inTop: inTop[i] })).filter((x) => x.h !== null);
  const withN = idx.filter((x) => x.h).length, withoutN = idx.length - withN;
  if (withN < 3 || withoutN < 3) return null;
  const withTop = idx.filter((x) => x.h && x.inTop).length;
  const withoutTop = idx.filter((x) => !x.h && x.inTop).length;
  const t = twoProportion(withTop, withN, withoutTop, withoutN);
  return { withN, withoutN, withTop, withoutTop, z: r3(t.z), p: r4(t.p) };
}

const byPlayer = new Map();
for (const r of recs) {
  const k = r.athlete_id || r.player;
  if (!byPlayer.has(k)) byPlayer.set(k, []);
  byPlayer.get(k).push(r);
}
const rand = mulberry32(20261123);

// For each player, each DISTINCT condition the engine applied gets its own
// test. Pooling different conditions of one player into one test would
// compare apples with oranges.
const engineTests = [];
const unevaluableRows = { floor: 0, other: 0 };
for (const [key, rowsAll] of byPlayer) {
  const th = thresholdsByKey.get(key);
  if (!th || th.length < 1) continue;
  const top = th.length - 1;
  const rows = rowsAll.filter((r) => num(r.actual_dk_points) !== null && num(r.model_projection) !== null && num(r.earlier_n) >= 4);
  if (rows.length < 8) continue;
  const inTop = rows.map((r) => classOf(num(r.actual_dk_points), th) === top ? 1 : 0);
  const byCond = new Map();
  for (const r of rows) {
    const cond = r.model_factor_condition;
    if (!cond) continue;
    const parsed = parseCondition(cond);
    if (!parsed) {
      if (cond.includes("even-split floor")) unevaluableRows.floor++;
      else unevaluableRows.other++;
      continue;
    }
    const key2 = parsed.key + " " + parsed.op + " " + parsed.val;
    if (!byCond.has(key2)) byCond.set(key2, { parsed, rows: [] });
    byCond.get(key2).rows.push(r);
  }
  for (const [condKey, grp] of byCond.entries()) {
    const idx = grp.rows.map((r) => classOf(num(r.actual_dk_points), th) === top ? 1 : 0);
    // the test is against the player's WHOLE population: does the condition
    // hold or not, and is the game in the high cluster or not
    const all = rows.map((r, i) => ({ r, h: condHolds(grp.parsed, r), inTop: inTop[i] })).filter((x) => x.h !== null);
    const t = testCondition(rows, grp.parsed, inTop);
    if (!t) continue;
    engineTests.push({
      playerKey: key,
      player: rowsAll[0].player,
      condition: condKey,
      kind: grp.parsed.key,
      rowsWhereConditionWasApplied: grp.rows.length,
      ...t,
    });
  }
}

// empirical null: the same test, on random conditions drawn from the same
// player's own pool of conditions, so the false-positive rate is measured.
let nullTests = 0, nullClearing = 0;
const nullPs = [];
for (const [key, rowsAll] of byPlayer) {
  const th = thresholdsByKey.get(key);
  if (!th || th.length < 1) continue;
  const top = th.length - 1;
  const rows = rowsAll.filter((r) => num(r.actual_dk_points) !== null && num(r.model_projection) !== null && num(r.earlier_n) >= 4);
  if (rows.length < 8) continue;
  const inTop = rows.map((r) => classOf(num(r.actual_dk_points), th) === top ? 1 : 0);
  const pool = [...new Set(rows.map((r) => (r.opponent ? "opponent=" + r.opponent : "month=" + monthOf(r.date))))];
  if (!pool.length) continue;
  for (let k = 0; k < 40; k++) {
    const cond = pool[Math.floor(rand() * pool.length)];
    const parsed = parseCondition(cond);
    const t = testCondition(rows, parsed, inTop);
    if (!t) continue;
    nullTests++; nullPs.push(t.p);
    if (t.p < 0.05) nullClearing++;
  }
}
const cleared = engineTests.filter((t) => t.p < 0.05);
const enginePs = engineTests.map((t) => t.p).sort((a, b) => a - b);
const kindCounts = {};
for (const t of engineTests) kindCounts[t.kind] = (kindCounts[t.kind] || 0) + 1;

console.log("=== B. ENGINE FACTOR vs THE NEW TAXONOMY ===");
console.log("rows where the engine used the even-split floor (no factor):", unevaluableRows.floor);
console.log("rows with a condition that could not be parsed:", unevaluableRows.other);
console.log("player-condition pairs testable against the player's own clusters:", engineTests.length);
console.log("of those, associated with the high cluster at p<0.05:", cleared.length, "of", engineTests.length);
console.log("median p across the engine's own condition:", enginePs.length ? r4(median(enginePs)) : null);
console.log("by condition kind:", JSON.stringify(kindCounts));
console.log("empirical null: random conditions of the same shape, same test ->", nullClearing, "of", nullTests, "cleared p<0.05 (", r3(nullClearing / Math.max(1, nullTests)), ")");
console.log("null median p:", nullPs.length ? r4(median([...nullPs].sort((a, b) => a - b))) : null);
console.log("cleared examples:", JSON.stringify(cleared.slice(0, 10).map((t) => ({ player: t.player, condition: t.condition, p: t.p, withN: t.withN, withoutN: t.withoutN, withTop: t.withTop, withoutTop: t.withoutTop }))));
console.log("closest to clearing:", JSON.stringify(engineTests.slice().sort((a, b) => a.p - b.p).slice(0, 8).map((t) => ({ player: t.player, condition: t.condition, p: t.p, withN: t.withN, withoutN: t.withoutN, withTop: t.withTop, withoutTop: t.withoutTop }))));

// ---- C. worked examples ----------------------------------------------------
console.log("=== C. THE SPLIT POPULATION ===");
const primarySplit = payload.players.filter((p) => p.primary.thresholds.length >= 1);
console.log("players split under his rule:", primarySplit.length, "of", payload.players.length);
for (const p of primarySplit) {
  console.log("--", p.player, "(" + p.position + ")", p.games, "games",
    "| thresholds", JSON.stringify(p.primary.thresholds),
    "| clusters valid:", p.primary.clusterValid,
    "| model", p.primary.metric.modelHitRate, "calibrated", p.primary.metric.calibratedHitRate,
    "baseline", p.primary.metric.baseHitRate, "reference", p.primary.reference.majorityShare);
}
console.log("=== C2. WORKED EXAMPLES (by eye) ===");
for (const name of ["Matthew Stafford", "Matt Flynn", "Benny Snell Jr.", "DeAngelo Williams"]) {
  const p = payload.players.find((x) => x.player === name);
  if (!p) { console.log(name, ": not in the population"); continue; }
  const rows = (byPlayer.get(p.key) || []).filter((r) => num(r.actual_dk_points) !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const scores = rows.map((r) => num(r.actual_dk_points)).sort((a, b) => a - b);
  console.log("---", name, "(" + p.position + ")", p.games, "games", p.firstDate, "to", p.lastDate);
  console.log("scores:", JSON.stringify(scores));
  console.log("median", p.distribution.median, "mode", p.distribution.mode, "kurtosis", p.distribution.kurtosis, "skew", p.distribution.skew);
  console.log("his gate:", p.primary.decision, "| loose thresholds:", JSON.stringify(p.distribution.looseThresholds));
  console.log("clusters (loose):", JSON.stringify(p.clusters.map((c) => ({ n: c.n, lo: c.lo, hi: c.hi, mean: c.mean, verdict: c.verdict }))));
  console.log("hit rate model", p.metric.modelHitRate, "calibrated", p.metric.calibratedHitRate, "baseline", p.metric.baseHitRate, "reference", p.reference.majorityShare);
  console.log("offset", p.precision.residualOffset, "residual IQR", p.precision.residualIQR, "| P=1 aim top cluster", p.aim.p1TopShare);
}

// ---- PERSIST: the figures the write-up cites, read back by the doc verifier ----
const auditOut = {
  fieldSemantics: {
    rowsWithBothControlHighAndPeeledHigh: withLimits.length,
    controlHighEqualsPeeledHigh: equalCH_PH,
    controlHighMinusPeeledHigh: { median: r3(median(diffCH_PH)), p10: r3(quantile(diffCH_PH, 0.1)), p90: r3(quantile(diffCH_PH, 0.9)) },
    p1Rows: p1.length,
    p1MinusControlHigh: { median: r3(median(p1vsControl)), max: r3(Math.max(...p1vsControl)) },
    projectionMinusControlHigh: { median: r3(median(projAboveControl)), max: r3(Math.max(...projAboveControl)) },
    oldBoomRows: oldBoom.length,
    oldBoomActualMinusControlHigh: { median: r3(median(boomAboveControl)), p10: r3(quantile(boomAboveControl, 0.1)), p90: r3(quantile(boomAboveControl, 0.9)) },
  },
  engineFactor: {
    testable: engineTests.length,
    cleared: cleared.length,
    tinyCells: cleared.filter((t) => t.withN < 5 || t.withoutN < 5).length,
    bothCellsAtLeast5: cleared.filter((t) => t.withN >= 5 && t.withoutN >= 5).length,
    medianPEngine: r4(median(enginePs)),
    nullTests,
    nullClearing,
    nullRate: r3(nullClearing / Math.max(1, nullTests)),
    nullMedianP: r4(median([...nullPs].sort((a, b) => a - b))),
    kinds: kindCounts,
  },
};
fs.writeFileSync(path.join(REPO, "frontend", "react", ".tmp-audit", "player-scoped-audit.json"), JSON.stringify(auditOut, null, 1));
console.log("");
console.log("wrote frontend/react/.tmp-audit/player-scoped-audit.json");
