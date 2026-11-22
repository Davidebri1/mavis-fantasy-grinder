/**
 * Mavis Outlier — Serverless Cloudflare Worker Edge API
 *
 * Implements all REST endpoints (`/api/health/`, `/api/slates/`,
 * `/api/slates/<id>/`, `/api/players/`, `/api/optimize/`,
 * `/api/import/csv/`, `/api/import/excel/`, `/api/export/csv/`,
 * `/api/export/excel/`) when running on Cloudflare Workers without a Docker
 * container binding. Never bundled into the frontend client.
 */

import {
  fetchLiveDkSlate,
  fetchLiveDkSlateByGroup,
  parseSlateId,
} from "./mavis-dk-live.mjs";

const VALID_SPORTS = new Set(["nba", "nfl", "mma", "golf"]);

// ───────────────────────────────────────────────────────────────────────────
// CORS helpers
// ───────────────────────────────────────────────────────────────────────────
export function buildCorsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedRaw =
    env?.CORS_ALLOWED_ORIGINS ??
    "https://mavis-fantasy-grinder.pages.dev,http://localhost:8088,http://127.0.0.1:8088,http://localhost:5173";
  const allowed = allowedRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let allowOrigin = "*";
  if (origin) {
    if (
      allowed.includes("*") ||
      allowed.includes(origin) ||
      origin.endsWith(".mavis-fantasy-grinder.pages.dev") ||
      origin.endsWith(".workers.dev")
    ) {
      allowOrigin = origin;
    } else if (allowed.length > 0) {
      allowOrigin = allowed[0];
    }
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...buildCorsHeaders(request, env),
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Sample slates (matching apps/common/management/commands/load_sample_data.py)
// ───────────────────────────────────────────────────────────────────────────
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tomorrowIsoDate() {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
}

const NBA_TEAMS = [
  ["LAL", "GSW", 0, ["LeBron James", "Anthony Davis", "Austin Reaves", "D'Angelo Russell", "Rui Hachimura"]],
  ["GSW", "LAL", 1, ["Stephen Curry", "Klay Thompson", "Andrew Wiggins", "Draymond Green", "Chris Paul"]],
  ["BOS", "MIA", 2, ["Jayson Tatum", "Jaylen Brown", "Derrick White", "Jrue Holiday", "Kristaps Porzingis"]],
  ["MIA", "BOS", 3, ["Jimmy Butler", "Bam Adebayo", "Tyler Herro", "Terry Rozier", "Caleb Martin"]],
  ["NYK", "PHI", 4, ["Jalen Brunson", "Julius Randle", "OG Anunoby", "Josh Hart", "Donte DiVincenzo"]],
  ["PHI", "NYK", 5, ["Joel Embiid", "Tyrese Maxey", "Tobias Harris", "Kelly Oubre Jr", "DeAnthony Melton"]],
];
const NBA_SALARY_BUCKETS = [3500, 4000, 4500, 5000, 5500, 6000, 7000, 8500, 10500];
const NBA_POSITIONS = ["PG", "SG", "SF", "PF", "C"];

const MMA_FIGHTERS = [
  ["Jon Jones", "Stipe Miocic", "Heavyweight"],
  ["Islam Makhachev", "Arman Tsarukyan", "Lightweight"],
  ["Sean O'Malley", "Merab Dvalishvili", "Bantamweight"],
  ["Alex Pereira", "Jiri Prochazka", "Light Heavyweight"],
  ["Dustin Poirier", "Max Holloway", "Lightweight"],
  ["Zhang Weili", "Tatiana Suarez", "Women's Strawweight"],
];

const GOLF_PLAYERS = [
  "Scottie Scheffler",
  "Rory McIlroy",
  "Jon Rahm",
  "Brooks Koepka",
  "Xander Schauffele",
  "Viktor Hovland",
  "Justin Thomas",
  "Collin Morikawa",
  "Tommy Fleetwood",
  "Wyndham Clark",
  "Ludvig Aberg",
  "Patrick Cantlay",
];

const NFL_SAMPLE_ROWS = [
  ["Patrick Mahomes", "KC", "BUF", "KC@BUF 4:25pm ET", "QB", 7400, 23.6, 15.0],
  ["Isiah Pacheco", "KC", "BUF", "KC@BUF 4:25pm ET", "RB", 5600, 15.8, 12.0],
  ["Rashee Rice", "KC", "BUF", "KC@BUF 4:25pm ET", "WR", 6800, 18.9, 18.0],
  ["Xavier Worthy", "KC", "BUF", "KC@BUF 4:25pm ET", "WR", 5300, 14.1, 10.0],
  ["Travis Kelce", "KC", "BUF", "KC@BUF 4:25pm ET", "TE", 6100, 15.9, 14.0],
  ["Chiefs DST", "KC", "BUF", "KC@BUF 4:25pm ET", "DST", 2900, 7.6, 7.0],
  ["Josh Allen", "BUF", "KC", "KC@BUF 4:25pm ET", "QB", 8100, 25.4, 21.0],
  ["James Cook", "BUF", "KC", "KC@BUF 4:25pm ET", "RB", 6600, 17.5, 16.0],
  ["Khalil Shakir", "BUF", "KC", "KC@BUF 4:25pm ET", "WR", 5900, 15.2, 13.0],
  ["Keon Coleman", "BUF", "KC", "KC@BUF 4:25pm ET", "WR", 4700, 12.6, 8.0],
  ["Dalton Kincaid", "BUF", "KC", "KC@BUF 4:25pm ET", "TE", 4900, 12.8, 11.0],
  ["Bills DST", "BUF", "KC", "KC@BUF 4:25pm ET", "DST", 2700, 7.1, 6.0],
  ["Brock Purdy", "SF", "DAL", "SF@DAL 4:25pm ET", "QB", 6500, 20.1, 11.0],
  ["Christian McCaffrey", "SF", "DAL", "SF@DAL 4:25pm ET", "RB", 8600, 23.2, 24.0],
  ["Deebo Samuel", "SF", "DAL", "SF@DAL 4:25pm ET", "WR", 6300, 16.4, 14.0],
  ["George Kittle", "SF", "DAL", "SF@DAL 4:25pm ET", "TE", 5700, 15.1, 13.0],
  ["49ers DST", "SF", "DAL", "SF@DAL 4:25pm ET", "DST", 3300, 8.7, 9.0],
  ["Dak Prescott", "DAL", "SF", "SF@DAL 4:25pm ET", "QB", 6700, 20.4, 12.0],
  ["Rico Dowdle", "DAL", "SF", "SF@DAL 4:25pm ET", "RB", 5200, 13.8, 10.0],
  ["CeeDee Lamb", "DAL", "SF", "SF@DAL 4:25pm ET", "WR", 8200, 21.8, 22.0],
  ["Jake Ferguson", "DAL", "SF", "SF@DAL 4:25pm ET", "TE", 4300, 11.6, 9.0],
  ["Cowboys DST", "DAL", "SF", "SF@DAL 4:25pm ET", "DST", 2500, 6.8, 5.0],
  ["Jalen Hurts", "PHI", "DET", "PHI@DET 8:20pm ET", "QB", 7800, 24.1, 17.0],
  ["Saquon Barkley", "PHI", "DET", "PHI@DET 8:20pm ET", "RB", 8300, 22.5, 23.0],
  ["A.J. Brown", "PHI", "DET", "PHI@DET 8:20pm ET", "WR", 7700, 20.1, 19.0],
  ["DeVonta Smith", "PHI", "DET", "PHI@DET 8:20pm ET", "WR", 6200, 16.2, 13.0],
  ["Eagles DST", "PHI", "DET", "PHI@DET 8:20pm ET", "DST", 3100, 8.1, 8.0],
  ["Jared Goff", "DET", "PHI", "PHI@DET 8:20pm ET", "QB", 6600, 20.8, 13.0],
  ["Jahmyr Gibbs", "DET", "PHI", "PHI@DET 8:20pm ET", "RB", 7500, 20.3, 19.0],
  ["Amon-Ra St. Brown", "DET", "PHI", "PHI@DET 8:20pm ET", "WR", 7900, 20.7, 20.0],
  ["Sam LaPorta", "DET", "PHI", "PHI@DET 8:20pm ET", "TE", 5100, 13.4, 10.0],
  ["Lions DST", "DET", "PHI", "PHI@DET 8:20pm ET", "DST", 2800, 7.4, 6.0],
];

function nbaRosterPositions(pos) {
  if (pos === "PG" || pos === "SG") return [pos, "G", "UTIL"];
  if (pos === "SF" || pos === "PF") return [pos, "F", "UTIL"];
  return [pos, "UTIL"];
}

function nflRosterPositions(pos) {
  if (pos === "RB" || pos === "WR" || pos === "TE") return [pos, "FLEX"];
  return [pos];
}

function buildSampleDataset() {
  const rand = makeRng(42);
  const slateDate = tomorrowIsoDate();
  const slateTime = "19:00:00";

  const nbaPlayers = [];
  for (const [teamA, teamB, idx, names] of NBA_TEAMS) {
    names.forEach((name, offset) => {
      const pos = NBA_POSITIONS[offset % NBA_POSITIONS.length];
      nbaPlayers.push({
        id: `nba-${idx}-${offset}`,
        name,
        sport: "nba",
        salary: NBA_SALARY_BUCKETS[Math.floor(rand() * NBA_SALARY_BUCKETS.length)],
        projection: Math.round((15 + rand() * 45) * 10) / 10,
        user_projection: null,
        team: offset < 5 ? teamA : teamB,
        opponent: offset < 5 ? teamB : teamA,
        game_info: `${teamA}@${teamB} 7:00pm ET`,
        game_time: null,
        positions: [pos],
        roster_positions: nbaRosterPositions(pos),
        correlation_group: `${teamA}@${teamB}`,
        projected_ownership: Math.round((2 + rand() * 33) * 10) / 10,
        max_ownership: 100.0,
        min_exposure: 0.0,
        max_exposure: 100.0,
        stddev: null,
        is_locked: false,
        is_excluded: false,
        is_liked: false,
        injury_status: null,
        injury_severity: null,
      });
    });
  }

  const mmaPlayers = [];
  MMA_FIGHTERS.forEach(([a, b], i) => {
    const salBuckets = [4500, 5500, 6500, 7500, 8500, 9500];
    [a, b].forEach((name, j) => {
      mmaPlayers.push({
        id: `mma-${i}-${j}`,
        name,
        sport: "mma",
        salary: salBuckets[Math.floor(rand() * salBuckets.length)],
        projection: Math.round((40 + rand() * 50) * 10) / 10,
        opponent_id: `mma-${i}-${1 - j}`,
        bout: `${a} vs ${b}`,
        projected_ownership: Math.round((5 + rand() * 35) * 10) / 10,
        max_exposure: 100.0,
        is_locked: false,
        is_excluded: false,
        is_liked: false,
      });
    });
  });

  const golfSalaries = [6500, 7000, 7500, 8000, 8500, 9000, 10000, 11000];
  const golfPlayers = GOLF_PLAYERS.map((name, i) => ({
    id: `golf-${i}`,
    name,
    sport: "golf",
    salary: golfSalaries[Math.floor(rand() * golfSalaries.length)],
    projection: Math.round((45 + rand() * 50) * 10) / 10,
    tee_time: null,
    projected_ownership: Math.round((2 + rand() * 28) * 10) / 10,
    is_locked: false,
    is_excluded: false,
    is_liked: false,
  }));

  const nflPlayers = NFL_SAMPLE_ROWS.map(([name, team, opp, gameInfo, pos, salary, proj, own], idx) => ({
    id: `nfl-${idx}`,
    name,
    sport: "nfl",
    salary,
    projection: proj,
    user_projection: null,
    team,
    opponent: opp,
    game_info: gameInfo,
    game_time: null,
    positions: [pos],
    roster_positions: nflRosterPositions(pos),
    correlation_group: gameInfo.split(" ")[0],
    projected_ownership: own,
    max_ownership: 100.0,
    min_exposure: 0.0,
    max_exposure: 100.0,
    stddev: null,
    is_locked: false,
    is_excluded: false,
    is_liked: false,
    injury_status: null,
    injury_severity: null,
    photo_url: null,
  }));

  const slates = {
    nba: {
      id: "slate-nba-sample",
      sport: "nba",
      slate_date: slateDate,
      slate_time: slateTime,
      name: "[SAMPLE] NBA Main Slate",
      file_name: "sample_nba.csv",
      is_active: true,
      created_at: `${slateDate}T00:00:00Z`,
    },
    nfl: {
      id: "slate-nfl-sample",
      sport: "nfl",
      slate_date: slateDate,
      slate_time: slateTime,
      name: "[SAMPLE] NFL Main Slate",
      file_name: "sample_nfl.csv",
      is_active: true,
      created_at: `${slateDate}T00:00:00Z`,
    },
    mma: {
      id: "slate-mma-sample",
      sport: "mma",
      slate_date: slateDate,
      slate_time: slateTime,
      name: "[SAMPLE] MMA Main Card",
      file_name: "sample_mma.csv",
      is_active: true,
      created_at: `${slateDate}T00:00:00Z`,
    },
    golf: {
      id: "slate-golf-sample",
      sport: "golf",
      slate_date: slateDate,
      slate_time: slateTime,
      name: "[SAMPLE] PGA Main Field",
      file_name: "sample_golf.csv",
      is_active: true,
      created_at: `${slateDate}T00:00:00Z`,
    },
  };

  const playersBySport = {
    nba: nbaPlayers,
    nfl: nflPlayers,
    mma: mmaPlayers,
    golf: golfPlayers,
  };

  return { slates, playersBySport };
}

const SAMPLE_DATA = buildSampleDataset();

// The sample rows carry invented prices and projections. They are labelled
// as sample so no part of the app can pass them off as DraftKings own
// published numbers, and they carry no ownership figure at all.
for (const rows of Object.values(SAMPLE_DATA.playersBySport)) {
  for (const row of rows) {
    row.salary_source = "sample";
    row.projection_source = "sample";
    delete row.projected_ownership;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Optimizer math & constraints
// ───────────────────────────────────────────────────────────────────────────
const NFL_CLASSIC_SLOTS = [
  { label: "QB", accepts: ["QB"] },
  { label: "RB", accepts: ["RB", "FB"] },
  { label: "RB", accepts: ["RB", "FB"] },
  { label: "WR", accepts: ["WR"] },
  { label: "WR", accepts: ["WR"] },
  { label: "WR", accepts: ["WR"] },
  { label: "TE", accepts: ["TE"] },
  { label: "FLEX", accepts: ["RB", "FB", "WR", "TE"] },
  { label: "DST", accepts: ["DST", "D"] },
];

const NBA_CLASSIC_SLOTS = [
  { label: "PG", accepts: ["PG"] },
  { label: "SG", accepts: ["SG"] },
  { label: "SF", accepts: ["SF"] },
  { label: "PF", accepts: ["PF"] },
  { label: "C", accepts: ["C"] },
  { label: "G", accepts: ["PG", "SG"] },
  { label: "F", accepts: ["SF", "PF"] },
  { label: "UTIL", accepts: null },
];

const SHOWDOWN_SLOTS = [
  { label: "CPT", accepts: null, multiplier: 1.5 },
  { label: "FLEX", accepts: null, multiplier: 1.0 },
  { label: "FLEX", accepts: null, multiplier: 1.0 },
  { label: "FLEX", accepts: null, multiplier: 1.0 },
  { label: "FLEX", accepts: null, multiplier: 1.0 },
  { label: "FLEX", accepts: null, multiplier: 1.0 },
];

function effectiveProjection(p) {
  const base = p.user_projection !== null && p.user_projection !== undefined ? Number(p.user_projection) : Number(p.projection || 0);
  return p.is_liked ? base * 1.15 : base;
}

function effectiveStddev(p) {
  if (p.stddev !== null && p.stddev !== undefined) return Number(p.stddev);
  const proj = Number(p.projection || 0);
  let mult = 0;
  if (proj >= 45) mult = 0.18;
  else if (proj >= 35) mult = 0.2;
  else if (proj >= 25) mult = 0.23;
  else if (proj >= 15) mult = 0.27;
  else if (proj > 0) mult = 0.32;
  return proj * mult;
}

function playerCeiling(p) {
  return Number(p.projection || 0) + 1.5 * effectiveStddev(p);
}

function correlationGroupOf(p) {
  if (p.correlation_group) return String(p.correlation_group).trim();
  const m = String(p.game_info || "").match(/([A-Z]{2,5}@[A-Z]{2,5})/);
  return m ? m[1] : "";
}

function normalizePlayer(p, sport) {
  const rawPos = Array.isArray(p.positions) ? p.positions : [];
  const rawRoster = Array.isArray(p.roster_positions) ? p.roster_positions : [];
  const positions = rawPos.length > 0 ? rawPos : rawRoster;
  const rosterPositions = rawRoster.length > 0 ? rawRoster : positions;
  return {
    id: String(p.id),
    name: String(p.name || p.id),
    sport,
    salary: Number(p.salary || 0),
    projection: Number(p.projection || 0),
    user_projection: p.user_projection !== undefined ? p.user_projection : null,
    team: String(p.team || "").trim(),
    opponent: String(p.opponent || "").trim(),
    game_info: String(p.game_info || "").trim(),
    positions,
    roster_positions: rosterPositions,
    correlation_group: correlationGroupOf(p),
    opponent_id: String(p.opponent_id || "").trim(),
    bout: String(p.bout || "").trim(),
    projected_ownership: Number(p.projected_ownership || 0),
    max_exposure: p.max_exposure !== undefined && p.max_exposure !== null ? Number(p.max_exposure) : 100.0,
    min_exposure: p.min_exposure !== undefined && p.min_exposure !== null ? Number(p.min_exposure) : 0.0,
    stddev: p.stddev !== undefined ? p.stddev : null,
    is_locked: Boolean(p.is_locked),
    is_excluded: Boolean(p.is_excluded),
    is_liked: Boolean(p.is_liked),
    injury_status: p.injury_status ?? null,
    injury_severity: p.injury_severity ?? null,
  };
}

function canFillSlot(player, slot, sport, contestType) {
  if (!slot.accepts) return true;
  const posList =
    sport === "nfl"
      ? (player.positions.length > 0 ? player.positions : player.roster_positions)
      : (player.roster_positions.length > 0 ? player.roster_positions : player.positions);
  return posList.some((pos) => slot.accepts.includes(String(pos).toUpperCase()));
}

function filterEligible(players, settings) {
  const seen = new Set();
  const out = [];
  const minProj = Number(settings.min_projection || 0);
  const excludedTeams = new Set(settings.excluded_teams || []);
  for (const p of players) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.is_excluded) continue;
    if (p.salary <= 0) continue;
    // DraftKings contests do not accept a player who is OUT or IR.
    const status = String(p.injury_status ?? "").toUpperCase();
    if (status === "OUT" || status === "IR") continue;
    // A player with no published projection cannot be scored, so they
    // cannot be part of a lineup.
    if (effectiveProjection(p) <= 0) continue;
    if (effectiveProjection(p) < minProj) continue;
    if (p.team && excludedTeams.has(p.team)) continue;
    out.push(p);
  }
  return out;
}

function choleskyLower(corr) {
  const n = corr.length;
  // Shrink off-diagonals geometrically toward identity if non-PSD so every
  // player retains unit marginal variance instead of collapsing diagonals.
  for (const shrink of [1.0, 0.85, 0.7, 0.5, 0.25, 0.0]) {
    const L = Array.from({ length: n }, () => new Float64Array(n));
    let valid = true;
    for (let i = 0; i < n && valid; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = i === j ? 1.0 : corr[i][j] * shrink;
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (i === j) {
          if (sum <= 1e-8) {
            valid = false;
            break;
          }
          L[i][j] = Math.sqrt(sum);
        } else {
          L[i][j] = sum / L[j][j];
        }
      }
    }
    if (valid) return L;
  }
  return Array.from({ length: n }, (_, i) => {
    const r = new Float64Array(n);
    r[i] = 1.0;
    return r;
  });
}

function buildCorrelationMatrix(players, sport, settings) {
  const n = players.length;
  const mat = Array.from({ length: n }, (_, i) => {
    const row = new Float64Array(n);
    row[i] = 1.0;
    return row;
  });
  if (sport === "golf") return mat;

  if (sport === "mma") {
    const oppCorr = Number(settings.opponent_correlation ?? -0.4);
    const cardCorr = Number(settings.card_correlation ?? 0.1);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = players[i];
        const b = players[j];
        let rho = 0;
        if (a.opponent_id && (a.opponent_id === b.id || b.opponent_id === a.id)) {
          rho = oppCorr;
        } else if (a.bout && b.bout && a.bout === b.bout) {
          rho = cardCorr;
        }
        mat[i][j] = mat[j][i] = rho;
      }
    }
    return mat;
  }

  if (sport === "nba") {
    const tmCorr = Number(settings.teammate_correlation ?? 0.35);
    const oppCorr = Number(settings.opponent_correlation ?? 0.2);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = players[i];
        const b = players[j];
        let rho = 0;
        if (a.team && a.team === b.team) rho = tmCorr;
        else if (a.team && a.opponent && a.team === b.opponent && a.opponent === b.team) rho = oppCorr;
        mat[i][j] = mat[j][i] = rho;
      }
    }
    return mat;
  }

  // NFL
  const qbWrCorr = Number(settings.qb_wr_te_correlation ?? 0.45);
  const qbOppWrCorr = Number(settings.qb_opp_wr_correlation ?? 0.25);
  const qbOppDstCorr = Number(settings.qb_opp_dst_correlation ?? -0.6);
  const tmCorr = Number(settings.teammate_correlation ?? 0.2);
  const hasPos = (p, targets) => p.positions.some((x) => targets.includes(x.toUpperCase()));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = players[i];
      const b = players[j];
      let rho = 0;
      const sameTeam = a.team && a.team === b.team;
      const oppTeam = a.team && a.opponent && a.team === b.opponent && a.opponent === b.team;
      if (sameTeam) {
        if ((hasPos(a, ["QB"]) && hasPos(b, ["WR", "TE"])) || (hasPos(b, ["QB"]) && hasPos(a, ["WR", "TE"]))) {
          rho = qbWrCorr;
        } else {
          rho = tmCorr;
        }
      } else if (oppTeam) {
        if ((hasPos(a, ["QB"]) && hasPos(b, ["WR", "TE"])) || (hasPos(b, ["QB"]) && hasPos(a, ["WR", "TE"]))) {
          rho = qbOppWrCorr;
        } else if ((hasPos(a, ["QB"]) && hasPos(b, ["DST", "D"])) || (hasPos(b, ["QB"]) && hasPos(a, ["DST", "D"]))) {
          rho = qbOppDstCorr;
        }
      }
      mat[i][j] = mat[j][i] = rho;
    }
  }
  return mat;
}

function generateSimulations(players, sport, settings, simCount) {
  const n = players.length;
  if (n === 0 || simCount <= 0) return [];
  const corr = buildCorrelationMatrix(players, sport, settings);
  const L = choleskyLower(corr);
  const means = players.map((p) => effectiveProjection(p));
  const stds = players.map((p) => effectiveStddev(p));
  const rand = makeRng(settings.seed ?? 42);
  const out = [];
  for (let s = 0; s < simCount; s++) {
    const normals = new Float64Array(n);
    for (let i = 0; i < n; i += 2) {
      const u1 = Math.max(1e-12, rand());
      const u2 = Math.max(1e-12, rand());
      const r = Math.sqrt(-2 * Math.log(u1));
      const th = 2 * Math.PI * u2;
      normals[i] = r * Math.cos(th);
      if (i + 1 < n) normals[i + 1] = r * Math.sin(th);
    }
    const row = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += L[i][j] * normals[j];
      row[i] = Math.max(0, means[i] + sum * stds[i]);
    }
    out.push(row);
  }
  return out;
}

function baseScoresForStrategy(strategy, players) {
  if (strategy === "balanced") {
    return players.map((p) => (p.salary > 0 ? effectiveProjection(p) / (p.salary / 1000) : 0));
  }
  if (strategy === "salaryCap") {
    return players.map((p) => 0.7 * (p.salary / 1000) + 0.3 * effectiveProjection(p));
  }
  return players.map((p) => effectiveProjection(p));
}

function perturbScores(baseScores, amount, seed) {
  const rand = makeRng(seed);
  return baseScores.map((s) => s * (1 + (rand() * 2 - 1) * amount));
}

function buildStrategyPlan(strategy, players, settings, sport) {
  const numLineups = Math.max(1, Number(settings.num_lineups || 20));
  if (strategy === "monteCarlo" || strategy === "contrarian") {
    const reqSims = Math.min(Math.max(numLineups * 6, 80), Number(settings.simulation_count || 200), 300);
    const sims = generateSimulations(players, sport, settings, reqSims);
    if (strategy === "contrarian") {
      return sims.map((row, idx) => ({
        scores: row.map((v, i) => {
          const own = Math.max(Number(players[i].projected_ownership || 0), 0.1) / 100.0;
          return v / Math.sqrt(own);
        }),
        iteration: idx,
        description: "contrarian",
      }));
    }
    return sims.map((row, idx) => ({ scores: row, iteration: idx, description: "monteCarlo" }));
  }

  const base = baseScoresForStrategy(strategy, players);
  const amount = strategy === "maxProjection" ? 0.05 : 0.08;
  const count = Math.max(1, Math.min(numLineups * 3, 180));
  const seedBase = Number(settings.seed ?? 42);
  const plan = [{ scores: base, iteration: 0, description: strategy }];
  for (let i = 1; i < count; i++) {
    plan.push({
      scores: perturbScores(base, amount, seedBase + i * 7919),
      iteration: i,
      description: `${strategy}_perturbed`,
    });
  }
  return plan;
}

function bipartiteAssign(playersSubset, slots, sport, contestType) {
  const m = slots.length;
  const n = playersSubset.length;
  const adj = playersSubset.map((p) => {
    const out = [];
    for (let s = 0; s < m; s++) {
      if (canFillSlot(p, slots[s], sport, contestType)) out.push(s);
    }
    return out;
  });
  const slotOwner = new Array(m).fill(-1);
  const dfs = (pIdx, seen) => {
    for (const sIdx of adj[pIdx]) {
      if (seen[sIdx]) continue;
      seen[sIdx] = true;
      const cur = slotOwner[sIdx];
      if (cur === -1 || dfs(cur, seen)) {
        slotOwner[sIdx] = pIdx;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < n; i++) {
    dfs(i, new Array(m).fill(false));
  }
  if (slotOwner.some((x) => x === -1)) return null;
  return slotOwner;
}

function buildStackRuleDescriptors(players, rawRules) {
  if (!Array.isArray(rawRules) || rawRules.length === 0) return [];
  const out = [];
  for (const r of rawRules) {
    const scope = String(r.scope || "team").toLowerCase();
    const id = String(r.id || "").trim();
    const min = Math.max(0, Number(r.min || 0));
    const max = Math.max(0, Number(r.max ?? players.length));
    if (!id) continue;
    const members = new Uint8Array(players.length);
    let memberCount = 0;
    players.forEach((p, i) => {
      let match = false;
      if (scope === "team") match = p.team === id;
      else if (scope === "game") match = p.correlation_group === id;
      else if (scope === "fight") match = p.bout === id;
      if (match) {
        members[i] = 1;
        memberCount += 1;
      }
    });
    if (memberCount > 0 || max < players.length) {
      out.push({ scope, id, min, max, members, memberCount });
    }
  }
  return out;
}

function solveOneLineup({
  players,
  scores,
  sport,
  contestType,
  slots,
  salaryCap,
  lockedSet,
  excludedSet,
  forbiddenKeys,
  stackRules,
  teamMaxLimit,
  allowOpponents,
  nodeBudget = 7500,
}) {
  const n = players.length;
  const rSize = slots.length;
  if (rSize === 0 || n < rSize) return null;

  const isShowdown = contestType === "showdown";
  const distinctTeamsInPool = new Set(players.map((p, i) => (!excludedSet.has(i) && p.team ? p.team : "")).filter(Boolean));
  const requireTwoTeams = (sport === "nba" || sport === "nfl") && distinctTeamsInPool.size >= 2;
  const effectiveTeamMax =
    sport === "nba" && !isShowdown
      ? Math.min(teamMaxLimit > 0 ? teamMaxLimit : 4, rSize - 1)
      : requireTwoTeams
        ? teamMaxLimit > 0
          ? Math.min(teamMaxLimit, rSize - 1)
          : rSize - 1
        : teamMaxLimit > 0
          ? teamMaxLimit
          : rSize;

  // QB vs opposing DST lookup for NFL
  const isQb = new Uint8Array(n);
  const isDst = new Uint8Array(n);
  if (sport === "nfl") {
    for (let i = 0; i < n; i++) {
      const pos = (players[i].positions.length ? players[i].positions : players[i].roster_positions).map((x) =>
        x.toUpperCase(),
      );
      if (pos.includes("QB")) isQb[i] = 1;
      if (pos.includes("DST") || pos.includes("D")) isDst[i] = 1;
    }
  }

  // Sort eligible indices per slot by descending score
  const slotSig = (s) => (s.accepts ? `${s.multiplier || 1}:${s.accepts.join(",")}` : `${s.multiplier || 1}:*`);
  const stepSlots = slots
    .map((s, origIdx) => {
      const cands = [];
      for (let i = 0; i < n; i++) {
        if (excludedSet.has(i)) continue;
        if (canFillSlot(players[i], s, sport, contestType)) cands.push(i);
      }
      cands.sort((a, b) => scores[b] - scores[a] || players[a].salary - players[b].salary);
      return { origIdx, label: s.label, sig: slotSig(s), mult: s.multiplier || 1.0, cands };
    })
    .sort((a, b) => {
      // CPT first in showdown; otherwise fewest candidates first
      if (isShowdown && a.origIdx === 0) return -1;
      if (isShowdown && b.origIdx === 0) return 1;
      return a.cands.length - b.cands.length || a.origIdx - b.origIdx;
    });

  if (stepSlots.some((s) => s.cands.length === 0)) return null;

  // Map symmetry predecessor for identical slots so combinations aren't duplicated
  const prevSameStep = new Array(rSize).fill(-1);
  if (!isShowdown) {
    const lastBySig = new Map();
    for (let step = 0; step < rSize; step++) {
      const sig = stepSlots[step].sig;
      if (lastBySig.has(sig)) prevSameStep[step] = lastBySig.get(sig);
      lastBySig.set(sig, step);
    }
  } else {
    // In showdown, FLEX slots (step 1..5) share signature
    for (let step = 2; step < rSize; step++) prevSameStep[step] = step - 1;
  }

  // Tight per-step lower-bound salary & upper-bound score ignoring global aliasing:
  // For each remaining suffix step..rSize-1, assign distinct minimum salaries and
  // distinct maximum scores so expensive prefixes prune at shallow depth.
  const eligibleSalaryList = [];
  const eligibleScoreList = [];
  for (let i = 0; i < n; i++) {
    if (excludedSet.has(i)) continue;
    eligibleSalaryList.push({ i, sal: players[i].salary });
    eligibleScoreList.push({ i, sc: scores[i] });
  }
  eligibleSalaryList.sort((a, b) => a.sal - b.sal);
  eligibleScoreList.sort((a, b) => b.sc - a.sc);

  const remMinSalDistinct = new Array(rSize + 1).fill(0);
  const remMaxScoreDistinct = new Array(rSize + 1).fill(0);
  for (let start = 0; start < rSize; start++) {
    const usedSal = new Set();
    let minS = 0;
    // Assign cheapest distinct eligible player to each slot start..rSize-1 (most-constrained slots first)
    for (let s = start; s < rSize; s++) {
      const slot = stepSlots[s];
      let pickedSal = Infinity;
      for (const item of eligibleSalaryList) {
        if (usedSal.has(item.i)) continue;
        if (canFillSlot(players[item.i], slots[slot.origIdx], sport, contestType)) {
          usedSal.add(item.i);
          pickedSal = item.sal;
          break;
        }
      }
      if (!Number.isFinite(pickedSal)) {
        remMinSalDistinct[start] = Infinity;
        break;
      }
      minS += pickedSal;
    }
    remMinSalDistinct[start] = minS;

    // Assign highest distinct eligible score * mult to each slot start..rSize-1
    const usedSc = new Set();
    let maxS = 0;
    for (let s = start; s < rSize; s++) {
      const slot = stepSlots[s];
      for (const item of eligibleScoreList) {
        if (usedSc.has(item.i)) continue;
        if (canFillSlot(players[item.i], slots[slot.origIdx], sport, contestType)) {
          usedSc.add(item.i);
          maxS += item.sc * slot.mult;
          break;
        }
      }
    }
    remMaxScoreDistinct[start] = maxS;
  }

  if (!Number.isFinite(remMinSalDistinct[0]) || remMinSalDistinct[0] > salaryCap) {
    return null;
  }

  // Helper conflict check
  const hasQbDstConflictWith = (pickedList, len, candIdx) => {
    if (sport !== "nfl") return false;
    const cp = players[candIdx];
    const cIsQb = isQb[candIdx] === 1;
    const cIsDst = isDst[candIdx] === 1;
    if (!cIsQb && !cIsDst) return false;
    for (let s = 0; s < len; s++) {
      const pi = pickedList[s];
      if (pi < 0) continue;
      const pp = players[pi];
      if (cIsQb && isDst[pi] === 1 && cp.team && pp.opponent && cp.team === pp.opponent) return true;
      if (cIsDst && isQb[pi] === 1 && cp.opponent && pp.team && cp.opponent === pp.team) return true;
    }
    return false;
  };

  let bestScore = -Infinity;
  let bestSlotPicks = null;

  // Quick feasible incumbent warm-start using salary-normalized penalty weights
  const avgScore = eligibleScoreList.length
    ? eligibleScoreList.reduce((s, x) => s + x.sc, 0) / eligibleScoreList.length
    : 15;
  const unitPen = avgScore / 6000;
  // Upper-bound how many future slots step..rSize-1 can physically accept any member of each stack rule
  const remRuleSlotsBound = Array.from({ length: rSize + 1 }, () => new Int32Array(stackRules.length));
  for (let step = rSize - 1; step >= 0; step--) {
    for (let ri = 0; ri < stackRules.length; ri++) {
      const hasAny = stepSlots[step].cands.some((c) => stackRules[ri].members[c] === 1);
      remRuleSlotsBound[step][ri] = remRuleSlotsBound[step + 1][ri] + (hasAny ? 1 : 0);
    }
  }

  for (const mult of [0.0, 0.35, 0.7, 1.1, 2.5, 8.0, 40.0]) {
    const salPenalty = mult * unitPen;
    const greedyUsed = new Uint8Array(n);
    const greedyPicked = new Int32Array(rSize).fill(-1);
    const gTeamMap = new Map();
    const gBoutMap = new Map();
    const gRuleCnt = new Int32Array(stackRules.length);
    const gLockedRem = new Set(lockedSet);
    let gSal = 0;
    let gScore = 0;
    let ok = true;

    for (let step = 0; step < rSize; step++) {
      const slot = stepSlots[step];
      const mustLocked = gLockedRem.size === rSize - step;
      // Count unmet stack rule urgency so greedy hits tight stack rules cleanly
      const unmetRuleBonus = (candIdx) => {
        let bonus = 0;
        for (let ri = 0; ri < stackRules.length; ri++) {
          const r = stackRules[ri];
          if (r.members[candIdx] && gRuleCnt[ri] < r.min) {
            const need = r.min - gRuleCnt[ri];
            const slack = remRuleSlotsBound[step][ri] - need;
            bonus += slack <= 1 ? avgScore * 4 : avgScore * 0.4;
          }
        }
        return bonus;
      };

      const sortedCands = [...slot.cands].sort((a, b) => {
        const va = scores[a] * slot.mult - salPenalty * players[a].salary + unmetRuleBonus(a);
        const vb = scores[b] * slot.mult - salPenalty * players[b].salary + unmetRuleBonus(b);
        return vb - va;
      });

      let chosen = -1;
      for (const candIdx of sortedCands) {
        if (greedyUsed[candIdx]) continue;
        if (mustLocked && !gLockedRem.has(candIdx)) continue;
        const cp = players[candIdx];
        if (gSal + cp.salary + remMinSalDistinct[step + 1] > salaryCap) continue;
        if (sport === "mma" && !allowOpponents && cp.bout && (gBoutMap.get(cp.bout) || 0) >= 1) continue;
        if (cp.team && (gTeamMap.get(cp.team) || 0) >= effectiveTeamMax) continue;
        if (hasQbDstConflictWith(greedyPicked, step, candIdx)) continue;
        if (stackRules.some((r, ri) => r.members[candIdx] && gRuleCnt[ri] + 1 > r.max)) continue;
        // Keep stack rule minimums physically reachable across remaining slots
        if (stackRules.some((r, ri) => {
          const nextCnt = gRuleCnt[ri] + (r.members[candIdx] ? 1 : 0);
          return nextCnt + remRuleSlotsBound[step + 1][ri] < r.min;
        })) continue;

        chosen = candIdx;
        break;
      }
      if (chosen < 0) {
        ok = false;
        break;
      }
      const cp = players[chosen];
      greedyUsed[chosen] = 1;
      greedyPicked[step] = chosen;
      gLockedRem.delete(chosen);
      if (cp.team) gTeamMap.set(cp.team, (gTeamMap.get(cp.team) || 0) + 1);
      if (cp.bout) gBoutMap.set(cp.bout, (gBoutMap.get(cp.bout) || 0) + 1);
      stackRules.forEach((r, ri) => {
        if (r.members[chosen]) gRuleCnt[ri] += 1;
      });
      gSal += cp.salary;
      gScore += scores[chosen] * slot.mult;
    }

    if (ok && gLockedRem.size === 0 && (!requireTwoTeams || gTeamMap.size >= 2)) {
      const idKey = [...greedyPicked].map((idx) => players[idx].id).sort().join("|");
      if (!forbiddenKeys.has(idKey) && gScore > bestScore) {
        bestScore = gScore;
        bestSlotPicks = new Array(rSize);
        for (let s = 0; s < rSize; s++) {
          bestSlotPicks[stepSlots[s].origIdx] = greedyPicked[s];
        }
      }
    }
  }

  const ruleCountArr = new Int32Array(stackRules.length);
  const teamCountMap = new Map();
  const boutCountMap = new Map();
  const used = new Uint8Array(n);
  const pickedAtStep = new Int32Array(rSize).fill(-1);
  const lockedRemaining = new Set(lockedSet);

  let nodes = 0;

  const dfs = (step, curSalary, curScore) => {
    if (nodes > nodeBudget) return;
    nodes += 1;

    const remSlots = rSize - step;
    if (curSalary + remMinSalDistinct[step] > salaryCap) return;
    if (curScore + remMaxScoreDistinct[step] <= bestScore + 1e-9) return;
    if (lockedRemaining.size > remSlots) return;

    // Check stack rule mins still reachable across future compatible slots
    for (let ri = 0; ri < stackRules.length; ri++) {
      const r = stackRules[ri];
      if (ruleCountArr[ri] + remRuleSlotsBound[step][ri] < r.min) return;
    }

    if (step === rSize) {
      if (lockedRemaining.size > 0) return;
      if (requireTwoTeams && teamCountMap.size < 2) return;
      // Assemble in original slot order for key check
      const selectedSorted = [];
      for (let s = 0; s < rSize; s++) selectedSorted.push(pickedAtStep[s]);
      const idKey = selectedSorted
        .map((idx) => players[idx].id)
        .sort()
        .join("|");
      if (forbiddenKeys.has(idKey)) return;

      bestScore = curScore;
      bestSlotPicks = new Array(rSize);
      for (let s = 0; s < rSize; s++) {
        bestSlotPicks[stepSlots[s].origIdx] = pickedAtStep[s];
      }
      return;
    }

    const slot = stepSlots[step];
    const prevIdx = prevSameStep[step] >= 0 ? pickedAtStep[prevSameStep[step]] : -1;
    const prevPosInCands = prevIdx >= 0 ? slot.cands.indexOf(prevIdx) : -1;

    // When all remaining slots must be locked players, prioritize locked candidates
    const mustPickLocked = lockedRemaining.size === remSlots;

    for (let ci = 0; ci < slot.cands.length; ci++) {
      if (ci <= prevPosInCands) continue;
      const candIdx = slot.cands[ci];
      if (used[candIdx]) continue;
      if (mustPickLocked && !lockedRemaining.has(candIdx)) continue;

      const cp = players[candIdx];
      if (curSalary + cp.salary + remMinSalDistinct[step + 1] > salaryCap) continue;

      if (sport === "mma" && !allowOpponents && cp.bout && (boutCountMap.get(cp.bout) || 0) >= 1) continue;
      if (cp.team && (teamCountMap.get(cp.team) || 0) >= effectiveTeamMax) continue;
      if (hasQbDstConflictWith(pickedAtStep, step, candIdx)) continue;

      let ruleFail = false;
      for (let ri = 0; ri < stackRules.length; ri++) {
        const r = stackRules[ri];
        const nextCnt = ruleCountArr[ri] + (r.members[candIdx] ? 1 : 0);
        if ((r.members[candIdx] && nextCnt > r.max) || nextCnt + remRuleSlotsBound[step + 1][ri] < r.min) {
          ruleFail = true;
          break;
        }
      }
      if (ruleFail) continue;

      // Apply
      used[candIdx] = 1;
      pickedAtStep[step] = candIdx;
      const wasLocked = lockedRemaining.delete(candIdx);
      if (cp.team) teamCountMap.set(cp.team, (teamCountMap.get(cp.team) || 0) + 1);
      if (cp.bout) boutCountMap.set(cp.bout, (boutCountMap.get(cp.bout) || 0) + 1);
      for (let ri = 0; ri < stackRules.length; ri++) {
        if (stackRules[ri].members[candIdx]) ruleCountArr[ri] += 1;
      }

      dfs(step + 1, curSalary + cp.salary, curScore + scores[candIdx] * slot.mult);

      // Undo
      for (let ri = 0; ri < stackRules.length; ri++) {
        if (stackRules[ri].members[candIdx]) ruleCountArr[ri] -= 1;
      }
      if (cp.bout) {
        const prevB = boutCountMap.get(cp.bout) || 0;
        if (prevB <= 1) boutCountMap.delete(cp.bout);
        else boutCountMap.set(cp.bout, prevB - 1);
      }
      if (cp.team) {
        const prevT = teamCountMap.get(cp.team) || 0;
        if (prevT <= 1) teamCountMap.delete(cp.team);
        else teamCountMap.set(cp.team, prevT - 1);
      }
      if (wasLocked) lockedRemaining.add(candIdx);
      pickedAtStep[step] = -1;
      used[candIdx] = 0;

      if (nodes > nodeBudget && bestSlotPicks !== null) break;
    }
  };

  dfs(0, 0, 0);
  return bestSlotPicks;
}

function buildLineupObject({ selectedSlotIndices, players, slots, sport, contestType, strategy, solverBackend }) {
  // For Showdown, promote highest projected selected player to CPT (1.5x)
  let finalAssignments = [];
  if (contestType === "showdown") {
    const ordered = [...selectedSlotIndices].sort(
      (a, b) => effectiveProjection(players[b]) - effectiveProjection(players[a]),
    );
    finalAssignments = ordered.map((idx, i) => ({
      slot: i === 0 ? "CPT" : "FLEX",
      score_multiplier: i === 0 ? 1.5 : 1.0,
      player_id: players[idx].id,
      player_name: players[idx].name,
      _idx: idx,
    }));
  } else {
    // Re-assign clean bipartite matching for optimal slot presentation
    const subset = selectedSlotIndices.map((idx) => players[idx]);
    const assigned = bipartiteAssign(subset, slots, sport, contestType);
    if (assigned) {
      finalAssignments = assigned.map((subIdx, sIdx) => {
        const pIdx = selectedSlotIndices[subIdx];
        return {
          slot: slots[sIdx].label,
          score_multiplier: slots[sIdx].multiplier || 1.0,
          player_id: players[pIdx].id,
          player_name: players[pIdx].name,
          _idx: pIdx,
        };
      });
    } else {
      finalAssignments = selectedSlotIndices.map((idx, sIdx) => ({
        slot: slots[sIdx].label,
        score_multiplier: slots[sIdx].multiplier || 1.0,
        player_id: players[idx].id,
        player_name: players[idx].name,
        _idx: idx,
      }));
    }
  }

  let totalSalary = 0;
  let totalProj = 0;
  let totalCeil = 0;
  const teams = new Set();
  const games = new Set();
  for (const a of finalAssignments) {
    const p = players[a._idx];
    totalSalary += p.salary;
    totalProj += effectiveProjection(p) * a.score_multiplier;
    totalCeil += playerCeiling(p) * a.score_multiplier;
    if (p.team) teams.add(p.team);
    if (p.correlation_group) games.add(p.correlation_group);
  }
  const uniqueKey = finalAssignments
    .map((a) => a.player_id)
    .sort()
    .join("|");

  return {
    assignments: finalAssignments.map(({ _idx, ...rest }) => rest),
    strategy,
    solver_backend: solverBackend,
    rank: 0,
    total_salary: totalSalary,
    total_projection: Math.round(totalProj * 10000) / 10000,
    total_ceiling: Math.round(totalCeil * 10000) / 10000,
    teams: [...teams].sort(),
    games: [...games].sort(),
    unique_key: uniqueKey,
  };
}

function enforceExposureCaps(lineups, eligible, settings, warnings) {
  if (!lineups || lineups.length === 0) return lineups;
  const globalCap = Number(settings.max_exposure ?? 100.0);
  const capById = new Map();
  let anyCap = false;
  for (const p of eligible) {
    if (p.is_locked) continue;
    const c = Math.min(globalCap, Number(p.max_exposure ?? 100.0));
    capById.set(p.id, c);
    if (c < 100.0) anyCap = true;
  }
  if (!anyCap) return lineups;

  const hasViolation = (subset) => {
    const k = subset.length;
    if (k === 0) return false;
    const counts = new Map();
    for (const l of subset) {
      const seen = new Set();
      for (const a of l.assignments) {
        if (seen.has(a.player_id)) continue;
        seen.add(a.player_id);
        counts.set(a.player_id, (counts.get(a.player_id) || 0) + 1);
      }
    }
    for (const [pid, cnt] of counts) {
      const cap = capById.get(pid);
      if (cap !== undefined && cap < 100.0) {
        if (cnt * 100 > k * cap + 1e-6) return true;
      }
    }
    return false;
  };

  if (!hasViolation(lineups)) return lineups;

  // Find maximum-cardinality compliant subset (>= 2) where every non-locked
  // player appears in at most floor(k * cap / 100) lineups of the kept size k.
  const m = lineups.length;
  const lineupPids = lineups.map((l) => [...new Set(l.assignments.map((a) => a.player_id))]);
  const totalFreq = new Map();
  for (const pids of lineupPids) {
    for (const pid of pids) totalFreq.set(pid, (totalFreq.get(pid) || 0) + 1);
  }
  // Precompute congestion score per lineup (lower = easier to pack within caps)
  const congestion = lineupPids.map((pids) => {
    let sum = 0;
    for (const pid of pids) {
      const cap = capById.get(pid);
      if (cap !== undefined && cap < 100.0) {
        sum += (totalFreq.get(pid) || 0) / Math.max(1, cap);
      }
    }
    return sum;
  });

  const tryPackSize = (targetK) => {
    const allowed = new Map();
    for (const [pid, cap] of capById) {
      if (cap < 100.0) allowed.set(pid, Math.floor((targetK * cap + 1e-9) / 100.0));
    }

    // 0. Multi-start backward-drop cover solver + 1-for-1 local swap repair
    if (m > targetK) {
      const drops = m - targetK;
      const runBackwardTrial = (rng, noiseAmp, projWeight) => {
        const active = new Uint8Array(m).fill(1);
        const curCounts = new Map(totalFreq);
        for (let step = 0; step < drops; step++) {
          let bestDrop = -1;
          let bestCover = -Infinity;
          let hasAnyExcess = false;
          for (const [pid, lim] of allowed) {
            if ((curCounts.get(pid) || 0) > lim) {
              hasAnyExcess = true;
              break;
            }
          }
          for (let j = m - 1; j >= 0; j--) {
            if (!active[j]) continue;
            let coverScore;
            if (!hasAnyExcess) {
              coverScore = -lineups[j].total_projection * projWeight + (rng ? rng() * noiseAmp : 0);
            } else {
              coverScore = -lineups[j].total_projection * projWeight + (rng ? rng() * noiseAmp : 0);
              for (const pid of lineupPids[j]) {
                const lim = allowed.get(pid);
                if (lim === undefined) continue;
                const excess = (curCounts.get(pid) || 0) - lim;
                if (excess > 0) coverScore += excess * excess * 100;
                else coverScore -= 1; // avoid dropping under-cap coverage when breaking ties
              }
            }
            if (coverScore > bestCover) {
              bestCover = coverScore;
              bestDrop = j;
            }
          }
          if (bestDrop < 0) break;
          active[bestDrop] = 0;
          for (const pid of lineupPids[bestDrop]) {
            curCounts.set(pid, (curCounts.get(pid) || 0) - 1);
          }
        }

        // 1-for-1 swap repair if any excess remains
        for (let sw = 0; sw < 30; sw++) {
          let badPid = null;
          for (const [pid, lim] of allowed) {
            if ((curCounts.get(pid) || 0) > lim) {
              badPid = pid;
              break;
            }
          }
          if (!badPid) break;
          let swapped = false;
          for (let outJ = m - 1; outJ >= 0 && !swapped; outJ--) {
            if (!active[outJ] || !lineupPids[outJ].includes(badPid)) continue;
            const outSet = new Set(lineupPids[outJ]);
            for (let inJ = 0; inJ < m; inJ++) {
              if (active[inJ] || lineupPids[inJ].includes(badPid)) continue;
              let createsViolation = false;
              for (const pid of lineupPids[inJ]) {
                if (outSet.has(pid)) continue;
                const lim = allowed.get(pid);
                if (lim !== undefined && (curCounts.get(pid) || 0) + 1 > lim) {
                  createsViolation = true;
                  break;
                }
              }
              if (!createsViolation) {
                active[outJ] = 0;
                active[inJ] = 1;
                for (const pid of lineupPids[outJ]) curCounts.set(pid, (curCounts.get(pid) || 0) - 1);
                for (const pid of lineupPids[inJ]) curCounts.set(pid, (curCounts.get(pid) || 0) + 1);
                swapped = true;
                break;
              }
            }
          }
          if (!swapped) break;
        }
        for (const [pid, lim] of allowed) {
          if ((curCounts.get(pid) || 0) > lim) return null;
        }
        const kept = [];
        for (let j = 0; j < m; j++) if (active[j]) kept.push(lineups[j]);
        return kept.length === targetK ? kept : null;
      };

      const deterministic = runBackwardTrial(null, 0, 0.01);
      if (deterministic) return deterministic;
      for (const s of [11, 29, 47, 73, 101, 149]) {
        const trial = runBackwardTrial(makeRng(s + targetK * 19), 25, 0.005);
        if (trial) return trial;
      }
    }

    // Check feasibility across different static priority orderings plus adaptive greedy
    const indices = Array.from({ length: m }, (_, i) => i);
    const orderings = [
      // 1. Lowest congestion first (packs most constrained lineups evenly)
      [...indices].sort((a, b) => congestion[a] - congestion[b] || lineups[b].total_projection - lineups[a].total_projection),
      // 2. Balanced projection minus congestion
      [...indices].sort((a, b) => (lineups[b].total_projection - 20 * congestion[b]) - (lineups[a].total_projection - 20 * congestion[a])),
      // 3. Highest projection first
      [...indices],
      // 4. Reverse projection
      [...indices].reverse(),
    ];
    for (const seed of [17, 42, 99, 137]) {
      const r = makeRng(seed + targetK * 31);
      orderings.push(
        [...indices]
          .map((i) => ({ i, key: r() - 0.1 * congestion[i] }))
          .sort((a, b) => b.key - a.key)
          .map((x) => x.i),
      );
    }

    for (const order of orderings) {
      const chosen = [];
      const curCounts = new Map();
      const canAdd = (idx) => {
        for (const pid of lineupPids[idx]) {
          const lim = allowed.get(pid);
          if (lim !== undefined && (curCounts.get(pid) || 0) + 1 > lim) return false;
        }
        return true;
      };
      for (const idx of order) {
        if (!canAdd(idx)) continue;
        chosen.push(idx);
        for (const pid of lineupPids[idx]) curCounts.set(pid, (curCounts.get(pid) || 0) + 1);
        if (chosen.length === targetK) {
          return chosen.sort((a, b) => a - b).map((j) => lineups[j]);
        }
      }
    }

    // Adaptive greedy packing: pick next lineup minimizing peak saturation ratio
    const chosen = [];
    const usedL = new Uint8Array(m);
    const curCounts = new Map();
    for (let step = 0; step < targetK; step++) {
      let bestIdx = -1;
      let bestCost = Infinity;
      for (let j = 0; j < m; j++) {
        if (usedL[j]) continue;
        let ok = true;
        let peakRatio = 0;
        let sumRatio = 0;
        for (const pid of lineupPids[j]) {
          const lim = allowed.get(pid);
          if (lim === undefined) continue;
          const next = (curCounts.get(pid) || 0) + 1;
          if (next > lim) {
            ok = false;
            break;
          }
          const ratio = lim > 0 ? next / lim : 999;
          if (ratio > peakRatio) peakRatio = ratio;
          sumRatio += ratio;
        }
        if (!ok) continue;
        const cost = peakRatio * 100 + sumRatio * 5 - lineups[j].total_projection * 0.05;
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = j;
        }
      }
      if (bestIdx < 0) break;
      usedL[bestIdx] = 1;
      chosen.push(bestIdx);
      for (const pid of lineupPids[bestIdx]) curCounts.set(pid, (curCounts.get(pid) || 0) + 1);
    }
    if (chosen.length === targetK) {
      return chosen.sort((a, b) => a - b).map((j) => lineups[j]);
    }
    return null;
  };

  let bestSubset = null;
  for (let targetK = m - 1; targetK >= 2; targetK--) {
    const packed = tryPackSize(targetK);
    if (packed) {
      bestSubset = packed;
      break;
    }
  }

  if (bestSubset && bestSubset.length >= 2) {
    warnings.push(
      `Portfolio pruned from ${lineups.length} to ${bestSubset.length} lineups to strictly enforce max exposure cap (${globalCap}%).`,
    );
    return bestSubset;
  }

  warnings.push(
    `Max exposure cap (${globalCap}%) cannot be satisfied across >=2 lineups given pool depth; returning top lineup.`,
  );
  return lineups.slice(0, 1);
}

export function runEdgeOptimize(body) {
  const t0 = Date.now();
  const sport = String(body?.sport || "").toLowerCase();
  if (!VALID_SPORTS.has(sport)) {
    return { error: { code: "invalid_sport", message: "sport must be nba/nfl/mma/golf" }, status: 400 };
  }
  const rawPlayers = body?.players;
  if (!Array.isArray(rawPlayers) || rawPlayers.length === 0) {
    return { error: { code: "invalid_players", message: "players must be a non-empty list" }, status: 400 };
  }

  const settings = body?.settings ?? {};
  const solverBackend = body?.solver_backend || "pulp";
  const strategy = String(settings.strategy || "monteCarlo");
  const contestType = String(settings.contest_type || "classic").toLowerCase();
  const salaryCap = Number(settings.salary_cap ?? 50000);
  const numLineups = Math.max(1, Math.min(2000, Number(settings.num_lineups ?? 20)));
  const maxExposure = Number(settings.max_exposure ?? 100.0);
  const uniqueLineups = settings.unique_lineups !== false;
  const allowOpponents = Boolean(settings.allow_opponents);
  const teamMaxLimit = Number(settings.global_max_players_per_team ?? 0);

  if (body?.seeds?.monte_carlo !== undefined) {
    settings.seed = Number(body.seeds.monte_carlo);
  }

  const normalized = rawPlayers.map((p) => normalizePlayer(p, sport));
  const eligible = filterEligible(normalized, settings);
  const warnings = [];

  let slots;
  if (sport === "nfl") {
    slots = contestType === "showdown" ? SHOWDOWN_SLOTS : NFL_CLASSIC_SLOTS;
  } else if (sport === "nba") {
    slots = contestType === "showdown" ? SHOWDOWN_SLOTS : NBA_CLASSIC_SLOTS;
  } else if (sport === "mma") {
    const reqSize = Number(settings.roster_size || 6);
    const distinctBouts = new Set(eligible.map((p) => p.bout).filter(Boolean));
    const size = allowOpponents || distinctBouts.size === 0 ? reqSize : Math.min(reqSize, distinctBouts.size);
    slots = Array.from({ length: size }, () => ({ label: "FLEX", accepts: null, multiplier: 1.0 }));
  } else {
    const reqSize = Number(settings.roster_size || 6);
    slots = Array.from({ length: reqSize }, () => ({ label: "FLEX", accepts: null, multiplier: 1.0 }));
  }

  if (eligible.length < slots.length) {
    return {
      status: 200,
      data: {
        lineups: [],
        strategy,
        solver_backend: solverBackend,
        top_score: 0,
        elapsed_ms: Date.now() - t0,
        warnings: [`Only ${eligible.length} eligible players; need ${slots.length}.`],
        run_metadata: {
          strategy,
          solver_backend: solverBackend,
          result_count: 0,
          top_score: 0,
          elapsed_ms: Date.now() - t0,
          warnings: [`Only ${eligible.length} eligible players; need ${slots.length}.`],
        },
      },
    };
  }

  const lockedSet = new Set();
  eligible.forEach((p, i) => {
    if (p.is_locked) lockedSet.add(i);
  });

  const rawRules = settings.stack_rules?.length ? settings.stack_rules : settings.team_stacking_rules || [];
  const stackRules = buildStackRuleDescriptors(eligible, rawRules);

  if (settings.enable_bring_back && sport === "nba") {
    // Keep lightweight: game stacks already capture bring-back rules cleanly
  }

  const plan = buildStrategyPlan(strategy, eligible, { ...settings, num_lineups: numLineups }, sport);
  const collected = new Map();
  const forbiddenKeys = new Set();

  const hasAnyCap = eligible.some(
    (p) => !p.is_locked && Math.min(maxExposure, p.max_exposure) < 100.0,
  );

  const computeTempExcludedAndScores = (baseScores, mode) => {
    const tempExcluded = new Set();
    const paced = [...baseScores];
    const nBuilt = collected.size;
    const appCounts = new Map();
    if (hasAnyCap && nBuilt > 0) {
      for (const l of collected.values()) {
        const seen = new Set();
        for (const a of l.assignments) {
          if (seen.has(a.player_id)) continue;
          seen.add(a.player_id);
          appCounts.set(a.player_id, (appCounts.get(a.player_id) || 0) + 1);
        }
      }
    }

    eligible.forEach((p, idx) => {
      if (p.is_locked) return;
      const effCap = Math.min(maxExposure, p.max_exposure);
      if (effCap <= 0) {
        tempExcluded.add(idx);
      } else if (effCap < 100.0) {
        const targetApp = Math.max(1, Math.floor(numLineups * (effCap / 100.0) + 1e-9));
        const runningFloor = Math.floor(((nBuilt + 1) * effCap + 1e-9) / 100.0);
        const runningCeil = Math.max(1, Math.ceil(((nBuilt + 1) * effCap - 1e-9) / 100.0));
        let maxApp = targetApp;
        if (nBuilt > 0) {
          if (mode === "pace_strict") maxApp = Math.min(targetApp, runningFloor);
          else if (mode === "pace_ceil") maxApp = Math.min(targetApp, runningCeil);
        }
        const curApp = appCounts.get(p.id) || 0;
        if (curApp >= maxApp) {
          tempExcluded.add(idx);
        } else if (nBuilt > 0 && curApp > 0) {
          const curSharePct = (curApp * 100.0) / nBuilt;
          if (curApp >= Math.max(1, runningFloor) || curSharePct > effCap) {
            paced[idx] *= 0.15;
          } else {
            const ratio = Math.min(1.0, curApp / Math.max(1, targetApp));
            paced[idx] *= Math.max(0.35, 1.0 - 0.55 * ratio);
          }
        }
      }
    });
    return { tempExcluded, paced };
  };

  const tryIteration = (scoresVec, allowTargetFallback = false) => {
    const modes =
      hasAnyCap && collected.size > 0
        ? allowTargetFallback
          ? ["pace_strict", "pace_ceil", "target"]
          : ["pace_strict", "pace_ceil"]
        : ["target"];
    for (const mode of modes) {
      const { tempExcluded, paced } = computeTempExcludedAndScores(scoresVec, mode);
      const picks = solveOneLineup({
        players: eligible,
        scores: paced,
        sport,
        contestType,
        slots,
        salaryCap,
        lockedSet,
        excludedSet: tempExcluded,
        forbiddenKeys,
        stackRules,
        teamMaxLimit,
        allowOpponents,
      });
      if (picks) {
        const lu = buildLineupObject({
          selectedSlotIndices: picks,
          players: eligible,
          slots,
          sport,
          contestType,
          strategy,
          solverBackend,
        });
        if (!collected.has(lu.unique_key)) {
          collected.set(lu.unique_key, lu);
          forbiddenKeys.add(lu.unique_key);
          return true;
        }
      }
    }
    return false;
  };

  const budgetMs = 1500;
  // Pass 1: build with running exposure pacing first so no chalk cluster
  // saturates targetApp early and traps short builds above max_exposure.
  for (const step of plan) {
    if (Date.now() - t0 > budgetMs) break;
    tryIteration(step.scores, false);
    if (collected.size >= numLineups || (!uniqueLineups && collected.size >= 1)) break;
  }

  // Pass 2: if running pacing left the build short of numLineups, allow target cap
  // fallback across remaining/extra iterations before pruning.
  if (uniqueLineups && hasAnyCap && collected.size < numLineups) {
    for (const step of plan) {
      if (Date.now() - t0 > budgetMs) break;
      tryIteration(step.scores, true);
      if (collected.size >= numLineups) break;
    }
  }

  // Extra deterministic perturbations if still short
  let extraIter = plan.length;
  let misses = 0;
  if (
    uniqueLineups &&
    collected.size < numLineups &&
    (strategy === "maxProjection" || strategy === "balanced" || strategy === "salaryCap")
  ) {
    const base = baseScoresForStrategy(strategy, eligible);
    const amount = strategy === "maxProjection" ? 0.06 : 0.1;
    const seedBase = Number(settings.seed ?? 42);
    while (collected.size < numLineups && misses < 12 && Date.now() - t0 < budgetMs) {
      extraIter += 1;
      const perturbed = perturbScores(base, amount, seedBase + extraIter * 7919);
      if (tryIteration(perturbed, true)) misses = 0;
      else misses += 1;
    }
  }

  let ordered = [...collected.values()].sort((a, b) => b.total_projection - a.total_projection);
  if (!uniqueLineups && ordered.length > 0 && numLineups > 1) {
    const best = ordered[0];
    ordered = Array.from({ length: numLineups }, (_, i) => ({
      ...best,
      assignments: best.assignments.map((a) => ({ ...a })),
      rank: i + 1,
    }));
  } else {
    ordered = ordered.slice(0, numLineups);
    ordered = enforceExposureCaps(ordered, eligible, { ...settings, max_exposure: maxExposure }, warnings);
    ordered.forEach((l, i) => {
      l.rank = i + 1;
    });
  }

  const topScore = ordered.reduce((mx, l) => Math.max(mx, l.total_projection), 0);
  const elapsedMs = Date.now() - t0;

  return {
    status: 200,
    data: {
      lineups: ordered,
      strategy,
      solver_backend: solverBackend,
      top_score: topScore,
      elapsed_ms: elapsedMs,
      warnings,
      run_metadata: {
        strategy,
        solver_backend: solverBackend,
        result_count: ordered.length,
        top_score: topScore,
        elapsed_ms: elapsedMs,
        warnings,
      },
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// CSV & minimal valid ZIP/XLSX export + CSV import preview
// ───────────────────────────────────────────────────────────────────────────
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function lineupsToCsv(lineups) {
  if (!Array.isArray(lineups) || lineups.length === 0) {
    return "rank,strategy,total_salary,total_projection,total_ceiling,assignments\n";
  }
  const headerMax = Math.max(0, ...lineups.map((l) => (l.assignments || []).length));
  if (headerMax === 0) return "rank,strategy,total_salary,total_projection\n";

  const headers = [
    "rank",
    "strategy",
    "total_salary",
    "total_projection",
    "total_ceiling",
    ...Array.from({ length: headerMax }, (_, i) => `slot${i + 1}`),
  ];
  const rows = [headers.join(",")];
  for (const lu of lineups) {
    const row = [
      lu.rank ?? "",
      lu.strategy ?? "",
      lu.total_salary ?? "",
      Number(lu.total_projection ?? 0).toFixed(2),
      Number(lu.total_ceiling ?? 0).toFixed(2),
    ];
    for (const a of lu.assignments || []) {
      const mult = Number(a.score_multiplier ?? 1);
      row.push(`${a.slot ?? ""}: ${a.player_name ?? ""}${mult >= 1.5 ? " (CPT)" : ""}`);
    }
    rows.push(row.map(csvEscape).join(","));
  }
  return `${rows.join("\n")}\n`;
}

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const centrals = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const nameBytes = enc.encode(name);
    const data = typeof content === "string" ? enc.encode(content) : content;
    const c = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, c, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, c, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    parts.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  let centralLen = 0;
  for (const c of centrals) centralLen += c.length;

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralLen, true);
  ev.setUint32(16, offset, true);

  const totalLen = offset + centralLen + end.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of [...parts, ...centrals, end]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function lineupsToXlsx(lineups) {
  const rows = [];
  if (!Array.isArray(lineups) || lineups.length === 0) {
    rows.push(["No lineups"]);
  } else {
    const headerMax = Math.max(0, ...lineups.map((l) => (l.assignments || []).length));
    rows.push([
      "rank",
      "strategy",
      "total_salary",
      "total_projection",
      "total_ceiling",
      ...Array.from({ length: headerMax }, (_, i) => `slot${i + 1}`),
    ]);
    for (const lu of lineups) {
      const r = [
        lu.rank ?? "",
        lu.strategy ?? "",
        lu.total_salary ?? "",
        Math.round(Number(lu.total_projection ?? 0) * 100) / 100,
        Math.round(Number(lu.total_ceiling ?? 0) * 100) / 100,
      ];
      for (const a of lu.assignments || []) {
        const mult = Number(a.score_multiplier ?? 1);
        r.push(`${a.slot ?? ""}: ${a.player_name ?? ""}${mult >= 1.5 ? " (CPT)" : ""}`);
      }
      rows.push(r);
    }
  }

  const rowXml = rows
    .map(
      (cols) =>
        `<row>${cols
          .map((val) =>
            typeof val === "number"
              ? `<c t="n"><v>${val}</v></c>`
              : `<c t="inlineStr"><is><t>${xmlEscape(val)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Lineups" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  return buildZip([
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rels },
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: wbRels },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml },
  ]);
}

function parseCsvRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const splitLine = (line) => {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === "," && !inQ) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = splitLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] ?? "";
    });
    return obj;
  });
}

function parseCsvImportPreview(sport, csvText) {
  const rows = parseCsvRows(csvText);
  const warnings = [];
  const players = rows
    .filter((r) => r.Name || r.Player || r.Fighter)
    .map((r, idx) => {
      const name = String(r.Name || r.Player || r.Fighter || "").trim();
      const rawSal = String(r.Salary || "0").replace(/[$,]/g, "").trim();
      const salary = Number.parseInt(rawSal, 10) || 0;
      const proj = Number.parseFloat(String(r.FPPG || r.AvgPointsPerGame || r.Projection || r.Proj || "0")) || 0;
      const rawPos = String(r.Position || r.Pos || "").trim();
      const positions = rawPos ? rawPos.split(/[\/,\s]+/).filter(Boolean) : [];
      const rosterPositions =
        sport === "nfl"
          ? [...new Set(positions.flatMap((p) => nflRosterPositions(p.toUpperCase())))]
          : sport === "nba"
            ? [...new Set(positions.flatMap((p) => nbaRosterPositions(p.toUpperCase())))]
            : ["FLEX"];
      const gameInfo = String(r["Game Info"] || r.Game || "");
      const m = gameInfo.match(/([A-Z]{2,5}@[A-Z]{2,5})/);
      return {
        id: String(r.ID || r.Id || r["Player ID"] || `${sport}-csv-${idx}`),
        name,
        salary,
        projection: proj,
        team: String(r.TeamAbbrev || r.Team || ""),
        opponent: String(r.Opponent || r.Opp || ""),
        game_info: gameInfo,
        positions,
        roster_positions: rosterPositions,
        correlation_group: m ? m[1] : "",
        opponent_id: String(r.Opponent || ""),
        bout: String(r.Bout || ""),
      };
    });
  return {
    slate_id: `import-${sport}`,
    sport,
    name: `Imported ${sport.toUpperCase()} Slate`,
    player_count: players.length,
    players,
    warnings,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Main HTTP Router
// ───────────────────────────────────────────────────────────────────────────
export async function handleEdgeApiRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders(request, env) });
  }

  const url = new URL(request.url);
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;

  if (request.method === "GET" && (path === "/api/health/" || path === "/")) {
    return jsonResponse(request, env, {
      status: "ok",
      service: "fantasy-grinder-api",
      version: "1.0.0",
      db: "ok",
    });
  }

  if (request.method === "GET" && path === "/api/slates/") {
    const sport = url.searchParams.get("sport");
    if (!VALID_SPORTS.has(sport)) {
      return jsonResponse(
        request,
        env,
        { code: "invalid_sport", message: "sport must be nba/nfl/mma/golf" },
        400,
      );
    }
    const notBefore = url.searchParams.get("not_before_date");

    // The live DraftKings slate first. If DraftKings cannot be reached,
    // or has no slate for this sport, the bundled sample is served and it
    // says so. A sample is never dressed up as a DraftKings slate.
    try {
      const live = await fetchLiveDkSlate(sport);
      if (notBefore && live.slate.slate_date < notBefore) {
        return jsonResponse(request, env, []);
      }
      return jsonResponse(request, env, [live.slate]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const baseSlate = SAMPLE_DATA.slates[sport];
      const liveDate = tomorrowIsoDate();
      const slate = {
        ...baseSlate,
        slate_date: liveDate,
        created_at: `${liveDate}T00:00:00Z`,
        data_source: "sample",
        warnings: [`Live DraftKings slate unavailable: ${reason}`],
      };
      if (notBefore && slate.slate_date < notBefore) {
        return jsonResponse(request, env, []);
      }
      return jsonResponse(request, env, [slate]);
    }
  }

  const slateDetailMatch = path.match(/^\/api\/slates\/([^/]+)\/$/);
  if (request.method === "GET" && slateDetailMatch) {
    const id = decodeURIComponent(slateDetailMatch[1]);
    const liveId = parseSlateId(id);
    if (liveId) {
      try {
        const live = await fetchLiveDkSlateByGroup(liveId.sport, liveId.draftGroupId);
        return jsonResponse(request, env, { ...live.slate, players: live.players });
      } catch (err) {
        return jsonResponse(
          request,
          env,
          { code: "dk_unavailable", message: err instanceof Error ? err.message : "DraftKings slate unavailable" },
          503,
        );
      }
    }
    const entry = Object.values(SAMPLE_DATA.slates).find((s) => s.id === id);
    if (!entry) {
      return jsonResponse(request, env, { code: "not_found", message: `Slate ${id} not found` }, 404);
    }
    const liveDate = tomorrowIsoDate();
    return jsonResponse(request, env, {
      ...entry,
      slate_date: liveDate,
      created_at: `${liveDate}T00:00:00Z`,
      players: SAMPLE_DATA.playersBySport[entry.sport] ?? [],
    });
  }

  if (request.method === "GET" && path === "/api/players/") {
    const slateId = url.searchParams.get("slate_id");
    const sport = url.searchParams.get("sport");
    if (slateId) {
      const liveId = parseSlateId(slateId);
      if (liveId) {
        try {
          const live = await fetchLiveDkSlateByGroup(liveId.sport, liveId.draftGroupId);
          return jsonResponse(request, env, {
            results: live.players,
            warnings: live.warnings,
            data_source: "draftkings-live",
          });
        } catch (err) {
          return jsonResponse(
            request,
            env,
            {
              results: [],
              warnings: [
                `DraftKings live slate unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
              ],
              data_source: "error",
            },
            503,
          );
        }
      }
      const entry = Object.values(SAMPLE_DATA.slates).find((s) => s.id === slateId);
      if (!entry) return jsonResponse(request, env, { code: "not_found" }, 404);
      return jsonResponse(request, env, {
        results: SAMPLE_DATA.playersBySport[entry.sport] ?? [],
        warnings: ["This is the bundled sample roster, not a live DraftKings slate."],
        data_source: "sample",
      });
    }
    if (!VALID_SPORTS.has(sport)) {
      return jsonResponse(
        request,
        env,
        { code: "invalid_sport", message: "sport must be nba/nfl/mma/golf (or pass slate_id)" },
        400,
      );
    }
    return jsonResponse(request, env, {
      results: SAMPLE_DATA.playersBySport[sport] ?? [],
      warnings: ["This is the bundled sample roster, not a live DraftKings slate."],
      data_source: "sample",
    });
  }

  if (request.method === "POST" && path === "/api/optimize/") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(request, env, { code: "invalid_json", message: "Request body must be valid JSON" }, 400);
    }
    const res = runEdgeOptimize(body);
    if (res.error) return jsonResponse(request, env, res.error, res.status || 400);
    return jsonResponse(request, env, res.data, 200);
  }

  if (request.method === "POST" && path === "/api/export/csv/") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse(request, env, { code: "invalid_json" }, 400);
    }
    const csvText = lineupsToCsv(body?.lineups || []);
    return new Response(csvText, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="lineups.csv"',
        ...buildCorsHeaders(request, env),
      },
    });
  }

  if (request.method === "POST" && path === "/api/export/excel/") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse(request, env, { code: "invalid_json" }, 400);
    }
    const xlsxBytes = lineupsToXlsx(body?.lineups || []);
    return new Response(xlsxBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="lineups.xlsx"',
        ...buildCorsHeaders(request, env),
      },
    });
  }

  if (request.method === "POST" && (path === "/api/import/csv/" || path === "/api/import/excel/")) {
    const ct = request.headers.get("Content-Type") || "";
    let sport = url.searchParams.get("sport");
    let csvText = "";
    if (ct.includes("multipart/form-data")) {
      const form = await request.formData();
      sport = String(form.get("sport") || sport || "");
      const f = form.get("file");
      if (!f) return jsonResponse(request, env, { code: "missing_file", message: "file is required" }, 400);
      csvText = await f.text();
    } else if (ct.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      sport = String(body.sport || sport || "");
      csvText = String(body.csv || body.content || "");
    } else {
      csvText = await request.text();
    }
    if (!VALID_SPORTS.has(sport)) {
      return jsonResponse(
        request,
        env,
        { code: "invalid_sport", message: "sport must be nba/nfl/mma/golf" },
        400,
      );
    }
    return jsonResponse(request, env, parseCsvImportPreview(sport, csvText), 200);
  }

  return jsonResponse(request, env, { code: "not_found", message: `Unknown endpoint: ${url.pathname}` }, 404);
}
