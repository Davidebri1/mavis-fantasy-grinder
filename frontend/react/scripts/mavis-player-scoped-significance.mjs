/**
 * mavis-player-scoped-significance.mjs
 *
 * Is the model better than the player's own no-skill rate? Tested the way
 * Dave's method requires: one paired difference per player, never pooled
 * games. Three tests per comparison:
 *
 *   - sign test: how many players beat their own reference (exact binomial)
 *   - Wilcoxon signed-rank on the paired differences (normal approximation
 *     with tie correction), which uses the size of the differences
 *   - the paired differences themselves, as a distribution
 *
 * Pooled-game proportion tests are deliberately NOT used: pooling players is
 * the mistake this whole rebuild corrects.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const IN = path.join(REPO, "frontend", "react", ".tmp-audit", "player-scoped-evaluation.json");

const P = JSON.parse(fs.readFileSync(IN, "utf8"));

function erf(x) {
  const sign = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}
const pFromZ = (z) => Math.max(0, Math.min(1, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)))));
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

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

/** exact two-sided sign test on paired differences */
function signTest(diffs) {
  const pos = diffs.filter((d) => d > 0).length;
  const neg = diffs.filter((d) => d < 0).length;
  const ties = diffs.filter((d) => d === 0).length;
  const n = pos + neg;
  if (!n) return { pos, neg, ties, n, p: 1 };
  // two-sided exact binomial at p=0.5
  const k = Math.min(pos, neg);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += binomial(i, n, 0.5);
  const p = Math.min(1, 2 * tail);
  return { pos, neg, ties, n, p: p < 0.0001 ? 0.0001 : p };
}
function binomial(i, n, p) {
  let coef = 1;
  for (let j = 0; j < i; j++) coef = coef * (n - j) / (j + 1);
  return coef * Math.pow(p, i) * Math.pow(1 - p, n - i);
}

/** Wilcoxon signed-rank, normal approximation with tie correction */
function wilcoxon(diffs) {
  const nz = diffs.filter((d) => d !== 0).map((d) => Math.abs(d));
  if (!nz.length) return { n: 0, p: 1 };
  const withSign = diffs.filter((d) => d !== 0).map((d) => ({ a: Math.abs(d), sign: d > 0 ? 1 : -1 }));
  withSign.sort((x, y) => x.a - y.a);
  // average ranks for ties
  let i = 0;
  while (i < withSign.length) {
    let j = i;
    while (j + 1 < withSign.length && withSign[j + 1].a === withSign[i].a) j++;
    if (j > i) {
      const avg = (i + j + 2) / 2;
      for (let k = i; k <= j; k++) withSign[k].rank = avg;
      i = j + 1;
    } else {
      withSign[i].rank = i + 1;
      i++;
    }
  }
  const wPlus = withSign.filter((x) => x.sign > 0).reduce((a, x) => a + x.rank, 0);
  const n = withSign.length;
  const wMinus = (n * (n + 1)) / 2 - wPlus;
  const w = Math.min(wPlus, wMinus);
  // tie correction
  const ties = new Map();
  for (const x of withSign) ties.set(x.a, (ties.get(x.a) || 0) + 1);
  let tieSum = 0;
  for (const c of ties.values()) if (c > 1) tieSum += c * c * c - c;
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1) - tieSum / 2) / 24);
  const z = sigma > 0 ? (w - mu) / sigma : 0;
  return { n, wPlus: r3(wPlus), wMinus: r3(wMinus), z: r3(z), p: pFromZ(z) };
}

function block(label, pop, variant) {
  const rows = pop.map((p) => {
    const v = variant(p);
    const ref = v.reference.majorityShare;
    return {
      player: p.player,
      model: v.metric.modelHitRate,
      baseline: v.metric.baseHitRate,
      calibrated: v.metric.calibratedHitRate,
      walkForward: v.metric.walkForwardHitRate,
      reference: ref,
    };
  });
  const out = { label, players: pop.length };
  for (const key of ["model", "baseline", "calibrated", "walkForward"]) {
    const diffs = rows.map((r) => (r[key] === null || r[key] === undefined ? null : r[key] - r.reference)).filter((x) => x !== null);
    const st = signTest(diffs);
    const wi = wilcoxon(diffs);
    out[key] = {
      n: diffs.length,
      medianDifference: r4(median(diffs)),
      q1: r4(quantile(diffs, 0.25)),
      q3: r4(quantile(diffs, 0.75)),
      playersBeatingReference: st.pos,
      playersBelowReference: st.neg,
      playersTied: st.ties,
      signTestP: st.p < 0.0001 ? "< 0.0001" : r4(st.p),
      wilcoxonP: wi.p < 0.0001 ? "< 0.0001" : r4(wi.p),
    };
  }
  return out;
}

const metricPlayers = P.players.filter((p) => p.primary.thresholds.length >= 1 && p.primary.clusterValid);
const loosePlayers = P.players.filter((p) => p.distribution.looseThresholds.length >= 1);
const looseValid = loosePlayers.filter((p) => p.clusterValid);

const out = {
  metricPopulation: block("players whose clusters are usable categories", metricPlayers, (p) => p.primary),
  looseSplit: block("humps only, gate ignored (robustness line)", loosePlayers, (p) => p),
  looseSplitValidOnly: block("humps only, clusters valid", looseValid, (p) => p),
};

console.log("=== SIGNIFICANCE: the model vs each player's own no-skill rate ===");
console.log("");
console.log("--- metric population (usable categories): " + out.metricPopulation.players + " players ---");
console.log(JSON.stringify(out.metricPopulation, null, 1));
console.log("");
console.log("--- robustness: humps only, gate ignored: " + out.looseSplit.players + " players ---");
console.log(JSON.stringify(out.looseSplit, null, 1));
console.log("");
console.log("--- robustness, clusters valid only: " + out.looseSplitValidOnly.players + " players ---");
console.log(JSON.stringify(out.looseSplitValidOnly, null, 1));

fs.writeFileSync(path.join(REPO, "frontend", "react", ".tmp-audit", "player-scoped-significance.json"), JSON.stringify(out, null, 1));
console.log("");
console.log("wrote frontend/react/.tmp-audit/player-scoped-significance.json");
