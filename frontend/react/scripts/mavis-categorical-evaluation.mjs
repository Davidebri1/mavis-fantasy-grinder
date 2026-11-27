#!/usr/bin/env node
/**
 * mavis-categorical-evaluation.mjs - Dave's one metric, per player, on the
 * rebuilt evaluation.
 *
 * Reads:  frontend/react/.tmp-audit/projection-evaluation.csv   (the rebuild)
 * Writes: frontend/react/.tmp-audit/categorical-evaluation.json
 *
 * THE METHOD, IN THE OWNER'S WORDS
 *
 *   "my metric measures truth: are these two numbers the same? it pays no
 *    mind to scales and to amounts and above or below by x amount. no. it
 *    wants to know did this projection equal this actual on this day."
 *
 * So the metric is: on each day, did the actual land in the category the
 * model called? The answer is one, zero, or - when the call is the even
 * split - one half, because the floor is a coin flip by definition.
 *
 * THE REFERENCE LINE
 *
 *   The rate is measured against what a predictor with NO information about
 *   the outcome scores, never against a flat 50%. For this model that
 *   predictor is the one that always names the player's biggest category:
 *   the same category for every day, with no knowledge of the day.
 *
 * NO ACCEPT / REJECT
 *
 *   The only accept/reject in the whole model is sameness: are the two
 *   halves one population or two? Everything else is a category, a factor,
 *   or a mean. Nothing here is scored as "accepted" or "rejected".
 *
 * SIGNIFICANCE IS ITS OWN SECTION
 *
 *   The sign test and the Wilcoxon signed-rank test on the per-player
 *   differences live in their own block. No p-value is ever printed next
 *   to a hit rate, in the numbers or in the charts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const CSV = path.join(REPO, "frontend", "react", ".tmp-audit", "projection-evaluation.csv");
const OUT = path.join(REPO, "frontend", "react", ".tmp-audit", "categorical-evaluation.json");

// ---------------------------------------------------------------------------
// Reading the CSV
// ---------------------------------------------------------------------------

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const raw = fs.readFileSync(CSV, "utf8");
const lines = raw.split("\n");
const header = parseCsvLine(lines[0].replace(/\r$/, ""));
const COL = {};
header.forEach((h, i) => { COL[h] = i; });

const players = new Map(); // athlete_id -> the player's rows, in date order
let rowsRead = 0;
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].replace(/\r$/, "");
  if (!line) continue;
  const f = parseCsvLine(line);
  if (f.length !== header.length) continue;
  rowsRead++;
  const row = {
    player: f[COL.player],
    athlete_id: f[COL.athlete_id],
    position: f[COL.position],
    team: f[COL.team],
    opponent: f[COL.opponent],
    date: f[COL.date],
    season: Number(f[COL.season]),
    status: f[COL.status],
    earlier_n: Number(f[COL.earlier_n]),
    sampleFlag: f[COL.sample_flag],
    cut: f[COL.cut] === "" ? null : Number(f[COL.cut]),
    actual: Number(f[COL.actual_dk_points]),
    actualCategory: f[COL.actual_category],
    outcomeClass: f[COL.outcome_class],
    call: f[COL.model_call],
    largestCategory: f[COL.model_largest_category],
    projection: f[COL.model_projection] === "" ? null : Number(f[COL.model_projection]),
    low90: f[COL.model_low90] === "" ? null : Number(f[COL.model_low90]),
    high90: f[COL.model_high90] === "" ? null : Number(f[COL.model_high90]),
    sameMeans: f[COL.model_same_means] === "true",
    sameMeansP: f[COL.model_same_means_p] === "" ? null : Number(f[COL.model_same_means_p]),
    factor: f[COL.model_factor],
    factorCondition: f[COL.model_factor_condition],
    factorP: f[COL.model_factor_p] === "" ? null : Number(f[COL.model_factor_p]),
    shapeHigh: f[COL.model_shape_high],
    shapeLow: f[COL.model_shape_low],
    categoriesText: f[COL.model_categories],
    baseline: f[COL.baseline_projection] === "" ? null : Number(f[COL.baseline_projection]),
    baselineCall: f[COL.baseline_call],
  };
  if (!players.has(row.athlete_id)) {
    players.set(row.athlete_id, { athlete_id: row.athlete_id, player: row.player, position: row.position, rows: [] });
  }
  players.get(row.athlete_id).rows.push(row);
}
for (const p of players.values()) {
  p.rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
console.log("rows read: " + rowsRead + " | players: " + players.size);

// ---------------------------------------------------------------------------
// The categories, as the CSV records them
// ---------------------------------------------------------------------------

/**
 * Parse the model_categories column: "id [lo,hi) n=.. mean=.. | id ...".
 *
 * The parts are split on the separator first and each part is matched on
 * its own. The range is [lo,hi) - an open bracket and a close paren - so a
 * greedy match across the separator would swallow every category but the
 * last one.
 */
function parseCategories(text) {
  const out = [];
  if (!text) return out;
  for (const part of text.split(" | ")) {
    const m = /^([a-z][a-z-]*) \[(-?[0-9.]+|-inf),(-?[0-9.]+|inf)\) n=([0-9]+) mean=(-?[0-9.]+)$/.exec(part.trim());
    if (!m) continue;
    out.push({
      id: m[1],
      lo: m[2] === "-inf" ? -Infinity : Number(m[2]),
      hi: m[3] === "inf" ? Infinity : Number(m[3]),
      n: Number(m[4]),
      mean: Number(m[5]),
    });
  }
  return out;
}

/** The category the value falls in. The ranges tile the score space once. */
function categoryAt(cats, value) {
  for (const c of cats) {
    if (c.lo <= value && value < c.hi) return c.id;
  }
  return "";
}

/**
 * The biggest category. Ties go to the higher-scoring category by default
 * (that is the model_largest_category column); the lower-scoring tie-break
 * is computed too, as the robustness line on the reference.
 */
function largestCategory(cats, tieHigh) {
  let best = null;
  for (const c of cats) {
    if (!best || c.n > best.n ||
        (c.n === best.n && (tieHigh ? c.mean > best.mean : c.mean < best.mean))) best = c;
  }
  return best ? best.id : "";
}

const medianOf = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const quantileOf = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round6 = (x) => (Number.isFinite(x) ? Math.round(x * 1000000) / 1000000 : null);

// ---------------------------------------------------------------------------
// Per player: Dave's one metric, his own no-skill reference, and round 2
// ---------------------------------------------------------------------------

const notYetScoreable = [];
const scoredPlayers = [];

for (const p of players.values()) {
  const scored = p.rows.filter((r) => r.call !== "");
  if (!scored.length) {
    notYetScoreable.push({ athlete_id: p.athlete_id, player: p.player, games: p.rows.length });
    continue;
  }

  // Round 1: did the actual land in the category the model called?
  let metricSum = 0;
  let refSum = 0;
  let refAltSum = 0;
  let callsEven = 0;
  let resolvedRows = 0, resolvedHits = 0, resolvedRefHits = 0, resolvedRefAltHits = 0;
  let mismatchedLargest = 0;
  const residuals = [];
  for (const r of scored) {
    const s = r.call === "even" ? 0.5 : (r.actualCategory === r.call ? 1 : 0);
    if (r.call === "even") callsEven++;
    metricSum += s;
    const cats = parseCategories(r.categoriesText);
    if (r.actualCategory === r.largestCategory) refSum += 1;
    if (r.actualCategory === largestCategory(cats, false)) refAltSum += 1;
    if (r.call !== "even") {
      resolvedRows++;
      if (r.actualCategory === r.call) resolvedHits++;
      if (r.actualCategory === r.largestCategory) resolvedRefHits++;
      if (r.actualCategory === largestCategory(cats, false)) resolvedRefAltHits++;
    }
    // the CSV's own largest category must agree with the parser
    if (cats.length && largestCategory(cats, true) !== r.largestCategory) mismatchedLargest++;
    residuals.push(r.actual - r.projection);
  }
  const n = scored.length;
  const metric = metricSum / n;
  const reference = refSum / n;
  const referenceAlt = refAltSum / n;

  // Round 2: the offset, applied walk-forward, then the same metric again.
  let offSum = 0;
  let offCount = 0;
  let calSum = 0;
  let calSumEven = 0, calEvenRows = 0, calSumResolved = 0, calResolvedRows = 0;
  const calResiduals = [];
  const calCalls = {};
  for (const r of scored) {
    const offset = offCount ? offSum / offCount : 0;
    const calibrated = r.projection + offset;
    const cats = parseCategories(r.categoriesText);
    const calCall = categoryAt(cats, calibrated);
    calCalls[calCall] = (calCalls[calCall] ?? 0) + 1;
    if (calCall && r.actualCategory === calCall) calSum += 1;
    if (r.call === "even") {
      calEvenRows++;
      if (calCall && r.actualCategory === calCall) calSumEven += 1;
    } else {
      calResolvedRows++;
      if (calCall && r.actualCategory === calCall) calSumResolved += 1;
    }
    calResiduals.push(r.actual - calibrated);
    offSum += r.actual - r.projection;
    offCount++;
  }
  const calibratedMetric = calSum / n;

  const last = scored[scored.length - 1];
  const finalCats = parseCategories(last.categoriesText);
  const factorCensus = {};
  for (const r of scored) {
    if (r.factor) factorCensus[r.factor] = (factorCensus[r.factor] ?? 0) + 1;
  }
  const conditions = new Set(scored.filter((r) => r.factor).map((r) => r.factor + " :: " + r.factorCondition));

  scoredPlayers.push({
    athlete_id: p.athlete_id,
    player: p.player,
    position: p.position,
    games: p.rows.length,
    scoredRows: n,
    metric: round6(metric),
    reference: round6(reference),
    referenceAlt: round6(referenceAlt),
    difference: round6(metric - reference),
    differenceAlt: round6(metric - referenceAlt),
    callsEven,
    resolvedRows,
    resolvedMetric: resolvedRows ? round6(resolvedHits / resolvedRows) : null,
    resolvedReference: resolvedRows ? round6(resolvedRefHits / resolvedRows) : null,
    resolvedReferenceAlt: resolvedRows ? round6(resolvedRefAltHits / resolvedRows) : null,
    resolvedDifference: resolvedRows ? round6(resolvedHits / resolvedRows - resolvedRefHits / resolvedRows) : null,
    calibratedMetric: round6(calibratedMetric),
    calibratedMetricEven: calEvenRows ? round6(calSumEven / calEvenRows) : null,
    calibratedMetricResolved: calResolvedRows ? round6(calSumResolved / calResolvedRows) : null,
    calibratedDifference: round6(calibratedMetric - reference),
    residualOffset: round6(meanOf(residuals)),
    residualIQR: round6(quantileOf(calResiduals, 0.75) - quantileOf(calResiduals, 0.25)),
    residualWithin2: round6(calResiduals.filter((r) => Math.abs(r) <= 2).length / n),
    residualMAE: round6(meanOf(calResiduals.map((r) => Math.abs(r)))),
    rawResidualIQR: round6(quantileOf(residuals, 0.75) - quantileOf(residuals, 0.25)),
    rawResidualWithin2: round6(residuals.filter((r) => Math.abs(r) <= 2).length / n),
    rawResidualMAE: round6(meanOf(residuals.map((r) => Math.abs(r)))),
    categories: finalCats.map((c) => ({
      id: c.id, n: c.n, mean: round6(c.mean),
      lo: c.lo === -Infinity ? null : c.lo, hi: c.hi === Infinity ? null : c.hi,
    })),
    separated: finalCats.filter((c) => c.id.endsWith("-outlier")).map((c) => ({
      id: c.id, n: c.n, mean: round6(c.mean),
    })),
    shapeHigh: last.shapeHigh,
    shapeLow: last.shapeLow,
    factors: factorCensus,
    factorConditions: [...conditions],
    mismatchOnLargestCategory: mismatchedLargest,
  });
}
// Integrity: the parser has to reproduce the category columns in the CSV.
// If it cannot, the parser is wrong - the run stops rather than reporting
// numbers that came out of a broken read.
let parseMismatches = 0;
let actualCategoryMismatch = 0;
for (const p of players.values()) {
  for (const r of p.rows) {
    if (!r.call) continue;
    const cats = parseCategories(r.categoriesText);
    if (!cats.length) { parseMismatches++; continue; }
    if (largestCategory(cats, true) !== r.largestCategory) parseMismatches++;
    if (categoryAt(cats, r.actual) !== r.actualCategory) actualCategoryMismatch++;
  }
}
if (parseMismatches > 0) {
  throw new Error("The category parser disagrees with the largest-category column in the CSV on " +
    parseMismatches + " rows - the parser is wrong, not the data.");
}
const scoredRowTotal = scoredPlayers.reduce((n, p) => n + p.scoredRows, 0);
console.log("integrity: the parser reproduces the largest category on every scored row; " +
  "the actual lands in the parsed category on " +
  (scoredRowTotal - actualCategoryMismatch) + " of " + scoredRowTotal + " scored rows");
console.log("scoreable players: " + scoredPlayers.length +
  " | players with no projection yet: " + notYetScoreable.length);

// ---------------------------------------------------------------------------
// Significance - its own section, never next to a rate
// ---------------------------------------------------------------------------

function logGamma(z) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
const logChoose = (n, k) => logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
const binomialPmf = (k, n, p) => Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
function binomialCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  for (let i = 0; i <= k; i++) s += binomialPmf(i, n, p);
  return Math.min(1, s);
}

/** The one-sided binomial upper tail P(X >= k) for Binomial(n, p), in log10.
 *  Used where the tail is far too small to represent in double precision -
 *  reporting 0 would be false precision. */
function binomialUpperTailLog10(k, n, p) {
  if (k <= 0 || k > n) return 0;
  const logP = Math.log(p), logQ = Math.log(1 - p);
  let maxLog = -Infinity, sum = 0;
  for (let i = k; i <= n; i++) {
    const lp = logChoose(n, i) + i * logP + (n - i) * logQ;
    if (lp > maxLog) { if (maxLog !== -Infinity) sum *= Math.exp(maxLog - lp); maxLog = lp; }
    else sum += Math.exp(lp - maxLog);
  }
  return (maxLog + Math.log(sum)) / Math.LN10;
}
const erf = (x) => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
};
const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/** log10 of the standard normal upper tail Q(a). Used when the tail is too
 *  small for double precision: reporting p = 0 would be false precision. */
function normalUpperTailLog10(a) {
  if (!Number.isFinite(a)) return -Infinity;
  if (a === 0) return Math.log10(0.5);
  const a2 = a * a;
  let sum = 1, term = 1;
  for (let k = 1; k <= 6; k++) { term *= -(2 * k - 1) / a2; sum += term; }
  const logQ = -0.5 * a2 - 0.5 * Math.log(2 * Math.PI) - Math.log(a) + Math.log(sum);
  return logQ / Math.LN10;
}

/** The sign test: how many players the model beat, how many it lost to. */
function signTest(diffs) {
  const nz = diffs.filter((d) => d !== 0);
  const positives = nz.filter((d) => d > 0).length;
  const negatives = nz.filter((d) => d < 0).length;
  const n = positives + negatives;
  if (!n) return { players: diffs.length, ties: diffs.length, positives: 0, negatives: 0, p: 1 };
  const k = Math.min(positives, negatives);
  const p = Math.min(1, 2 * binomialCdf(k, n, 0.5));
  return { players: diffs.length, ties: diffs.length - n, positives, negatives, p };
}

/** The Wilcoxon signed-rank test on the same paired differences. */
function wilcoxonSignedRank(diffs) {
  const nz = diffs.filter((d) => d !== 0).map((d) => ({ d, abs: Math.abs(d) }));
  const n = nz.length;
  if (!n) return { players: diffs.length, n: 0, p: 1, method: "no non-zero differences" };
  const sorted = [...nz].sort((a, b) => a.abs - b.abs);
  const ranks = new Array(n);
  let i = 0;
  let tied = false;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].abs === sorted[i].abs) j++;
    if (j > i) tied = true;
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = avg;
    i = j + 1;
  }
  let wPlus = 0;
  for (let k = 0; k < n; k++) if (sorted[k].d > 0) wPlus += ranks[k];
  const totalRank = (n * (n + 1)) / 2;
  const wMinus = totalRank - wPlus;
  const wMin = Math.min(wPlus, wMinus);
  if (!tied && n <= 50) {
    // exact null distribution over the ranks 1..n
    const maxSum = totalRank;
    const counts = new Array(maxSum + 1).fill(0);
    counts[0] = 1;
    for (let r = 1; r <= n; r++) {
      for (let s = maxSum; s >= r; s--) counts[s] += counts[s - r];
    }
    let tail = 0;
    for (let s = 0; s <= wMin; s++) tail += counts[s];
    const p = Math.min(1, (2 * tail) / Math.pow(2, n));
    return { players: diffs.length, n, p, method: "exact" };
  }
  // normal approximation with the continuity and tie corrections
  let tieSum = 0;
  i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].abs === sorted[i].abs) j++;
    const t = j - i + 1;
    tieSum += t * t * t - t;
    i = j + 1;
  }
  const mu = totalRank / 2;
  const variance = (n * (n + 1) * (2 * n + 1) - tieSum) / 24;
  const sigma = Math.sqrt(variance);
  const z = (Math.abs(wPlus - mu) - 0.5) / sigma;
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  if (p > 0) return { players: diffs.length, n, p, z: Math.abs(z), method: "normal approximation with tie correction" };
  const pLog10 = normalUpperTailLog10(Math.abs(z)) + Math.log10(2);
  return { players: diffs.length, n, p: null, pLog10: Math.round(pLog10 * 100) / 100, z: Math.abs(z), method: "normal approximation with tie correction; the two-sided p-value is below the representable range, so it is reported as log10(p)" };
}

const diffs = scoredPlayers.map((p) => p.metric - p.reference);
const diffsAlt = scoredPlayers.map((p) => p.metric - p.referenceAlt);
const signTestResult = signTest(diffs);
const wilcoxonResult = wilcoxonSignedRank(diffs);
const signTestAlt = signTest(diffsAlt);
const wilcoxonAlt = wilcoxonSignedRank(diffsAlt);

// ---------------------------------------------------------------------------
// The aggregate: the whole population, with the n>=30 line as a robustness
// check - never as a filter.
// ---------------------------------------------------------------------------

const summarise = (set) => {
  const metrics = set.map((p) => p.metric);
  const refs = set.map((p) => p.reference);
  const d = set.map((p) => p.metric - p.reference);
  const above = d.filter((x) => x > 0).length;
  const below = d.filter((x) => x < 0).length;
  return {
    players: set.length,
    metricMean: round6(meanOf(metrics)),
    metricMedian: round6(medianOf(metrics)),
    metricP25: round6(quantileOf(metrics, 0.25)),
    metricP75: round6(quantileOf(metrics, 0.75)),
    referenceMean: round6(meanOf(refs)),
    referenceMedian: round6(medianOf(refs)),
    differenceMean: round6(meanOf(d)),
    differenceMedian: round6(medianOf(d)),
    playersAboveReference: above,
    playersAtReference: d.length - above - below,
    playersBelowReference: below,
    calibratedMean: round6(meanOf(set.map((p) => p.calibratedMetric))),
    calibratedEvenMean: round6(meanOf(set.map((p) => p.calibratedMetricEven).filter((v) => v !== null))),
    calibratedResolvedMean: round6(meanOf(set.map((p) => p.calibratedMetricResolved).filter((v) => v !== null))),
    resolvedMetricMean: round6(meanOf(set.map((p) => p.resolvedMetric).filter((v) => v !== null))),
    resolvedReferenceMean: round6(meanOf(set.map((p) => p.resolvedReference).filter((v) => v !== null))),
    resolvedDifferenceMean: round6(meanOf(set.map((p) => p.resolvedDifference).filter((v) => v !== null))),
    residualOffsetMean: round6(meanOf(set.map((p) => p.residualOffset))),
    residualIQRMean: round6(meanOf(set.map((p) => p.residualIQR))),
    residualWithin2Mean: round6(meanOf(set.map((p) => p.residualWithin2))),
    residualMAEMean: round6(meanOf(set.map((p) => p.residualMAE))),
    rawResidualIQRMean: round6(meanOf(set.map((p) => p.rawResidualIQR))),
    rawResidualWithin2Mean: round6(meanOf(set.map((p) => p.rawResidualWithin2))),
    rawResidualMAEMean: round6(meanOf(set.map((p) => p.rawResidualMAE))),
  };

};

const allScored = summarise(scoredPlayers);
const fullSample = summarise(scoredPlayers.filter((p) => p.scoredRows >= 30));

// ---------------------------------------------------------------------------
// The factor census and the sameness census
// ---------------------------------------------------------------------------

const scoredRows = [];
for (const p of players.values()) {
  for (const r of p.rows) if (r.call !== "") scoredRows.push(r);
}

const factorUsage = {};
const factorEvidence = { separated: [], notSeparated: [] };
for (const r of scoredRows) {
  if (!r.factor) continue;
  factorUsage[r.factor] = (factorUsage[r.factor] ?? 0) + 1;
  const separated = r.shapeHigh === "multimodal" || r.shapeLow === "multimodal";
  (separated ? factorEvidence.separated : factorEvidence.notSeparated).push(r.factorP);
}
const evidenceBlock = (ps) => {
  const vals = ps.filter((v) => v !== null && Number.isFinite(v));
  const below = vals.filter((v) => v < 0.05).length;
  const expected = vals.length * 0.05;
  // the measured null: under the null that a factor p-value is uniform, 5% of the
  // 5% of the rows fall below 0.05.
  const tailLog10 = vals.length ? binomialUpperTailLog10(below, vals.length, 0.05) : null;
  return {
    rows: vals.length,
    below05: below,
    shareBelow05: round6(vals.length ? below / vals.length : null),
    expectedBelow05IfUniform: round6(expected),
    excessRatio: round6(expected > 0 ? below / expected : null),
    upperTailLog10: tailLog10 === null ? null : Math.round(tailLog10 * 100) / 100,
    pMedian: round6(medianOf(vals)),
    pP25: round6(quantileOf(vals, 0.25)),
    pP75: round6(quantileOf(vals, 0.75)),
  };
};

const samenessCensus = {
  onePopulation: scoredRows.filter((r) => r.sameMeans).length,
  twoPopulations: scoredRows.filter((r) => !r.sameMeans).length,
  pMedian: round6(medianOf(scoredRows.map((r) => r.sameMeansP).filter((v) => v !== null))),
  pP25: round6(quantileOf(scoredRows.map((r) => r.sameMeansP).filter((v) => v !== null), 0.25)),
  pP75: round6(quantileOf(scoredRows.map((r) => r.sameMeansP).filter((v) => v !== null), 0.75)),
  shareBelow05: round6(
    scoredRows.filter((r) => r.sameMeansP !== null && r.sameMeansP < 0.05).length /
    Math.max(1, scoredRows.filter((r) => r.sameMeansP !== null).length)),
};

const outcomeCensus = {};
for (const r of scoredRows) outcomeCensus[r.outcomeClass] = (outcomeCensus[r.outcomeClass] ?? 0) + 1;
const callCensus = {};
for (const r of scoredRows) callCensus[r.call] = (callCensus[r.call] ?? 0) + 1;

// ---------------------------------------------------------------------------
// Chart data
// ---------------------------------------------------------------------------

const bimodalityOf = (xs) => {
  const m = meanOf(xs);
  let m2 = 0, m3 = 0, m4 = 0;
  for (const x of xs) { const d = x - m; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
  if (xs.length < 2 || m2 === 0) return 0;
  m2 /= xs.length; m3 /= xs.length; m4 /= xs.length;
  const skew = m3 / Math.pow(m2, 1.5);
  const kurtNom = m4 / (m2 * m2);
  return kurtNom === 0 ? 0 : (skew * skew + 1) / kurtNom;
};
const histogramOf = (scores) => {
  const min = Math.floor(Math.min(...scores));
  const max = Math.ceil(Math.max(...scores));
  const counts = new Array(Math.max(1, max - min + 1)).fill(0);
  for (const s of scores) {
    const b = Math.min(counts.length - 1, Math.max(0, Math.floor(s) - min));
    counts[b]++;
  }
  return { min, width: 1, counts };
};

const chartPlayerIds = new Set();
for (const p of [...scoredPlayers].sort((a, b) => b.scoredRows - a.scoredRows).slice(0, 18)) {
  chartPlayerIds.add(p.athlete_id);
}
let mostBimodal = null;
for (const p of scoredPlayers) {
  const scores = players.get(p.athlete_id).rows.map((r) => r.actual);
  const b = bimodalityOf(scores);
  if (!mostBimodal || b > mostBimodal.b) mostBimodal = { id: p.athlete_id, b };
}
if (mostBimodal) chartPlayerIds.add(mostBimodal.id);

const chartPlayers = [];
for (const id of chartPlayerIds) {
  const p = scoredPlayers.find((x) => x.athlete_id === id);
  if (!p) continue;
  const scores = players.get(id).rows.map((r) => r.actual);
  chartPlayers.push({
    athlete_id: id, player: p.player, position: p.position,
    games: p.games, scoredRows: p.scoredRows,
    metric: p.metric, reference: p.reference, difference: p.difference,
    calibratedMetric: p.calibratedMetric,
    histogram: histogramOf(scores),
    categories: p.categories,
    separated: p.separated,
    shapeHigh: p.shapeHigh,
    shapeLow: p.shapeLow,
    factors: p.factors,
  });
}
chartPlayers.sort((a, b) => b.scoredRows - a.scoredRows);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const resolvedDiffs = scoredPlayers
  .map((p) => p.resolvedDifference)
  .filter((v) => v !== null);
const resolvedBlock = {
  note: "The same measure restricted to the rows where the model named a category. The even call is a coin flip by definition, so it contributes no category truth; it is left out of this line, and the reference is measured on the very same rows. A robustness check, not a filter - the whole population above is the headline.",
  players: resolvedDiffs.length,
  metricMean: round6(meanOf(scoredPlayers.map((p) => p.resolvedMetric).filter((v) => v !== null))),
  referenceMean: round6(meanOf(scoredPlayers.map((p) => p.resolvedReference).filter((v) => v !== null))),
  differenceMean: round6(meanOf(resolvedDiffs)),
  signTest: signTest(resolvedDiffs),
  wilcoxonSignedRank: wilcoxonSignedRank(resolvedDiffs),
};

const result = {
  generatedAt: new Date().toISOString(),
  inputs: {
    csv: "frontend/react/.tmp-audit/projection-evaluation.csv",
    rowsRead,
    players: players.size,
    scoredRows: scoredRows.length,
  },
  method: {
    metric: "Dave's one metric, per player: the proportion of that player's evaluated days on which the actual landed in the category the model called. A call of even scores one half, because the even split is a coin flip by definition.",
    reference: "The player's own no-skill reference: the rate a predictor with no information about the outcome scores - always name the player's biggest category, on every day. It is derived from the row's own categories; it is never a flat 50%.",
    referenceTieBreak: "Ties for the biggest category go to the higher-scoring category. The lower-scoring tie-break is reported as a robustness line, so the reference cannot be accused of a favourable tie-break.",
    round2: "Round 2 applies the offset - the mean of actual minus projection over the games already seen, walk-forward, no lookahead - to the next game's projection. The calibrated projection falls in a category; the same metric is measured again. The precision is the residual spread around that offset.",
    significance: "The sign test and the Wilcoxon signed-rank test on the per-player differences, in their own section. No p-value is printed next to a rate.",
    sameness: "Sameness is the only accept/reject in the model: are the two halves one population or two. Everything else is a category, a factor or a mean.",
  },
  population: {
    scoreablePlayers: scoredPlayers.length,
    playersWithNoProjectionYet: notYetScoreable.length,
    playersWithNoProjectionYetList: notYetScoreable.slice(0, 50),
    note: "A player is scoreable once the model has four completed games to form two populations. Players with fewer are reported as a fact, never dropped from the record.",
  },
  aggregate: allScored,
  robustness: {
    fullSample30: fullSample,
    resolvedCallsOnly: resolvedBlock,
    note: "The whole population is the headline. This line is the same measure restricted to players with at least 30 evaluated days - a robustness check, not a filter.",
  },
  significance: {
    signTest: signTestResult,
    wilcoxonSignedRank: wilcoxonResult,
    tieBreakRobustness: {
      note: "The same two tests against the reference computed with the other tie-break.",
      signTest: signTestAlt,
      wilcoxonSignedRank: wilcoxonAlt,
    },
  },
  factors: {
    usage: factorUsage,
    evidenceWhenAPopulationWasSeparated: evidenceBlock(factorEvidence.separated),
    evidenceWhenNothingWasSeparated: evidenceBlock(factorEvidence.notSeparated),
    note: "A factor is a categorization, not a verdict. Nothing is accepted or rejected. The engine selects the candidate that covers the separated population, so the p-values below are selection-biased and are NOT a test that a factor is valid. The census reports which factor threads which population; the p-value distribution is the evidence for that selection.",
  },
  integrity: {
    parserDisagreementsWithLargestCategory: parseMismatches,
    actualCategoryReproductionMismatch: actualCategoryMismatch,
    note: "The parser is checked against the largest-category column in the CSV on every scored row; a disagreement stops the run. The second count is the rows where the printed, rounded category ranges put the actual in a different category than the full-precision ranges did.",
  },
  sameness: samenessCensus,
  outcomes: outcomeCensus,
  calls: callCensus,
  chartPlayers,
  chartPoints: scoredPlayers.map((p) => [
    p.reference, p.metric, p.calibratedMetric, p.scoredRows,
  ]),
  players: scoredPlayers,
};

fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log("wrote " + OUT);
console.log("aggregate (whole population): metric mean " + allScored.metricMean +
  " | reference mean " + allScored.referenceMean +
  " | difference mean " + allScored.differenceMean);
console.log("n>=30 robustness line: players " + fullSample.players +
  " | difference mean " + fullSample.differenceMean);
console.log("sign test p " + signTestResult.p + " | wilcoxon p " + wilcoxonResult.p +
  " (" + wilcoxonResult.method + ")");
console.log("players above their own no-skill reference: " + allScored.playersAboveReference +
  " | at " + allScored.playersAtReference + " | below " + allScored.playersBelowReference);
console.log("factor usage: " + JSON.stringify(factorUsage));
console.log("sameness: one population " + samenessCensus.onePopulation +
  " | two populations " + samenessCensus.twoPopulations);
