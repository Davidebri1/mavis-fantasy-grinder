/**
 * dave-port.mjs — deliberate plain-Node mirror of
 * frontend/react/src/lib/dave-projection.ts, so the evaluation harness
 * runs under bare node with no app imports (the app is TypeScript; the
 * harness is a script).
 *
 * SAME maths, SAME decisions, line for line, documented in the engine's
 * module doc. The parity test (scripts/dave-port.test.mjs) runs both
 * implementations on the same cases and asserts identical output.
 *
 * This module is pure: it has no side effects, no network, and no file
 * access. The harness (mavis-projection-evaluation.mjs) imports it.
 *
 * Port additions (report only, never behaviour): halvesT / halvesDf /
 * nHigh / nLow / highVar / lowVar, so the report can show the two
 * half-averages, the sameness t, and rebuild the interval at the
 * evaluation's own P. They do not change the projection.
 */

export const SAME_T = 2.1;
export const SKEW_LIMIT = 1;
export const KURT_LIMIT = 2;
export const MAX_PEELS = 2;
export const Z90 = 1.6449;
export const FACTOR_T_MIN = 2.0;

export const BREAKPOINT_RULES = {
  swingPoints: 15,
  window: 5,
  meanGap: 6,
  shiftT: 2.0,
  cooldown: 5,
};

export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sampleVariance(xs) {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
}

export function skewKurt(xs) {
  const m = mean(xs);
  let m2 = 0, m3 = 0, m4 = 0;
  for (const x of xs) { const d = x - m; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
  m2 /= xs.length; m3 /= xs.length; m4 /= xs.length;
  if (m2 === 0) return { skew: 0, kurt: 0 };
  return { skew: m3 / Math.pow(m2, 1.5), kurt: m4 / (m2 * m2) - 3 };
}

export function isNormal(xs) {
  const { skew, kurt } = skewKurt(xs);
  return Math.abs(skew) <= SKEW_LIMIT && Math.abs(kurt) <= KURT_LIMIT;
}

export function welchT(a, b) {
  const nA = a.length, nB = b.length;
  const mA = mean(a), mB = mean(b);
  const vA = sampleVariance(a), vB = sampleVariance(b);
  const se2 = vA / nA + vB / nB;
  if (se2 === 0) return { t: 0, df: Math.min(nA, nB) - 1 };
  const df =
    (se2 * se2) / ((vA / nA) * (vA / nA) / (nA - 1) + (vB / nB) * (vB / nB) / (nB - 1));
  return { t: (mA - mB) / Math.sqrt(se2), df };
}

function medianSplit(games) {
  const sorted = games.map((game, index) => ({ game, index })).sort((a, b) => a.game.score - b.game.score);
  const mid = Math.floor(sorted.length / 2);
  const lowEnd = sorted.length % 2 === 0 ? mid : mid + 1;
  return { low: sorted.slice(0, lowEnd), high: sorted.slice(lowEnd) };
}

/** The cut C: the largest score in the LOW half of the engine's own split. */
export function cutOf(scores) {
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lowEnd = sorted.length % 2 === 0 ? mid : mid + 1;
  return sorted[lowEnd - 1];
}

function peelOutliers(entries) {
  const kept = [...entries];
  const peeled = [];
  for (let pass = 0; pass < MAX_PEELS; pass++) {
    if (kept.length <= 3) break;
    if (isNormal(kept.map((e) => e.game.score))) break;
    const m = mean(kept.map((e) => e.game.score));
    const sd = Math.sqrt(sampleVariance(kept.map((e) => e.game.score)));
    let worst = 0;
    let worstZ = -1;
    kept.forEach((e, i) => {
      const z = sd === 0 ? 0 : Math.abs(e.game.score - m) / sd;
      if (z > worstZ) { worstZ = z; worst = i; }
    });
    peeled.push(kept[worst].index);
    kept.splice(worst, 1);
  }
  return { kept, peeled };
}

function scoresFor(entries, key, hold) {
  const out = [];
  for (const e of entries) {
    const v = e.game.factors[key];
    if (v === undefined) continue;
    if (hold(v)) out.push(e.game.score);
  }
  return out;
}

function fractionHolding(entries, key, hold) {
  let holdCount = 0;
  let known = 0;
  for (const e of entries) {
    const v = e.game.factors[key];
    if (v === undefined) continue;
    known++;
    if (hold(v)) holdCount++;
  }
  return known ? holdCount / known : 0;
}

function buildApplication(key, condition, holds, withScores, withoutScores, highEntries, lowEntries) {
  if (withScores.length < 2 || withoutScores.length < 2) return null;
  const test = welchT(withScores, withoutScores);
  if (Math.abs(test.t) < FACTOR_T_MIN) return null;
  const highFraction = fractionHolding(highEntries, key, (v) => holds(v) === true);
  const lowFraction = fractionHolding(lowEntries, key, (v) => holds(v) === true);
  const detail =
    condition +
    " (two-sample t-test: t=" + test.t.toFixed(2) +
    ", df=" + test.df +
    "; scores average " + mean(withScores).toFixed(2) +
    " in n=" + withScores.length +
    " games when the condition holds vs " + mean(withoutScores).toFixed(2) +
    " in n=" + withoutScores.length +
    " games when it does not)";
  return {
    key,
    condition,
    holds,
    test: {
      t: test.t,
      df: test.df,
      withN: withScores.length,
      withMean: mean(withScores),
      withoutN: withoutScores.length,
      withoutMean: mean(withoutScores),
    },
    highFraction,
    lowFraction,
    detail,
  };
}

function detectFactorCandidates(low, high) {
  const keys = new Set();
  for (const e of [...low, ...high]) {
    for (const k of Object.keys(e.game.factors)) keys.add(k);
  }
  const entries = [...low, ...high];
  const out = [];
  for (const key of Array.from(keys).sort()) {
    const known = entries.filter((e) => e.game.factors[key] !== undefined);
    if (known.length < 4) continue;
    const values = known.map((e) => e.game.factors[key]);
    if (values.every((v) => typeof v === "number")) {
      const highVals = high.map((e) => Number(e.game.factors[key])).filter((v) => Number.isFinite(v));
      const lowVals = low.map((e) => Number(e.game.factors[key])).filter((v) => Number.isFinite(v));
      if (highVals.length < 2 || lowVals.length < 2) continue;
      const mid = (mean(highVals) + mean(lowVals)) / 2;
      const aboveScores = scoresFor(entries, key, (v) => Number(v) > mid);
      const belowScores = scoresFor(entries, key, (v) => Number(v) < mid);
      if (aboveScores.length < 2 || belowScores.length < 2) continue;
      const aboveHigher = mean(aboveScores) >= mean(belowScores);
      const holds = aboveHigher
        ? (v) => (v === undefined || typeof v !== "number" || !Number.isFinite(v) ? undefined : v === mid ? undefined : v > mid)
        : (v) => (v === undefined || typeof v !== "number" || !Number.isFinite(v) ? undefined : v === mid ? undefined : v < mid);
      const app = aboveHigher
        ? buildApplication(key, key + " > " + mid.toFixed(2), holds, aboveScores, belowScores, high, low)
        : buildApplication(key, key + " < " + mid.toFixed(2), holds, belowScores, aboveScores, high, low);
      if (app) out.push(app);
      continue;
    }
    const distinctValues = Array.from(new Set(known.map((e) => String(e.game.factors[key])))).sort();
    let best = null;
    for (const v of distinctValues) {
      const equalsScores = scoresFor(entries, key, (x) => String(x) === v);
      const notScores = scoresFor(entries, key, (x) => String(x) !== v);
      const equalsHigher = mean(equalsScores) >= mean(notScores);
      const app = equalsHigher
        ? buildApplication(key, key + "=" + v, (x) => (x === undefined ? undefined : String(x) === v), equalsScores, notScores, high, low)
        : buildApplication(key, key + "!=" + v, (x) => (x === undefined ? undefined : String(x) !== v), notScores, equalsScores, high, low);
      if (!app) continue;
      if (!best || Math.abs(app.test.t) > Math.abs(best.test.t)) best = app;
    }
    if (best) out.push(best);
  }
  out.sort((a, b) => Math.abs(b.test.t) - Math.abs(a.test.t) || a.key.localeCompare(b.key));
  return out;
}

/**
 * Mirror of projectDave. games = [{ date, score, factors }]; upcoming =
 * the objective conditions known before the upcoming game. Port additions:
 * halvesT/halvesDf/nHigh/nLow for the report (never used in the maths).
 */
export function projectDave(games, upcoming = {}) {
  if (games.length < 4) {
    throw new Error(
      "Dave's method needs at least 4 completed games to split into halves; got " + games.length + ".",
    );
  }
  const split = medianSplit(games);
  const lowPeeled = peelOutliers(split.low);
  const highPeeled = peelOutliers(split.high);
  const peeled = [...lowPeeled.peeled, ...highPeeled.peeled].sort((a, b) => a - b);
  const lowScores = lowPeeled.kept.map((e) => e.game.score);
  const highScores = highPeeled.kept.map((e) => e.game.score);
  const lowMean = mean(lowScores);
  const highMean = mean(highScores);
  const lowVar = sampleVariance(lowScores);
  const highVar = sampleVariance(highScores);
  const normality = { high: isNormal(highScores), low: isNormal(lowScores) };
  const halves = welchT(highScores, lowScores);
  const sameMeans = Math.abs(halves.t) < SAME_T;

  const build = (p) => {
    const variance =
      p * p * highVar + (1 - p) * (1 - p) * lowVar + p * (1 - p) * Math.pow(highMean - lowMean, 2);
    const halfWidth = Z90 * Math.sqrt(variance);
    const projection = highMean * p + lowMean * (1 - p);
    return {
      projection,
      low90: projection - halfWidth,
      high90: projection + halfWidth,
      highMean,
      lowMean,
      factor: null,
      p,
      peeled,
      sameMeans,
      normality,
      factorDetail: null,
      factors: [],
      halvesT: halves.t,
      halvesDf: halves.df,
      nHigh: highScores.length,
      nLow: lowScores.length,
      highVar,
      lowVar,
    };
  };

  if (sameMeans) {
    const raw = mean([...lowScores, ...highScores]);
    return { ...build(0.5), projection: raw, factor: null };
  }

  const candidates = detectFactorCandidates(lowPeeled.kept, highPeeled.kept);
  const applied = candidates.find((f) => f.holds(upcoming[f.key]) !== undefined) ?? null;
  const p = applied ? (applied.holds(upcoming[applied.key]) ? 1 : 0) : 0.5;
  const shown = applied ?? candidates[0] ?? null;

  return {
    ...build(p),
    factor: shown ? shown.key : null,
    factorDetail: shown
      ? { condition: shown.condition, highFraction: shown.highFraction, lowFraction: shown.lowFraction }
      : null,
    factors: candidates,
    p,
  };
}

/** Mirror of detectBreakpoints (module doc 8). */
export function detectBreakpoints(games) {
  const flags = [];
  const rules = BREAKPOINT_RULES;
  let lastShiftIndex = -(rules.cooldown + 1);
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    if (i > 0) {
      const prev = games[i - 1];
      const prevTeam = prev.factors.team;
      const curTeam = game.factors.team;
      if (typeof prevTeam === "string" && typeof curTeam === "string" && prevTeam !== curTeam) {
        flags.push({
          kind: "team change",
          date: game.date,
          priorDate: prev.date,
          detail: "team change: " + prevTeam + " to " + curTeam + " (first " + curTeam + " game on record " + game.date + ")",
        });
      }
      const swing = game.score - prev.score;
      if (Math.abs(swing) >= rules.swingPoints) {
        flags.push({
          kind: "big swing",
          date: game.date,
          priorDate: prev.date,
          detail: "score moved " + prev.score.toFixed(2) + " to " + game.score.toFixed(2) +
            " (" + (swing > 0 ? "+" : "") + swing.toFixed(2) + " DK points in one game)",
        });
      }
    }
    if (i >= rules.window && i + rules.window <= games.length && i - lastShiftIndex > rules.cooldown) {
      const before = games.slice(i - rules.window, i).map((g) => g.score);
      const after = games.slice(i, i + rules.window).map((g) => g.score);
      const gap = mean(after) - mean(before);
      const { t, df } = welchT(after, before);
      if (Math.abs(gap) >= rules.meanGap && Math.abs(t) >= rules.shiftT) {
        flags.push({
          kind: "level shift",
          date: game.date,
          priorDate: games[i - 1].date,
          detail: "5-game mean " + mean(before).toFixed(2) + " to " + mean(after).toFixed(2) +
            " (two-sample t-test: t=" + t.toFixed(2) + ", df=" + df + ")",
        });
        lastShiftIndex = i;
      }
    }
  }
  return flags;
}
