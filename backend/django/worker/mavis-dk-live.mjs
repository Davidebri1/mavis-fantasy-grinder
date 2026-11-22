/**
 * Mavis Outlier — live DraftKings slate for the edge API.
 *
 * The Worker's job is to hand the app the slate DraftKings is actually
 * selling right now: real published salaries, DraftKings' own projections,
 * real games, real injury status. Nothing in this module is modelled.
 *
 * How the live slate is found:
 *   1. GET /lobbies/v1/lobbies/{sport}          -> the contests on the board
 *   2. keep the Classic contests, group them by draft group, and take the
 *      group that starts soonest (that is the one carrying the whole slate;
 *      the most contests wins a tie)
 *   3. GET /draftgroups/v1/draftgroups/{id}/draftables
 *      -> players, prices, games, injury status and DraftKings' own stats
 *
 * Two DraftKings quirks this module handles, both observed on the live
 * payload rather than assumed:
 *
 *   - A classic slate lists every RB/WR/TE twice: once at their position
 *     slot and once at the FLEX slot. Both carry the SAME price and the
 *     SAME stats, so the duplicate is dropped instead of rostered twice.
 *     The entry kept is the one whose slot is used by the fewest positions
 *     (the position slot), which is also the entry that carries a flex
 *     premium when DraftKings charges one.
 *
 *   - The projection attribute id differs by sport (NFL 90, NBA 219).
 *     DraftKings publishes what every id means in the payload's own
 *     "draftStats" array, so the id is read from there instead of guessed.
 *
 * If DraftKings cannot be reached, the caller falls back to the bundled
 * sample and labels it as a sample. This module never returns a sample.
 */

/** The browser identity DraftKings' public endpoints answer to. */
const DK_HEADERS = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  referer: "https://www.draftkings.com/",
};

const DK_ORIGIN = "https://api.draftkings.com";

/** How long a lobby / draftables response stays in the Worker cache. */
const LOBBY_TTL_SECONDS = 300;
const DRAFTABLES_TTL_SECONDS = 120;

/** Sports where DraftKings publishes a Classic contest slate. */
const DK_LIVE_SPORTS = new Set(["nfl", "nba"]);

/** Fallback projection attribute ids, used only if "draftStats" is absent. */
const FALLBACK_PROJECTION_ATTRIBUTE = { nfl: 90, nba: 219 };

/**
 * A JSON GET, cached in the Worker cache so the app does not pull a
 * 10 MB lobby on every request.
 */
async function fetchJsonCached(url, ttlSeconds) {
  const cache = globalThis.caches?.default;
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return await hit.json();
    } catch {
      // A cache read that fails is not a failure — go to the network.
    }
  }

  const res = await fetch(url, { headers: DK_HEADERS });
  if (!res.ok) {
    throw new Error(`DraftKings responded ${res.status} for ${url}`);
  }
  const json = await res.json();

  if (cache) {
    try {
      await cache.put(
        url,
        new Response(JSON.stringify(json), {
          headers: {
            "content-type": "application/json",
            "cache-control": `public, max-age=${ttlSeconds}`,
          },
        }),
      );
    } catch {
      // Caching is best-effort; the response is already in hand.
    }
  }
  return json;
}

/**
 * The Classic draft group that starts soonest. Ties go to the group with
 * the most contests, which is the full slate rather than an afternoon-only
 * or late-only subset.
 */
function pickClassicDraftGroup(lobby, now = Date.now()) {
  const contests = lobby?.lobby?.contests ?? [];
  const groups = new Map();
  for (const contest of contests) {
    if (String(contest.gameTypeName ?? "").trim().toLowerCase() !== "classic") {
      continue;
    }
    const start = new Date(contest.contestStartTime).getTime();
    if (!Number.isFinite(start) || start <= now) continue;
    const id = contest.draftGroupId;
    if (id === undefined || id === null) continue;
    const group = groups.get(id) ?? { id, start, contests: 0 };
    group.contests += 1;
    if (start < group.start) group.start = start;
    groups.set(id, group);
  }
  return (
    [...groups.values()].sort(
      (a, b) => a.start - b.start || b.contests - a.contests,
    )[0] ?? null
  );
}

/**
 * The id of DraftKings' own projection attribute (FPPG) for this payload.
 * DraftKings publishes the meaning of every id in "draftStats", so this is
 * read rather than hard-coded.
 */
function projectionAttributeId(payload, sport) {
  const stats = Array.isArray(payload?.draftStats) ? payload.draftStats : [];
  const match = stats.find((stat) => {
    const abbr = String(stat.abbr ?? "").trim().toUpperCase();
    const name = String(stat.name ?? "").trim().toLowerCase();
    return abbr === "FPPG" || name.includes("fantasy points");
  });
  if (match && Number.isFinite(Number(match.id))) return Number(match.id);
  return FALLBACK_PROJECTION_ATTRIBUTE[sport] ?? null;
}

/** The numeric value of one stat attribute, or null when it is not published. */
function numericStat(attributes, attributeId) {
  if (!attributeId || !Array.isArray(attributes)) return null;
  const attribute = attributes.find((a) => Number(a.id) === attributeId);
  if (!attribute) return null;
  const value = Number(attribute.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * One entry per player.
 *
 * DraftKings lists a player once per eligible roster slot. The entry kept
 * is the one whose slot is used by the fewest positions across the slate,
 * which is the position slot rather than the FLEX/UTIL slot.
 */
function choosePrimaryEntryPerPlayer(entries) {
  const slotPositions = new Map();
  for (const entry of entries) {
    const slot = entry.rosterSlotId;
    if (!slotPositions.has(slot)) slotPositions.set(slot, new Set());
    slotPositions.get(slot).add(String(entry.position ?? ""));
  }

  const byPlayer = new Map();
  for (const entry of entries) {
    const key =
      entry.playerId ?? entry.playerDkId ?? entry.draftableId ?? entry.displayName;
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key).push(entry);
  }

  const chosen = [];
  for (const list of byPlayer.values()) {
    let best = list[0];
    let bestScore = Infinity;
    for (const entry of list) {
      const spread = (slotPositions.get(entry.rosterSlotId)?.size ?? 99) * 1000;
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
function rosterPositionsFor(position, sport) {
  if (!position) return [];
  if (sport === "nfl") {
    if (position === "RB" || position === "FB" || position === "WR" || position === "TE") {
      return [position, "FLEX"];
    }
    return [position];
  }
  if (sport === "nba") {
    if (position === "PG" || position === "SG") return [position, "G", "UTIL"];
    if (position === "SF" || position === "PF") return [position, "F", "UTIL"];
    if (position === "C") return [position, "UTIL"];
  }
  return [position];
}

/** "TB @ DET" -> away "TB", home "DET". */
function splitMatchup(name) {
  const [away, home] = String(name ?? "")
    .split("@")
    .map((part) => part.trim().toUpperCase());
  return { away, home };
}

/** The calendar date of a game in DraftKings' own time zone (Eastern). */
function easternDate(iso) {
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

/** "1:00pm ET" — how DraftKings writes a tip time. */
function easternTimeLabel(iso) {
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

/** One DraftKings draftable -> the app's player shape. */
function mapDraftableToPlayer(entry, sport, attributeId) {
  const competition = entry.competition ?? {};
  const competitionName = String(competition.name ?? "").trim();
  const { away, home } = splitMatchup(competitionName);
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
    projection: projection === null ? 0 : projection,
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

/** The slate id the app asks the players endpoint with. */
export function slateIdFor(sport, draftGroupId) {
  return `dk-${sport}-${draftGroupId}`;
}

/** Split a slate id back into its sport and DraftKings draft group. */
export function parseSlateId(id) {
  const match = /^dk-(nfl|nba)-(\d+)$/.exec(String(id ?? ""));
  return match ? { sport: match[1], draftGroupId: match[2] } : null;
}

/** The live slate for a sport, found from the contests on the board. */
export async function fetchLiveDkSlate(sport) {
  if (!DK_LIVE_SPORTS.has(sport)) {
    throw new Error(
      `DraftKings publishes no Classic slate for ${String(sport).toUpperCase()}`,
    );
  }
  const lobby = await fetchJsonCached(
    `${DK_ORIGIN}/lobbies/v1/lobbies/${sport}`,
    LOBBY_TTL_SECONDS,
  );
  const group = pickClassicDraftGroup(lobby);
  if (!group) {
    throw new Error(
      `DraftKings has no upcoming Classic ${String(sport).toUpperCase()} slate`,
    );
  }
  return buildSlate(sport, String(group.id));
}

/** The live slate for a known DraftKings draft group. */
export async function fetchLiveDkSlateByGroup(sport, draftGroupId) {
  if (!DK_LIVE_SPORTS.has(sport)) {
    throw new Error(
      `DraftKings publishes no Classic slate for ${String(sport).toUpperCase()}`,
    );
  }
  return buildSlate(sport, String(draftGroupId));
}

/** Fetch one draft group and turn it into a slate plus its players. */
async function buildSlate(sport, draftGroupId) {
  const payload = await fetchJsonCached(
    `${DK_ORIGIN}/draftgroups/v1/draftgroups/${draftGroupId}/draftables`,
    DRAFTABLES_TTL_SECONDS,
  );
  const entries = Array.isArray(payload?.draftables) ? payload.draftables : [];
  if (entries.length === 0) {
    throw new Error(`DraftKings draft group ${draftGroupId} published no players`);
  }

  const attributeId = projectionAttributeId(payload, sport);
  const players = choosePrimaryEntryPerPlayer(entries).map((entry) =>
    mapDraftableToPlayer(entry, sport, attributeId),
  );

  const games = [...new Set(players.map((p) => p.game_info).filter(Boolean))];
  const starts = players
    .map((p) => p.game_time)
    .filter(Boolean)
    .sort();
  const firstStart = starts[0] ?? null;

  const outCount = players.filter((p) => p.injury_status === "OUT").length;
  const irCount = players.filter((p) => p.injury_status === "IR").length;
  const noProjection = players.filter(
    (p) => p.projection_source === "dk-pending",
  ).length;

  const warnings = [];
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

  const slate = {
    id: slateIdFor(sport, draftGroupId),
    sport,
    name: `DraftKings ${String(sport).toUpperCase()} Main Slate`,
    slate_date: easternDate(firstStart ?? new Date().toISOString()),
    slate_time: firstStart ? easternTimeLabel(firstStart) : "",
    file_name: `draftkings-${draftGroupId}.json`,
    is_active: true,
    created_at: new Date().toISOString(),
    data_source: "draftkings-live",
    provider: "DraftKings",
    draft_group_id: draftGroupId,
    contest_type: "Classic",
    game_count: games.length,
    player_count: players.length,
    fetched_at: new Date().toISOString(),
    warnings,
  };

  return { slate, players, warnings };
}
