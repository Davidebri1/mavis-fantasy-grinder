/* ===========================================================================
 * SUPERSEDED - 2026-11-26 (mavis)
 *
 * This script belongs to the evaluation framing Dave rejected on 2026-11-26:
 * factors and clusters were accepted or rejected, a coefficient was reported
 * as a variable ("P=1"), a p value was printed beside a hit rate, and the
 * framing measured pooled data against control-limit bands.
 *
 * The rejection was of the framing, not of this file. The file stays in the
 * repository as a dated record of that method and is not part of the current
 * evaluation.
 *
 * Its input is pinned to the pre-correction CSV so it still runs against the
 * data it was written for. The current method is:
 *   scripts/mavis-categorical-evaluation.mjs   - the analysis
 *   scripts/mavis-categorical-charts.mjs       - the charts
 *   docs/mavis-categorical-evaluation.md       - the write-up
 *
 * Point it at another file with MAVIS_PRE_CSV, or MAVIS_PRE_JSON where the
 * input is the harness JSON.
 * =========================================================================== */

/**
 * mavis-boom-semantics-walkforward.mjs
 *
 * The retrospective boom audit compares the old (contemporaneous) control
 * limit against the player's FINAL upper cluster. That is not apples to
 * apples: the engine only knew the earlier games at the time.
 *
 * This script repeats the classification on the same basis the engine used:
 * thresholds are re-derived from the games ALREADY SEEN, and the actual is
 * then classified against them:
 *   - in the upper cluster            -> a HIGH GAME
 *   - beyond the upper limit          -> a genuine BOOM
 *   - neither                         -> an ordinary game
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const CSV = process.env.MAVIS_PRE_CSV || path.join(REPO, "frontend", "react", ".tmp-audit", "projection-evaluation-pre-correction.csv");

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

function findThresholds(scores) {
  const min = Math.min(...scores), max = Math.max(...scores);
  const width = 1;
  const nb = Math.max(1, Math.floor((max - min) / width) + 1);
  const counts = new Array(nb).fill(0);
  for (const s of scores) counts[Math.min(nb - 1, Math.max(0, Math.floor((s - min) / width)))]++;
  const smooth = counts.map((_, i) => {
    const a = counts[i - 1] ?? counts[i], b = counts[i], c = counts[i + 1] ?? counts[i];
    return 0.25 * a + 0.5 * b + 0.25 * c;
  });
  let peaks = [];
  for (let i = 0; i < nb; i++) {
    if (counts[i] < 2) continue;
    const l = smooth[i - 1] ?? smooth[i], r = smooth[i + 1] ?? smooth[i];
    if (smooth[i] >= l && smooth[i] > r) peaks.push(i);
  }
  peaks = peaks.filter((p) => ((counts[p - 1] ?? 0) + counts[p] + (counts[p + 1] ?? 0)) >= 3);
  const merged = [];
  for (const p of peaks) {
    const last = merged[merged.length - 1];
    if (last !== undefined && p - last <= 2) {
      if (counts[p] > counts[last]) merged[merged.length - 1] = p;
    } else merged.push(p);
  }
  peaks = merged;
  const thresholds = [];
  for (let i = 0; i + 1 < peaks.length; i++) {
    const a = peaks[i], b = peaks[i + 1];
    let valley = a;
    for (let j = a + 1; j < b; j++) if (smooth[j] < smooth[valley]) valley = j;
    if (smooth[valley] > 0.5 * Math.min(smooth[a], smooth[b])) continue;
    thresholds.push({ at: min + (valley + 0.5) * width, valleyCount: r3(smooth[valley]) });
  }
  return thresholds.map((t) => t.at);
}

const raw = parseCsv(fs.readFileSync(CSV, "utf8"));
const header = raw[0];
const recs = raw.slice(1).filter((r) => r.length === header.length)
  .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));

const byPlayer = new Map();
for (const r of recs) {
  const k = r.athlete_id || r.player;
  if (!byPlayer.has(k)) byPlayer.set(k, []);
  byPlayer.get(k).push(r);
}
for (const rows of byPlayer.values()) rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const MIN_PRIOR = 12;
let evaluated = 0, splitAtTheTime = 0;
const classes = { highGame: 0, boom: 0, ordinary: 0 };
const oldBoomRows = { total: 0, highGame: 0, boom: 0, ordinary: 0 };
const boomSizes = [];
const oldBoomSizes = [];

for (const [key, rows] of byPlayer) {
  const scoresAll = rows.map((r) => num(r.actual_dk_points)).filter((x) => x !== null);
  if (scoresAll.length < 30) continue;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const actual = num(r.actual_dk_points);
    if (actual === null) continue;
    const prior = scoresAll.slice(0, i);
    if (prior.length < MIN_PRIOR) continue;
    const th = findThresholds(prior);
    if (!th.length) continue;
    evaluated++;
    splitAtTheTime++;
    const inTop = classOf(actual, th) === th.length;
    const priorMed = median(prior);
    const sig = robustSigma(prior, priorMed);
    const topScores = prior.filter((s) => classOf(s, th) === th.length);
    const topMean = topScores.length ? median(topScores) : null;
    const isBoom = inTop && topMean !== null && actual > topMean + 1.96 * sig;
    const cls = isBoom ? "boom" : inTop ? "highGame" : "ordinary";
    classes[cls]++;
    if (isBoom) boomSizes.push(actual - topMean);
    if (r.outcome_class === "boom (outlier high)") {
      oldBoomRows.total++;
      oldBoomRows[cls]++;
      if (topMean !== null) oldBoomSizes.push(actual - topMean);
    }
  }
}

function describe(vals) {
  if (!vals.length) return { n: 0 };
  return { n: vals.length, median: r3(median(vals)), p10: r3(quantile(vals, 0.1)), p90: r3(quantile(vals, 0.9)) };
}

console.log("=== WALK-FORWARD CLASSIFICATION, same basis as the engine ===");
console.log("");
console.log("evaluations where the player's earlier games had a second hump:", evaluated);
console.log("classified as a HIGH GAME (in the upper cluster):", classes.highGame, "=", r3(classes.highGame / evaluated));
console.log("classified as a genuine BOOM (beyond the upper limit):", classes.boom, "=", r3(classes.boom / evaluated));
console.log("classified as ordinary (below the upper cluster):", classes.ordinary, "=", r3(classes.ordinary / evaluated));
console.log("");
console.log("boom size above the upper-cluster median:", JSON.stringify(describe(boomSizes)));
console.log("");
console.log("-- the OLD 'boom (outlier high)' label, re-read on this same basis --");
console.log("old boom rows among these:", oldBoomRows.total);
console.log("  of which are really a HIGH GAME:", oldBoomRows.highGame, "=", r3(oldBoomRows.highGame / Math.max(1, oldBoomRows.total)));
console.log("  of which are really a BOOM:", oldBoomRows.boom, "=", r3(oldBoomRows.boom / Math.max(1, oldBoomRows.total)));
console.log("  of which are ordinary games:", oldBoomRows.ordinary, "=", r3(oldBoomRows.ordinary / Math.max(1, oldBoomRows.total)));
console.log("old boom size above the upper-cluster median:", JSON.stringify(describe(oldBoomSizes)));

const out = { evaluated, classes, oldBoomRows, boomSize: describe(boomSizes), oldBoomSize: describe(oldBoomSizes) };
fs.writeFileSync(path.join(REPO, "frontend", "react", ".tmp-audit", "boom-semantics-walkforward.json"), JSON.stringify(out, null, 1));
console.log("");
console.log("wrote frontend/react/.tmp-audit/boom-semantics-walkforward.json");
