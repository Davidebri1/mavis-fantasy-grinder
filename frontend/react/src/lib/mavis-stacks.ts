/**
 * Daily lineup stack candidate proposals (UI-only, no solver logic).
 *
 * Enforces sport roster-slot constraints on proposed stack cards: for NFL,
 * every stack card carries at most 1 QB; game stacks pair 1 QB + 1–2 WR/TE
 * on the primary side with a 0–1 bring-back RB/WR/TE from the opponent.
 */
import type { Player, Sport, StackRule } from "@/types";

export type StackSport = Sport;
export type StackKind = "team" | "game" | "card";
export type StackVariant = "team" | "game" | "card" | "bout";

export interface StackCandidate {
  id: string;
  kind: StackKind;
  variant: StackVariant;
  name: string;
  scopeId: string;
  scope: "team" | "game";
  players: Player[];
  salary: number;
  projection: number;
  value: number;
  rule: StackRule;
}

export interface GenerateStacksOptions {
  limit?: number;
  allowOpponents?: boolean;
}

const ROSTER_SIZE: Record<StackSport, number> = {
  nba: 8,
  nfl: 9,
  mma: 6,
  golf: 6,
};

const DEFAULT_LIMIT = 24;

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function byProjection(a: Player, b: Player): number {
  return (b.projection ?? 0) - (a.projection ?? 0);
}

function groupBy<T>(items: T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function salaryOf(players: Player[]): number {
  return players.reduce((sum, p) => sum + (p.salary ?? 0), 0);
}

function projectionOf(players: Player[]): number {
  return players.reduce((sum, p) => sum + (p.projection ?? 0), 0);
}

function primaryPos(p: Player): string {
  return (p.positions?.[0] ?? p.roster_positions?.[0] ?? "").toUpperCase();
}

function isQb(p: Player): boolean {
  const all = [...(p.positions ?? []), ...(p.roster_positions ?? [])].map((s) =>
    s.toUpperCase(),
  );
  return all.includes("QB");
}

function isDst(p: Player): boolean {
  const pos = primaryPos(p);
  return pos === "DST" || pos === "D" || pos === "DEF";
}

function isPassCatcher(p: Player): boolean {
  const pos = primaryPos(p);
  return pos === "WR" || pos === "TE";
}

function isBringBackSkill(p: Player): boolean {
  const pos = primaryPos(p);
  return pos === "RB" || pos === "WR" || pos === "TE";
}

function buildCandidate(params: {
  variant: StackVariant;
  name: string;
  scope: "team" | "game";
  scopeId: string;
  players: Player[];
  sport: StackSport;
}): StackCandidate {
  const players = [...params.players].sort(byProjection);
  const salary = salaryOf(players);
  const projection = round(projectionOf(players), 2);
  const value = salary > 0 ? round((projection / salary) * 100, 2) : 0;
  const id = `${params.variant}:${params.scopeId}:${players.map((p) => p.id).sort().join("-")}`;

  return {
    id,
    kind:
      params.variant === "team" ? "team" : params.variant === "game" ? "game" : "card",
    variant: params.variant,
    name: params.name,
    scopeId: params.scopeId,
    scope: params.scope,
    players,
    salary,
    projection,
    value,
    rule: {
      scope: params.scope,
      id: params.scopeId,
      min: players.length,
      max: ROSTER_SIZE[params.sport],
    },
  };
}

/**
 * NFL team stack selection respecting Classic 1-QB limit (never 2 QBs, never DST).
 */
function pickNflTeamStack(members: Player[], size: number): Player[] | null {
  const sorted = [...members].filter((p) => !isDst(p)).sort(byProjection);
  const qbs = sorted.filter(isQb);
  const passCatchers = sorted.filter(isPassCatcher);
  const skills = sorted.filter((p) => !isQb(p));

  const picks: Player[] = [];
  if (qbs.length > 0) {
    picks.push(qbs[0]);
  }
  for (const p of passCatchers) {
    if (picks.length >= size) break;
    picks.push(p);
  }
  for (const p of skills) {
    if (picks.length >= size) break;
    if (!picks.some((picked) => picked.id === p.id)) {
      picks.push(p);
    }
  }
  if (picks.length < size) return null;
  if (picks.filter(isQb).length > 1) return null;
  return picks;
}

function teamStacks(players: Player[], sport: StackSport): StackCandidate[] {
  const out: StackCandidate[] = [];
  for (const [team, members] of groupBy(players, (p) => p.team)) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(byProjection);
    for (const size of [2, 3]) {
      const picks =
        sport === "nfl"
          ? pickNflTeamStack(members, size)
          : sorted.length >= size
            ? sorted.slice(0, size)
            : null;
      if (!picks || picks.length < size) continue;
      out.push(
        buildCandidate({
          variant: "team",
          name: `${team} ${size}-man stack`,
          scope: "team",
          scopeId: team,
          players: picks,
          sport,
        }),
      );
    }
  }
  return out;
}

/**
 * NFL game stacks: 1 QB + 1–2 WR/TE on primary team + 0–1 bring-back RB/WR/TE
 * from opponent. Strictly caps QB count at 1 and excludes DST units.
 */
function buildNflGameVariants(sides: Player[][]): Player[][] {
  if (sides.length < 2) return [];
  const candidates: Array<{
    primary: Player[];
    opp: Player[];
    qbProj: number;
  }> = [];

  for (let i = 0; i < 2; i++) {
    const primary = sides[i];
    const opp = sides[1 - i];
    const qb = primary.find(isQb);
    if (qb) {
      candidates.push({ primary, opp, qbProj: qb.projection ?? 0 });
    }
  }

  // Fallback to skill-only cross-game pair if neither side has an eligible QB
  if (candidates.length === 0) {
    const sA = sides[0].filter((p) => !isQb(p) && !isDst(p));
    const sB = sides[1].filter((p) => !isQb(p) && !isDst(p));
    if (sA.length > 0 && sB.length > 0) {
      return [[sA[0], sB[0]]];
    }
    return [];
  }

  candidates.sort((a, b) => b.qbProj - a.qbProj);
  const { primary, opp } = candidates[0];
  const qb = primary.find(isQb)!;
  const primaryPass = primary.filter(isPassCatcher);
  const oppBringBack = opp.filter(isBringBackSkill);

  const variants: Player[][] = [];
  if (primaryPass.length >= 1) {
    // 1 QB + 1 WR/TE + 1 opponent bring-back RB/WR/TE (3-man game stack)
    if (oppBringBack.length >= 1) {
      variants.push([qb, primaryPass[0], oppBringBack[0]]);
    } else {
      variants.push([qb, primaryPass[0]]);
    }
  }
  if (primaryPass.length >= 2) {
    // 1 QB + 2 WR/TE + 1 opponent bring-back RB/WR/TE (4-man game stack)
    if (oppBringBack.length >= 1) {
      variants.push([qb, primaryPass[0], primaryPass[1], oppBringBack[0]]);
    } else {
      variants.push([qb, primaryPass[0], primaryPass[1]]);
    }
  }
  return variants.filter((v) => v.length >= 2 && v.filter(isQb).length <= 1);
}

function gameStacks(players: Player[], sport: StackSport): StackCandidate[] {
  const out: StackCandidate[] = [];
  for (const [gameKey, members] of groupBy(players, (p) => p.correlation_group)) {
    const sides = [...groupBy(members, (p) => p.team).values()]
      .filter((side) => side.length > 0)
      .map((side) => [...side].sort(byProjection))
      .sort((a, b) => (b[0]?.projection ?? 0) - (a[0]?.projection ?? 0));
    if (sides.length < 2) continue;

    let variants: Player[][];
    if (sport === "nfl") {
      variants = buildNflGameVariants(sides);
    } else {
      const [a, b] = sides;
      const core = [a[0], b[0]];
      const extras = [
        ...(a.length > 1 ? [a[1]] : []),
        ...(b.length > 1 ? [b[1]] : []),
      ].sort(byProjection);
      variants = [
        core,
        [...core, ...extras.slice(0, 1)],
        [...core, ...extras.slice(0, 2)],
      ];
    }

    for (const picks of variants) {
      if (picks.length < 2) continue;
      out.push(
        buildCandidate({
          variant: "game",
          name: `${gameKey} game stack`,
          scope: "game",
          scopeId: gameKey,
          players: picks,
          sport,
        }),
      );
    }
  }
  return out;
}

function pickCard(
  sorted: Player[],
  size: number,
  allowOpponents: boolean,
): Player[] {
  const picks: Player[] = [];
  const usedBouts = new Set<string>();
  for (const p of sorted) {
    if (picks.length >= size) break;
    const bout = p.bout ?? "";
    if (!allowOpponents && bout && usedBouts.has(bout)) continue;
    picks.push(p);
    if (bout) usedBouts.add(bout);
  }
  return picks;
}

function cardStacks(
  players: Player[],
  sport: StackSport,
  allowOpponents: boolean,
): StackCandidate[] {
  const out: StackCandidate[] = [];
  for (const [cardId, members] of groupBy(players, (p) => p.correlation_group)) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(byProjection);
    for (const size of [2, 3]) {
      if (sorted.length < size) continue;
      const picks = pickCard(sorted, size, allowOpponents);
      if (picks.length < size) continue;
      const eventName = sorted.find((p) => p.game_info)?.game_info;
      out.push(
        buildCandidate({
          variant: "card",
          name: eventName ? `${eventName} card stack` : `Card ${cardId} stack`,
          scope: "game",
          scopeId: cardId,
          players: picks,
          sport,
        }),
      );
    }
  }
  return out;
}

function boutStacks(players: Player[], sport: StackSport): StackCandidate[] {
  const out: StackCandidate[] = [];
  for (const [boutKey, fighters] of groupBy(players, (p) => p.bout)) {
    if (fighters.length !== 2) continue;
    const cardId = fighters.find((p) => p.correlation_group)?.correlation_group;
    if (!cardId) continue;
    out.push(
      buildCandidate({
        variant: "bout",
        name: boutKey,
        scope: "game",
        scopeId: cardId,
        players: fighters,
        sport,
      }),
    );
  }
  return out;
}

export function generateStacks(
  players: Player[],
  sport: StackSport,
  options: GenerateStacksOptions = {},
): StackCandidate[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const allowOpponents = options.allowOpponents ?? false;
  if (sport === "golf") return [];

  const eligible = players.filter((p) => p.sport === sport && !p.is_excluded);

  let candidates: StackCandidate[];
  if (sport === "mma") {
    candidates = [];
    if (allowOpponents) candidates = candidates.concat(boutStacks(eligible, sport));
    candidates = candidates.concat(cardStacks(eligible, sport, allowOpponents));
  } else {
    candidates = teamStacks(eligible, sport).concat(gameStacks(eligible, sport));
  }

  const seen = new Set<string>();
  const unique: StackCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.scope}:${candidate.scopeId}:${candidate.players
      .map((p) => p.id)
      .sort()
      .join("-")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  unique.sort(
    (a, b) =>
      b.projection - a.projection ||
      b.value - a.value ||
      a.name.localeCompare(b.name),
  );
  return unique.slice(0, Math.max(0, limit));
}
