// mavis-evaluation-significance.mjs
// Built by mavis, 2026-11-14.
//
// Purpose: replace the flat "50%" reference in the projection evaluation with the
// reference that actually answers "does this carry skill?".
//
// A 50% agreement reference is only correct when the actual outcome is a 50/50 split
// AND the predictor is a 50/50 coin flip. On this data neither holds:
//   - booms are 52.0% of evaluations (the cut C is the median split of earlier games)
//   - the model categorizes high on 72.1% of evaluations, the baseline on 79.0%
// So a predictor with NO information about the outcome still agrees MORE than 50%
// of the time. The no-skill reference is:
//   boom subset   : P(predict high)                = p
//   bust subset   : P(predict low)                 = 1 - p
//   overall       : boomFrac * p + (1-boomFrac) * (1 - p)
// where p is the predictor's own overall high rate.
//
// Tests reported:
//   - one-sample z-test against the no-skill reference (z = (rate - ref)/sqrt(ref(1-ref)/n))
//   - one-sample z-test against 50% (kept for continuity with the previous document)
//   - permutation test: predictions shuffled across all evaluations, outcome labels
//     held fixed -> destroys any association while preserving both marginal
//     distributions. 10,000 shuffles, deterministic seed.
//   - chi-square test of independence on the 2x2 (predictor x actual), effect size phi
//   - model vs baseline on the same games: discordant-pair comparison
//     (McNemar's test), with both discordant counts printed so it can be checked by hand.
//
// Reads:  .tmp-audit/projection-evaluation.csv
// Writes: .tmp-audit/projection-significance.json
//
// Rebuild from frontend/react:  node scripts/mavis-evaluation-significance.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const csvPath = path.join(root, ".tmp-audit", "projection-evaluation.csv");
const outPath = path.join(root, ".tmp-audit", "projection-significance.json");

const SHUFFLES = 10000;
const SEED = 20261114;

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

// normal cdf via erf approximation (Abramowitz & Stegun 7.1.26)
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return s * y;
}
const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const twoSidedP = (z) => 2 * (1 - normalCdf(Math.abs(z)));

// ---------------------------------------------------------------- load rows
const raw = fs.readFileSync(csvPath, "utf8");
const [header, ...body] = parseCsv(raw);
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const req = ["actual_category", "model_category", "model_agrees", "baseline_category", "baseline_agrees"];
for (const k of req) if (!(k in idx)) throw new Error("missing column: " + k);

const evals = [];
for (const r of body) {
  if (!r.length) continue;
  if (r[idx.actual_category] !== "boom" && r[idx.actual_category] !== "bust") continue; // first game of record
  if (!r[idx.model_agrees]) continue;
  evals.push({
    boom: r[idx.actual_category] === "boom",
    modelHigh: r[idx.model_category] === "high",
    modelAgrees: r[idx.model_agrees] === "same",
    baseHigh: r[idx.baseline_category] === "high",
    baseAgrees: r[idx.baseline_agrees] === "same",
  });
}

// ---------------------------------------------------------------- statistics
function zAgainst(rate, ref, n) {
  if (ref <= 0 || ref >= 1) return null;
  const sd = Math.sqrt((ref * (1 - ref)) / n);
  return { z: (rate - ref) / sd, ref, n };
}

function sideStats(name, highKey, agreesKey, rows, rng) {
  const n = rows.length;
  const boomRows = rows.filter((r) => r.boom);
  const bustRows = rows.filter((r) => !r.boom);
  const nBoom = boomRows.length, nBust = bustRows.length;
  const boomFrac = nBoom / n;

  const p = rows.filter((r) => r[highKey]).length / n; // overall high rate
  const agreeBoom = boomRows.filter((r) => r[agreesKey]).length;
  const agreeBust = bustRows.filter((r) => r[agreesKey]).length;
  const rateBoom = agreeBoom / nBoom;
  const rateBust = agreeBust / nBust;
  const rateAll = (agreeBoom + agreeBust) / n;

  // no-skill reference
  const refBoom = p;
  const refBust = 1 - p;
  const refAll = boomFrac * p + (1 - boomFrac) * (1 - p);

  // 2x2 (predictor x actual)
  const a = boomRows.filter((r) => r[highKey]).length;  // predict high, actual boom
  const b = bustRows.filter((r) => r[highKey]).length;  // predict high, actual bust
  const c = nBoom - a;                                   // predict low,  actual boom
  const d = nBust - b;                                  // predict low,  actual bust
  const phi = (a * d - b * c) / Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  const chi2 = phi * phi * n;
  // 2x2 chi-square, df = 1, p-value via erfc for df=1
  const chiP = 1 - erf(Math.sqrt(chi2 / 2)); // df=1: p = erfc(sqrt(chi2/2))

  // permutation test: shuffle predictions across all rows, outcomes fixed
  const preds = rows.map((r) => r[highKey]);
  const isBoom = rows.map((r) => r.boom);
  const nullBoom = [], nullBust = [], nullAll = [];
  const idxs = preds.map((_, i) => i);
  for (let s = 0; s < SHUFFLES; s++) {
    // Fisher-Yates with seeded rng
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t;
    }
    let ab = 0, bb = 0, nB = 0;
    for (let i = 0; i < idxs.length; i++) {
      const pred = preds[idxs[i]];
      if (isBoom[i]) { nB++; if (pred) ab++; }
      else if (!pred) bb++;
    }
    nullBoom.push(ab / nB);
    nullBust.push(bb / (preds.length - nB));
    nullAll.push((ab + bb) / preds.length);
  }
  const permP = (arr, obs) => {
    let ge = 0;
    for (const v of arr) if (v >= obs - 1e-12) ge++;
    return (ge + 1) / (arr.length + 1);
  };
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    name,
    n, nBoom, nBust, boomFrac,
    highRate: p,
    agreement: {
      boom: { rate: rateBoom, n: nBoom, count: agreeBoom },
      bust: { rate: rateBust, n: nBust, count: agreeBust },
      overall: { rate: rateAll, n, count: agreeBoom + agreeBust },
    },
    noSkillReference: {
      boom: refBoom,
      bust: refBust,
      overall: refAll,
      note: "boom: P(predict high)=p; bust: P(predict low)=1-p; overall: boomFrac*p+(1-boomFrac)*(1-p)",
    },
    vs50: {
      boom: zAgainst(rateBoom, 0.5, nBoom),
      bust: zAgainst(rateBust, 0.5, nBust),
      overall: zAgainst(rateAll, 0.5, n),
    },
    vsNoSkill: {
      boom: zAgainst(rateBoom, refBoom, nBoom),
      bust: zAgainst(rateBust, refBust, nBust),
      overall: zAgainst(rateAll, refAll, n),
    },
    gapPoints: {
      boom: (rateBoom - refBoom) * 100,
      bust: (rateBust - refBust) * 100,
      overall: (rateAll - refAll) * 100,
    },
    permutation: {
      shuffles: SHUFFLES,
      nullMean: { boom: mean(nullBoom), bust: mean(nullBust), overall: mean(nullAll) },
      pValue: {
        boom: permP(nullBoom, rateBoom),
        bust: permP(nullBust, rateBust),
        overall: permP(nullAll, rateAll),
      },
    },
    twoByTwo: {
      cells: { predictHighActualBoom: a, predictHighActualBust: b, predictLowActualBoom: c, predictLowActualBust: d },
      chiSquare: chi2, df: 1, pValue: chiP, phi,
    },
  };
}

const rng = mulberry32(SEED);
const model = sideStats("model", "modelHigh", "modelAgrees", evals, rng);
const baseline = sideStats("baseline", "baseHigh", "baseAgrees", evals, rng);

// ---------------------------------------------------------------- model vs baseline (paired, same games)
let discordModelOnly = 0; // model same, baseline different
let discordBaseOnly = 0;  // baseline same, model different
for (const r of evals) {
  if (r.modelAgrees && !r.baseAgrees) discordModelOnly++;
  else if (!r.modelAgrees && r.baseAgrees) discordBaseOnly++;
}
const discordTotal = discordModelOnly + discordBaseOnly;
const mcChi2 = Math.pow(Math.abs(discordModelOnly - discordBaseOnly), 2) / discordTotal;
const mcP = 1 - erf(Math.sqrt(mcChi2 / 2)); // df=1

// ---------------------------------------------------------------- output
const fmt = (x, d = 4) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(d));
const pct = (x) => fmt(x * 100, 2) + "%";
const pct1 = (x) => fmt(x * 100, 1) + "%";

const lines = [];
lines.push("SIGNIFICANCE: no-skill reference, permutation tests, and the corrected comparison");
lines.push("");
lines.push("evaluations = " + evals.length + "   booms = " + model.nBoom + " (" + pct1(model.boomFrac) + ")   busts = " + model.nBust);
lines.push("");
lines.push("MODEL      high rate p = " + pct(model.highRate));
lines.push("  boom    agreement " + pct(model.agreement.boom.rate) + " (n=" + model.nBoom + ")  vs 50%: z=" + fmt(model.vs50.boom.z, 2) + "   vs no-skill " + pct(model.noSkillReference.boom) + ": z=" + fmt(model.vsNoSkill.boom.z, 2) + "   perm p=" + fmt(model.permutation.pValue.boom, 4) + "   gap " + fmt(model.gapPoints.boom, 2) + " pts");
lines.push("  bust    agreement " + pct(model.agreement.bust.rate) + " (n=" + model.nBust + ")  vs 50%: z=" + fmt(model.vs50.bust.z, 2) + "   vs no-skill " + pct(model.noSkillReference.bust) + ": z=" + fmt(model.vsNoSkill.bust.z, 2) + "   perm p=" + fmt(model.permutation.pValue.bust, 4) + "   gap " + fmt(model.gapPoints.bust, 2) + " pts");
lines.push("  overall agreement " + pct(model.agreement.overall.rate) + " (n=" + model.n + ")  vs 50%: z=" + fmt(model.vs50.overall.z, 2) + "   vs no-skill " + pct(model.noSkillReference.overall) + ": z=" + fmt(model.vsNoSkill.overall.z, 2) + "   perm p=" + fmt(model.permutation.pValue.overall, 4) + "   gap " + fmt(model.gapPoints.overall, 2) + " pts");
lines.push("  2x2 chi2=" + fmt(model.twoByTwo.chiSquare, 2) + " phi=" + fmt(model.twoByTwo.phi, 4) + " p=" + fmt(model.twoByTwo.pValue, 6));
lines.push("");
lines.push("BASELINE   high rate p = " + pct(baseline.highRate));
lines.push("  boom    agreement " + pct(baseline.agreement.boom.rate) + " (n=" + baseline.nBoom + ")  vs 50%: z=" + fmt(baseline.vs50.boom.z, 2) + "   vs no-skill " + pct(baseline.noSkillReference.boom) + ": z=" + fmt(baseline.vsNoSkill.boom.z, 2) + "   perm p=" + fmt(baseline.permutation.pValue.boom, 4) + "   gap " + fmt(baseline.gapPoints.boom, 2) + " pts");
lines.push("  bust    agreement " + pct(baseline.agreement.bust.rate) + " (n=" + baseline.nBust + ")  vs 50%: z=" + fmt(baseline.vs50.bust.z, 2) + "   vs no-skill " + pct(baseline.noSkillReference.bust) + ": z=" + fmt(baseline.vsNoSkill.bust.z, 2) + "   perm p=" + fmt(baseline.permutation.pValue.bust, 4) + "   gap " + fmt(baseline.gapPoints.bust, 2) + " pts");
lines.push("  overall agreement " + pct(baseline.agreement.overall.rate) + " (n=" + baseline.n + ")  vs 50%: z=" + fmt(baseline.vs50.overall.z, 2) + "   vs no-skill " + pct(baseline.noSkillReference.overall) + ": z=" + fmt(baseline.vsNoSkill.overall.z, 2) + "   perm p=" + fmt(baseline.permutation.pValue.overall, 4) + "   gap " + fmt(baseline.gapPoints.overall, 2) + " pts");
lines.push("  2x2 chi2=" + fmt(baseline.twoByTwo.chiSquare, 2) + " phi=" + fmt(baseline.twoByTwo.phi, 4) + " p=" + fmt(baseline.twoByTwo.pValue, 6));
lines.push("");
lines.push("MODEL vs BASELINE on the same " + evals.length + " games (discordant pairs):");
lines.push("  model same / baseline different = " + discordModelOnly);
lines.push("  baseline same / model different = " + discordBaseOnly);
lines.push("  McNemar chi2=" + fmt(mcChi2, 2) + " p=" + fmt(mcP, 4));
lines.push("");
lines.push("THE 50% LINE, for the record: what it claimed and what it actually supports");
lines.push("  model  boom: 50% -> z=" + fmt(model.vs50.boom.z, 2) + " ; no-skill " + pct(model.noSkillReference.boom) + " -> z=" + fmt(model.vsNoSkill.boom.z, 2));
lines.push("  base   boom: 50% -> z=" + fmt(baseline.vs50.boom.z, 2) + " ; no-skill " + pct(baseline.noSkillReference.boom) + " -> z=" + fmt(baseline.vsNoSkill.boom.z, 2));

console.log(lines.join("\n"));

fs.writeFileSync(outPath, JSON.stringify({
  generated: "2026-11-14",
  seed: SEED,
  shuffles: SHUFFLES,
  evaluations: evals.length,
  model,
  baseline,
  modelVsBaseline: {
    discordModelOnly, discordBaseOnly, discordTotal,
    chiSquare: mcChi2, df: 1, pValue: mcP,
  },
}, null, 2));

console.log("");
console.log("wrote " + outPath);
