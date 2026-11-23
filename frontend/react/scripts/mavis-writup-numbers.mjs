/**
 * mavis-writup-numbers.mjs
 *
 * The last numbers the write-up needs, in one place:
 *   - why each player was called one population or a split
 *   - the factor work restricted to the metric population
 *   - the common causes found, with p-values and their normality verdict
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const IN = path.join(REPO, "frontend", "react", ".tmp-audit", "player-scoped-evaluation.json");
const P = JSON.parse(fs.readFileSync(IN, "utf8"));

const reasons = {};
for (const p of P.players) {
  const r = p.primary.reason.startsWith("no second hump") ? "no second hump"
    : p.primary.reason === "median and mode match" ? "median and mode match"
    : "kurtosis " + p.distribution.kurtosis + " (>= " + P.aggregate.gate.parameters.platykurticCut + ")";
  const key = p.primary.thresholds.length ? "split" : r;
  reasons[key] = (reasons[key] || 0) + 1;
}
console.log("=== WHY EACH PLAYER WAS CALLED WHAT ===");
console.log(JSON.stringify(reasons, null, 1));

const split = P.players.filter((p) => p.primary.thresholds.length >= 1);
const metric = split.filter((p) => p.primary.clusterValid);
const invalid = split.filter((p) => !p.primary.clusterValid);

console.log("");
console.log("=== FACTOR WORK ===");
console.log("split players:", split.length, "| usable categories:", metric.length, "| rejected (wrong factor):", invalid.length);
console.log("");
console.log("-- the rejected ones, and why --");
for (const p of invalid) {
  console.log("  " + p.player + " (" + p.position + ", " + p.games + " games) thresholds " + JSON.stringify(p.primary.thresholds));
  for (const c of p.primary.clusters) {
    console.log("     cluster n=" + c.n + " [" + (c.lo === null ? "-inf" : c.lo) + ", " + (c.hi === null ? "inf" : c.hi) + "] mean " + c.mean +
      " skew " + c.skew + " kurtosis " + c.kurtosis + " -> " + c.verdict);
  }
}
console.log("");
const withFactor = metric.filter((p) => p.factors.clearingP > 0);
const withHolding = metric.filter((p) => p.factors.holdingAfterNormality > 0);
console.log("metric-population players with a cause at p<0.05:", withFactor.length, "of", metric.length);
console.log("metric-population players with a cause that also passes the normality test:", withHolding.length, "of", metric.length);
console.log("");
console.log("-- the validated causes in the metric population --");
for (const p of withHolding) {
  const f = p.factors.rows.filter((x) => x.p < 0.05 && (x.subsetNormality.verdict.startsWith("normal") || x.subsetNormality.verdict.startsWith("skewed")))[0];
  if (!f) continue;
  console.log("  " + p.player + " (" + p.position + "): " + f.cause +
    " | standout share " + f.standoutShareWith + " with vs " + f.standoutShareWithout + " without" +
    " | p=" + f.p + " | subset " + f.subsetNormality.verdict + " (skew " + f.subsetNormality.skew + ", kurtosis " + f.subsetNormality.kurtosis + ")");
}
console.log("");
console.log("-- every cause clearing p<0.05 across all 186 players, by kind --");
const byKind = {};
for (const p of P.players) {
  for (const f of p.factors.rows) {
    if (f.p >= 0.05) continue;
    byKind[f.kind] = byKind[f.kind] || { total: 0, holding: 0 };
    byKind[f.kind].total++;
    if (f.subsetNormality.verdict.startsWith("normal") || f.subsetNormality.verdict.startsWith("skewed")) byKind[f.kind].holding++;
  }
}
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].total - a[1].total)) {
  console.log("  " + k + ": " + v.total + " causes at p<0.05, " + v.holding + " of them pass the normality test");
}
console.log("");
console.log("-- the metric population, per player --");
console.log("player | pos | games | thresholds | model | calibrated | baseline | his no-skill rate | offset | residual IQR | cause");
for (const p of metric) {
  const f = p.factors.best;
  console.log(p.player + " | " + p.position + " | " + p.games + " | " + JSON.stringify(p.primary.thresholds) +
    " | " + p.primary.metric.modelHitRate + " | " + p.primary.metric.calibratedHitRate + " | " + p.primary.metric.baseHitRate +
    " | " + p.primary.reference.majorityShare + " | " + p.primary.precision.residualOffset + " | " + p.primary.precision.residualIQR +
    " | " + (f ? f.cause + " p=" + f.p : "none at p<0.05"));
}
