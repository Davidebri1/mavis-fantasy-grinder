/**
 * Dave's projection model — implemented exactly as written in
 * "docs/DFS Projection Model.md" (the source of truth, verbatim).
 *
 * The method, in his words and ours:
 *
 * 1. Split a player's completed games into HIGH and LOW halves by score.
 *    His doc: "this cut off can be decided any way you like" — we use the
 *    median (the defensible choice: no score dominates the cut, and the two
 *    halves stay balanced as games accumulate). Every game is classified:
 *    with an odd count the middle game joins the LOW half, respecting the
 *    floor side he emphasises.
 *
 * 2. Mean of each half, "regardless of opponent".
 *
 * 3. Normality per half, computed directly (no stats library): skewness and
 *    excess kurtosis from the half's central moments. A half is flagged
 *    non-normal when |skew| > 1 or |excess kurtosis| > 2 — thresholds chosen
 *    to be honest at these tiny sample sizes (a half of 3 symmetric points
 *    has excess kurtosis -1.5, so it passes; anything visibly lumpy fails).
 *    If a half is non-normal, peel the single most extreme point (largest
 *    |z| — his "multimodal data, the peaks that don't belong"), re-test, and
 *    repeat at most twice per half. Peeled games are reported by index.
 *
 * 4. THE FACTOR. For each factor key present in the data, build the ONE
 *    condition that marks the higher-scoring side (the high side of the
 *    median split) and test it the standard way: a two-sample t-test
 *    between the scores of the games WHERE THE CONDITION HOLDS and the
 *    games where it does not (Welch's t, sample variances). Factor keys
 *    are ordinary pre-game conditions; three shapes are handled:
 *      - boolean:      the true group vs the false group; the condition
 *                      is the state whose games average higher, and the
 *                      upcoming game holds it (P = 1) or not (P = 0).
 *      - categorical:  the single value v whose presence or absence
 *                      separates the halves with the best two-sample t
 *                      (opponent=NE, month=December, venue=...); the
 *                      condition is the state whose games average
 *                      higher, v or its complement.
 *      - numeric:      values are split at the midpoint between the two
 *                      halves' factor-value means; the condition is
 *                      "value above the midpoint" when the above group
 *                      averages higher, "below" otherwise, and the test
 *                      compares the scores of the two groups.
 *    A factor is only ALLOWED to set P when its test clears the evidence
 *    floor |t| >= 2 (FACTOR_T_MIN). Every factor that clears the floor is
 *    reported in `factors`, ranked strongest (highest |t|) first, ties
 *    broken alphabetically. One factor at a time sets P — his doc: "you
 *    simply pick one of them (not multiple) and test that" — but the
 *    ranked list makes the set extensible: if the strongest factor's
 *    condition is UNKNOWN for the upcoming game, the next known factor's
 *    condition sets P; when no factor's condition is known, P = 0.5 and
 *    the projection falls to his even-split floor. The defined P values
 *    stay { 0, 1, 0.5 }: a P of 0.5 is defined as "the factor's state is
 *    not known for the upcoming game (or none applies)", which projects
 *    the balanced average of the two half means. It is never read as a
 *    side call; categorisation is done downstream against the cut C.
 *
 * 5. P for the upcoming game — the probability the HIGH side's factor
 *    condition holds in the upcoming game, from its known conditions:
 *      - boolean/categorical: the upcoming value matches the high side's
 *        condition -> P = 1; it does not -> P = 0; the condition is not
 *        known for the upcoming game -> P = 0.5.
 *      - numeric: let the midpoint be halfway between the halves' factor
 *        means. The upcoming value on the high half's side of the midpoint
 *        -> P = 1; on the low side -> P = 0; exactly at the midpoint or
 *        unknown -> P = 0.5.
 *    If the halves are the same population (step 6) or nothing separates
 *    them, P = 0.5 — his "even split ... as the floor": "half high half low
 *    = total projection".
 *
 * 6. SAMENESS. Welch's t-test implemented directly (t statistic +
 *    Welch-Satterthwaite degrees of freedom, sample variances). His doc:
 *    "you test them against one another for sameness; they shouldn't be the
 *    same. if they are, you project using the raw average of the two
 *    samples." We treat |t| < 2.1 as "same" (about the two-sided 95%
 *    critical value at these small degrees of freedom) so the projection is
 *    the raw average of all (post-peel) games and no factor is applied.
 *
 * 7. PROJECTION = highMean x P + lowMean x (1 - P), exactly his formula
 *    ("High scoring: high outlier group average x % probability of
 *    occurrence in upcoming game + normal group average x (1 - %)"), using
 *    the post-peel means. The 90% confidence interval combines the two
 *    halves' variances weighted by P and (1-P), plus the between-half term
 *    P(1-P)(highMean - lowMean)^2 — the variance of a two-component
 *    mixture. That between-half term is what lets the interval respect
 *    boom/bust, which is the entire point of the model; without it a P of
 *    0.5 across two very different halves would report an absurdly narrow
 *    interval. The multiplier is the normal 90% quantile (1.645); with
 *    halves this small that is anticonservative, which we state rather than
 *    hide.
 *
 * 8. BREAKPOINTS (regime leads). detectBreakpoints walks a player's
 *    career chronologically and flags every distinct contrast:
 *      - team change: the team field changes between consecutive games
 *        when the factors carry a team.
 *      - big swing: |score - previous score| >= 15 DK points.
 *      - level shift: the mean of the 5 games before an index differs
 *        from the mean of the 5 games from it onward by >= 6 DK points
 *        AND the two-sample t between the two windows clears |t| >= 2,
 *        with a cooldown so consecutive windows do not re-flag the
 *        same shift.
 *    Flags are leads, not firings — they are recorded with dates so a
 *    projection's regime can be defended game by game.
 */

/** One completed game. score = DraftKings fantasy points for that game;
 *  factors = objective conditions of that game (isHome, month, passAttempts...). */
export interface GameLog {
  date: string;
  score: number;
  factors: Record<string, boolean | number | string | undefined>;
}

export interface DaveProjection {
  /** highMean x P + lowMean x (1 - P), post-peel. */
  projection: number;
  low90: number;
  high90: number;
  highMean: number;
  lowMean: number;
  /** The factor key that won separation, or null (same halves / none found). */
  factor: string | null;
  /** Probability of the high side's factor condition in the upcoming game. */
  p: number;
  /** Original indices of games peeled as multimodal outliers. */
  peeled: number[];
  /** Welch's t said the two halves are one population -> raw-average path. */
  sameMeans: boolean;
  /** Post-peel verdict per half: true = passed the skew/kurtosis test. */
  normality: { high: boolean; low: boolean };
  /** How the factor that set P separates the halves (null when none). */
  factorDetail: {
    /** The condition that marks the HIGH side (numeric: the midpoint rule). */
    condition: string;
    highFraction: number;
    lowFraction: number;
  } | null;
  /**
   * Every factor whose two-sample t-test cleared the evidence floor,
   * strongest (highest |t|) first. Empty when the halves are one
   * population (the raw-average path) or nothing separates them. The
   * condition that set P is the first one whose state is known for the
   * upcoming game; when none is known P falls to his even-split floor.
   */
  factors: FactorApplication[];
}

/** The two-sample t-test behind one factor condition: the standard
 *  with/without comparison of game scores (Welch's t). */
export interface FactorTest {
  t: number;
  df: number;
  /** Games where the condition holds, with their score mean. */
  withN: number;
  withMean: number;
  /** Games where the condition does not hold, with their score mean. */
  withoutN: number;
  withoutMean: number;
}

/** One factor condition, its two-sample t-test, and how it evaluates a value. */
export interface FactorApplication {
  key: string;
  /** The condition that marks the higher-scoring side, readable. */
  condition: string;
  /**
   * Whether the condition holds for a candidate value: true / false, or
   * undefined when the value is missing or not comparable (unknown).
   */
  holds(value: boolean | number | string | undefined): boolean | undefined;
  test: FactorTest;
  /** Share of each half (of the post-peel games) where the condition holds. */
  highFraction: number;
  lowFraction: number;
  /** The evidence sentence for a report: condition, t, df, both groups. */
  detail: string;
}

/** |t| below this -> the halves are the same population (see module doc). */
const SAME_T = 2.1;

/**
 * Evidence floor for a factor: a condition may only set P when the
 * two-sample t-test of the games where it holds against the games where
 * it does not reaches |t| >= 2. Every applied factor's t and df are
 * reported with it, so a small-df t near 2 is visible as the weaker
 * evidence it is, not buried.
 */
const FACTOR_T_MIN = 2.0;
/** Normality thresholds: |skew| > 1 or |excess kurtosis| > 2 -> non-normal. */
const SKEW_LIMIT = 1;
const KURT_LIMIT = 2;
/** At most two peels per half ("repeat at most twice"). */
const MAX_PEELS = 2;
/** Normal 90% quantile for the interval. */
const Z90 = 1.6449;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample variance (n - 1 denominator). */
function sampleVariance(xs: number[]): number {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
}

/** Central-moment skewness and excess kurtosis, computed directly. */
function skewKurt(xs: number[]): { skew: number; kurt: number } {
  const m = mean(xs);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= xs.length;
  m3 /= xs.length;
  m4 /= xs.length;
  if (m2 === 0) return { skew: 0, kurt: 0 };
  return { skew: m3 / Math.pow(m2, 1.5), kurt: m4 / (m2 * m2) - 3 };
}

function isNormal(xs: number[]): boolean {
  const { skew, kurt } = skewKurt(xs);
  return Math.abs(skew) <= SKEW_LIMIT && Math.abs(kurt) <= KURT_LIMIT;
}

/** Welch's t statistic and Welch-Satterthwaite df, computed directly. */
export function welchT(a: number[], b: number[]): { t: number; df: number } {
  const nA = a.length;
  const nB = b.length;
  const mA = mean(a);
  const mB = mean(b);
  const vA = sampleVariance(a);
  const vB = sampleVariance(b);
  const se2 = vA / nA + vB / nB;
  if (se2 === 0) return { t: 0, df: Math.min(nA, nB) - 1 };
  const df =
    (se2 * se2) /
    ((vA / nA) * (vA / nA) / (nA - 1) + (vB / nB) * (vB / nB) / (nB - 1));
  return { t: (mA - mB) / Math.sqrt(se2), df };
}

interface Split {
  low: { game: GameLog; index: number }[];
  high: { game: GameLog; index: number }[];
}

/**
 * Median split. His doc: "this cut off can be decided any way you like".
 * Every game is classified — with an odd count the middle game joins the
 * LOW half (the floor side).
 */
function medianSplit(games: GameLog[]): Split {
  const sorted = games
    .map((game, index) => ({ game, index }))
    .sort((a, b) => a.game.score - b.game.score);
  const mid = Math.floor(sorted.length / 2);
  const lowEnd = sorted.length % 2 === 0 ? mid : mid + 1;
  return { low: sorted.slice(0, lowEnd), high: sorted.slice(lowEnd) };
}

/**
 * Peel the multimodal outlier (largest |z|) from a non-normal half, at most
 * MAX_PEELS times, never shrinking the half below 3 points (a 3-point
 * symmetric half is the smallest that can pass the normality test).
 */
function peelOutliers(
  entries: { game: GameLog; index: number }[],
): { kept: { game: GameLog; index: number }[]; peeled: number[] } {
  const kept = [...entries];
  const peeled: number[] = [];
  for (let pass = 0; pass < MAX_PEELS; pass++) {
    if (kept.length <= 3) break;
    if (isNormal(kept.map((e) => e.game.score))) break;
    const m = mean(kept.map((e) => e.game.score));
    const sd = Math.sqrt(sampleVariance(kept.map((e) => e.game.score)));
    let worst = 0;
    let worstZ = -1;
    kept.forEach((e, i) => {
      const z = sd === 0 ? 0 : Math.abs(e.game.score - m) / sd;
      if (z > worstZ) {
        worstZ = z;
        worst = i;
      }
    });
    peeled.push(kept[worst].index);
    kept.splice(worst, 1);
  }
  return { kept, peeled };
}

/**
 * Factor detection — the two-sample t-test machinery (see module doc 4).
 * Each candidate key yields ONE condition oriented to the higher-scoring
 * side, tested the standard way: the scores of the games where the
 * condition holds vs the scores of the games where it does not. Only
 * candidates clearing FACTOR_T_MIN are returned; |t| ties break
 * alphabetically for determinism.
 */

/** Scores of the entries whose factor value satisfies hold (undefined
 *  values never join a group — an unknown is unknown, not a group). */
function scoresFor(
  entries: { game: GameLog }[],
  key: string,
  hold: (v: boolean | number | string) => boolean,
): number[] {
  const out: number[] = [];
  for (const e of entries) {
    const v = e.game.factors[key];
    if (v === undefined) continue;
    if (hold(v)) out.push(e.game.score);
  }
  return out;
}

/** Fraction of entries where the condition holds (unknowns excluded from
 *  the denominator, like the scores above). */
function fractionHolding(
  entries: { game: GameLog }[],
  key: string,
  hold: (v: boolean | number | string) => boolean,
): number {
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

function buildApplication(
  key: string,
  condition: string,
  holds: (v: boolean | number | string | undefined) => boolean | undefined,
  withScores: number[],
  withoutScores: number[],
  highEntries: { game: GameLog }[],
  lowEntries: { game: GameLog }[],
): FactorApplication | null {
  if (withScores.length < 2 || withoutScores.length < 2) return null;
  const test = welchT(withScores, withoutScores);
  if (Math.abs(test.t) < FACTOR_T_MIN) return null;
  const highFraction = fractionHolding(highEntries, key, (v) => holds(v) === true);
  const lowFraction = fractionHolding(lowEntries, key, (v) => holds(v) === true);
  const detail =
    condition +
    " (two-sample t-test: t=" +
    test.t.toFixed(2) +
    ", df=" +
    test.df +
    "; scores average " +
    mean(withScores).toFixed(2) +
    " in n=" +
    withScores.length +
    " games when the condition holds vs " +
    mean(withoutScores).toFixed(2) +
    " in n=" +
    withoutScores.length +
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

/**
 * Detect the factor candidates for one player at one target game.
 *
 * Two shapes of condition, one candidate per key:
 *  - non-numeric keys: for every observed value v, test the state
 *    "key = v" against its complement; whichever of v / its complement
 *    averages the higher score becomes the condition (the complement
 *    candidate is "key != v"). The best value wins the key.
 *  - numeric keys: split at the midpoint between the halves' own means
 *    of the factor value; the condition is the side of the midpoint
 *    whose games score higher; the test compares the two groups' scores.
 */
function detectFactorCandidates(
  low: { game: GameLog; index: number }[],
  high: { game: GameLog; index: number }[],
): FactorApplication[] {
  const keys = new Set<string>();
  for (const e of [...low, ...high]) {
    for (const k of Object.keys(e.game.factors)) keys.add(k);
  }
  const entries = [...low, ...high];
  const out: FactorApplication[] = [];

  for (const key of Array.from(keys).sort()) {
    const known = entries.filter((e) => e.game.factors[key] !== undefined);
    if (known.length < 4) continue;

    const values = known.map((e) => e.game.factors[key]);
    if (values.every((v) => typeof v === "number")) {
      // Numeric: the midpoint rule.
      const highVals = high
        .map((e) => Number(e.game.factors[key]))

        .filter((v) => Number.isFinite(v));
      const lowVals = low
        .map((e) => Number(e.game.factors[key]))

        .filter((v) => Number.isFinite(v));
      if (highVals.length < 2 || lowVals.length < 2) continue;
      const mid = (mean(highVals) + mean(lowVals)) / 2;
      const aboveScores = scoresFor(entries, key, (v) => Number(v) > mid);
      const belowScores = scoresFor(entries, key, (v) => Number(v) < mid);
      if (aboveScores.length < 2 || belowScores.length < 2) continue;
      const aboveHigher = mean(aboveScores) >= mean(belowScores);
      const app = aboveHigher
        ? buildApplication(
            key,
            key + " > " + mid.toFixed(2),
            (v) => {
              if (v === undefined || typeof v !== "number" || !Number.isFinite(v)) return undefined;
              if (v === mid) return undefined; // exactly at the midpoint -> uncertain
              return v > mid;
            },
            aboveScores,
            belowScores,
            high,
            low,
          )
        : buildApplication(
            key,
            key + " < " + mid.toFixed(2),
            (v) => {
              if (v === undefined || typeof v !== "number" || !Number.isFinite(v)) return undefined;
              if (v === mid) return undefined;
              return v < mid;
            },
            belowScores,
            aboveScores,
            high,
            low,
          );
      if (app) out.push(app);
      continue;
    }

    // Non-numeric: best single value, oriented to the higher-scoring state.
    const distinctValues = Array.from(new Set(known.map((e) => String(e.game.factors[key])))).sort();
    let best: FactorApplication | null = null;
    for (const v of distinctValues) {
      const equalsScores = scoresFor(entries, key, (x) => String(x) === v);
      const notScores = scoresFor(entries, key, (x) => String(x) !== v);
      const equalsHigher = mean(equalsScores) >= mean(notScores);
      const app = equalsHigher
        ? buildApplication(
            key,
            key + "=" + v,
            (x) => (x === undefined ? undefined : String(x) === v),
            equalsScores,
            notScores,
            high,
            low,
          )
        : buildApplication(
            key,
            key + "!=" + v,
            (x) => (x === undefined ? undefined : String(x) !== v),
            notScores,
            equalsScores,
            high,
            low,
          );
      if (!app) continue;
      if (!best || Math.abs(app.test.t) > Math.abs(best.test.t)) best = app;
    }
    if (best) out.push(best);
  }

  out.sort((a, b) => Math.abs(b.test.t) - Math.abs(a.test.t) || a.key.localeCompare(b.key));
  return out;
}

/**
 * Project the next game from completed game logs, per the module doc.
 * upcoming = the objective conditions already known about the next game
 * (isHome, month, ...). Throws when there are fewer than 4 games — the
 * median split needs two halves of at least two.
 */
export function projectDave(
  games: GameLog[],
  upcoming: Record<string, boolean | number | string | undefined> = {},
): DaveProjection {
  if (games.length < 4) {
    throw new Error(
      "Dave's method needs at least 4 completed games to split into halves; got " +
        games.length +
        ".",
    );
  }
  const split = medianSplit(games);
  const lowPeeled = peelOutliers(split.low);
  const highPeeled = peelOutliers(split.high);
  const peeled = [...lowPeeled.peeled, ...highPeeled.peeled].sort(
    (a, b) => a - b,
  );

  const lowScores = lowPeeled.kept.map((e) => e.game.score);
  const highScores = highPeeled.kept.map((e) => e.game.score);
  const lowMean = mean(lowScores);
  const highMean = mean(highScores);
  const lowVar = sampleVariance(lowScores);
  const highVar = sampleVariance(highScores);

  const normality = {
    high: isNormal(highScores),
    low: isNormal(lowScores),
  };

  // Sameness: Welch's t-test, implemented directly (see module doc).
  const { t } = welchT(highScores, lowScores);
  const sameMeans = Math.abs(t) < SAME_T;

  const build = (p: number): DaveProjection => {
    // Within-half variances weighted by P and (1-P), plus the between-half
    // boom/bust term — the variance of a two-component mixture.
    const variance =
      p * p * highVar +
      (1 - p) * (1 - p) * lowVar +
      p * (1 - p) * Math.pow(highMean - lowMean, 2);
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
    };
  };

  if (sameMeans) {
    // His doc: "if they are, you project using the raw average of the two
    // samples." Raw average of all post-peel games; even-split floor.
    const raw = mean([...lowScores, ...highScores]);
    return { ...build(0.5), projection: raw, factor: null };
  }

  const candidates = detectFactorCandidates(lowPeeled.kept, highPeeled.kept);

  // Strongest factor first; the first whose condition is known for the
  // upcoming game sets P. When none is known, P falls to his even-split
  // floor: the balanced average of the two half means (a definitional
  // rule — see module doc 4). Categorisation happens downstream.
  const applied =
    candidates.find((f) => f.holds(upcoming[f.key]) !== undefined) ?? null;
  const p = applied ? (applied.holds(upcoming[applied.key]) ? 1 : 0) : 0.5;
  const shown = applied ?? candidates[0] ?? null;

  return {
    ...build(p),
    factor: shown ? shown.key : null,
    factorDetail: shown
      ? {
          condition: shown.condition,
          highFraction: shown.highFraction,
          lowFraction: shown.lowFraction,
        }
      : null,
    factors: candidates,
    p,
  };
}


// ---------------------------------------------------------------------------
// Breakpoints — regime leads (see module doc 8)
// ---------------------------------------------------------------------------

/** Named regime rules for detectBreakpoints (see module doc 8). */
export const BREAKPOINT_RULES = {
  /** A single-game move of at least this many DK points is a big swing. */
  swingPoints: 15,
  /** Games on each side of a suspected level shift. */
  window: 5,
  /** Smallest mean gap (DK points) between the two windows worth flagging. */
  meanGap: 6,
  /** Two-sample t floor for the level-shift check. */
  shiftT: 2.0,
  /** How many indices to skip after a flagged level shift (no re-flagging
   *  consecutive windows of one shift). */
  cooldown: 5,
} as const;

export interface Breakpoint {
  kind: "team change" | "big swing" | "level shift";
  /** Date of the first game in the new regime. */
  date: string;
  /** Date of the previous game, for context (null at the log's start). */
  priorDate: string | null;
  detail: string;
}

/**
 * Walk a player's career chronologically and flag every distinct contrast.
 * Flags are leads, not firings: a flagged breakpoint is a candidate factor
 * worth investigating, recorded with dates so a projection's regime can be
 * defended or corrected game by game.
 */
export function detectBreakpoints(games: GameLog[]): Breakpoint[] {
  const flags: Breakpoint[] = [];
  const rules = BREAKPOINT_RULES;
  let lastShiftIndex = -(rules.cooldown + 1);
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    if (i > 0) {
      const prev = games[i - 1];
      const prevTeam = prev.factors.team;
      const curTeam = game.factors.team;
      if (
        typeof prevTeam === "string" &&
        typeof curTeam === "string" &&
        prevTeam !== curTeam
      ) {
        flags.push({
          kind: "team change",
          date: game.date,
          priorDate: prev.date,
          detail:
            "team change: " +
            prevTeam +
            " to " +
            curTeam +
            " (first " +
            curTeam +
            " game on record " +
            game.date +
            ")",
        });
      }
      const swing = game.score - prev.score;
      if (Math.abs(swing) >= rules.swingPoints) {
        flags.push({
          kind: "big swing",
          date: game.date,
          priorDate: prev.date,
          detail:
            "score moved " +
            prev.score.toFixed(2) +
            " to " +
            game.score.toFixed(2) +
            " (" +
            (swing > 0 ? "+" : "") +
            swing.toFixed(2) +
            " DK points in one game)",
        });
      }
    }
    if (
      i >= rules.window &&
      i + rules.window <= games.length &&
      i - lastShiftIndex > rules.cooldown
    ) {
      const before = games
        .slice(i - rules.window, i)
        .map((g) => g.score);
      const after = games.slice(i, i + rules.window).map((g) => g.score);
      const gap = mean(after) - mean(before);
      const { t, df } = welchT(after, before);
      if (Math.abs(gap) >= rules.meanGap && Math.abs(t) >= rules.shiftT) {
        flags.push({
          kind: "level shift",
          date: game.date,
          priorDate: games[i - 1].date,
          detail:
            "5-game mean " +
            mean(before).toFixed(2) +
            " to " +
            mean(after).toFixed(2) +
            " (two-sample t-test: t=" +
            t.toFixed(2) +
            ", df=" +
            df +
            ")",
        });
        lastShiftIndex = i;
      }
    }
  }
  return flags;
}
