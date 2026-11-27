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

// mavis-control-limit-evaluation.mjs
// Built by mavis, 2026-11-17.
//
// The evaluation, in the owner's own terms (docs/DFS Projection Model.md):
//
//   - the earlier games are split at the median. That split is LOGISTICS:
//     it is how the two halves are formed, and it is never reported as a rate.
//   - the mean of the low half is the LOWER control limit; the mean of the
//     high half is the UPPER control limit. Their difference R is the
//     CONTROL LIMIT RANGE - the yardstick. Good players have tight limits;
//     inconsistent players have wide ones.
//   - a BOOM is an OUTLIER HIGH: a high scoring game that breaks above the
//     upper control limit. A BUST is an OUTLIER LOW: below the lower
//     control limit. Everything between the limits is inside the band.
//   - what we care about is PREDICTABILITY, and it is measured in units of
//     R: where the projection sits in the band against where the actual
//     landed, and whether the call points at the right control limit.
//
// Reads:  .tmp-audit/projection-evaluation-pre-correction.csv
// Writes: .tmp-audit/projection-control-limits.json
//
// Rebuild from frontend/react:  node scripts/mavis-control-limit-evaluation.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const csvPath = process.env.MAVIS_PRE_CSV || path.join(root, ".tmp-audit", "projection-evaluation-pre-correction.csv");
const outPath = path.join(root, ".tmp-audit", "projection-control-limits.json");

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

const raw = fs.readFileSync(csvPath, "utf8");
const [header, ...body] = parseCsv(raw);
const ix = Object.fromEntries(header.map((h, i) => [h, i]));
const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const rows = [];
for (const r of body) {
  if (!r.length) continue;
  const status = r[ix.status];
  if (status === "first game of record") {
    rows.push({ kind: "first", player: r[ix.player], athlete_id: r[ix.athlete_id], position: r[ix.position], season: num(r[ix.season]) });
    continue;
  }
  const R = num(r[ix.control_range]);
  rows.push({
    kind: "evaluation",
    player: r[ix.player], athlete_id: r[ix.athlete_id], position: r[ix.position],
    season: num(r[ix.season]), earlier_n: num(r[ix.earlier_n]),
    sampleFlag: r[ix.sample_flag] ?? "",
    lowerCL: num(r[ix.control_low]), upperCL: num(r[ix.control_high]), R,
    outcome: r[ix.outcome_class] ?? "",
    actualPos: num(r[ix.actual_band_position]),
    modelPos: num(r[ix.model_band_position]),
    baselinePos: num(r[ix.baseline_band_position]),
    path: r[ix.model_path] ?? "",
    factor: r[ix.model_factor] ?? "",
    factorT: num(r[ix.model_factor_t]),
    P: num(r[ix.model_P]),
    actual: num(r[ix.actual_dk_points]),
    projection: num(r[ix.model_projection]),
    baseline: num(r[ix.baseline_projection]),
    contained: r[ix.model_contained] ?? "",
    modelDirection: r[ix.model_direction] ?? "",
    baselineDirection: r[ix.baseline_direction] ?? "",
    peeledHigh: num(r[ix.peeled_high]) ?? 0,
    peeledLow: num(r[ix.peeled_low]) ?? 0,
  });
}

// ---------------------------------------------------------------- helpers
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
};
const pct = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 10);
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

const evaluations = rows.filter((r) => r.kind === "evaluation");
const firstGames = rows.filter((r) => r.kind === "first");
const scored = evaluations.filter((r) => r.R !== null && r.R > 0 && r.actualPos !== null && r.modelPos !== null);
const booms = scored.filter((r) => r.outcome === "boom (outlier high)");
const busts = scored.filter((r) => r.outcome === "bust (outlier low)");
const inside = scored.filter((r) => r.outcome === "inside the band");

// ---------------------------------------------------------------- control limits
const ranges = scored.map((r) => r.R);
const controlLimitRange = {
  evaluationsWithControlLimits: scored.length,
  mean: r2(mean(ranges)),
  median: r2(median(ranges)),
  p10: r2(quantile(ranges, 0.1)),
  p90: r2(quantile(ranges, 0.9)),
  min: r2(Math.min(...ranges)),
  max: r2(Math.max(...ranges)),
  note: "DK points between the lower and the upper control limit. Good players have tight limits; inconsistent players have wide ones.",
};

// per player: the median control limit range across that player's evaluations
const byPlayer = new Map();
for (const r of scored) {
  const key = r.athlete_id;
  if (!byPlayer.has(key)) byPlayer.set(key, { athlete_id: key, player: r.player, position: r.position, R: [], bandErrModel: [], bandErrBase: [], boom: 0, bust: 0, inside: 0, evaluations: 0 });
  const p = byPlayer.get(key);
  p.R.push(r.R);
  p.evaluations++;
  p.bandErrModel.push((r.actualPos - r.modelPos) ** 2);
  p.bandErrBase.push((r.actualPos - r.baselinePos) ** 2);
  if (r.outcome === "boom (outlier high)") p.boom++;
  else if (r.outcome === "bust (outlier low)") p.bust++;
  else p.inside++;
}
const playerStats = [...byPlayer.values()].map((p) => ({
  player: p.player, position: p.position, evaluations: p.evaluations,
  medianControlLimitRange: r2(median(p.R)),
  meanControlLimitRange: r2(mean(p.R)),
  bandErrorModel: r2(mean(p.bandErrModel)),
  bandErrorBaseline: r2(mean(p.bandErrBase)),
  boomGames: p.boom, bustGames: p.bust, insideBand: p.inside,
}));
const pool = playerStats.filter((p) => p.evaluations >= 30);
const tightest = [...pool].sort((a, b) => a.medianControlLimitRange - b.medianControlLimitRange).slice(0, 8);
const widest = [...pool].sort((a, b) => b.medianControlLimitRange - a.medianControlLimitRange).slice(0, 8);

// R against predictability: does a wider band mean a harder game?
const bandErrorByR = (() => {
  const buckets = [
    { label: "R < 6", test: (v) => v < 6 },
    { label: "6 <= R < 10", test: (v) => v >= 6 && v < 10 },
    { label: "10 <= R < 15", test: (v) => v >= 10 && v < 15 },
    { label: "R >= 15", test: (v) => v >= 15 },
  ];
  return buckets.map((b) => {
    const set = scored.filter((r) => b.test(r.R));
    return {
      bucket: b.label, evaluations: set.length,
      bandErrorModel: r2(mean(set.map((r) => (r.actualPos - r.modelPos) ** 2))),
      bandErrorBaseline: r2(mean(set.map((r) => (r.actualPos - r.baselinePos) ** 2))),
      boomGames: set.filter((r) => r.outcome === "boom (outlier high)").length,
      bustGames: set.filter((r) => r.outcome === "bust (outlier low)").length,
    };
  });
})();

// ---------------------------------------------------------------- predictability
const bandError = (set, key) => r2(mean(set.map((r) => (r.actualPos - r[key]) ** 2)));
const bandCorrelation = (set, key) => r2(pearson(set.map((r) => r[key]), set.map((r) => r.actualPos)));

const pathGroups = {
  factor: scored.filter((r) => r.path === "factor"),
  rawAverage: scored.filter((r) => r.path.startsWith("raw average")),
  evenSplitFloor: scored.filter((r) => r.path.startsWith("even-split")),
};
const predictabilityByPath = Object.fromEntries(
  Object.entries(pathGroups).map(([k, set]) => [k, {
    evaluations: set.length,
    bandErrorModel: bandError(set, "modelPos"),
    bandErrorBaseline: bandError(set, "baselinePos"),
    bandCorrelationModel: bandCorrelation(set, "modelPos"),
    bandCorrelationBaseline: bandCorrelation(set, "baselinePos"),
  }])
);
const predictabilityBySample = (() => {
  const low = scored.filter((r) => r.earlier_n < 30);
  const full = scored.filter((r) => r.earlier_n >= 30);
  const one = (set) => ({
    evaluations: set.length,
    bandErrorModel: bandError(set, "modelPos"),
    bandErrorBaseline: bandError(set, "baselinePos"),
    bandCorrelationModel: bandCorrelation(set, "modelPos"),
    bandCorrelationBaseline: bandCorrelation(set, "baselinePos"),
  });
  return { under30: one(low), thirtyOrMore: one(full) };
})();

const predictability = {
  all: {
    evaluations: scored.length,
    bandErrorModel: bandError(scored, "modelPos"),
    bandErrorBaseline: bandError(scored, "baselinePos"),
    bandCorrelationModel: bandCorrelation(scored, "modelPos"),
    bandCorrelationBaseline: bandCorrelation(scored, "baselinePos"),
  },
  byPath: predictabilityByPath,
  bySample: predictabilityBySample,
  note: "Squared error and correlation in control-limit-range units (R). The model's projection sits at a control limit when P is 1 or 0 and at the midpoint when P is the even-split floor, so the band error answers 'how close did the number land', while the direction section answers 'did it point at the right limit'.",
};

// ---------------------------------------------------------------- direction
const at = (r, side) => (side === "model" ? r.modelPos : r.baselinePos);
// The stored direction verdict is authoritative - it was decided at full
// precision. The band position is the fallback for an older CSV.
const storedDirection = (r, side) => (side === "model" ? r.modelDirection : r.baselineDirection);
const pointsUp = (r, side) =>
  storedDirection(r, side) ? storedDirection(r, side) === "up" : at(r, side) > 0.5;
const pointsDown = (r, side) =>
  storedDirection(r, side) ? storedDirection(r, side) === "down" : at(r, side) < 0.5;
const excessOf = (r) => (r.actualPos > 1 ? r.actualPos - 1 : -r.actualPos);

const sideDirection = (side) => {
  const baseUp = scored.filter((r) => pointsUp(r, side)).length;
  const baseDown = scored.filter((r) => pointsDown(r, side)).length;
  const boomUp = booms.filter((r) => pointsUp(r, side)).length;
  const boomDown = booms.filter((r) => pointsDown(r, side)).length;
  const bustDown = busts.filter((r) => pointsDown(r, side)).length;
  const bustUp = busts.filter((r) => pointsUp(r, side)).length;
  const excess = (set, keep) => {
    const xs = set.filter(keep).map(excessOf);
    return xs.length ? r2(mean(xs)) : null;
  };
  return {
    scoredRows: scored.length,
    pointsUp: baseUp,
    pointsDown: baseDown,
    noCall: scored.length - baseUp - baseDown,
    boom: {
      games: booms.length,
      pointsUp: boomUp,
      pointsDown: boomDown,
      liftPoints: pct(boomUp / booms.length - baseUp / scored.length),
      meanExcessWhenPointingUp: excess(booms, (r) => pointsUp(r, side)),
      meanExcessWhenPointingDown: excess(booms, (r) => !pointsUp(r, side)),
    },
    bust: {
      games: busts.length,
      pointsDown: bustDown,
      pointsUp: bustUp,
      liftPoints: pct(bustDown / busts.length - baseDown / scored.length),
      meanExcessWhenPointingDown: excess(busts, (r) => pointsDown(r, side)),
      meanExcessWhenPointingUp: excess(busts, (r) => !pointsDown(r, side)),
    },
  };
};
const direction = {
  model: sideDirection("model"),
  baseline: sideDirection("baseline"),
  note: "The reference is each side's own pointing rate over the same rows - the plain average points up when it sits above the band midpoint, the model when its P puts it above it. Lift is that rate on the outlier games minus the side's own rate: positive means the side points the right way more often on those games than it does on average.",
};

// ---------------------------------------------------------------- diagnostics
// (a) is the winning factor informative out of sample? boom rate by P
const factorRows = pathGroups.factor;
const boomRate = (set) => (set.length ? set.filter((r) => r.outcome === "boom (outlier high)").length / set.length : null);
const bustRate = (set) => (set.length ? set.filter((r) => r.outcome === "bust (outlier low)").length / set.length : null);
const diagnosticFactor = {
  factorPathEvaluations: factorRows.length,
  p1: {
    rows: factorRows.filter((r) => r.P === 1).length,
    boomRate: pct(boomRate(factorRows.filter((r) => r.P === 1))),
    bustRate: pct(bustRate(factorRows.filter((r) => r.P === 1))),
  },
  p0: {
    rows: factorRows.filter((r) => r.P === 0).length,
    boomRate: pct(boomRate(factorRows.filter((r) => r.P === 0))),
    bustRate: pct(bustRate(factorRows.filter((r) => r.P === 0))),
  },
  note: "Out of sample, on the factor path: if the winning factor carried the signal, games where its condition holds (P=1) would break out above the upper control limit more often than games where it does not (P=0).",
};

// (b) does a stronger in-sample |t| buy a better out-of-sample call?
const tRows = factorRows.filter((r) => r.factorT !== null && r.factorT !== undefined);
const tSorted = [...tRows].sort((a, b) => Math.abs(a.factorT) - Math.abs(b.factorT));
const tercile = Math.floor(tSorted.length / 3);
const tGroups = [
  { label: "weakest |t| third", set: tSorted.slice(0, tercile) },
  { label: "middle |t| third", set: tSorted.slice(tercile, 2 * tercile) },
  { label: "strongest |t| third", set: tSorted.slice(2 * tercile) },
];
const diagnosticByT = tGroups.map((g) => {
  const set = g.set;
  const up = set.filter((r) => pointsUp(r, "model")).length;
  const down = set.filter((r) => pointsDown(r, "model")).length;
  const boomUp = set.filter((r) => r.outcome === "boom (outlier high)" && pointsUp(r, "model")).length;
  const bustDown = set.filter((r) => r.outcome === "bust (outlier low)" && pointsDown(r, "model")).length;
  return {
    group: g.label,
    evaluations: set.length,
    medianAbsT: r2(median(set.map((r) => Math.abs(r.factorT)))),
    pointsUpRate: pct(up / set.length),
    pointsDownRate: pct(down / set.length),
    boomLiftPoints: pct(boomUp / Math.max(1, set.filter((r) => r.outcome === "boom (outlier high)").length) - up / set.length),
    bustLiftPoints: pct(bustDown / Math.max(1, set.filter((r) => r.outcome === "bust (outlier low)").length) - down / set.length),
  };
});

// (c) the same, by sample size
const diagnosticBySample = [
  { label: "earlier_n < 30", set: scored.filter((r) => r.earlier_n < 30) },
  { label: "earlier_n >= 30", set: scored.filter((r) => r.earlier_n >= 30) },
].map((g) => {
  const set = g.set;
  const up = set.filter((r) => pointsUp(r, "model")).length;
  const down = set.filter((r) => pointsDown(r, "model")).length;
  const boomSet = set.filter((r) => r.outcome === "boom (outlier high)");
  const bustSet = set.filter((r) => r.outcome === "bust (outlier low)");
  return {
    group: g.label,
    evaluations: set.length,
    pointsUpRate: pct(up / set.length),
    pointsDownRate: pct(down / set.length),
    boomLiftPoints: pct(boomSet.filter((r) => pointsUp(r, "model")).length / Math.max(1, boomSet.length) - up / set.length),
    bustLiftPoints: pct(bustSet.filter((r) => pointsDown(r, "model")).length / Math.max(1, bustSet.length) - down / set.length),
  };
});

// (d) the peaks his own method separated out of the training data
const peaks = {
  outlierHighSeparated: evaluations.reduce((a, r) => a + (r.peeledHigh ?? 0), 0),
  outlierLowSeparated: evaluations.reduce((a, r) => a + (r.peeledLow ?? 0), 0),
  evaluationsWithPeels: evaluations.filter((r) => (r.peeledHigh ?? 0) + (r.peeledLow ?? 0) > 0).length,
  note: "The engine's own outlier identification inside the training data: the peaks that don't belong, separated out of each half before the means were taken. These are booms and busts by his own method.",
};

// ---------------------------------------------------------------- per era
const ERAS = [
  { label: "2002-2008", from: 2002, to: 2008 },
  { label: "2009-2014", from: 2009, to: 2014 },
  { label: "2015-2020", from: 2015, to: 2020 },
  { label: "2021-2026", from: 2021, to: 2026 },
];
const perEra = ERAS.map((e) => {
  const set = scored.filter((r) => r.season >= e.from && r.season <= e.to);
  const boomSet = set.filter((r) => r.outcome === "boom (outlier high)");
  const bustSet = set.filter((r) => r.outcome === "bust (outlier low)");
  const up = set.filter((r) => pointsUp(r, "model")).length;
  const down = set.filter((r) => pointsDown(r, "model")).length;
  return {
    era: e.label,
    evaluations: set.length,
    medianControlLimitRange: r2(median(set.map((r) => r.R))),
    boomGames: boomSet.length,
    bustGames: bustSet.length,
    insideBand: set.length - boomSet.length - bustSet.length,
    bandErrorModel: bandError(set, "modelPos"),
    bandErrorBaseline: bandError(set, "baselinePos"),
    modelBoomLiftPoints: pct(boomSet.filter((r) => pointsUp(r, "model")).length / Math.max(1, boomSet.length) - up / set.length),
    modelBustLiftPoints: pct(bustSet.filter((r) => pointsDown(r, "model")).length / Math.max(1, bustSet.length) - down / set.length),
  };
});

const perPosition = (() => {
  const out = {};
  for (const r of scored) {
    if (!out[r.position]) out[r.position] = { evaluations: 0, R: [], errModel: [], errBase: [] };
    const p = out[r.position];
    p.evaluations++; p.R.push(r.R);
    p.errModel.push((r.actualPos - r.modelPos) ** 2);
    p.errBase.push((r.actualPos - r.baselinePos) ** 2);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, {
    evaluations: v.evaluations,
    medianControlLimitRange: r2(median(v.R)),
    bandErrorModel: r2(mean(v.errModel)),
    bandErrorBaseline: r2(mean(v.errBase)),
  }]).sort((a, b) => b[1].evaluations - a[1].evaluations));
})();

// ---------------------------------------------------------------- output
const result = {
  generated: "2026-11-17",
  coverage: {
    gamesOfRecord: rows.length,
    evaluations: evaluations.length,
    firstGamesOfRecord: firstGames.length,
    withControlLimits: scored.length,
    noControlLimitsYet: evaluations.length - scored.length,
    playersEvaluated: new Set(evaluations.map((r) => r.athlete_id)).size,
  },
  outcomeClasses: {
    boomOutlierHigh: booms.length,
    bustOutlierLow: busts.length,
    insideTheBand: inside.length,
    note: "boom = above the upper control limit, bust = below the lower control limit. Counts only - the split that forms the halves is logistics and never appears as a rate.",
  },
  controlLimitRange,
  predictability,
  direction,
  diagnostics: {
    factorOutOfSample: diagnosticFactor,
    byInSampleT: diagnosticByT,
    bySampleSize: diagnosticBySample,
    peaksSeparated: peaks,
  },
  perEra,
  perPosition,
  players: {
    poolEvaluations: pool.length,
    tightest,
    widest,
  },
};

fs.writeFileSync(outPath, JSON.stringify(result, null, 1));

const L = [];
L.push("CONTROL LIMIT EVALUATION (mavis, 2026-11-17)");
L.push("");
L.push("games of record " + result.coverage.gamesOfRecord + " | evaluations " + result.coverage.evaluations +
  " | with control limits " + result.coverage.withControlLimits +
  " | no control limits yet (n<4) " + result.coverage.noControlLimitsYet);
L.push("");
L.push("outcome classes - boom (outlier high) " + booms.length +
  " | bust (outlier low) " + busts.length + " | inside the band " + inside.length);
L.push("");
L.push("control limit range R: median " + controlLimitRange.median + " | mean " + controlLimitRange.mean +
  " | p10 " + controlLimitRange.p10 + " | p90 " + controlLimitRange.p90 + " DK points");
L.push("");
L.push("PREDICTABILITY (band units)");
L.push("  all        band error model " + predictability.all.bandErrorModel + " vs baseline " + predictability.all.bandErrorBaseline +
  " | correlation model " + predictability.all.bandCorrelationModel + " vs baseline " + predictability.all.bandCorrelationBaseline);
for (const [k, v] of Object.entries(predictabilityByPath)) {
  L.push("  " + k.padEnd(16) + " n=" + String(v.evaluations).padStart(6) +
    " | band error model " + v.bandErrorModel + " vs baseline " + v.bandErrorBaseline +
    " | corr model " + v.bandCorrelationModel + " vs baseline " + v.bandCorrelationBaseline);
}
L.push("");
L.push("DIRECTION (reference = each side's own pointing rate)");
L.push("  model    up " + direction.model.pointsUp + " / down " + direction.model.pointsDown + " / no call " + direction.model.noCall +
  " | boom lift " + direction.model.boom.liftPoints + " pts | bust lift " + direction.model.bust.liftPoints + " pts");
L.push("  baseline up " + direction.baseline.pointsUp + " / down " + direction.baseline.pointsDown + " / no call " + direction.baseline.noCall +
  " | boom lift " + direction.baseline.boom.liftPoints + " pts | bust lift " + direction.baseline.bust.liftPoints + " pts");
L.push("  model   boom excess when pointing up " + direction.model.boom.meanExcessWhenPointingUp +
  " R | when pointing down " + direction.model.boom.meanExcessWhenPointingDown + " R");
L.push("  baseline boom excess when pointing up " + direction.baseline.boom.meanExcessWhenPointingUp +
  " R | when pointing down " + direction.baseline.boom.meanExcessWhenPointingDown + " R");
L.push("");
L.push("DIAGNOSTIC - is the winning factor informative out of sample?");
L.push("  P=1 rows " + diagnosticFactor.p1.rows + " boom rate " + diagnosticFactor.p1.boomRate + "% | P=0 rows " +
  diagnosticFactor.p0.rows + " boom rate " + diagnosticFactor.p0.boomRate + "%");
for (const g of diagnosticByT) {
  L.push("  " + g.group.padEnd(20) + " n=" + String(g.evaluations).padStart(6) + " median |t| " + g.medianAbsT +
    " | boom lift " + g.boomLiftPoints + " pts | bust lift " + g.bustLiftPoints + " pts");
}
for (const g of diagnosticBySample) {
  L.push("  " + g.group.padEnd(20) + " n=" + String(g.evaluations).padStart(6) +
    " | boom lift " + g.boomLiftPoints + " pts | bust lift " + g.bustLiftPoints + " pts");
}
L.push("");
L.push("peaks separated out of the training data: " + peaks.outlierHighSeparated + " outlier high (boom), " +
  peaks.outlierLowSeparated + " outlier low (bust)");
L.push("");
L.push("wrote " + outPath);
console.log(L.join("\n"));
