/**
 * mavis-boom-semantics.mjs
 *
 * What IS a boom, under Dave's own vocabulary?
 *
 *   "boom is outlier of upper limit. it can never be a relatively small
 *    number. high game is the word you're looking for"
 *
 * So: a HIGH GAME is a member of the player's upper cluster. A BOOM is an
 * outlier beyond that cluster's upper limit - a genuinely large number.
 *
 * The old evaluation called anything above the upper control limit a "boom
 * (outlier high)". That threshold is the high half's MEAN, so the old booms
 * were only marginally large. This script measures them properly, in points,
 * against the player's own upper-cluster mean from the new taxonomy.
 *
 * It also measures the model's P=1 projection against the same upper-cluster
 * mean, because the engine's P=1 projection is exactly its upper control
 * limit (the high half's mean) - so the question "does the model's high
 * projection point at the player's high game, or at a number well above it?"
 * has a concrete answer.
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
const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
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
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const robustSigma = (xs, med) => 1.4826 * (median(xs.map((s) => Math.abs(s - med))) || 1e-9);
const classOf = (v, th) => { let c = 0; for (const t of th) if (v >= t) c++; return c; };

const raw = parseCsv(fs.readFileSync(CSV, "utf8"));
const header = raw[0];
const recs = raw.slice(1).filter((r) => r.length === header.length)
  .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
const payload = JSON.parse(fs.readFileSync(JSON_IN, "utf8"));

const byPlayer = new Map();
for (const r of recs) {
  const k = r.athlete_id || r.player;
  if (!byPlayer.has(k)) byPlayer.set(k, []);
  byPlayer.get(k).push(r);
}

// The upper cluster of each player, from the new taxonomy. A player with no
// second hump has ONE population, so he has no high game cluster to point at.
const upperCluster = new Map();
for (const p of payload.players) {
  const th = p.distribution.looseThresholds;
  if (!th.length) continue;
  const top = p.clusters[p.clusters.length - 1];
  if (!top || !top.n) continue;
  upperCluster.set(p.key, {
    mean: top.mean,
    hi: top.hi,
    n: top.n,
    thresholds: th,
    robustSigma: p.distribution.robustSigma,
    scores: (byPlayer.get(p.key) || []).map((r) => num(r.actual_dk_points)).filter((x) => x !== null),
  });
}

const oldBoom = [];
const p1Rows = [];
const allOldBoomRows = recs.filter((r) => r.outcome_class === "boom (outlier high)");

for (const r of recs) {
  const key = r.athlete_id || r.player;
  const uc = upperCluster.get(key);
  const actual = num(r.actual_dk_points);
  if (actual === null) continue;

  if (r.outcome_class === "boom (outlier high)") {
    const entry = { key, player: r.player, actual, oldBoom: true, hasUpper: !!uc };
    if (uc) {
      const inTop = classOf(actual, uc.thresholds) === uc.thresholds.length;
      const sig = robustSigma(uc.scores, median(uc.scores));
      const sorted = [...uc.scores].sort((a, b) => b - a);
      const rank = sorted.findIndex((s) => s === actual);
      const nextDown = sorted[rank + 1];
      entry.aboveUpperMean = actual - uc.mean;
      entry.inTopCluster = inTop;
      entry.beyondUpperLimit = actual > uc.mean + 1.96 * sig;
      entry.isolatedSpike = nextDown !== undefined && actual - nextDown >= 3;
    }
    oldBoom.push(entry);
  }

  if (num(r.model_P) === 1 && uc) {
    p1Rows.push({
      key, player: r.player,
      projection: num(r.model_projection),
      upperMean: uc.mean,
      diff: num(r.model_projection) - uc.mean,
      inTop: classOf(num(r.model_projection), uc.thresholds) === uc.thresholds.length,
    });
  }
}

function describe(vals) {
  if (!vals.length) return { n: 0 };
  return {
    n: vals.length,
    median: r3(median(vals)),
    p10: r3(quantile(vals, 0.1)),
    p90: r3(quantile(vals, 0.9)),
  };
}

const withUpper = oldBoom.filter((e) => e.hasUpper);
console.log("=== BOOM SEMANTICS, in Dave's vocabulary ===");
console.log("");
console.log("old 'boom (outlier high)' rows in the dataset:", allOldBoomRows.length);
console.log("old booms inside the evaluated player population:", oldBoom.length);
console.log("old booms for players whose distribution HAS an upper cluster:", withUpper.length);
console.log("");
console.log("-- how large was an old 'boom', measured against the player's own upper-cluster mean --");
console.log("actual - upper cluster mean:", JSON.stringify(describe(withUpper.map((e) => e.aboveUpperMean))));
console.log("  (the old control-limit threshold was the high half's MEAN, so these are small by construction)");
console.log("");
console.log("-- under the new taxonomy, what were those games really? --");
console.log("landed in the player's upper cluster (a HIGH GAME):", withUpper.filter((e) => e.inTopCluster).length, "of", withUpper.length);
console.log("beyond the upper limit (a genuine BOOM):", withUpper.filter((e) => e.beyondUpperLimit).length, "of", withUpper.length);
console.log("isolated spikes (>= 3 pts above the next game):", withUpper.filter((e) => e.isolatedSpike).length, "of", withUpper.length);
console.log("");
console.log("-- where does the model's P=1 projection point? --");
console.log("P=1 rows for players with an upper cluster:", p1Rows.length);
console.log("P=1 projection - upper cluster mean:", JSON.stringify(describe(p1Rows.map((e) => e.diff))));
console.log("P=1 projections that land in the upper cluster:", p1Rows.filter((e) => e.inTop).length, "of", p1Rows.length,
  "=", r3(p1Rows.filter((e) => e.inTop).length / Math.max(1, p1Rows.length)));
console.log("");
console.log("NOTE: the engine's P=1 projection is exactly its upper control limit, which is the high HALF's mean");
// how far above the upper cluster mean does the model's high projection sit?
const above = p1Rows.filter((e) => e.diff > 0).length;
console.log("P=1 projections ABOVE the player's upper-cluster mean:", above, "of", p1Rows.length,
  "=", r3(above / Math.max(1, p1Rows.length)));
const wayAbove = p1Rows.filter((e) => e.diff > 5).length;
console.log("P=1 projections more than 5 points above the upper-cluster mean:", wayAbove, "of", p1Rows.length,
  "=", r3(wayAbove / Math.max(1, p1Rows.length)));

// the same question for the P=0 side
const p0Rows = [];
for (const r of recs) {
  if (num(r.model_P) !== 0) continue;
  const key = r.athlete_id || r.player;
  const uc = upperCluster.get(key);
  if (!uc) continue;
  const proj = num(r.model_projection);
  if (proj === null) continue;
  const bottom = payload.players.find((p) => p.key === key).clusters[0];
  p0Rows.push({
    player: r.player,
    diff: proj - bottom.mean,
    inBottom: classOf(proj, uc.thresholds) === 0,
  });
}
console.log("");
console.log("-- the P=0 side, for symmetry --");
console.log("P=0 rows for players with an upper cluster:", p0Rows.length);
console.log("P=0 projection - lower-cluster mean:", JSON.stringify(describe(p0Rows.map((e) => e.diff))));
console.log("P=0 projections landing in the lower cluster:", p0Rows.filter((e) => e.inBottom).length, "of", p0Rows.length,
  "=", r3(p0Rows.filter((e) => e.inBottom).length / Math.max(1, p0Rows.length)));

const out = {
  oldBoomRows: allOldBoomRows.length,
  oldBoomInPopulation: oldBoom.length,
  oldBoomWithUpperCluster: withUpper.length,
  aboveUpperMean: describe(withUpper.map((e) => e.aboveUpperMean)),
  inTopCluster: withUpper.filter((e) => e.inTopCluster).length,
  beyondUpperLimit: withUpper.filter((e) => e.beyondUpperLimit).length,
  isolatedSpikes: withUpper.filter((e) => e.isolatedSpike).length,
  p1Rows: p1Rows.length,
  p1MinusUpperMean: describe(p1Rows.map((e) => e.diff)),
  p1InUpperCluster: p1Rows.filter((e) => e.inTop).length,
  p1AboveUpperMean: above,
  p1MoreThan5Above: wayAbove,
  p0Rows: p0Rows.length,
  p0MinusLowerMean: describe(p0Rows.map((e) => e.diff)),
  p0InLowerCluster: p0Rows.filter((e) => e.inBottom).length,
};
fs.writeFileSync(path.join(REPO, "frontend", "react", ".tmp-audit", "boom-semantics.json"), JSON.stringify(out, null, 1));
console.log("");
console.log("wrote frontend/react/.tmp-audit/boom-semantics.json");
