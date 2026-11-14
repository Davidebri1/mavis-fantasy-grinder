/**
 * Smart Recommendations — calibrated field-distribution ROI & cash-rate model.
 *
 * Models each lineup's win and cash probabilities via standard normal tail
 * probabilities (z-score relative to the simulated contest field, entry fee,
 * max entries, and a top-heavy tournament payout curve) so different lineups
 * yield differentiated, realistic ROI estimates rather than flat/clamped numbers.
 */
import type { Lineup } from "@/types";

export type ContestType = "cash" | "gpp" | "single";

export interface ContestProfile {
  type: ContestType;
  entryFee: number;
  fieldSize: number;
  prizePool: number;
  bankroll: number;
}

export interface PickResult {
  lineup: Lineup;
  rank: number;
  score: number;
  estimatedRoi: number;
  /** Modelled chance this entry cashes, 0–1. */
  estimatedCashRate: number;
  reason: string;
}

const DK_TAKES: Record<ContestType, number> = {
  cash: 0.1,
  gpp: 0.15,
  single: 0.1,
};

const PAYING_SHARE_GPP = 0.15;
const PAYING_SHARE_CASH = 0.44;
const FIRST_PLACE_SHARE_GPP = 0.2;

/** Standard normal CDF via Abramowitz & Stegun 7.1.26 erf approximation. */
function normalCdf(z: number): number {
  const x = z / Math.SQRT2;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
function normalQuantile(p: number): number {
  const clamped = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (clamped < pLow) {
    const q = Math.sqrt(-2 * Math.log(clamped));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (clamped <= pHigh) {
    const q = clamped - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - clamped));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

function payingSpots(contest: ContestProfile): number {
  const share = contest.type === "cash" ? PAYING_SHARE_CASH : PAYING_SHARE_GPP;
  return Math.max(
    1,
    Math.min(contest.fieldSize, Math.round(contest.fieldSize * share)),
  );
}

function poolStats(allLineups: Lineup[], fallbackMean: number): { mean: number; std: number } {
  if (allLineups.length === 0) {
    return { mean: fallbackMean, std: Math.max(12, Math.abs(fallbackMean) * 0.12) };
  }
  const mean =
    allLineups.reduce((s, l) => s + l.total_projection, 0) / allLineups.length;
  const variance =
    allLineups.reduce((s, l) => s + (l.total_projection - mean) ** 2, 0) /
    allLineups.length;
  // Field-level contest standard deviation combines lineup spread with outcome variance
  const fieldSigma = Math.max(Math.sqrt(variance) * 1.5, Math.abs(mean) * 0.12, 10);
  return { mean, std: fieldSigma };
}

/**
 * Estimate expected value, cash probability, and ROI for a lineup in a contest
 * using a calibrated normal score distribution against the simulated field.
 */
export function estimateEntryValue(
  lineup: Lineup,
  contest: ContestProfile,
  allLineups: Lineup[],
  maxEntries: number = 1,
): { roi: number; cashRate: number; expectedPayout: number } {
  const entry = Math.max(contest.entryFee, 0.01);
  const field = Math.max(2, contest.fieldSize);
  const rake = DK_TAKES[contest.type];
  const grossPool = entry * field;
  const pool = contest.prizePool > 0 ? contest.prizePool : grossPool * (1 - rake);
  const spots = payingSpots(contest);

  const { mean, std } = poolStats(allLineups, lineup.total_projection);
  const zRaw = (lineup.total_projection - mean) / std;
  // Mild crowding dilution as user enters multiple correlated entries into same field
  const crowdingPenalty = Math.log10(Math.max(1, maxEntries)) * 0.03;
  const zEff = Math.max(-3.0, Math.min(3.0, zRaw - crowdingPenalty));

  const pCashBase = Math.min(0.95, Math.max(1 / field, spots / field));
  const zCashCut = normalQuantile(1 - pCashBase);
  const cashRate = Math.min(0.95, Math.max(0.002, normalCdf(zEff - zCashCut)));

  const pWinBase = Math.min(0.5, 1 / field);
  const zWinCut = normalQuantile(1 - pWinBase);
  const winRate = Math.min(cashRate * 0.5, Math.max(1e-6, normalCdf(zEff - zWinCut)));

  let expectedPayout: number;
  if (contest.type === "cash" || spots === 1) {
    const flatCashPrize = pool / spots;
    expectedPayout = cashRate * flatCashPrize;
  } else {
    // Top-heavy tournament payout curve calibrated so an average field entry recovers ~(1 - rake) * entry
    const topShare = Math.min(0.35, FIRST_PLACE_SHARE_GPP);
    const firstPrize = pool * topShare;
    const remainderPool = pool - firstPrize;
    const consolationPrize = remainderPool / Math.max(1, spots - 1);
    const minCashRate = Math.max(0, cashRate - winRate);
    expectedPayout = winRate * firstPrize + minCashRate * consolationPrize;
  }

  return {
    roi: (expectedPayout - entry) / entry,
    cashRate,
    expectedPayout,
  };
}

function scoreLineup(lineup: Lineup, contest: ContestProfile, allLineups: Lineup[]): number {
  if (contest.type === "cash" || contest.type === "single") {
    return lineup.total_projection;
  }
  const myPlayers = new Set(lineup.assignments.map((a) => a.player_id));
  let avgOverlap = 0;
  for (const other of allLineups) {
    if (other.unique_key === lineup.unique_key) continue;
    const otherPlayers = new Set(other.assignments.map((a) => a.player_id));
    let shared = 0;
    for (const p of myPlayers) if (otherPlayers.has(p)) shared += 1;
    avgOverlap += shared / Math.max(myPlayers.size, 1);
  }
  avgOverlap /= Math.max(allLineups.length - 1, 1);
  const diversity = 1 - avgOverlap / Math.max(myPlayers.size, 1);
  return lineup.total_projection * (1 + diversity);
}

export function recommendPicks(
  lineups: Lineup[],
  contest: ContestProfile,
  maxEntries: number = 20,
): PickResult[] {
  if (lineups.length === 0) return [];
  const affordableCount = Math.floor(contest.bankroll / Math.max(contest.entryFee, 1));
  const safeMax = Math.max(1, Math.min(maxEntries, lineups.length, affordableCount));

  const scored: PickResult[] = lineups.map((l, idx) => {
    const score = scoreLineup(l, contest, lineups);
    const value = estimateEntryValue(l, contest, lineups, safeMax);
    const reason =
      contest.type === "cash"
        ? "Highest projected floor — best for cash games"
        : contest.type === "single"
          ? "Best single-lineup projection"
          : `High projection × low overlap (${(score / Math.max(l.total_projection, 1)).toFixed(2)}× leverage)`;
    return {
      lineup: l,
      rank: idx,
      score,
      estimatedRoi: value.roi,
      estimatedCashRate: value.cashRate,
      reason,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, safeMax);
}

export function buildContestPresets(sport: "nba" | "nfl" | "mma" | "golf"): ContestProfile[] {
  if (sport === "nba") {
    return [
      { type: "gpp", entryFee: 3, fieldSize: 1000, prizePool: 2500, bankroll: 30 },
      { type: "gpp", entryFee: 20, fieldSize: 500, prizePool: 9000, bankroll: 100 },
      { type: "cash", entryFee: 5, fieldSize: 100, prizePool: 475, bankroll: 50 },
      { type: "single", entryFee: 5, fieldSize: 100, prizePool: 475, bankroll: 10 },
    ];
  }
  if (sport === "nfl") {
    return [
      { type: "gpp", entryFee: 5, fieldSize: 1000, prizePool: 5000, bankroll: 50 },
      { type: "gpp", entryFee: 20, fieldSize: 500, prizePool: 10000, bankroll: 100 },
      { type: "cash", entryFee: 10, fieldSize: 100, prizePool: 950, bankroll: 50 },
      { type: "single", entryFee: 10, fieldSize: 100, prizePool: 950, bankroll: 10 },
    ];
  }
  if (sport === "mma") {
    return [
      { type: "gpp", entryFee: 5, fieldSize: 500, prizePool: 2200, bankroll: 50 },
      { type: "cash", entryFee: 3, fieldSize: 50, prizePool: 140, bankroll: 30 },
      { type: "single", entryFee: 3, fieldSize: 50, prizePool: 140, bankroll: 10 },
    ];
  }
  return [
    { type: "gpp", entryFee: 5, fieldSize: 800, prizePool: 3500, bankroll: 50 },
    { type: "cash", entryFee: 3, fieldSize: 80, prizePool: 220, bankroll: 30 },
    { type: "single", entryFee: 3, fieldSize: 80, prizePool: 220, bankroll: 10 },
  ];
}
