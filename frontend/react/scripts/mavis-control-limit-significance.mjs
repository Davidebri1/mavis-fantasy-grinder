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

// mavis-control-limit-significance.mjs
// Built by mavis, 2026-11-17.
//
// The statistical tests for the CONTROL LIMIT rebuild, in the owner's own
// terms (docs/DFS Projection Model.md):
//
//   - a BOOM is an OUTLIER HIGH: the actual landed above the upper control
//     limit. A BUST is an OUTLIER LOW: below the lower control limit.
//     Everything between the limits is INSIDE THE BAND.
//   - R = upper control limit - lower control limit is the yardstick. Band
//     positions are measured in R units: 0 is the lower limit, 1 is the
//     upper limit.
//   - PREDICTABILITY is the deliverable. It has two parts:
//       (1) ACCURACY  - how close the number landed to the actual, in R
//           units (squared band error) and whether it tracks the actual
//           at all (correlation).
//       (2) DIRECTION - whether the call points at the right control
//           limit: up on a boom, down on a bust.
//   - the reference line is NEVER a flat 50%. For a direction rate it is
//     that side's OWN pointing rate over the same rows - what a predictor
//     carrying no information about the outcome scores. For the interval
//     it is the interval's own nominal coverage, which is a different
//     kind of reference and is labelled as such.
//
// Reads:  .tmp-audit/projection-evaluation-pre-correction.csv
// Writes: .tmp-audit/projection-control-limit-significance.json
//
// Rebuild from frontend/react:
//   node scripts/mavis-control-limit-evaluation.mjs
//   node scripts/mavis-control-limit-significance.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const csvPath = process.env.MAVIS_PRE_CSV || path.join(root, ".tmp-audit", "projection-evaluation-pre-correction.csv");
const outPath = path.join(root, ".tmp-audit", "projection-control-limit-significance.json");

const SHUFFLES = 10000;
const SEED = 20261117;

// ---------------------------------------------------------------- csv reader
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

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const erf = (x) => {
  const s = Math.sign(x); x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return s * y;
};
const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const twoSidedP = (z) => 2 * (1 - normalCdf(Math.abs(z)));

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
const r4 = (x) => (x === null || x === undefined ? null : Math.round(x * 10000) / 10000);
const pct = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 10);

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}
const fisherZ = (r) => 0.5 * Math.log((1 + r) / (1 - r));

// ---------------------------------------------------------------- load
const raw = fs.readFileSync(csvPath, "utf8");
const [header, ...body] = parseCsv(raw);
const ix = Object.fromEntries(header.map((h, i) => [h, i]));
const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const evaluations = [];
let firstGames = 0;
let evaluationsWithoutControlLimits = 0;
for (const r of body) {
  if (!r.length) continue;
  if (r[ix.status] === "first game of record") { firstGames++; continue; }
  const R = num(r[ix.control_range]);
  const actualPos = num(r[ix.actual_band_position]);
  const modelPos = num(r[ix.model_band_position]);
  const basePos = num(r[ix.baseline_band_position]);
  if (R === null || R <= 0 || actualPos === null || modelPos === null || basePos === null) {
    // An evaluation with fewer than 4 earlier games: no halves, so no
    // control limits and nothing to place in the band. Recorded, never scored.
    evaluationsWithoutControlLimits++;
    continue;
  }
  evaluations.push({
    outcome: r[ix.outcome_class] || "",
    actualPos, modelPos, basePos, R,
    earlierN: num(r[ix.earlier_n]),
    P: num(r[ix.model_P]),
    path: r[ix.model_path] || "",
    factor: r[ix.model_factor] || "",
    factorT: num(r[ix.model_factor_t]),
    contained: r[ix.model_contained] || "",
    modelDirection: r[ix.model_direction] || "",
    baseDirection: r[ix.baseline_direction] || "",
    actual: num(r[ix.actual_dk_points]),
    projection: num(r[ix.model_projection]),
    baseline: num(r[ix.baseline_projection]),
  });
}

const N = evaluations.length;
const isBoom = new Int8Array(N);
const isBust = new Int8Array(N);
const modelUp = new Int8Array(N);
const modelDown = new Int8Array(N);
const baseUp = new Int8Array(N);
const baseDown = new Int8Array(N);
const actualPos = new Float64Array(N);
const modelPos = new Float64Array(N);
const basePos = new Float64Array(N);
const modelErr = new Float64Array(N);
const baseErr = new Float64Array(N);

let boomCount = 0, bustCount = 0, insideCount = 0;
const factorP1 = { boom: 0, n: 0 };
const factorP0 = { boom: 0, n: 0 };
const factorAll = { boom: 0, n: 0 };

evaluations.forEach((e, i) => {
  if (e.outcome === "boom (outlier high)") { isBoom[i] = 1; boomCount++; }
  else if (e.outcome === "bust (outlier low)") { isBust[i] = 1; bustCount++; }
  else insideCount++;
  // The stored verdict is authoritative - it was decided at full precision.
  // The band position is the fallback for an older CSV.
  const mDir = e.modelDirection;
  const bDir = e.baseDirection;
  modelUp[i] = mDir ? (mDir === "up" ? 1 : 0) : (e.modelPos > 0.5 ? 1 : 0);
  modelDown[i] = mDir ? (mDir === "down" ? 1 : 0) : (e.modelPos < 0.5 ? 1 : 0);
  baseUp[i] = bDir ? (bDir === "up" ? 1 : 0) : (e.basePos > 0.5 ? 1 : 0);
  baseDown[i] = bDir ? (bDir === "down" ? 1 : 0) : (e.basePos < 0.5 ? 1 : 0);
  actualPos[i] = e.actualPos;
  modelPos[i] = e.modelPos;
  basePos[i] = e.basePos;
  modelErr[i] = (e.actualPos - e.modelPos) ** 2;
  baseErr[i] = (e.actualPos - e.basePos) ** 2;
  if (e.path === "factor") {
    factorAll.n++; factorAll.boom += isBoom[i];
    if (e.P === 1) { factorP1.n++; factorP1.boom += isBoom[i]; }
    else if (e.P === 0) { factorP0.n++; factorP0.boom += isBoom[i]; }
  }
});

// ---------------------------------------------------------------- direction
// The no-skill reference for a direction rate is that side's OWN pointing
// rate over the same rows: what it scores when it carries no information
// about which games were booms and which were busts.
function sideStats(name, up, down) {
  const n = N;
  let upTotal = 0, downTotal = 0;
  for (let i = 0; i < n; i++) { upTotal += up[i]; downTotal += down[i]; }
  const noCall = n - upTotal - downTotal;
  const refBoom = upTotal / n;
  const refBust = downTotal / n;

  let boomUp = 0, boomN = 0, bustDown = 0, bustN = 0;
  for (let i = 0; i < n; i++) {
    if (isBoom[i]) { boomN++; boomUp += up[i]; }
    if (isBust[i]) { bustN++; bustDown += down[i]; }
  }
  const obsBoom = boomN ? boomUp / boomN : null;
  const obsBust = bustN ? bustDown / bustN : null;

  const zBoom = boomN && refBoom > 0 && refBoom < 1
    ? (obsBoom - refBoom) / Math.sqrt(refBoom * (1 - refBoom) / boomN) : null;
  const zBust = bustN && refBust > 0 && refBust < 1
    ? (obsBust - refBust) / Math.sqrt(refBust * (1 - refBust) / bustN) : null;

  const errs = name === "model" ? modelErr : baseErr;
  const pos = name === "model" ? modelPos : basePos;
  const errList = [], posList = [];
  for (let i = 0; i < n; i++) { errList.push(errs[i]); posList.push(pos[i]); }
  const actualList = Array.from(actualPos);

  return {
    name,
    n,
    pointing: {
      up: upTotal, down: downTotal, noCall,
      upRate: r4(upTotal / n), downRate: r4(downTotal / n),
    },
    boom: {
      games: boomN, pointsUp: boomUp,
      rate: r4(obsBoom),
      noSkillReference: r4(refBoom),
      liftPoints: pct(obsBoom - refBoom),
      z: zBoom === null ? null : Math.round(zBoom * 100) / 100,
      pTwoSided: zBoom === null ? null : r4(twoSidedP(zBoom)),
    },
    bust: {
      games: bustN, pointsDown: bustDown,
      rate: r4(obsBust),
      noSkillReference: r4(refBust),
      liftPoints: pct(obsBust - refBust),
      z: zBust === null ? null : Math.round(zBust * 100) / 100,
      pTwoSided: zBust === null ? null : r4(twoSidedP(zBust)),
    },
    bandError: r2(mean(errList)),
    bandCorrelation: r4(pearson(posList, actualList)),
  };
}

// ---------------------------------------------------------------- permutation
// Shuffle each side's calls across all rows with the outcome labels held
// fixed: destroys any association while preserving both marginal
// distributions. Same shuffle drives both sides.
const rng = mulberry32(SEED);
const perm = new Int32Array(N);
for (let i = 0; i < N; i++) perm[i] = i;
const nullModelBoom = [], nullModelBust = [];
const nullBaseBoom = [], nullBaseBust = [];
for (let s = 0; s < SHUFFLES; s++) {
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  let modelBoomUp = 0, baseBoomUp = 0, boomRows = 0;
  let modelBustDown = 0, baseBustDown = 0, bustRows = 0;
  for (let i = 0; i < N; i++) {
    const j = perm[i];
    if (isBoom[i]) {
      boomRows++; modelBoomUp += modelUp[j]; baseBoomUp += baseUp[j];
    } else if (isBust[i]) {
      bustRows++; modelBustDown += modelDown[j]; baseBustDown += baseDown[j];
    }
  }
  nullModelBoom.push(boomRows ? modelBoomUp / boomRows : 0);
  nullModelBust.push(bustRows ? modelBustDown / bustRows : 0);
  nullBaseBoom.push(boomRows ? baseBoomUp / boomRows : 0);
  nullBaseBust.push(bustRows ? baseBustDown / bustRows : 0);
}
const permP = (arr, obs) => {
  let ge = 0;
  for (const v of arr) if (v >= obs - 1e-12) ge++;
  return (ge + 1) / (arr.length + 1);
};

// ---------------------------------------------------------------- side stats
const model = sideStats("model", modelUp, modelDown);
const baseline = sideStats("baseline", baseUp, baseDown);
const PERM_NOTE = "One-sided: the fraction of shuffled runs that scored at or above the observed rate, in the direction of the claim. The z-test p above is two-sided.";
model.permutation = {
  shuffles: SHUFFLES, seed: SEED, note: PERM_NOTE,
  pValueBoom: r4(permP(nullModelBoom, model.boom.rate)),
  pValueBust: r4(permP(nullModelBust, model.bust.rate)),
  nullMeanBoom: r4(mean(nullModelBoom)),
  nullMeanBust: r4(mean(nullModelBust)),
};
baseline.permutation = {
  shuffles: SHUFFLES, seed: SEED, note: PERM_NOTE,
  pValueBoom: r4(permP(nullBaseBoom, baseline.boom.rate)),
  pValueBust: r4(permP(nullBaseBust, baseline.bust.rate)),
  nullMeanBoom: r4(mean(nullBaseBoom)),
  nullMeanBust: r4(mean(nullBaseBust)),
};

// ---------------------------------------------------------------- paired model vs baseline
// Same rows, same games. On a boom: model points up while the baseline does
// not, against the reverse. On a bust: model points down while the baseline
// does not, against the reverse.
let modelOnlyBoom = 0, baseOnlyBoom = 0, modelOnlyBust = 0, baseOnlyBust = 0;
for (let i = 0; i < N; i++) {
  if (isBoom[i]) {
    if (modelUp[i] && !baseUp[i]) modelOnlyBoom++;
    else if (baseUp[i] && !modelUp[i]) baseOnlyBoom++;
  } else if (isBust[i]) {
    if (modelDown[i] && !baseDown[i]) modelOnlyBust++;
    else if (baseDown[i] && !modelDown[i]) baseOnlyBust++;
  }
}
const mcnemar = (a, b) => {
  const total = a + b;
  if (total === 0) return { chiSquare: null, df: 1, pValue: null };
  const chi2 = Math.pow(Math.abs(a - b), 2) / total;
  return { chiSquare: Math.round(chi2 * 100) / 100, df: 1, pValue: r4(1 - erf(Math.sqrt(chi2 / 2))) };
};
const paired = {
  boom: { modelOnly: modelOnlyBoom, baselineOnly: baseOnlyBoom, ...mcnemar(modelOnlyBoom, baseOnlyBoom) },
  bust: { modelOnly: modelOnlyBust, baselineOnly: baseOnlyBust, ...mcnemar(modelOnlyBust, baseOnlyBust) },
  note: "Paired discordant pairs on the same rows. McNemar's test, chi-square with 1 degree of freedom.",
};

// ---------------------------------------------------------------- band accuracy, paired
const diffs = [];
for (let i = 0; i < N; i++) diffs.push(modelErr[i] - baseErr[i]);
const dMean = mean(diffs);
const dSd = Math.sqrt(diffs.reduce((a, d) => a + (d - dMean) ** 2, 0) / (N - 1));
const tStat = dMean / (dSd / Math.sqrt(N));
// sign-flip permutation on the mean paired difference
const signRng = mulberry32(SEED + 1);
let geCount = 0;
for (let s = 0; s < SHUFFLES; s++) {
  let acc = 0;
  for (let i = 0; i < N; i++) acc += (signRng() < 0.5 ? -diffs[i] : diffs[i]);
  if (Math.abs(acc / N) >= Math.abs(dMean)) geCount++;
}
const bandAccuracy = {
  n: N,
  bandErrorModel: r2(mean(Array.from(modelErr))),
  bandErrorBaseline: r2(mean(Array.from(baseErr))),
  differenceModelMinusBaseline: r4(dMean),
  pairedT: Math.round(tStat * 100) / 100,
  df: N - 1,
  pTwoSided: r4(twoSidedP(tStat)),
  signFlipPermutationP: r4((geCount + 1) / (SHUFFLES + 1)),
  bandCorrelationModel: model.bandCorrelation,
  bandCorrelationBaseline: baseline.bandCorrelation,
  correlationDifferenceZ: Math.round(((fisherZ(model.bandCorrelation) - fisherZ(baseline.bandCorrelation)) / Math.sqrt(2 / (N - 3))) * 100) / 100,
  correlationDifferenceP: r4(twoSidedP((fisherZ(model.bandCorrelation) - fisherZ(baseline.bandCorrelation)) / Math.sqrt(2 / (N - 3)))),
  note: "Band error is squared distance from the actual to the call, in R units. A paired t-test on the per-row differences, confirmed by a sign-flip permutation.",
};

// ---------------------------------------------------------------- factor informativeness
const twoProportion = (a, na, b, nb) => {
  const p1 = a / na, p2 = b / nb, p = (a + b) / (na + nb);
  const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
  const z = (p1 - p2) / se;
  const chi2 = z * z;
  return {
    rateA: r4(p1), nA: na, countA: a,
    rateB: r4(p2), nB: nb, countB: b,
    differencePoints: pct(p1 - p2),
    z: Math.round(z * 100) / 100,
    pTwoSided: r4(twoSidedP(z)),
    chiSquare: Math.round(chi2 * 100) / 100,
    df: 1,
    pValueChiSquare: r4(twoSidedP(Math.sqrt(chi2))),
  };
};
const factorInformativeness = {
  question: "Out of sample, does the winning factor carry information? On the factor path, games where its condition holds (P=1) against games where it does not (P=0): are booms more common when it holds?",
  factorPathEvaluations: factorAll.n,
  overallBoomRate: r4(factorAll.boom / factorAll.n),
  p1: twoProportion(factorP1.boom, factorP1.n, factorP0.boom, factorP0.n),
  note: "The reference for a factor is its own base rate: if the factor carried nothing, P=1 and P=0 rows would show the same boom rate.",
};

// ---------------------------------------------------------------- containment
let containN = 0, containSame = 0;
for (const e of evaluations) {
  if (e.contained === "same" || e.contained === "different") {
    containN++;
    if (e.contained === "same") containSame++;
  }
}
const coverRate = containN ? containSame / containN : null;
const nominal = 0.9;
const coverSe = Math.sqrt(nominal * (1 - nominal) / containN);
const coverZ = (coverRate - nominal) / coverSe;
const containment = {
  evaluationsWithInterval: containN,
  same: containSame,
  different: containN - containSame,
  rate: pct(coverRate),
  nominalCoverage: 90,
  reference: "the interval's own nominal coverage (90%), not a coin flip: this asks whether the engine's 90% interval behaves like a 90% interval",
  z: Math.round(coverZ * 100) / 100,
  pTwoSided: r4(twoSidedP(coverZ)),
};

// ---------------------------------------------------------------- terciles and sample size
const factorRows = evaluations.filter((e) => e.path === "factor");
const tRows = factorRows.filter((e) => e.factorT !== null && e.factorT !== undefined);
const tSorted = [...tRows].sort((a, b) => Math.abs(a.factorT) - Math.abs(b.factorT));
const tercile = Math.floor(tSorted.length / 3);
const tercileStats = [
  { label: "weakest |t| third", set: tSorted.slice(0, tercile) },
  { label: "middle |t| third", set: tSorted.slice(tercile, 2 * tercile) },
  { label: "strongest |t| third", set: tSorted.slice(2 * tercile) },
].map((g) => {
  const set = g.set;
  const boomSet = set.filter((e) => e.outcome === "boom (outlier high)");
  const bustSet = set.filter((e) => e.outcome === "bust (outlier low)");
  const up = set.filter((e) => e.modelPos > 0.5).length;
  const down = set.filter((e) => e.modelPos < 0.5).length;
  return {
    group: g.label,
    evaluations: set.length,
    medianAbsT: r2(mean(set.map((e) => Math.abs(e.factorT))) ? [...set.map((e) => Math.abs(e.factorT))].sort((a, b) => a - b)[Math.floor(set.length / 2)] : null),
    boomGames: boomSet.length, bustGames: bustSet.length,
    boomLiftPoints: pct(boomSet.filter((e) => e.modelPos > 0.5).length / Math.max(1, boomSet.length) - up / set.length),
    bustLiftPoints: pct(bustSet.filter((e) => e.modelPos < 0.5).length / Math.max(1, bustSet.length) - down / set.length),
  };
});
const sampleStats = [
  { label: "earlier_n < 30", set: evaluations.filter((e) => e.earlierN < 30) },
  { label: "earlier_n >= 30", set: evaluations.filter((e) => e.earlierN >= 30) },
].map((g) => {
  const set = g.set;
  const boomSet = set.filter((e) => e.outcome === "boom (outlier high)");
  const bustSet = set.filter((e) => e.outcome === "bust (outlier low)");
  const up = set.filter((e) => e.modelPos > 0.5).length;
  const down = set.filter((e) => e.modelPos < 0.5).length;
  return {
    group: g.label,
    evaluations: set.length,
    boomGames: boomSet.length, bustGames: bustSet.length,
    boomLiftPoints: pct(boomSet.filter((e) => e.modelPos > 0.5).length / Math.max(1, boomSet.length) - up / set.length),
    bustLiftPoints: pct(bustSet.filter((e) => e.modelPos < 0.5).length / Math.max(1, bustSet.length) - down / set.length),
    bandErrorModel: r2(mean(set.map((e) => (e.actualPos - e.modelPos) ** 2))),
    bandErrorBaseline: r2(mean(set.map((e) => (e.actualPos - e.basePos) ** 2))),
  };
});

// ---------------------------------------------------------------- output
const result = {
  generated: "2026-11-17",
  seed: SEED,
  shuffles: SHUFFLES,
  coverage: {
    gamesOfRecord: evaluations.length + evaluationsWithoutControlLimits + firstGames,
    firstGamesOfRecord: firstGames,
    evaluations: evaluations.length + evaluationsWithoutControlLimits,
    withControlLimits: N,
    noControlLimitsYet: evaluationsWithoutControlLimits,
    boomOutlierHigh: boomCount,
    bustOutlierLow: bustCount,
    insideTheBand: insideCount,
    note: "Only evaluations with control limits (R > 0) can be placed in the band; the rest are recorded in the CSV and excluded from every rate below.",
  },
  model,
  baseline,
  paired,
  bandAccuracy,
  factorInformativeness,
  containment,
  byInSampleT: tercileStats,
  bySampleSize: sampleStats,
  references: {
    direction: "Each side's own pointing rate over the same rows - what it scores carrying no information about the outcome. Never a flat 50%.",
    interval: "The interval's own nominal coverage. A different kind of reference, labelled as such.",
    factor: "The factor path's own boom rate. If the factor carried nothing, P=1 and P=0 rows would match.",
  },
};

fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

const L = [];
L.push("CONTROL LIMIT SIGNIFICANCE (mavis, 2026-11-17)");
L.push("");
L.push("evaluations with control limits " + N + " | boom " + boomCount + " | bust " + bustCount + " | inside the band " + insideCount);
L.push("");
L.push("DIRECTION - reference is each side's own pointing rate over the same rows");
L.push("  model    up " + model.pointing.up + " / down " + model.pointing.down + " / no call " + model.pointing.noCall);
L.push("    boom  " + pct(model.boom.rate) + "% of " + model.boom.games + " games, reference " + pct(model.boom.noSkillReference) + "% | lift " + model.boom.liftPoints + " pts | z " + model.boom.z + " | perm p " + model.permutation.pValueBoom);
L.push("    bust  " + pct(model.bust.rate) + "% of " + model.bust.games + " games, reference " + pct(model.bust.noSkillReference) + "% | lift " + model.bust.liftPoints + " pts | z " + model.bust.z + " | perm p " + model.permutation.pValueBust);
L.push("  baseline up " + baseline.pointing.up + " / down " + baseline.pointing.down + " / no call " + baseline.pointing.noCall);
L.push("    boom  " + pct(baseline.boom.rate) + "% of " + baseline.boom.games + " games, reference " + pct(baseline.boom.noSkillReference) + "% | lift " + baseline.boom.liftPoints + " pts | z " + baseline.boom.z + " | perm p " + baseline.permutation.pValueBoom);
L.push("    bust  " + pct(baseline.bust.rate) + "% of " + baseline.bust.games + " games, reference " + pct(baseline.bust.noSkillReference) + "% | lift " + baseline.bust.liftPoints + " pts | z " + baseline.bust.z + " | perm p " + baseline.permutation.pValueBust);
L.push("");
L.push("BAND ACCURACY (R units)");
L.push("  band error model " + bandAccuracy.bandErrorModel + " vs baseline " + bandAccuracy.bandErrorBaseline +
  " | difference " + bandAccuracy.differenceModelMinusBaseline + " | paired t " + bandAccuracy.pairedT + " (df " + bandAccuracy.df + ") p " + bandAccuracy.pTwoSided +
  " | sign-flip perm p " + bandAccuracy.signFlipPermutationP);
L.push("  correlation model " + bandAccuracy.bandCorrelationModel + " vs baseline " + bandAccuracy.bandCorrelationBaseline +
  " | Fisher z " + bandAccuracy.correlationDifferenceZ + " p " + bandAccuracy.correlationDifferenceP);
L.push("");
L.push("MODEL vs BASELINE, same rows (McNemar's test)");
L.push("  boom  model only " + paired.boom.modelOnly + " | baseline only " + paired.boom.baselineOnly + " | chi2 " + paired.boom.chiSquare + " p " + paired.boom.pValue);
L.push("  bust  model only " + paired.bust.modelOnly + " | baseline only " + paired.bust.baselineOnly + " | chi2 " + paired.bust.chiSquare + " p " + paired.bust.pValue);
L.push("");
L.push("FACTOR INFORMATIVENESS (factor path)");
L.push("  P=1 boom rate " + pct(factorInformativeness.p1.rateA) + "% (n=" + factorInformativeness.p1.nA + ") vs P=0 " + pct(factorInformativeness.p1.rateB) + "% (n=" + factorInformativeness.p1.nB + ")");
L.push("  difference " + factorInformativeness.p1.differencePoints + " pts | z " + factorInformativeness.p1.z + " | p " + factorInformativeness.p1.pTwoSided);
L.push("");
L.push("CONTAINMENT (the engine's 90% interval, reference = its own 90% nominal)");
L.push("  same " + containment.same + " of " + containment.evaluationsWithInterval + " = " + containment.rate + "% | z " + containment.z + " p " + containment.pTwoSided);
L.push("");
for (const g of tercileStats) L.push("  " + g.group.padEnd(20) + " n=" + String(g.evaluations).padStart(6) + " | boom lift " + g.boomLiftPoints + " pts | bust lift " + g.bustLiftPoints + " pts");
for (const g of sampleStats) L.push("  " + g.group.padEnd(20) + " n=" + String(g.evaluations).padStart(6) + " | boom lift " + g.boomLiftPoints + " pts | bust lift " + g.bustLiftPoints + " pts | band error model " + g.bandErrorModel + " vs baseline " + g.bandErrorBaseline);
L.push("");
L.push("wrote " + outPath);
console.log(L.join("\n"));
