/**
 * Dave's projection model - implemented as written in
 * "docs/DFS Projection Model.md" (the source of truth, verbatim).
 *
 * The method, in his words and ours:
 *
 * 1. Split a player's completed games into HIGH and LOW halves by score.
 *    "use all the games. so you're splitting your data into two halves.
 *    high and low, and getting two means". Every game is classified: with
 *    an odd count the middle game joins the LOW half, respecting the floor
 *    side he emphasises.
 *
 * 2. The means are the RAW half means: highMean over every high game,
 *    lowMean over every low game, "regardless of opponent".
 *
 * 3. SAMENESS - the only accept/reject in the whole model. Welch's
 *    two-sample t between the high scores and the low scores. |t| < 2.1
 *    means the halves are one population: "if they are, you project using
 *    the raw average of the two samples", and the call is "even".
 *
 * 4. MULTIMODALITY is a property, never a gate. "if they are non normal
 *    within one half or another, you separate out the multimodal data. the
 *    peaks that dont belong" - a hump, not a spike ("they must behave in
 *    normality in isolation", "not just one or two spikes"). The hump rule
 *    (detectHumps) finds the humps and the valley between them; the
 *    separated population is the hump with the smaller game mass, because
 *    the main body is the biggest hump. The other games in that half form
 *    the normal group.
 *
 * 5. THE FACTOR. "With the multimodal anomalies removed, you then
 *    investigate that data for a common thread. this belongs to a
 *    different population, statistically, so there is a factor." Every
 *    candidate condition is tested with a two-sample t-test and reported
 *    with its t, df and p-value. Nothing is accepted or rejected: the list
 *    is a ranking. The one factor that is used is the condition that
 *    covers the separated population (at least half of it), or - when
 *    nothing was separated - the condition with the strongest two-sample
 *    t. "you simply pick one of them (not multiple) and test that".
 *
 * 6. THE CALL is categorical, never a coefficient. His formula - "high
 *    Outlier group average x (% probability of occurrence in upcoming
 *    game) + normal outlier group average x (1 - % prob)" - uses a
 *    probability that is external and that he turns into a constant: "the
 *    probability was external, and I turn it into a cosntant, a given. by
 *    doing that, I dont inherit a variable, an unknown. I inheret a
 *    resolved constant." So the call names the CATEGORY: "high" /
 *    "high-outlier" / "high-normal" / "low" / "low-outlier" / "low-normal",
 *    or "even" when the factor's state is unknown - "by using the average
 *    category only when youre uncertain (no known outlier slope) ... using
 *    the even split between good and bad as the floor".
 *
 * 7. THE PROJECTION targets the CATEGORY mean, so a boom is reachable: a
 *    high-outlier call returns the outlier group's mean, which sits ABOVE
 *    the high half's mean (the upper limit), instead of equalling it. The
 *    even floor is "half high half low = total projection" over the two
 *    population means; the same-means path is the raw average of all games.
 *
 * 8. BREAKPOINTS (regime leads) - unchanged: detectBreakpoints walks a
 *    player's career and flags team changes, big swings and level shifts.
 */

/** One completed game. score = DraftKings fantasy points for that game;
 *  factors = objective conditions of that game (isHome, month, ...). */
export interface GameLog {
  date: string;
  score: number;
  factors: Record<string, boolean | number | string | undefined>;
}

/** The categories a player's games fall into. "boom" is never a category:
 *  a boom is a genuine outlier beyond the upper limit of the high half. */
export type DaveCategoryId =
  | "high"
  | "high-outlier"
  | "high-normal"
  | "low"
  | "low-outlier"
  | "low-normal";

/** The categorical outcome. Never a coefficient. */
export type DaveCall = DaveCategoryId | "even";

/** The shape of one half. A property, never a gate. */
export interface DaveShape {
  /** Raw kurtosis: 3 is normal, below 3 leans bimodal, above 3 leans lognormal. */
  kurtosis: number;
  /** Excess kurtosis (raw - 3). */
  excessKurtosis: number;
  /** Sample skewness. */
  skew: number;
  /** What the half is: one population, or multimodal (a hump was separated out). */
  verdict: "single population" | "multimodal";
  /** The valley thresholds detected in this half. */
  thresholds: number[];
}

/** One category of the player's games. */
export interface DaveCategory {
  id: DaveCategoryId;
  side: "high" | "low";
  kind: "population" | "outlier" | "normal";
  mean: number;
  n: number;
  /** Indices into the input games array. */
  indices: number[];
  /** Half-open score range [lo, hi); null = unbounded. */
  lo: number | null;
  /** Half-open score range [lo, hi); null = unbounded. */
  hi: number | null;
}

/** The two-sample t-test behind one factor condition (Welch's). */
export interface FactorTest {
  t: number;
  df: number;
  /** Two-sided p-value for the two-sample t-test. */
  p: number | null;
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
  /** The condition, readable. */
  condition: string;
  /**
   * Whether the condition holds for a candidate value: true / false, or
   * undefined when the value is missing or not comparable (unknown).
   */
  holds(value: boolean | number | string | undefined): boolean | undefined;
  test: FactorTest;
  /** The side this condition marks. */
  marks: "high" | "low" | null;
  /** The category this condition marks on that side. */
  marksCategory: DaveCategoryId | null;
  /** Share of the marked category's games where the condition holds. */
  coverage: number;
  /** Share of the held group games that lie in the marked category. */
  purity: number;
  /** The evidence sentence for a report. */
  detail: string;
}

export interface DaveProjection {
  /** The number to display. */
  projection: number;
  low90: number;
  high90: number;
  /** The HIGH half's mean over ALL its games (raw half mean = the upper limit). */
  highMean: number;
  /** The LOW half's mean over ALL its games (raw half mean). */
  lowMean: number;
  /** The high side's population mean (the normal group when separated, else the half). */
  highPopulationMean: number;
  /** The low side's population mean. */
  lowPopulationMean: number;
  /** The categorical outcome. Never a coefficient. */
  call: DaveCall;
  /** The factor key that was picked, or null. */
  factor: string | null;
  /** The factor's condition in words, or null. */
  factorCondition: string | null;
  /** Every candidate condition with its evidence, strongest first. */
  factors: FactorApplication[];
  /** Welch's t said the two halves are one population -> the raw-average path. */
  sameMeans: boolean;
  sameMeansTest: { t: number; df: number; p: number | null } | null;
  shape: { high: DaveShape; low: DaveShape };
  categories: DaveCategory[];
  /** Indices of the games in the separated (outlier) categories. */
  separated: number[];
  /** The largest score in the LOW half. */
  cut: number;
  /** Report extras: the sameness test behind the call. */
  halvesT: number;
  halvesDf: number;
  sameMeansT: number;
  sameMeansDf: number;
  sameMeansP: number | null;
  /** Report extras: how many games each half holds. */
  nHigh: number;
  nLow: number;
  /** Report extras: each half's spread. */
  highVar: number;
  lowVar: number;
}

/** |t| below this -> the halves are the same population (see module doc 3). */
export const SAME_T = 2.1;
/** Normality reference limits, kept for the report: |skew| > 1 or |excess kurtosis| > 2. */
export const SKEW_LIMIT = 1;
export const KURT_LIMIT = 2;
/** Normal 90% quantile for the interval. */
export const Z90 = 1.6449;
/**
 * Evidence floor for a factor when nothing was separated: a condition may
 * only set the call when the two-sample t-test of the games where it holds
 * against the games where it does not reaches |t| >= 2.
 */
export const FACTOR_T_MIN = 2.0;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample variance (n - 1 denominator). A single game has no spread. */
function sampleVariance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
}

/** Central-moment skewness and EXCESS kurtosis, computed directly. */
export function skewKurt(xs: number[]): { skew: number; kurt: number } {
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

/** Raw kurtosis and skewness - the shape report's numbers. */
function rawShape(xs: number[]): { skew: number; kurtosis: number; excessKurtosis: number } {
  const { skew, kurt } = skewKurt(xs);
  return { skew, kurtosis: kurt + 3, excessKurtosis: kurt };
}

/** Normality is a property, not a gate; this stays as a report helper. */
export function isNormal(xs: number[]): boolean {
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


// ---------------------------------------------------------------------------
// The two-sided p-value behind every t-test (Welch's), computed directly.
// ---------------------------------------------------------------------------

function logGamma(x: number): number {
  const g = 7;
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = C[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const EPS = 3e-14;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for Welch's t with df degrees of freedom. */
export function tPValue(t: number, df: number): number | null {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return null;
  const x = df / (df + t * t);
  return incompleteBeta(df / 2, 0.5, x);
}

// ---------------------------------------------------------------------------
// The hump rule - "the peaks that dont belong" (module doc 4).
// ---------------------------------------------------------------------------

export interface DaveHumps {
  /** Peak positions as score values. */
  peaks: number[];
  /** Valley thresholds as score values. */
  thresholds: number[];
}

/**
 * Detect the humps in one set of scores and the valley between them.
 *
 * 1-point bins, smoothed counts (0.25 / 0.5 / 0.25), a peak needs at least
 * two games in its bin and at least three games of mass around it, peaks
 * within two bins are merged, and a valley is accepted when its smoothed
 * count is at most half the smaller of the two peaks it sits between. The
 * threshold is the valley's centre. A single spike is not a hump: "they
 * must behave in normality in isolation", "not just one or two spikes".
 */
export function detectHumps(scores: number[]): DaveHumps {
  if (scores.length === 0) return { peaks: [], thresholds: [] };
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const width = 1;
  const nb = Math.max(1, Math.floor((max - min) / width) + 1);
  const counts = new Array<number>(nb).fill(0);
  for (const s of scores) {
    counts[Math.min(nb - 1, Math.max(0, Math.floor((s - min) / width)))]++;
  }
  const smooth = counts.map((_, i) => {
    const a = counts[i - 1] ?? counts[i];
    const b = counts[i];
    const c = counts[i + 1] ?? counts[i];
    return 0.25 * a + 0.5 * b + 0.25 * c;
  });
  let peaks: number[] = [];
  for (let i = 0; i < nb; i++) {
    if (counts[i] < 2) continue;
    const l = smooth[i - 1] ?? smooth[i];
    const r = smooth[i + 1] ?? smooth[i];
    if (smooth[i] >= l && smooth[i] > r) peaks.push(i);
  }
  peaks = peaks.filter(
    (p) => (counts[p - 1] ?? 0) + counts[p] + (counts[p + 1] ?? 0) >= 3,
  );
  const merged: number[] = [];
  for (const p of peaks) {
    const last = merged[merged.length - 1];
    if (last !== undefined && p - last <= 2) {
      if (counts[p] > counts[last]) merged[merged.length - 1] = p;
    } else merged.push(p);
  }
  peaks = merged;
  const thresholds: number[] = [];
  for (let i = 0; i + 1 < peaks.length; i++) {
    const a = peaks[i];
    const b = peaks[i + 1];
    let valley = a;
    for (let j = a + 1; j < b; j++) if (smooth[j] < smooth[valley]) valley = j;
    if (smooth[valley] > 0.5 * Math.min(smooth[a], smooth[b])) continue;
    thresholds.push(min + (valley + 0.5) * width);
  }
  return {
    peaks: peaks.map((p) => min + (p + 0.5) * width),
    thresholds,
  };
}

// ---------------------------------------------------------------------------
// The two populations
// ---------------------------------------------------------------------------

interface Entry {
  game: GameLog;
  index: number;
  score: number;
}

interface Split {
  low: Entry[];
  high: Entry[];
  /** The largest score in the LOW half. */
  cut: number;
}

/**
 * The split. "use all the games. so you're splitting your data into two
 * halves. high and low". With an odd count the middle game joins the LOW
 * half - the floor side he emphasises.
 *
 * The split is made value-consistent: when the cut score sits in both
 * halves, the games at that score all join the LOW half, so no score value
 * ever belongs to two halves. That is what lets the category ranges tile
 * the score space exactly once ("you now have categories now for every
 * possible outcome. nothing gets dropped as a miss").
 */
function splitHalves(games: GameLog[]): Split {
  const entries: Entry[] = games.map((game, index) => ({
    game,
    index,
    score: game.score,
  }));
  const sorted = [...entries].sort((a, b) => a.score - b.score || a.index - b.index);
  const lowEnd = Math.ceil(sorted.length / 2);
  let low = sorted.slice(0, lowEnd);
  let high = sorted.slice(lowEnd);
  const cut = low.length ? low[low.length - 1].score : NaN;
  if (high.length > 0 && high[0].score === cut) {
    const moved = high.filter((e) => e.score === cut);
    const kept = high.filter((e) => e.score !== cut);
    const newLow = [...low, ...moved];
    if (newLow.length >= 2 && kept.length >= 2) {
      low = newLow;
      high = kept;
    }
  }
  return { low, high, cut };
}

/** The cut C: the largest score in the LOW half of the engine's own split. */
export function cutOf(scores: number[]): number {
  const sorted = [...scores].sort((a, b) => a - b);
  const lowEnd = Math.ceil(sorted.length / 2);
  return sorted[lowEnd - 1];
}


// ---------------------------------------------------------------------------
// The shape of one half - and the separation of its multimodal data
// ---------------------------------------------------------------------------

interface SideAnalysis {
  side: "high" | "low";
  entries: Entry[];
  /** The raw half mean over every game in the half. */
  mean: number;
  variance: number;
  /** Every valley threshold detected in this half. */
  thresholds: number[];
  /** The threshold the categories were split on (null when one population). */
  splitThreshold: number | null;
  /** The separated population: "the peaks that dont belong". */
  separated: Entry[];
  /** Every other game in this half. */
  normal: Entry[];
  isMultimodal: boolean;
}

/** The region a score falls in, given the half's thresholds. */
function regionOf(score: number, thresholds: number[]): number {
  let c = 0;
  for (const t of thresholds) if (score >= t) c++;
  return c;
}

/**
 * Analyse one half and separate its multimodal data.
 *
 * "if they are non normal within one half or another, you separate out the
 * multimodal data. the peaks that dont belong. sort it out." A half with
 * one hump, or with no valley, stays ONE population - skew and one-off
 * spikes are natural and normal. When the two sides of a valley carry the
 * same number of games, the hump better covered by the strongest factor
 * condition wins; failing that, the outer hump (the upper one on the high
 * side, the lower one on the low side).
 */
function analyseSide(
  side: "high" | "low",
  entries: Entry[],
  tieHeld: Set<number> | null,
): SideAnalysis {
  const scores = entries.map((e) => e.score);
  const humps = detectHumps(scores);
  const base: SideAnalysis = {
    side,
    entries,
    mean: mean(scores),
    variance: sampleVariance(scores),
    thresholds: humps.thresholds,
    splitThreshold: null,
    separated: [],
    normal: [...entries],
    isMultimodal: false,
  };
  if (humps.thresholds.length === 0) return base;

  const coverageOf = (group: Entry[]): number => {
    if (!tieHeld) return 0;
    const held = group.filter((e) => tieHeld.has(e.index)).length;
    return group.length ? held / group.length : 0;
  };

  let best: { t: number; minority: Entry[]; size: number; outer: number } | null = null;
  for (const t of humps.thresholds) {
    const below = entries.filter((e) => e.score < t);
    const above = entries.filter((e) => e.score >= t);
    if (below.length === 0 || above.length === 0) continue;
    let minority: Entry[];
    if (below.length < above.length) minority = below;
    else if (above.length < below.length) minority = above;
    else {
      const covBelow = coverageOf(below);
      const covAbove = coverageOf(above);
      if (covBelow !== covAbove) minority = covBelow > covAbove ? below : above;
      else minority = side === "high" ? above : below;
    }
    if (minority.length < 2) continue;
    const minorityMean = mean(minority.map((e) => e.score));
    const outer = side === "high" ? minorityMean : -minorityMean;
    if (
      !best ||
      minority.length < best.size ||
      (minority.length === best.size && outer > best.outer)
    ) {
      best = { t, minority, size: minority.length, outer };
    }
  }
  if (!best) return base;
  const separated = best.minority;
  const normal = entries.filter((e) => !separated.includes(e));
  if (normal.length === 0) return base;
  return {
    ...base,
    splitThreshold: best.t,
    separated,
    normal,
    isMultimodal: true,
  };
}

// ---------------------------------------------------------------------------
// The categories
// ---------------------------------------------------------------------------

interface BuiltCategories {
  categories: DaveCategory[];
  /** The high side's population category ("high" or "high-normal"). */
  highPopulation: DaveCategory;
  /** The low side's population category ("low" or "low-normal"). */
  lowPopulation: DaveCategory;
  highOutlier: DaveCategory | null;
  lowOutlier: DaveCategory | null;
  /** The score boundary between the low and high halves. */
  boundary: number;
}

/**
 * Build the categories. Every game lands in exactly one category and the
 * category ranges tile the score space exactly once, so an actual outcome
 * always has a category: "you now have categories now for every possible
 * outcome. nothing gets dropped as a miss".
 */
function buildCategories(
  high: SideAnalysis,
  low: SideAnalysis,
): BuiltCategories {
  const lowMax = Math.max(...low.entries.map((e) => e.score));
  const highMin = Math.min(...high.entries.map((e) => e.score));
  const boundary = highMin > lowMax ? (lowMax + highMin) / 2 : lowMax;
  const categories: DaveCategory[] = [];

  const push = (
    id: DaveCategoryId,
    side: "high" | "low",
    kind: "population" | "outlier" | "normal",
    group: Entry[],
    lo: number | null,
    hi: number | null,
  ): DaveCategory => {
    const cat: DaveCategory = {
      id,
      side,
      kind,
      mean: mean(group.map((e) => e.score)),
      n: group.length,
      indices: group.map((e) => e.index),
      lo,
      hi,
    };
    categories.push(cat);
    return cat;
  };

  let highPopulation: DaveCategory;
  let lowPopulation: DaveCategory;
  let highOutlier: DaveCategory | null = null;
  let lowOutlier: DaveCategory | null = null;

  if (!low.isMultimodal) {
    lowPopulation = push("low", "low", "population", low.entries, null, boundary);
  } else {
    const t = low.splitThreshold as number;
    const below = low.entries.filter((e) => e.score < t);
    const above = low.entries.filter((e) => e.score >= t);
    const sepIsBelow = low.separated === below || low.separated.every((e) => e.score < t);
    lowOutlier = push(
      "low-outlier",
      "low",
      "outlier",
      low.separated,
      sepIsBelow ? null : t,
      sepIsBelow ? t : boundary,
    );
    lowPopulation = push(
      "low-normal",
      "low",
      "normal",
      low.normal,
      sepIsBelow ? t : null,
      sepIsBelow ? boundary : t,
    );
  }

  if (!high.isMultimodal) {
    highPopulation = push("high", "high", "population", high.entries, boundary, null);
  } else {
    const t = high.splitThreshold as number;
    const below = high.entries.filter((e) => e.score < t);
    const sepIsBelow = high.separated === below || high.separated.every((e) => e.score < t);
    highOutlier = push(
      "high-outlier",
      "high",
      "outlier",
      high.separated,
      sepIsBelow ? boundary : t,
      sepIsBelow ? t : null,
    );
    highPopulation = push(
      "high-normal",
      "high",
      "normal",
      high.normal,
      sepIsBelow ? t : boundary,
      sepIsBelow ? null : t,
    );
  }

  categories.sort((a, b) => (a.lo === null ? -Infinity : a.lo) - (b.lo === null ? -Infinity : b.lo));
  return { categories, highPopulation, lowPopulation, highOutlier, lowOutlier, boundary };
}


// ---------------------------------------------------------------------------
// The factor - "the common thread"
// ---------------------------------------------------------------------------

interface RawCandidate {
  key: string;
  condition: string;
  holds(value: boolean | number | string | undefined): boolean | undefined;
  /** The games where the condition holds. */
  held: Entry[];
  /** The games where it does not hold. Unknown values join neither group. */
  without: Entry[];
  test: FactorTest;
}

interface MarkedCandidate extends RawCandidate {
  marks: "high" | "low";
  marksCategory: DaveCategoryId;
  coverage: number;
  purity: number;
  /** Share of the separated population this condition covers. */
  sepCoverage: number;
  detail: string;
}

/**
 * Every candidate condition, one per partition of the data.
 *
 * "With the multimodal anomalies removed, you then investigate that data
 * for a common thread." A candidate is a way of splitting the games:
 *   - boolean / categorical: key = v (and its complement key != v), one
 *     condition per value, oriented to the side whose games score higher;
 *   - numeric: key > mid / key < mid, where mid is the midpoint between
 *     the two halves' means of that key's values.
 *
 * Nothing is accepted or rejected here: every candidate is reported with
 * its t, df, p-value, group sizes, coverage and purity.
 */
function buildRawCandidates(low: Entry[], high: Entry[]): RawCandidate[] {
  const entries = [...low, ...high];
  const keys = new Set<string>();
  for (const e of entries) for (const k of Object.keys(e.game.factors)) keys.add(k);
  const out: RawCandidate[] = [];
  const seen = new Set<string>();

  const add = (
    key: string,
    condition: string,
    holds: (v: boolean | number | string | undefined) => boolean | undefined,
    held: Entry[],
    without: Entry[],
  ): void => {
    if (held.length < 2 || without.length < 2) return;
    const signature = key + "|" + held.map((e) => e.index).join(",");
    if (seen.has(signature)) return;
    seen.add(signature);
    const test = welchT(
      held.map((e) => e.score),
      without.map((e) => e.score),
    );
    out.push({
      key,
      condition,
      holds,
      held,
      without,
      test: {
        t: test.t,
        df: test.df,
        p: tPValue(test.t, test.df),
        withN: held.length,
        withMean: mean(held.map((e) => e.score)),
        withoutN: without.length,
        withoutMean: mean(without.map((e) => e.score)),
      },
    });
  };

  for (const key of Array.from(keys).sort()) {
    const known = entries.filter((e) => e.game.factors[key] !== undefined);
    if (known.length < 4) continue;
    const values = known.map((e) => e.game.factors[key]);
    if (values.every((v) => typeof v === "number")) {
      const highVals = high
        .map((e) => Number(e.game.factors[key]))
        .filter((v) => Number.isFinite(v));
      const lowVals = low
        .map((e) => Number(e.game.factors[key]))
        .filter((v) => Number.isFinite(v));
      if (highVals.length < 2 || lowVals.length < 2) continue;
      const mid = (mean(highVals) + mean(lowVals)) / 2;
      const above = known.filter((e) => Number(e.game.factors[key]) > mid);
      const below = known.filter((e) => Number(e.game.factors[key]) < mid);
      if (above.length < 2 || below.length < 2) continue;
      const aboveHigher = mean(above.map((e) => e.score)) >= mean(below.map((e) => e.score));
      const holds = aboveHigher
        ? (v: boolean | number | string | undefined) =>
            v === undefined || typeof v !== "number" || !Number.isFinite(v)
              ? undefined
              : v === mid
                ? undefined
                : v > mid
        : (v: boolean | number | string | undefined) =>
            v === undefined || typeof v !== "number" || !Number.isFinite(v)
              ? undefined
              : v === mid
                ? undefined
                : v < mid;
      add(
        key,
        aboveHigher ? key + " > " + mid.toFixed(2) : key + " < " + mid.toFixed(2),
        holds,
        aboveHigher ? above : below,
        aboveHigher ? below : above,
      );
      continue;
    }

    const distinct = Array.from(new Set(known.map((e) => String(e.game.factors[key])))).sort();
    for (const v of distinct) {
      const equals = known.filter((e) => String(e.game.factors[key]) === v);
      const notEquals = known.filter((e) => String(e.game.factors[key]) !== v);
      if (equals.length < 2 || notEquals.length < 2) continue;
      const equalsHigher = mean(equals.map((e) => e.score)) >= mean(notEquals.map((e) => e.score));
      // The condition names the state the held games are in: "key=v" when
      // they are v's games, "key!=v" when they are the rest - except on a
      // two-state key, where the rest IS the other state and is named
      // directly ("isHome=true", never "isHome!=false").
      const other = distinct.length === 2 ? distinct.find((x) => x !== v) : undefined;
      const condition = equalsHigher
        ? key + "=" + v
        : other !== undefined
          ? key + "=" + other
          : key + "!=" + v;
      const holds = equalsHigher
        ? (x: boolean | number | string | undefined) =>
            x === undefined ? undefined : String(x) === v
        : other !== undefined
          ? (x: boolean | number | string | undefined) =>
              x === undefined ? undefined : String(x) === other
          : (x: boolean | number | string | undefined) =>
              x === undefined ? undefined : String(x) !== v;
      add(
        key,
        condition,
        holds,
        equalsHigher ? equals : notEquals,
        equalsHigher ? notEquals : equals,
      );
    }
  }
  return out;
}

/** Rank the candidates by the strength of the two-sample t-test. */
function rankCandidates(candidates: RawCandidate[]): RawCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      Math.abs(b.test.t) - Math.abs(a.test.t) ||
      a.key.localeCompare(b.key) ||
      a.condition.localeCompare(b.condition),
  );
}

/**
 * Say what each candidate marks. A condition that covers at least half of
 * a separated population marks that population - "this belongs to a
 * different population, statistically, so there is a factor". Otherwise it
 * marks the side its held group comes from.
 */
function markCandidates(
  candidates: RawCandidate[],
  cats: BuiltCategories,
  high: SideAnalysis,
  low: SideAnalysis,
): MarkedCandidate[] {
  const catById = new Map(cats.categories.map((c) => [c.id, c]));
  return candidates.map((c) => {
    const heldIds = new Set(c.held.map((e) => e.index));
    const heldHigh = c.held.filter((e) => high.entries.includes(e)).length;
    const heldLow = c.held.filter((e) => low.entries.includes(e)).length;
    const majoritySide: "high" | "low" =
      heldHigh > heldLow ? "high" : heldLow > heldHigh ? "low" : high.mean >= low.mean ? "high" : "low";

    const covOf = (cat: DaveCategory | null): number => {
      if (!cat) return 0;
      const inside = c.held.filter((e) => cat.indices.includes(e.index)).length;
      return cat.n ? inside / cat.n : 0;
    };
    const covHigh = covOf(cats.highOutlier);
    const covLow = covOf(cats.lowOutlier);
    const sepCoverage = Math.max(covHigh, covLow);
    const sepSide: "high" | "low" | null =
      sepCoverage <= 0 ? null : covHigh >= covLow ? "high" : "low";

    const marks: "high" | "low" = sepSide ?? majoritySide;
    const marksCategory: DaveCategoryId =
      sepSide !== null
        ? sepSide === "high"
          ? "high-outlier"
          : "low-outlier"
        : marks === "high"
          ? cats.highPopulation.id
          : cats.lowPopulation.id;
    const marked = catById.get(marksCategory) ?? null;
    const inside = marked ? c.held.filter((e) => marked.indices.includes(e.index)).length : 0;
    const coverage = marked && marked.n ? inside / marked.n : 0;
    const purity = c.held.length ? inside / c.held.length : 0;
    const pText = c.test.p === null ? "n/a" : c.test.p.toFixed(4);
    const detail =
      c.condition +
      " (two-sample t-test: t=" +
      c.test.t.toFixed(2) +
      ", df=" +
      c.test.df.toFixed(2) +
      "; p=" +
      pText +
      "; scores average " +
      c.test.withMean.toFixed(2) +
      " in n=" +
      c.test.withN +
      " games when the condition holds vs " +
      c.test.withoutMean.toFixed(2) +
      " in n=" +
      c.test.withoutN +
      " games when it does not)";
    return { ...c, marks, marksCategory, coverage, purity, sepCoverage, detail };
  });
}


// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

/**
 * Project the next game from completed game logs, as written in Dave's
 * document. upcoming = the objective conditions already known about the
 * next game (isHome, month, opponent, ...). Throws when there are fewer
 * than 4 games - the split needs two halves of at least two.
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

  // 1 + 2. The two populations and their raw half means.
  const split = splitHalves(games);
  const lowScores = split.low.map((e) => e.score);
  const highScores = split.high.map((e) => e.score);
  const lowMean = mean(lowScores);
  const highMean = mean(highScores);

  // 3. SAMENESS - the only accept/reject in the model.
  const halves = welchT(highScores, lowScores);
  const sameMeans = Math.abs(halves.t) < SAME_T;
  const sameMeansTest = {
    t: halves.t,
    df: halves.df,
    p: tPValue(halves.t, halves.df),
  };

  // 4 + 5. The candidates come first (they need only the two halves); the
  // separation uses the strongest candidate to break a mass tie; then the
  // candidates learn what they mark.
  const raw = buildRawCandidates(split.low, split.high);
  const rankedRaw = rankCandidates(raw);
  const tieHeld = new Set<number>(
    rankedRaw.length ? rankedRaw[0].held.map((e) => e.index) : [],
  );
  const highSide = analyseSide("high", split.high, tieHeld);
  const lowSide = analyseSide("low", split.low, tieHeld);
  const cats = buildCategories(highSide, lowSide);
  const marked = markCandidates(rankedRaw, cats, highSide, lowSide);

  // The one factor that is used: the thread through the separated
  // population when there is one, otherwise the strongest separation.
  let selected: MarkedCandidate | null = null;
  if (cats.highOutlier || cats.lowOutlier) {
    const eligible = marked
      .filter((c) => c.sepCoverage >= 0.5)
      .sort(
        (a, b) =>
          b.sepCoverage - a.sepCoverage ||
          Math.abs(b.test.t) - Math.abs(a.test.t) ||
          a.key.localeCompare(b.key) ||
          a.condition.localeCompare(b.condition),
      );
    selected = eligible.length ? eligible[0] : null;
  } else {
    const eligible = marked
      .filter((c) => Math.abs(c.test.t) >= FACTOR_T_MIN)
      .sort(
        (a, b) =>
          Math.abs(b.test.t) - Math.abs(a.test.t) ||
          a.key.localeCompare(b.key) ||
          a.condition.localeCompare(b.condition),
      );
    selected = eligible.length ? eligible[0] : null;
  }

  // 6. The call - a category, never a coefficient.
  const catById = new Map(cats.categories.map((c) => [c.id, c]));
  let call: DaveCall = "even";
  let selectedCategory: DaveCategory | null = null;
  if (!sameMeans && selected) {
    const state = selected.holds(upcoming[selected.key]);
    if (state === true) {
      selectedCategory = catById.get(selected.marksCategory) ?? null;
    } else if (state === false) {
      selectedCategory =
        selected.marks === "high" ? cats.lowPopulation : cats.highPopulation;
    }
    if (selectedCategory) call = selectedCategory.id;
  }

  // 7. The projection targets the CATEGORY mean.
  const highPopulationMean = cats.highPopulation.mean;
  const lowPopulationMean = cats.lowPopulation.mean;
  const allScores = [...lowScores, ...highScores];
  let projection: number;
  let variance: number;
  if (sameMeans) {
    // "if they are, you project using the raw average of the two samples"
    projection = mean(allScores);
    variance = sampleVariance(allScores);
  } else if (selectedCategory) {
    projection = selectedCategory.mean;
    variance = sampleVariance(
      selectedCategory.indices.map((i) => games[i].score),
    );
  } else {
    // "half high half low = total projection" over the population means.
    projection = (highPopulationMean + lowPopulationMean) / 2;
    const varHigh = sampleVariance(
      cats.highPopulation.indices.map((i) => games[i].score),
    );
    const varLow = sampleVariance(
      cats.lowPopulation.indices.map((i) => games[i].score),
    );
    variance =
      0.25 * varHigh +
      0.25 * varLow +
      0.25 * Math.pow(highPopulationMean - lowPopulationMean, 2);
  }
  const halfWidth = Z90 * Math.sqrt(variance);

  // The shape of each half: a property, never a gate.
  const shape = {
    high: {
      ...rawShape(highScores),
      verdict: (highSide.isMultimodal ? "multimodal" : "single population") as
        | "single population"
        | "multimodal",
      thresholds: highSide.thresholds,
    },
    low: {
      ...rawShape(lowScores),
      verdict: (lowSide.isMultimodal ? "multimodal" : "single population") as
        | "single population"
        | "multimodal",
      thresholds: lowSide.thresholds,
    },
  };

  const separated = [...highSide.separated, ...lowSide.separated]
    .map((e) => e.index)
    .sort((a, b) => a - b);

  return {
    projection,
    low90: projection - halfWidth,
    high90: projection + halfWidth,
    highMean,
    lowMean,
    highPopulationMean,
    lowPopulationMean,
    call,
    factor: selected && !sameMeans ? selected.key : null,
    factorCondition: selected && !sameMeans ? selected.condition : null,
    factors: marked,
    sameMeans,
    sameMeansTest,
    shape,
    categories: cats.categories,
    separated,
    cut: split.cut,
    halvesT: halves.t,
    halvesDf: halves.df,
    sameMeansT: halves.t,
    sameMeansDf: halves.df,
    sameMeansP: sameMeansTest.p,
    nHigh: highScores.length,
    nLow: lowScores.length,
    highVar: sampleVariance(highScores),
    lowVar: sampleVariance(lowScores),
  };
}


// ---------------------------------------------------------------------------
// Breakpoints - regime leads (unchanged)
// ---------------------------------------------------------------------------

/** Named regime rules for detectBreakpoints. */
export const BREAKPOINT_RULES = {
  /** A single-game move of at least this many DK points is a big swing. */
  swingPoints: 15,
  /** Games on each side of a suspected level shift. */
  window: 5,
  /** Smallest mean gap (DK points) between the two windows worth flagging. */
  meanGap: 6,
  /** Two-sample t floor for the level-shift check. */
  shiftT: 2.0,
  /** How many indices to skip after a flagged level shift. */
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
