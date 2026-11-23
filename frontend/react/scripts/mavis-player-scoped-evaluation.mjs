/**
 * mavis-player-scoped-evaluation.mjs
 *
 * Per-player evaluation of Dave's projection model, following the method as
 * written in "docs/DFS Projection Model.md" and as restated in the owner's
 * 2026-11-23 correction.
 *
 * THE SCOPE (the objective defines the population):
 *   One population per player. A player's own completed games are his
 *   population. Nothing is pooled across players, positions, teams or eras;
 *   every statistic below is computed inside one player's games. Across
 *   players, only per-player PROPORTIONS are aggregated - never pooled games.
 *
 * THE VARIABLE:
 *   The player's own DraftKings fantasy-point distribution.
 *
 * THE THRESHOLDS, by his own decision rule:
 *   1. Median and mode. If they are statistically similar, the curve is
 *      normal: one population, no threshold.
 *   2. If they differ, look at kurtosis. His own reference points are 3
 *      (normal) and low (bimodal). Below the cut the curve is platykurtic -
 *      two humps - so the distribution is split and the thresholds are the
 *      valleys between the humps. At or above the cut it is a lognormal or
 *      heavy tail, resolvable with a constant, and stays one population.
 *   3. A hump must be a hump: at least three games around a peak, separated
 *      from the next hump by a valley. Not one or two spikes.
 *   4. Each cluster is then described on its own. Skew is fine (lognormal,
 *      resolvable with a constant). A cluster that is still bimodal means a
 *      wrong factor - that threshold is not yet a usable category, and the
 *      player is not in the metric population.
 *
 * THE ONE METRIC:
 *   The proportion of days on which the projection landed in the same
 *   cluster as the actual. The reference is the player's OWN no-skill rate
 *   (the majority cluster share), never a flat 50%.
 *
 * PRECISION / CALIBRATION:
 *   The model's residual offset per player is re-estimated from the games
 *   already seen and applied to the next game, then the same metric is
 *   measured again. The spread of the residual around that offset is the
 *   precision of the model.
 *
 * THE FACTORS:
 *   What changed in the games that stand apart from the player's own average,
 *   and what the thresholds have in common. Reported as p-values. A factor's
 *   own subset is then tested for normality: skew is fine, bimodal means the
 *   factor is wrong.
 *
 * Inputs:  frontend/react/.tmp-audit/projection-evaluation.csv
 * Outputs: frontend/react/.tmp-audit/player-scoped-evaluation.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const CSV = path.join(REPO, "frontend", "react", ".tmp-audit", "projection-evaluation.csv");
const OUT = path.join(REPO, "frontend", "react", ".tmp-audit", "player-scoped-evaluation.json");

const MIN_GAMES = 30;
const FACTOR_P = 0.05;
const MIN_OFFSET_HISTORY = 3;
const MIN_PRIOR_FOR_WF = 12;
const SPIKE_GAP = 3;
/** "Median and mode are statistically similar": within half a robust sigma. */
const MODE_MATCH_SIGMA = 0.5;
/** His own number: a normal curve has kurtosis 3. Below it, the curve is flat. */
const KURT_CUT = 3;
/**
 * The two numbers above are mavis's operationalization of "median and mode are
 * statistically similar" and "low kurtosis means bimodal". They are the only
 * free constants in the gate, so the population is swept across them and the
 * sensitivity is reported rather than hidden.
 */
const SWEEP_SIGMA_BANDS = [0.25, 0.5, 0.75, 1.0];
const SWEEP_KURT_CUTS = [1.5, 2.0, 2.5, 3.0, 3.5];

// ---------------------------------------------------------------- csv -----

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

// ----------------------------------------------------------- statistics ---

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN);

function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function sampleSd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

function skew(xs) {
  if (xs.length < 3) return 0;
  const m = mean(xs);
  let m2 = 0, m3 = 0;
  for (const x of xs) { const d = x - m; m2 += d * d; m3 += d * d * d; }
  m2 /= xs.length; m3 /= xs.length;
  return m2 === 0 ? 0 : m3 / Math.pow(m2, 1.5);
}

function kurtosis(xs) {
  if (xs.length < 4) return NaN;
  const m = mean(xs);
  let m2 = 0, m4 = 0;
  for (const x of xs) { const d = x - m; m2 += d * d; m4 += d * d * d * d; }
  m2 /= xs.length; m4 /= xs.length;
  return m2 === 0 ? NaN : m4 / (m2 * m2);
}

function erf(x) {
  const sign = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}
const pFromZ = (z) => Math.max(0, Math.min(1, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)))));

function jarqueBera(xs) {
  const n = xs.length;
  if (n < 8) return { jb: NaN, p: NaN };
  const s = skew(xs), k = kurtosis(xs);
  const jb = (n / 6) * (s * s + ((k - 3) ** 2) / 4);
  return { jb, p: Math.exp(-jb / 2) };
}

/**
 * Dave's verdict on a subset: skew is fine (a lognormal, resolvable with a
 * constant), a low kurtosis means bimodal, which means a wrong factor.
 */
function normalityVerdict(xs) {
  const s = skew(xs), k = kurtosis(xs);
  const { p } = jarqueBera(xs);
  let verdict;
  if (xs.length < 8) verdict = "too few games to test";
  else if (Math.abs(s) > 1 && k > 4) verdict = "skewed (lognormal) - fine, resolvable with a constant";
  else if (k < 2) verdict = "bimodal - wrong factor";
  else if (Math.abs(s) <= 1 && k >= 2 && k <= 4.5) verdict = "normal - factor holds";
  else verdict = k > 4.5 ? "heavy tail - check for a second population" : "flat - check for a second population";
  return { skew: r4(s), kurtosis: r4(k), jbP: r4(p), verdict, n: xs.length };
}

const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

// ------------------------------------------------------ threshold finding ---

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
  let modeBin = 0;
  for (let i = 1; i < nb; i++) if (smooth[i] > smooth[modeBin]) modeBin = i;
  return {
    min: r3(min), max: r3(max), width,
    mode: r3(min + (modeBin + 0.5) * width),
    counts,
    peaks: peaks.map((p) => r3(min + (p + 0.5) * width)),
    thresholds: thresholds.map((t) => t.at),
    thresholdDetail: thresholds,
  };
}

function classOf(v, thresholds) {
  let c = 0;
  for (const t of thresholds) if (v >= t) c++;
  return c;
}

function describeClusters(scores, thresholds) {
  const buckets = [];
  for (let c = 0; c <= thresholds.length; c++) {
    const lo = c === 0 ? -Infinity : thresholds[c - 1];
    const hi = c === thresholds.length ? Infinity : thresholds[c];
    buckets.push(scores.filter((s) => (c === 0 ? s < hi : s >= lo && s < hi)));
  }
  return buckets.map((xs, i) => ({
    cluster: i,
    lo: i === 0 ? null : r3(thresholds[i - 1]),
    hi: i === thresholds.length ? null : r3(thresholds[i]),
    n: xs.length,
    mean: r3(mean(xs)),
    median: r3(median(xs)),
    sd: r3(sampleSd(xs)),
    ...normalityVerdict(xs),
    scores: xs,
  }));
}

function isolatedSpikes(scores) {
  const s = [...scores].sort((a, b) => b - a);
  const out = [];
  for (let i = 0; i < s.length - 1; i++) if (s[i] - s[i + 1] >= SPIKE_GAP) out.push(s[i]);
  return out;
}

const monthOf = (d) => Number(d.slice(5, 7));
const decadeOf = (s) => Math.floor(Number(s) / 10) * 10;

function kindKey(r) {
  const out = [];
  if (r.opponent) out.push(["opponent", r.opponent]);
  if (r.team) out.push(["team", r.team]);
  out.push(["month", String(monthOf(r.date))]);
  out.push(["decade", String(decadeOf(r.season))]);
  return out;
}

function twoProportion(aHit, aN, bHit, bN) {
  if (!aN || !bN) return { z: NaN, p: NaN };
  const p1 = aHit / aN, p2 = bHit / bN, pooled = (aHit + bHit) / (aN + bN);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / aN + 1 / bN));
  if (se === 0) return { z: 0, p: 1 };
  const z = (p1 - p2) / se;
  return { z, p: pFromZ(z) };
}

const robustSigmaOf = (xs, med) => 1.4826 * (median(xs.map((s) => Math.abs(s - med))) || 1e-9);

/**
 * His decision rule, in his order. Returns the thresholds that are actually
 * usable as categories: none when the curve is one population.
 */
function decide(hist, med, mode, robustSigma, kurt, band, cut) {
  const gap = Math.abs(med - mode);
  if (!hist.thresholds.length) {
    return { decision: "one population - no second hump", thresholds: [], reason: "no second hump" };
  }
  if (gap <= band * robustSigma) {
    return { decision: "one population - median and mode match (normal)", thresholds: [], reason: "median and mode match" };
  }
  if (kurt >= cut) {
    return { decision: "one population - kurtosis " + r2(kurt) + " (lognormal or heavy tail, resolved with a constant)", thresholds: [], reason: "kurtosis " + r2(kurt) };
  }
  return { decision: "split - " + hist.thresholds.length + " threshold(s), kurtosis " + r2(kurt) + " (platykurtic)", thresholds: hist.thresholds, reason: "kurtosis " + r2(kurt) };
}

/**
 * Step 7 and step 9: each threshold must be a hump behaving normally in
 * isolation. The SAME rule is applied inside each cluster: a cluster that
 * still splits is bimodal, which means the factor is wrong.
 */
function validateClusters(scores, thresholds, band, cut) {
  const cl = describeClusters(scores, thresholds);
  const details = cl.map((c) => {
    const out = {
      n: c.n, lo: c.lo, hi: c.hi, mean: c.mean, median: c.median, sd: c.sd,
      skew: c.skew, kurtosis: c.kurtosis, jbP: c.jbP,
    };
    if (c.n < 8) {
      out.tested = false;
      out.subDecision = "too few games to test";
      out.subSplit = false;
      out.verdict = "too few games to test";
      return out;
    }
    const h = findThresholds(c.scores);
    const d = decide(h, c.median, h.mode, robustSigmaOf(c.scores, c.median), c.kurtosis, band, cut);
    out.tested = true;
    out.subDecision = d.decision;
    out.subSplit = d.thresholds.length > 0;
    out.verdict = out.subSplit
      ? "bimodal - wrong factor"
      : (c.verdict.startsWith("skewed") ? "skewed - fine, resolvable with a constant" : "normal - factor holds");
    return out;
  });
  const tested = details.filter((d) => d.tested);
  return {
    details,
    valid: thresholds.length > 0 && tested.every((d) => !d.subSplit),
    underPowered: details.some((d) => !d.tested),
  };
}

// ---------------------------------------------------------------- main -----

const raw = parseCsv(fs.readFileSync(CSV, "utf8"));
const header = raw[0];
const recs = raw.slice(1).filter((r) => r.length === header.length)
  .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));

const byPlayer = new Map();
for (const r of recs) {
  const key = r.athlete_id || r.player;
  if (!byPlayer.has(key)) byPlayer.set(key, []);
  byPlayer.get(key).push(r);
}

const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const players = [];

/**
 * The one metric, measured against one player's own categories.
 */
function evaluateVariant(games, evals, thresholds, band, cut) {
  const scores = games.map((g) => g.score);
  const clusters = describeClusters(scores, thresholds);
  const nClusters = clusters.length;
  const shares = clusters.map((c) => c.n / scores.length);
  const majorityShare = Math.max(...shares);
  const chanceRate = shares.reduce((a, b) => a + b * b, 0);
  const spikes = isolatedSpikes(scores);
  const spikeSet = new Set(spikes);

  let modelHits = 0, baseHits = 0, calHits = 0, calUsed = 0;
  let wfHits = 0, wfUsed = 0;
  const aim = { p1: 0, p1Top: 0, p0: 0, p0Bottom: 0, floor: 0 };
  let oldBoomRows = 0, oldBoomInTopCluster = 0, oldBoomSpikes = 0;
  const priorResiduals = [];

  for (const r of evals) {
    const actual = num(r.actual_dk_points);
    const proj = num(r.model_projection);
    const base = num(r.baseline_projection);
    const ac = classOf(actual, thresholds);
    const mc = classOf(proj, thresholds);
    if (mc === ac) modelHits++;
    if (base !== null && classOf(base, thresholds) === ac) baseHits++;
    const residual = actual - proj;
    if (priorResiduals.length >= MIN_OFFSET_HISTORY) {
      const off = median(priorResiduals);
      if (classOf(proj + off, thresholds) === ac) calHits++;
      calUsed++;
    }
    priorResiduals.push(residual);
    const priorN = num(r.earlier_n) ?? 0;
    if (priorN >= MIN_PRIOR_FOR_WF) {
      const priorScores = games.slice(0, priorN).map((g) => g.score);
      const ph = findThresholds(priorScores);
      const pm = median(priorScores);
      const pd = decide(ph, pm, ph.mode, robustSigmaOf(priorScores, pm), kurtosis(priorScores), band, cut);
      if (pd.thresholds.length >= 1) {
        wfUsed++;
        if (classOf(proj, pd.thresholds) === classOf(actual, pd.thresholds)) wfHits++;
      }
    }
    const P = num(r.model_P);
    if (P === 1) { aim.p1++; if (mc === nClusters - 1) aim.p1Top++; }
    else if (P === 0) { aim.p0++; if (mc === 0) aim.p0Bottom++; }
    else aim.floor++;
    const peeledHigh = num(r.peeled_high);
    if (peeledHigh !== null && r.outcome_class === "boom (outlier high)") {
      oldBoomRows++;
      if (ac === nClusters - 1) oldBoomInTopCluster++;
      if (spikeSet.has(actual)) oldBoomSpikes++;
    }
  }

  const residualOffset = median(priorResiduals);
  const residualIQR = quantile(priorResiduals, 0.75) - quantile(priorResiduals, 0.25);
  const within2 = priorResiduals.filter((x) => Math.abs(x - residualOffset) <= 2).length / priorResiduals.length;

  return {
    thresholds,
    clusters: clusters.map((c) => ({
      cluster: c.cluster, lo: c.lo, hi: c.hi, n: c.n, mean: c.mean, median: c.median,
      sd: c.sd, skew: c.skew, kurtosis: c.kurtosis, jbP: c.jbP, verdict: c.verdict,
    })),
    reference: { majorityShare: r3(majorityShare), chanceRate: r3(chanceRate) },
    metric: {
      modelHits, baseHits, n: evals.length,
      modelHitRate: evals.length ? r3(modelHits / evals.length) : null,
      baseHitRate: evals.length ? r3(baseHits / evals.length) : null,
      liftOverReference: evals.length ? r3(modelHits / evals.length - majorityShare) : null,
      baseLiftOverReference: evals.length ? r3(baseHits / evals.length - majorityShare) : null,
      modelBeatsReference: evals.length ? (modelHits / evals.length > majorityShare) : null,
      baseBeatsReference: evals.length ? (baseHits / evals.length > majorityShare) : null,
      calibratedBeatsReference: calUsed ? (calHits / calUsed > majorityShare) : null,
      calibratedHits: calHits, calibratedN: calUsed,
      calibratedHitRate: calUsed ? r3(calHits / calUsed) : null,
      walkForwardHits: wfHits, walkForwardN: wfUsed,
      walkForwardHitRate: wfUsed ? r3(wfHits / wfUsed) : null,
    },
    precision: {
      residualOffset: r3(residualOffset),
      residualIQR: r3(residualIQR),
      residualSd: r3(sampleSd(priorResiduals)),
      shareWithin2PointsOfOffset: r3(within2),
    },
    aim: {
      p1: aim.p1, p1TopCluster: aim.p1Top,
      p0: aim.p0, p0BottomCluster: aim.p0Bottom,
      floor: aim.floor,
      p1TopShare: aim.p1 ? r3(aim.p1Top / aim.p1) : null,
      p0BottomShare: aim.p0 ? r3(aim.p0Bottom / aim.p0) : null,
    },
    oldBoom: { rows: oldBoomRows, inTopCluster: oldBoomInTopCluster, isolatedSpikes: oldBoomSpikes },
  };
}

for (const [key, rowsAll] of byPlayer) {
  rowsAll.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const games = rowsAll.map((r) => ({ row: r, score: num(r.actual_dk_points) })).filter((g) => g.score !== null);
  if (games.length < MIN_GAMES) continue;

  const scores = games.map((g) => g.score);
  const player = rowsAll[0].player;
  const position = rowsAll[0].position;
  const team = rowsAll[0].team;

  const hist = findThresholds(scores);
  const med = median(scores);
  const q1 = quantile(scores, 0.25), q3 = quantile(scores, 0.75);
  const iqr = q3 - q1;
  const robustSigma = robustSigmaOf(scores, med);
  const distSkew = skew(scores);
  const distKurt = kurtosis(scores);
  const modeGap = Math.abs(med - hist.mode);

  const evals = rowsAll.filter((r) => num(r.model_projection) !== null && num(r.earlier_n) >= 4);

  // ---- the gate, in his order, with his own kurtosis reference ----
  const primary = decide(hist, med, hist.mode, robustSigma, distKurt, MODE_MATCH_SIGMA, KURT_CUT);
  const primaryClusters = validateClusters(scores, primary.thresholds, MODE_MATCH_SIGMA, KURT_CUT);
  const primaryVariant = evaluateVariant(games, evals, primary.thresholds, MODE_MATCH_SIGMA, KURT_CUT);

  // ---- the looser split: the humps alone, gate ignored. Robustness line ----
  const looseThresholds = hist.thresholds;
  const looseClusters = validateClusters(scores, looseThresholds, MODE_MATCH_SIGMA, KURT_CUT);
  const looseVariant = evaluateVariant(games, evals, looseThresholds, MODE_MATCH_SIGMA, KURT_CUT);

  // ---- gate sensitivity: move the two free constants ----
  const gateSweep = [];
  for (const band of SWEEP_SIGMA_BANDS) {
    for (const cut of SWEEP_KURT_CUTS) {
      const d = decide(hist, med, hist.mode, robustSigma, distKurt, band, cut);
      const v = d.thresholds.length ? validateClusters(scores, d.thresholds, band, cut) : { valid: false, underPowered: false };
      gateSweep.push({
        modeMatchSigma: band,
        platykurticCut: cut,
        decision: d.decision.split(" - ")[0],
        thresholds: d.thresholds.length,
        clustersValid: v.valid,
        underPowered: v.underPowered,
      });
    }
  }

  // factors: what changed in the games that stand apart
  const standoutIdx = new Set();
  games.forEach((g, i) => { if (Math.abs(g.score - med) > 1.96 * robustSigma) standoutIdx.add(i); });
  const standout = [...standoutIdx].map((i) => games[i].score);

  const candidates = new Map();
  games.forEach((g, i) => {
    for (const [kind, value] of kindKey(g.row)) {
      const k = kind + "=" + value;
      if (!candidates.has(k)) candidates.set(k, { kind, value, ids: new Set() });
      candidates.get(k).ids.add(i);
    }
  });
  const topIds = new Set(games.map((g, i) => i).filter((i) => classOf(games[i].score, looseThresholds) === looseVariant.clusters.length - 1));
  const factorRows = [];
  for (const c of candidates.values()) {
    const nWith = c.ids.size, nWithout = games.length - nWith;
    if (nWith < 3 || nWithout < 3) continue;
    const withStandout = [...c.ids].filter((i) => standoutIdx.has(i)).length;
    const withoutStandout = standout.length - withStandout;
    const test = twoProportion(withStandout, nWith, withoutStandout, nWithout);
    if (!Number.isFinite(test.p)) continue;
    const subset = [...c.ids].map((i) => games[i].score);
    const norm = normalityVerdict(subset);
    let topTest = null;
    if (looseVariant.clusters.length > 1) {
      const withTop = [...c.ids].filter((i) => topIds.has(i)).length;
      const withoutTop = topIds.size - withTop;
      if (withTop >= 3 && withoutTop >= 3) topTest = twoProportion(withTop, nWith, withoutTop, nWithout);
    }
    factorRows.push({
      cause: c.kind + "=" + c.value,
      kind: c.kind,
      value: c.value,
      nWith,
      nWithout,
      standoutWith: withStandout,
      standoutWithout: withoutStandout,
      standoutShareWith: r3(withStandout / nWith),
      standoutShareWithout: r3(withoutStandout / nWithout),
      z: r3(test.z),
      p: r4(test.p),
      topClusterP: topTest ? r4(topTest.p) : null,
      subsetNormality: norm,
    });
  }
  factorRows.sort((a, b) => a.p - b.p);
  const factorsClearing = factorRows.filter((f) => f.p < FACTOR_P);
  const factorsHolding = factorsClearing.filter((f) => f.subsetNormality.verdict.startsWith("normal") || f.subsetNormality.verdict.startsWith("skewed"));

  players.push({
    key,
    player,
    position,
    team,
    games: games.length,
    evaluations: evals.length,
    firstDate: games[0].row.date.slice(0, 10),
    lastDate: games[games.length - 1].row.date.slice(0, 10),
    distribution: {
      mean: r3(mean(scores)),
      median: r3(med),
      sd: r3(sampleSd(scores)),
      skew: r4(distSkew),
      kurtosis: r4(distKurt),
      mode: hist.mode,
      medianMinusMode: r3(modeGap),
      robustSigma: r3(robustSigma),
      iqr: r3(iqr),
      min: hist.min,
      max: hist.max,
      peaks: hist.peaks,
      splitDecision: primary.decision,
      splitReason: primary.reason,
      thresholds: primary.thresholds,
      looseThresholds,
      thresholdDetail: hist.thresholdDetail,
      counts: hist.counts,
      histogramMin: hist.min,
      histogramWidth: hist.width,
      isolatedSpikes: isolatedSpikes(scores).length,
    },
    // top-level fields are the LOOSE (hump-only) variant: the population that
    // exists on this data, used for the robustness line and the charts.
    clusters: looseVariant.clusters,
    clusterValid: looseClusters.valid,
    reference: looseVariant.reference,
    metric: looseVariant.metric,
    precision: looseVariant.precision,
    aim: looseVariant.aim,
    oldBoom: looseVariant.oldBoom,
    primary: {
      decision: primary.decision,
      reason: primary.reason,
      thresholds: primary.thresholds,
      clusters: primaryClusters.details,
      clusterValid: primaryClusters.valid,
      underPowered: primaryClusters.underPowered,
      reference: primaryVariant.reference,
      metric: primaryVariant.metric,
      precision: primaryVariant.precision,
      aim: primaryVariant.aim,
      oldBoom: primaryVariant.oldBoom,
    },
    gateSweep,
    factors: {
      standoutGames: standout.length,
      standoutThreshold: r3(1.96 * robustSigma),
      tested: factorRows.length,
      clearingP: factorsClearing.length,
      holdingAfterNormality: factorsHolding.length,
      best: factorRows[0] ? {
        cause: factorRows[0].cause, p: factorRows[0].p, z: factorRows[0].z,
        standoutShareWith: factorRows[0].standoutShareWith,
        standoutShareWithout: factorRows[0].standoutShareWithout,
        subsetNormality: factorRows[0].subsetNormality,
      } : null,
      rows: factorRows.slice(0, 6),
    },
  });
}

players.sort((a, b) => b.games - a.games);

// ------------------------------------------------------------ aggregate ----

const stat = (arr) => {
  const xs = arr.filter((x) => x !== null && Number.isFinite(x));
  return { n: xs.length, median: r3(median(xs)), q1: r3(quantile(xs, 0.25)), q3: r3(quantile(xs, 0.75)), mean: r3(mean(xs)) };
};
const decisions = {};
for (const p of players) {
  const key = p.primary.decision.split(" - ")[0];
  decisions[key] = (decisions[key] || 0) + 1;
}

const primarySplit = players.filter((p) => p.primary.thresholds.length >= 1);
const primaryValid = primarySplit.filter((p) => p.primary.clusterValid);
const looseSplit = players.filter((p) => p.distribution.looseThresholds.length >= 1);
const looseValid = looseSplit.filter((p) => p.clusterValid);

const metricBlock = (pop, variant) => ({
  players: pop.length,
  model: stat(pop.map((p) => variant(p).metric.modelHitRate)),
  baseline: stat(pop.map((p) => variant(p).metric.baseHitRate)),
  calibrated: stat(pop.map((p) => variant(p).metric.calibratedHitRate)),
  walkForwardThresholds: stat(pop.map((p) => variant(p).metric.walkForwardHitRate)),
  playerReference: stat(pop.map((p) => variant(p).reference.majorityShare)),
  modelBeatingOwnReference: pop.filter((p) => variant(p).metric.modelBeatsReference === true).length,
  baselineBeatingOwnReference: pop.filter((p) => variant(p).metric.baseBeatsReference === true).length,
  calibratedBeatingOwnReference: pop.filter((p) => variant(p).metric.calibratedBeatsReference === true).length,
});

const precisionBlock = (pop, variant) => ({
  residualOffset: stat(pop.map((p) => variant(p).precision.residualOffset)),
  residualIQR: stat(pop.map((p) => variant(p).precision.residualIQR)),
  shareWithin2Points: stat(pop.map((p) => variant(p).precision.shareWithin2PointsOfOffset)),
});

const aimBlock = (pop, variant) => {
  const p1 = pop.reduce((a, p) => a + variant(p).aim.p1, 0);
  const p1Top = pop.reduce((a, p) => a + variant(p).aim.p1TopCluster, 0);
  const p0 = pop.reduce((a, p) => a + variant(p).aim.p0, 0);
  const p0Bottom = pop.reduce((a, p) => a + variant(p).aim.p0BottomCluster, 0);
  return {
    p1Projections: p1, p1LandingInTopCluster: p1Top, p1TopShare: r3(p1Top / Math.max(1, p1)),
    p0Projections: p0, p0LandingInBottomCluster: p0Bottom, p0BottomShare: r3(p0Bottom / Math.max(1, p0)),
  };
};

const sweepRows = [];
for (const band of SWEEP_SIGMA_BANDS) {
  for (const cut of SWEEP_KURT_CUTS) {
    const g = players.map((p) => p.gateSweep.find((x) => x.modeMatchSigma === band && x.platykurticCut === cut)).filter(Boolean);
    sweepRows.push({
      modeMatchSigma: band,
      platykurticCut: cut,
      splitPlayers: g.filter((x) => x.decision === "split").length,
      clustersValidPlayers: g.filter((x) => x.clustersValid).length,
      underPoweredPlayers: g.filter((x) => x.underPowered).length,
    });
  }
}

const agg = {
  population: {
    rule: "players with at least " + MIN_GAMES + " games of record in the dataset",
    players: players.length,
    games: players.reduce((a, p) => a + p.games, 0),
    evaluations: players.reduce((a, p) => a + p.evaluations, 0),
  },
  gate: {
    rule: "median and mode within " + MODE_MATCH_SIGMA + " robust sigma, then kurtosis against " + KURT_CUT + " (his own normal reference)",
    parameters: { modeMatchSigma: MODE_MATCH_SIGMA, platykurticCut: KURT_CUT },
    decisions,
    splitPlayers: primarySplit.length,
    clustersValidPlayers: primaryValid.length,
    underPoweredPlayers: primarySplit.filter((p) => p.primary.underPowered).length,
    invalidReason: primarySplit.filter((p) => !p.primary.clusterValid).map((p) => ({
      player: p.player,
      clusters: p.primary.clusters.map((c) => ({ n: c.n, lo: c.lo, hi: c.hi, verdict: c.verdict })),
    })),
  },
  metricPopulation: {
    rule: "players whose own distribution is split into clusters and whose every cluster passes the normality test (skew fine, bimodal means wrong factor)",
    players: primaryValid.length,
    games: primaryValid.reduce((a, p) => a + p.games, 0),
    evaluations: primaryValid.reduce((a, p) => a + p.evaluations, 0),
  },
  metric: metricBlock(primaryValid, (p) => p.primary),
  looserSplit: {
    rule: "split on the humps alone, ignoring the median/mode and kurtosis gate - robustness line only",
    players: looseSplit.length,
    clustersValidPlayers: looseValid.length,
    metric: metricBlock(looseSplit, (p) => p),
    metricClustersValidOnly: metricBlock(looseValid, (p) => p),
    precision: precisionBlock(looseSplit, (p) => p),
    aim: aimBlock(looseSplit, (p) => p),
  },
  precision: precisionBlock(primaryValid, (p) => p.primary),
  aim: aimBlock(primaryValid, (p) => p.primary),
  gateSweep: sweepRows,
  factors: {
    playersWithClearingFactor: players.filter((p) => p.factors.clearingP > 0).length,
    playersWithHoldingFactor: players.filter((p) => p.factors.holdingAfterNormality > 0).length,
    medianStandoutGames: r3(median(players.map((p) => p.factors.standoutGames))),
    causeKinds: (() => {
      const m = new Map();
      for (const p of players) for (const f of p.factors.rows) if (f.p < FACTOR_P) m.set(f.kind, (m.get(f.kind) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ kind: k, causes: v }));
    })(),
  },
  oldBoomAudit: {
    rows: players.reduce((a, p) => a + p.oldBoom.rows, 0),
    oldBoomInTopCluster: players.reduce((a, p) => a + p.oldBoom.inTopCluster, 0),
    oldBoomThatAreIsolatedSpikes: players.reduce((a, p) => a + p.oldBoom.isolatedSpikes, 0),
  },
};

const payload = {
  generated: "2026-11-23",
  method: "per-player, Dave's DFS Projection Model method (docs/DFS Projection Model.md) and the 2026-11-23 correction",
  minGames: MIN_GAMES,
  factorP: FACTOR_P,
  aggregate: agg,
  players,
};
fs.writeFileSync(OUT, JSON.stringify(payload, null, 1));
console.log("players", players.length, "games", agg.population.games, "evaluations", agg.population.evaluations);
console.log("gate decisions", JSON.stringify(agg.gate.decisions));
console.log("primary split players", agg.gate.splitPlayers, "clusters-valid", agg.gate.clustersValidPlayers, "under-powered", agg.gate.underPoweredPlayers);
console.log("metric population", agg.metricPopulation.players, "games", agg.metricPopulation.games, "evaluations", agg.metricPopulation.evaluations);
console.log("metric", JSON.stringify(agg.metric, null, 1));
console.log("looser split", JSON.stringify(agg.looserSplit, null, 1));
console.log("precision", JSON.stringify(agg.precision));
console.log("aim", JSON.stringify(agg.aim));
console.log("factors", JSON.stringify(agg.factors));
console.log("oldBoomAudit", JSON.stringify(agg.oldBoomAudit));
console.log("gateSweep", JSON.stringify(agg.gateSweep));
console.log("wrote", OUT);
