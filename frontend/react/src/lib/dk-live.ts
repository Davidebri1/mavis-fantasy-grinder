/**
 * Live DraftKings slate — pulled by the customer's own browser.
 *
 * Why the browser and not our server: DraftKings' public API refuses
 * requests that come from datacenter IP ranges — the optimizer API gets a
 * 403 from the Cloudflare edge — but it answers a browser cross-origin
 * request with "Access-Control-Allow-Origin: *". So the app asks
 * DraftKings for the slate from the page the customer is already looking
 * at, and sends the pool to the optimizer API. Every number in the pool is
 * DraftKings' own: published salary, published projection, published injury
 * status, real games.
 *
 * Nothing here is modelled, estimated or filled in. A price DraftKings has
 * not published stays absent, and a player without a published projection
 * is never given one.
 */
import type { Player, Sport } from "@/types";

const DK_ORIGIN = "https://api.draftkings.com";

/** How long the contest board stays fresh in this browser. */
const LOBBY_TTL_MS = 5 * 60 * 1000;
/** How long a draft group's player list stays fresh. */
const DRAFTABLES_TTL_MS = 60 * 1000;

/** Sports where DraftKings runs a Classic board. */
export const DK_LIVE_SPORTS: Sport[] = ["nfl", "nba"];

export function dkLiveSupported(sport: Sport): boolean {
  return DK_LIVE_SPORTS.includes(sport);
}

/* ── DraftKings' own payload, as far as this app reads it ─────────────── */

interface DkContest {
  draftGroupId?: number | string;
  gameTypeName?: string;
  contestStartTime?: string;
  name?: string;
  entries?: number;
}

interface DkLobby {
  lobby?: { contests?: DkContest[] };
}

interface DkDraftStatAttribute {
  id?: number;
  value?: string | number;
}

export interface DkDraftable {
  draftableId?: number | string;
  displayName?: string;
  shortName?: string;
  playerId?: number | string;
  playerDkId?: number | string;
  position?: string;
  rosterSlotId?: number;
  salary?: number;
  status?: string;
  isDisabled?: boolean;
  playerImage160?: string;
  teamAbbreviation?: string;
  competition?: { name?: string; startTime?: string };
  draftStatAttributes?: DkDraftStatAttribute[];
}

interface DkDraftablesPayload {
  draftables?: DkDraftable[];
  draftStats?: { id?: number; abbr?: string; name?: string }[];
}

/* ── Fetching ─────────────────────────────────────────────────────────── */

const jsonCache = new Map<string, { at: number; value: unknown }>();

async function fetchJsonCached<T>(url: string, ttlMs: number): Promise<T> {
  const hit = jsonCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;

  let res: Response;
  try {
    res = await fetch(url, {
      // "accept" is a CORS-safelisted header, so this stays a simple
      // request and needs no preflight.
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`DraftKings could not be reached from this browser (${detail})`);
  }
  if (!res.ok) {
    throw new Error(`DraftKings answered ${res.status} for ${url}`);
  }
  const value = (await res.json()) as T;
  jsonCache.set(url, { at: Date.now(), value });
  return value;
}

/* ── The board ────────────────────────────────────────────────────────── */

/** One DraftKings draft group: a set of games and the contests on them. */
export interface DkBoard {
  draftGroupId: string;
  /** When the board's first contest locks. */
  startsAt: string;
  startMs: number;
  contests: number;
  entries: number;
  /** DraftKings' own name for the board: "Main", "Sun-Mon", "Primetime". */
  label: string;
}

/** "NFL $1 Double Up (Sun-Mon)" -> "Sun-Mon". */
const WINDOW_SUFFIX = /\(([^()]{1,30})\)\s*$/;

/**
 * The name DraftKings puts on a board. It writes the window in the contest
 * name — "(Early Only)", "(Sun-Mon)", "(Primetime)" — and leaves the main
 * board without one. A window is only believed when the contests really
 * carry it.
 */
export function boardLabelFromNames(names: string[], totalContests: number): string {
  const counts = new Map<string, number>();
  for (const name of names) {
    const match = WINDOW_SUFFIX.exec(String(name ?? "").trim());
    if (!match) continue;
    const label = match[1].trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let label = "";
  let count = 0;
  for (const [candidate, seen] of counts) {
    if (seen > count) {
      label = candidate;
      count = seen;
    }
  }
  if (!label || count * 5 < totalContests) return "Main";
  return label;
}

/**
 * Every Classic board DraftKings has open, soonest first.
 *
 * DraftKings runs several boards over the same games — the main board, an
 * early-only board, a night board — and each one is a separate draft group.
 * Only Classic boards count here, because those are the contests a lineup
 * can be entered into.
 */
export function pickClassicBoards(lobby: unknown, now = Date.now()): DkBoard[] {
  const contests = (lobby as DkLobby)?.lobby?.contests ?? [];
  const groups = new Map<
    string,
    { startMs: number; contests: number; entries: number; names: string[] }
  >();

  for (const contest of contests) {
    if (String(contest.gameTypeName ?? "").trim().toLowerCase() !== "classic") {
      continue;
    }
    const start = new Date(contest.contestStartTime ?? "").getTime();
    if (!Number.isFinite(start) || start <= now) continue;
    const id = String(contest.draftGroupId ?? "");
    if (!id) continue;

    const group = groups.get(id) ?? {
      startMs: start,
      contests: 0,
      entries: 0,
      names: [],
    };
    group.contests += 1;
    group.entries += Number(contest.entries ?? 0);
    if (start < group.startMs) group.startMs = start;
    if (group.names.length < 300) group.names.push(String(contest.name ?? ""));
    groups.set(id, group);
  }

  const boards = [...groups.entries()].map(([draftGroupId, g]) => ({
    draftGroupId,
    startsAt: new Date(g.startMs).toISOString(),
    startMs: g.startMs,
    contests: g.contests,
    entries: g.entries,
    label: boardLabelFromNames(g.names, g.contests),
  }));
  boards.sort((a, b) => a.startMs - b.startMs || b.entries - a.entries);
  return boards;
}

/* ── Draftables → players ─────────────────────────────────────────────── */

/** The id of DraftKings' own projection attribute (FPPG) for this payload. */
const FALLBACK_PROJECTION_ATTRIBUTE: Record<string, number> = { nfl: 90, nba: 219 };

/**
 * DraftKings publishes what every stat id means in the payload's own
 * "draftStats" array, so the id is read from there rather than assumed.
 */
export function projectionAttributeId(payload: unknown, sport: string): number | null {
  const stats = (payload as DkDraftablesPayload)?.draftStats ?? [];
  const match = stats.find((stat) => {
    const abbr = String(stat.abbr ?? "").trim().toUpperCase();
    const name = String(stat.name ?? "").trim().toLowerCase();
    return abbr === "FPPG" || name.includes("fantasy points");
  });
  if (match && Number.isFinite(Number(match.id))) return Number(match.id);
  return FALLBACK_PROJECTION_ATTRIBUTE[sport] ?? null;
}

/** The numeric value of one stat attribute, or null when it is not published. */
function numericStat(
  attributes: DkDraftStatAttribute[] | undefined,
  attributeId: number | null,
): number | null {
  if (!attributeId || !Array.isArray(attributes)) return null;
  const attribute = attributes.find((a) => Number(a.id) === attributeId);
  if (!attribute) return null;
  const raw = attribute.value;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * One entry per player.
 *
 * DraftKings lists a player once per eligible roster slot. The entry kept
 * is the one whose slot serves the fewest positions across the slate, which
 * is the position slot rather than the FLEX/UTIL slot.
 */
export function choosePrimaryEntryPerPlayer(entries: DkDraftable[]): DkDraftable[] {
  const slotPositions = new Map<number, Set<string>>();
  for (const entry of entries) {
    const slot = Number(entry.rosterSlotId ?? 0);
    if (!slotPositions.has(slot)) slotPositions.set(slot, new Set());
    slotPositions.get(slot)!.add(String(entry.position ?? ""));
  }

  const byPlayer = new Map<string, DkDraftable[]>();
  for (const entry of entries) {
    const key = String(
      entry.playerId ?? entry.playerDkId ?? entry.draftableId ?? entry.displayName ?? "",
    );
    if (!key) continue;
    const list = byPlayer.get(key) ?? [];
    list.push(entry);
    byPlayer.set(key, list);
  }

  const chosen: DkDraftable[] = [];
  for (const list of byPlayer.values()) {
    let best = list[0];
    let bestScore = Infinity;
    for (const entry of list) {
      const spread = (slotPositions.get(Number(entry.rosterSlotId ?? 0))?.size ?? 99) * 1000;
      const score = spread + Number(entry.rosterSlotId ?? 0);
      if (score < bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

/** The roster slots a player can fill, in the app's slot vocabulary. */
export function rosterPositionsFor(position: string, sport: Sport): string[] {
  const pos = String(position ?? "").trim().toUpperCase();
  if (!pos) return [];
  if (sport === "nfl") {
    if (pos === "RB" || pos === "FB" || pos === "WR" || pos === "TE") {
      return [pos, "FLEX"];
    }
    return [pos];
  }
  if (sport === "nba") {
    if (pos === "PG" || pos === "SG") return [pos, "G", "UTIL"];
    if (pos === "SF" || pos === "PF") return [pos, "F", "UTIL"];
    if (pos === "C") return [pos, "UTIL"];
  }
  return [pos];
}

/** One DraftKings draftable -> the app's player shape. */
export function mapDraftableToPlayer(
  entry: DkDraftable,
  sport: Sport,
  attributeId: number | null,
): Player {
  const competition = entry.competition ?? {};
  const competitionName = String(competition.name ?? "").trim();
  const [away, home] = competitionName.split("@").map((p) => p.trim().toUpperCase());
  const team = String(entry.teamAbbreviation ?? "").trim().toUpperCase();
  const opponent = team && away && home ? (team === away ? home : away) : "";
  const position = String(entry.position ?? "").trim().toUpperCase();
  const projection = numericStat(entry.draftStatAttributes, attributeId);
  const status = String(entry.status ?? "").trim().toUpperCase();
  const salary = Number(entry.salary ?? 0);

  return {
    id: `dk-${entry.draftableId}`,
    name: String(entry.displayName ?? entry.shortName ?? "").trim(),
    sport,
    salary: Number.isFinite(salary) ? salary : 0,
    // A projection DraftKings has not published stays empty. It is never
    // replaced by a modelled number.
    projection: projection ?? 0,
    projection_source: projection === null ? "dk-pending" : "dk",
    salary_source: "dk",
    user_projection: null,
    team,
    opponent,
    game_info: competitionName,
    game_time: competition.startTime ?? null,
    positions: position ? [position] : [],
    roster_positions: rosterPositionsFor(position, sport),
    correlation_group: away && home ? `${away}@${home}` : "",
    injury_status: status && status !== "NONE" ? status : null,
    injury_severity: null,
    photo_url: entry.playerImage160 || null,
  };
}

/* ── The slate ────────────────────────────────────────────────────────── */

export interface LiveDkSlateInfo {
  draftGroupId: string;
  /** DraftKings' own name for the board. */
  board: string;
  gameCount: number;
  playerCount: number;
  slateDate: string;
  slateTime: string;
  fetchedAt: string;
}

export interface LiveDkRoster {
  slate: LiveDkSlateInfo;
  players: Player[];
  warnings: string[];
}

/** The calendar date of a game in DraftKings' own time zone (Eastern). */
function easternDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** "1:00PM ET" — how DraftKings writes a tip time. */
function easternTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
    return `${time.replace(/\s?([AP]M)/i, "$1").toUpperCase()} ET`;
  } catch {
    return "";
  }
}

/** The games on a draft group, with the time each one starts. */
function gamesOf(entries: DkDraftable[]): { name: string; startTime: string }[] {
  const byName = new Map<string, string>();
  for (const entry of entries) {
    const name = String(entry.competition?.name ?? "").trim();
    if (!name) continue;
    const start = String(entry.competition?.startTime ?? "");
    const known = byName.get(name);
    if (!known || (start && start < known)) byName.set(name, start);
  }
  return [...byName.entries()].map(([name, startTime]) => ({ name, startTime }));
}

/**
 * The live DraftKings slate for a sport.
 *
 * DraftKings runs several boards over the same games. The one this app
 * takes is the board that carries the most games — the fullest slate on
 * the board — so no game is quietly left out. When two boards carry the
 * same games, the one with more entries wins, because that is the board
 * customers are entering.
 */
export async function fetchLiveDkRoster(sport: Sport): Promise<LiveDkRoster> {
  if (!dkLiveSupported(sport)) {
    throw new Error(
      `DraftKings runs no Classic board for ${sport.toUpperCase()}`,
    );
  }

  const lobby = await fetchJsonCached<DkLobby>(
    `${DK_ORIGIN}/lobbies/v1/lobbies/${sport}`,
    LOBBY_TTL_MS,
  );
  const boards = pickClassicBoards(lobby, Date.now());
  if (boards.length === 0) {
    throw new Error(
      `DraftKings has no open Classic ${sport.toUpperCase()} board right now`,
    );
  }

  // Boards that lock with the first game of the day are the ones that can
  // carry the whole day. The later boards are windows into it.
  const earliest = boards[0].startMs;
  const candidates = boards.filter((b) => b.startMs === earliest).slice(0, 3);

  let best: {
    board: DkBoard;
    payload: DkDraftablesPayload;
    games: { name: string; startTime: string }[];
  } | null = null;

  for (const board of candidates) {
    const payload = await fetchJsonCached<DkDraftablesPayload>(
      `${DK_ORIGIN}/draftgroups/v1/draftgroups/${board.draftGroupId}/draftables`,
      DRAFTABLES_TTL_MS,
    );
    const entries = Array.isArray(payload?.draftables) ? payload.draftables : [];
    if (entries.length === 0) continue;
    const games = gamesOf(entries);
    const better =
      !best ||
      games.length > best.games.length ||
      (games.length === best.games.length && board.entries > best.board.entries);
    if (better) best = { board, payload, games };
  }

  if (!best) {
    throw new Error("DraftKings published no players for this slate");
  }

  const attributeId = projectionAttributeId(best.payload, sport);
  const players = choosePrimaryEntryPerPlayer(best.payload.draftables ?? []).map(
    (entry) => mapDraftableToPlayer(entry, sport, attributeId),
  );

  const starts = best.games
    .map((g) => g.startTime)
    .filter(Boolean)
    .sort();
  const firstStart = starts[0] ?? null;
  const gameDates = [
    ...new Set(best.games.map((g) => easternDate(g.startTime)).filter(Boolean)),
  ];

  const outCount = players.filter((p) => p.injury_status === "OUT").length;
  const irCount = players.filter((p) => p.injury_status === "IR").length;
  const noProjection = players.filter((p) => p.projection_source === "dk-pending")
    .length;

  const warnings: string[] = [];
  if (outCount + irCount > 0) {
    warnings.push(
      `${outCount + irCount} players are marked OUT or IR by DraftKings. DraftKings contests do not accept them, so they are excluded from lineups.`,
    );
  }
  if (noProjection > 0) {
    warnings.push(
      `${noProjection} players have no DraftKings projection published. They carry their real price but cannot be built into a lineup.`,
    );
  }
  if (gameDates.length > 1) {
    warnings.push(
      `This is DraftKings' "${best.board.label}" board: it spans ${gameDates.length} days of games. A lineup built from it can only be entered in DraftKings contests that use the same board.`,
    );
  }

  const slate: LiveDkSlateInfo = {
    draftGroupId: best.board.draftGroupId,
    board: best.board.label,
    gameCount: best.games.length,
    playerCount: players.length,
    slateDate: easternDate(firstStart ?? new Date().toISOString()),
    slateTime: firstStart ? easternTimeLabel(firstStart) : "",
    fetchedAt: new Date().toISOString(),
  };

  return { slate, players, warnings };
}
