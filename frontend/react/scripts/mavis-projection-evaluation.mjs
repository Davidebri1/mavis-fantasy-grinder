#!/usr/bin/env node
/**
 * mavis-projection-evaluation.mjs — walk-forward evaluation of Dave's
 * projection model against a plain baseline on real DraftKings-point
 * actuals. Built by mavis for Dave. Supersedes
 * scripts/mavis-accuracy-history.mjs (its proven ESPN fetch layer is
 * reused here verbatim) and docs/mavis-accuracy-history.md (superseded by
 * docs/mavis-projection-evaluation.md).
 *
 * The engine is src/lib/dave-projection.ts; this script runs its
 * bare-Node mirror scripts/dave-port.mjs (parity-tested in
 * scripts/dave-port.test.mjs). The engine supplies the median split, the
 * halves, outlier peeling, the ranked factor list with its two-sample
 * t-tests, and the sameness test. The harness applies the owner's
 * evaluation spec on top of that.
 *
 * -------------------------------------------------------------------------
 * DEFINITIONS (authoritative — mirrored in docs/mavis-projection-evaluation.md)
 * -------------------------------------------------------------------------
 *
 * GAME OF RECORD
 *   One completed game for one player in the dataset (ESPN box score,
 *   scored with DraftKings' published rubric). Every game of record is
 *   written to the CSV. Nothing is omitted.
 *
 * FIRST GAME OF RECORD
 *   A player's first game in the dataset. It has no earlier games, so no
 *   cut and no projection exist for it. It is recorded as information
 *   ("first game of record"), not silence.
 *
 * EARLIER GAMES / EARLIER_N
 *   For a target game: that player's completed games whose date is
 *   STRICTLY before the target game's date, all seasons, sorted by date.
 *   earlier_n is their count.
 *
 * CUT (C) - LOGISTICS, NOT A FINDING
 *   The earlier games are split in half at the median: sorted ascending,
 *   the LOW half takes the first ceil(n/2) games (an odd count puts the
 *   middle game in the LOW half). C = the largest value in the LOW half.
 *   This is how the two halves are formed. It is a means, not a result:
 *   it is never reported as a rate, and it is NOT the definition of a
 *   boom.
 *
 * CONTROL LIMITS
 *   The mean of the LOW half is the LOWER control limit; the mean of the
 *   HIGH half is the UPPER control limit (post-peel, the engine's own
 *   numbers). The CONTROL LIMIT RANGE R = upper - lower is the width of
 *   the band. Good players have tight limits, inconsistent players have
 *   wide ones. R is the yardstick: every comparison below is measured in
 *   units of R.
 *
 * HIGH SCORING GAME (the parent term)
 *   A game whose DK points are above that player's own average of the
 *   earlier games. Every boom is a high scoring game; a high scoring
 *   game is not necessarily a boom. Words are not interchangeable: the
 *   child inherits from the parent, it never contradicts it.
 *
 * BOOM = OUTLIER HIGH, BUST = OUTLIER LOW
 *   A boom is a high scoring game that breaks ABOVE the upper control
 *   limit. A bust is the mirror: below the lower control limit. Games
 *   between the limits are inside the band. These are the peaks that
 *   don't belong - the outliers his document separates out - so the
 *   definition is a child of "high scoring", never a contradiction of it.
 *
 * BAND POSITION (the unit everything is measured in)
 *   (value - lower limit) / R. The actual's position is below 0 on a
 *   bust, above 1 on a boom, inside 0..1 otherwise. The model's position
 *   is where its projection sits in the band; the baseline's is where its
 *   plain average sits.
 *
 * BASELINE
 *   The plain prior-games average (arithmetic mean of the earlier games;
 *   no split, no factor, no weighting, no outlier removal). It is scored
 *   in the same band units as the model.
 *
 * P (the owner's rule, as the engine runs it)
 *   The probability that the winning factor's high-side condition holds
 *   for the UPCOMING game: 1 when the condition holds, 0 when it does
 *   not, and the even-split floor (0.5) when no factor's state is known
 *   for that game. The projection is high mean x P + low mean x (1 - P)
 *   - his document's formula.
 *
 * MODEL PATHS
 *   - factor:            a factor cleared the evidence floor (|t| >= 2)
 *                        and its state is known for the upcoming game;
 *                        P = 1 or 0 accordingly, formula applied.
 *   - raw average:       the two halves are the same population (Welch
 *                        two-sample t, |t| < 2.1); the projection is the
 *                        raw average of the earlier games - his document's
 *                        definitional rule.
 *   - even-split floor:  no factor's state is known for this game; P =
 *                        0.5 and the projection is the balanced average of
 *                        the two half means - his definitional floor.
 *   - no control limits: earlier_n < 4 - too few games to split into
 *                        halves, so his method has no control limits and
 *                        no projection yet. The row is recorded (nothing
 *                        is omitted) and is not scored.
 *
 * LOW-SAMPLE ASTERISK
 *   Every game with earlier_n >= 1 gets a projection. Games with
 *   earlier_n < 30 are flagged in sample_flag ("low sample (n=12)") —
 *   the projection is still issued and still recorded. The 30-game line
 *   is the Central Limit Theorem threshold the owner set; rows below it
 *   are asterisked, never dropped.
 *
 * CONTAINMENT (supporting line)
 *   For evaluations with an interval (earlier_n >= 4): same when the
 *   actual DK points fall inside the model's 90% interval, different
 *   otherwise. Never called a "miss".
 *
 * FACTORS FED (all known before kickoff, all objective)
 *   isHome (boolean), month (categorical), opponent (categorical: the
 *   opposing team's abbreviation), restDays (numeric: days since that
 *   player's previous game of record), regimeShifts (numeric: the number
 *   of level-shift breakpoints recorded for the player strictly before
 *   that game — the feedable form of the regime flag; breakpoints
 *   themselves are leads, not firings).
 *
 * NOT FEEDABLE TODAY (listed in the doc, never faked)
 *   Receiver availability / injuries, snap counts and targets (in-game),
 *   weather, betting lines, coaching changes — reasons in the doc.
 *
 * USAGE
 *   node scripts/mavis-projection-evaluation.mjs
 *   MAVIS_TEAMS=ne,gb,pit,sf MAVIS_SEASON_START=2002 MAVIS_SEASON_END=2026
 *   MAVIS_REFRESH=1 (refetch every summary, ignoring the cache)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectDave,
  detectBreakpoints,
  cutOf,
  mean,
  sampleVariance,
  Z90,
} from "./dave-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_CSV = join(HERE, "..", ".tmp-audit", "projection-evaluation.csv");
const OUT_JSON = join(HERE, "..", ".tmp-audit", "projection-evaluation.json");
const CACHE_DIR = process.env.MAVIS_CACHE_DIR
  ? join(process.env.MAVIS_CACHE_DIR)
  : join(tmpdir(), "mavis-accuracy-cache");

const TEAMS = (process.env.MAVIS_TEAMS ?? "ne,gb,pit,sf")
  .split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
const SEASON_START = Number(process.env.MAVIS_SEASON_START ?? 2002);
const SEASON_END = Number(process.env.MAVIS_SEASON_END ?? 2026);
const LOW_SAMPLE_N = Number(process.env.MAVIS_LOW_SAMPLE_N ?? 30);
const CONCURRENCY = Number(process.env.MAVIS_CONCURRENCY ?? 8);
const POSITION_LOOKUP_CAP = Number(process.env.MAVIS_POSITION_LOOKUP_CAP ?? 3000);
const REFRESH = process.env.MAVIS_REFRESH === "1";

const SEASONS = [];
for (let y = SEASON_START; y <= SEASON_END; y++) SEASONS.push(y);

const ERAS = [
  { label: "2002-2008", from: 2002, to: 2008 },
  { label: "2009-2014", from: 2009, to: 2014 },
  { label: "2015-2020", from: 2015, to: 2020 },
  { label: "2021-2026", from: 2021, to: 2026 },
];

// ---------------------------------------------------------------------------
// ESPN fetch layer — reused verbatim from the proven
// scripts/mavis-accuracy-history.mjs (team schedule -> event summary ->
// DraftKings points per player).
// ---------------------------------------------------------------------------

let REQUESTS = 0;
const FAILURES = [];

async function getJson(url, label) {
  const tries = 4;
  for (let i = 0; i < tries; i++) {
    try {
      REQUESTS++;
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
      if (res.ok) return await res.json();
      if (i === tries - 1) throw new Error("HTTP " + res.status);
    } catch (err) {
      if (i === tries - 1) {
        FAILURES.push((label ?? url) + " :: " + err.message);
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// DraftKings published scoring rubric.
function dkPointsFor(rec) {
  const get = (group, key) => {
    const g = rec.groups[group];
    if (!g) return 0;
    const i = g.keys.indexOf(key);
    if (i < 0) return 0;
    const v = Number(g.values[i]);
    return Number.isFinite(v) ? v : 0;
  };
  let pts = 0;
  const passYds = get("passing", "passingYards");
  pts += passYds * 0.04 + get("passing", "passingTouchdowns") * 4 - get("passing", "interceptions");
  if (passYds >= 300) pts += 3;
  const rushYds = get("rushing", "rushingYards");
  pts += rushYds * 0.1 + get("rushing", "rushingTouchdowns") * 6;
  if (rushYds >= 100) pts += 3;
  const recYds = get("receiving", "receivingYards");
  pts += get("receiving", "receptions") + recYds * 0.1 + get("receiving", "receivingTouchdowns") * 6;
  if (recYds >= 100) pts += 3;
  pts += get("receiving", "twoPointConversions") * 2;
  pts -= get("fumbles", "fumblesLost");
  return Math.round(pts * 100) / 100;
}

function passingAttempts(rec) {
  const g = rec.groups.passing;
  if (!g) return 0;
  const i = g.keys.indexOf("completions/passingAttempts");
  if (i < 0) return 0;
  const parts = String(g.values[i] ?? "").split("/");
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : 0;
}

function groupNumber(rec, group, key) {
  const g = rec.groups[group];
  if (!g) return 0;
  const i = g.keys.indexOf(key);
  if (i < 0) return 0;
  const v = Number(g.values[i]);
  return Number.isFinite(v) ? v : 0;
}

function inferPosition(rec) {
  const att = passingAttempts(rec);
  const rushAtt = groupNumber(rec, "rushing", "rushingAttempts");
  const targets = groupNumber(rec, "receiving", "receivingTargets");
  if (att > 0) return "QB";
  if (rushAtt > 0 && targets > 0) return "RB";
  if (rushAtt >= 3 && targets === 0) return "RB";
  if (targets > 0) return "WR/TE";
  if (rushAtt > 0) return "RB";
  return null;
}

/** Pull both teams' box scores out of one event summary. */
function harvestSummary(sum, date, season) {
  const competitors = sum?.header?.competitions?.[0]?.competitors ?? [];
  const homeAbbr = (competitors.find((c) => c.homeAway === "home")?.team?.abbreviation ?? "").toUpperCase();
  const month = MONTHS[new Date(date).getUTCMonth()];
  const players = [];
  for (const teamBox of sum?.boxscore?.players ?? []) {
    const teamAbbr = (teamBox?.team?.abbreviation ?? "").toUpperCase();
    const isHome = teamAbbr === homeAbbr;
    const byAthlete = new Map();
    for (const g of teamBox?.statistics ?? []) {
      for (const a of g?.athletes ?? []) {
        const id = a?.athlete?.id;
        if (!id) continue;
        let rec = byAthlete.get(id);
        if (!rec) {
          rec = { id: String(id), name: a.athlete.displayName ?? "", groups: {} };
          byAthlete.set(id, rec);
        }
        rec.groups[g.name] = { keys: g.keys ?? [], values: a.stats ?? [] };
      }
    }
    for (const rec of byAthlete.values()) {
      const pos = inferPosition(rec);
      if (!pos) continue; // only offensive players who produced DK-relevant stats
      players.push({
        id: rec.id, name: rec.name, team: teamAbbr, isHome, month,
        season, date, pos, score: dkPointsFor(rec),
      });
    }
  }
  return { date, season, homeAbbr, players };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const round = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const round4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
// The numbers that feed a verdict are written at 12 decimals so the CSV
// reproduces its own labels: anyone recomputing a containment or a
// direction from these columns gets the same answer as the stored verdict.
const round12 = (x) => (Number.isFinite(x) ? Math.round(x * 1e12) / 1e12 : null);
// The midpoint tolerance. The even-split floor, and the raw average when
// the two halves are the same size, both land on the band midpoint;
// floating point puts them a hair either side of it. A projection at the
// midpoint points at neither control limit - it makes no call.
const MIDPOINT_EPS = 1e-9;
const snapMidpoint = (pos) =>
  pos === null || pos === undefined ? null
  : Math.abs(pos - 0.5) <= MIDPOINT_EPS ? 0.5 : pos;
// The direction verdict at full precision. Band position 0 is the lower
// control limit, 0.5 the midpoint, 1 the upper limit.
const directionOf = (pos) =>
  pos === null || pos === undefined ? ""
  : Math.abs(pos - 0.5) <= MIDPOINT_EPS ? "no call"
  : pos > 0.5 ? "up" : "down";
// The limit tolerance. A game that lands exactly ON a control limit does
// not break it - it is inside the band. Floating point puts such a tie a
// hair either side of the line, so the comparison carries a tolerance and
// every reader of the CSV uses the same one.
const LIMIT_EPS = 1e-9;
const outcomeClassOf = (actual, lower, upper) =>
  actual > upper + LIMIT_EPS ? "boom (outlier high)"
  : actual < lower - LIMIT_EPS ? "bust (outlier low)"
  : "inside the band";
const containedOf = (actual, low90, high90) =>
  actual >= low90 - LIMIT_EPS && actual <= high90 + LIMIT_EPS ? "same" : "different";
const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now();
  console.log("mavis-projection-evaluation: teams=" + TEAMS.join(",") +
    " seasons=" + SEASON_START + ".." + SEASON_END +
    " lowSampleN=" + LOW_SAMPLE_N);

  // ---- 1. schedules (only fetched when the cache is cold or refreshed) ---
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, "events.json");
  const cache = !REFRESH && existsSync(cachePath)
    ? JSON.parse(readFileSync(cachePath, "utf8"))
    : {};
  console.log("Cached event summaries available: " + Object.keys(cache).length);

  const events = new Map(); // eventId -> { id, date, season }
  await mapLimit(TEAMS.flatMap((t) => SEASONS.map((s) => [t, s])), 4, async ([team, season]) => {
    try {
      const sched = await getJson(
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/" + team + "/schedule?season=" + season,
        "schedule " + team + " " + season);
      for (const ev of sched?.events ?? []) {
        if (ev?.competitions?.[0]?.status?.type?.completed !== true) continue;
        const id = String(ev.id);
        if (events.has(id)) continue;
        events.set(id, { id, date: ev.date, season });
      }
    } catch { /* recorded in FAILURES */ }
  });
  console.log("Completed regular-season games across seasons: " + events.size +
    " (requests: " + REQUESTS + ")");

  // ---- 2. summaries (cached; fetched only when missing) ------------------
  const ids = [...events.keys()].filter((id) => !cache[id]);
  console.log("Summaries to fetch: " + ids.length);
  let done = 0;
  await mapLimit(ids, CONCURRENCY, async (id) => {
    const ev = events.get(id);
    try {
      const sum = await getJson(
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" + id,
        "summary " + id);
      cache[id] = harvestSummary(sum, ev.date, ev.season);
    } catch { /* recorded in FAILURES */ }
    done++;
    if (done % 400 === 0) {
      console.log("  summaries " + done + "/" + ids.length + " (requests: " + REQUESTS + ")");
      writeFileSync(cachePath, JSON.stringify(cache));
    }
  });
  writeFileSync(cachePath, JSON.stringify(cache));
  const cachedEvents = Object.values(cache);
  const summariesHeld = cachedEvents.length;
  console.log("Event summaries held: " + cachedEvents.length + "/" + events.size +
    " (requests: " + REQUESTS + ")");

  // ---- 3. player logs -----------------------------------------------------
  // factors carried per game (all known before kickoff): isHome, month,
  // team, opponent, restDays. opponent is derived per event: the other
  // team in the box score. restDays = days since that player's previous
  // game of record.
  const logs = new Map(); // athleteId -> [games]
  for (const ev of cachedEvents) {
    const teams = [...new Set((ev.players ?? []).map((p) => p.team))];
    for (const p of ev.players ?? []) {
      if (!logs.has(p.id)) logs.set(p.id, []);
      logs.get(p.id).push({
        date: p.date, season: p.season, score: p.score,
        isHome: p.isHome, month: p.month, team: p.team,
        opponent: teams.length === 2 ? teams.find((t) => t !== p.team) : undefined,
        pos: p.pos, name: p.name,
      });
    }
  }
  for (const list of logs.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (let i = 0; i < list.length; i++) {
      list[i].restDays = i === 0
        ? undefined
        : Math.round((Date.parse(list[i].date) - Date.parse(list[i - 1].date)) / 86400000);
    }
  }
  console.log("Distinct players with DK-relevant games: " + logs.size);

  // ---- 4. walk-forward evaluation: EVERY game recorded --------------------
  const CSV_HEADER = [
    "player", "athlete_id", "position", "team", "opponent", "date", "season",
    "status", "earlier_n", "sample_flag", "cut", "actual_dk_points",
    "control_low", "control_high", "control_range",
    "outcome_class", "actual_band_position",
    "model_path", "model_factor", "model_factor_condition",
    "model_factor_t", "model_factor_df", "model_P",
    "model_projection", "model_band_position", "model_direction",
    "model_low90", "model_high90", "model_contained",
    "baseline_projection", "baseline_band_position", "baseline_direction",
    "peeled_high", "peeled_low", "justification",
  ];
  const csvLines = [CSV_HEADER.join(",")];
  const evalRows = []; // compact per-evaluation records for aggregation
  const careers = new Map(); // athlete_id -> full-career chart data
  let firstGames = 0;

  for (const [id, games] of logs) {
    const name = games[0].name;
    for (let k = 0; k < games.length; k++) {
      const target = games[k];
      const earlier = games.slice(0, k);
      const n = earlier.length;

      if (n === 0) {
        firstGames++;
        const rowObj = {
          player: name, athlete_id: id, position: target.pos, team: target.team,
          opponent: target.opponent ?? "", date: target.date, season: target.season,
          status: "first game of record", earlier_n: 0,
          sample_flag: "first game of record (n=0)", actual_dk_points: round12(target.score),
          justification:
            "first game of record: no earlier games, so no cut and no projection exist for this game",
        };
        csvLines.push(CSV_HEADER.map((h) => csvEscape(rowObj[h])).join(","));
        continue;
      }

      const earlierScores = earlier.map((g) => g.score);
      const cut = cutOf(earlierScores);
      const actual = target.score;
      const sampleFlag = n < LOW_SAMPLE_N ? "low sample (n=" + n + ")" : "";
      const baseline = mean(earlierScores);

      // regime flag: level-shift breakpoints recorded strictly before the
      // target game (leads, not firings) — feedable as a count.
      const shiftDates = detectBreakpoints(
        earlier.map((g) => ({ date: g.date, score: g.score, factors: { team: g.team } })),
      )
        .filter((f) => f.kind === "level shift")
        .map((f) => f.date);
      const regimeFor = (date) => shiftDates.reduce((c, d) => (d <= date ? c + 1 : c), 0);

      const rowObj = {
        player: name, athlete_id: id, position: target.pos, team: target.team,
        opponent: target.opponent ?? "", date: target.date, season: target.season,
        status: "evaluation", earlier_n: n, sample_flag: sampleFlag,
        cut: round(cut), actual_dk_points: round12(actual),
        baseline_projection: round12(baseline),
      };

      if (n < 4) {
        // His method needs four completed games to form two halves, so
        // there are no control limits yet and no projection to score.
        // The row is recorded - nothing is omitted - and it is not scored.
        rowObj.model_path = "no control limits yet (n<4)";
        rowObj.model_projection = round(baseline);
        rowObj.outcome_class = "no control limits yet (n<4)";
        rowObj.justification =
          "earlier_n=" + n + ": fewer than 4 completed games, so his method has no halves, no control limits and no projection yet; recorded as information, not scored";
      } else {
        const earlierEng = earlier.map((g) => ({
          date: g.date, score: g.score,
          factors: {
            isHome: g.isHome, month: g.month, team: g.team,
            opponent: g.opponent, restDays: g.restDays,
            regimeShifts: regimeFor(g.date),
          },
        }));
        const upcoming = {
          isHome: target.isHome, month: target.month, team: target.team,
          opponent: target.opponent, restDays: target.restDays,
          regimeShifts: regimeFor(target.date),
        };
        const proj = projectDave(earlierEng, upcoming);

        // The engine's own P, by his rule: 1 when the winning factor's
        // high-side condition holds for the UPCOMING game, 0 when it does
        // not, and the even-split floor when no factor's state is known.
        const P = proj.p;
        const projection = proj.projection;

        // The control limits: the two half means, post-peel.
        const lowerCL = proj.lowMean;
        const upperCL = proj.highMean;
        const R = upperCL - lowerCL;
        const bandPos = (v) => (R > 0 ? (v - lowerCL) / R : null);

        if (proj.sameMeans) {
          rowObj.model_path = "raw average (halves one population)";
          rowObj.model_factor_condition =
            "halves are one population (two-sample t-test t=" +
            round(proj.halvesT) + ", df=" + round(proj.halvesDf) +
            ") -> raw average of all earlier games, his document's definitional rule";
          rowObj.model_factor_t = round(proj.halvesT);
          rowObj.model_factor_df = round(proj.halvesDf);
        } else if (P !== 0.5) {
          const f = proj.factors.find((x) => x.key === proj.factor);
          rowObj.model_path = "factor";
          rowObj.model_factor = proj.factor ?? "";
          rowObj.model_factor_condition =
            (f ? f.condition : proj.factor ?? "") +
            " (two-sample t-test t=" + round(f ? f.test.t : null) +
            ", df=" + round(f ? f.test.df : null) +
            "; scores average " + round(f ? f.test.withMean : null) + " in n=" +
            (f ? f.test.withN : "?") + " games when the condition holds vs " +
            round(f ? f.test.withoutMean : null) + " in n=" +
            (f ? f.test.withoutN : "?") + " games when it does not)" +
            "; P=" + P + " (the condition " + (P === 1 ? "holds" : "does not hold") +
            " for the upcoming game - his rule)";
          rowObj.model_factor_t = round(f ? f.test.t : null);
          rowObj.model_factor_df = round(f ? f.test.df : null);
        } else {
          const f0 = proj.factors[0];
          rowObj.model_path = "even-split floor (no factor's state known for this game)";
          rowObj.model_factor_condition = f0
            ? "strongest candidate factor " + f0.key + " (" + f0.condition +
              ", two-sample t-test t=" + round(f0.test.t) + ", df=" + round(f0.test.df) +
              ") has no known state for the upcoming game -> even-split floor, his document's definitional rule"
            : "no candidate factor reached |t| >= 2 -> even-split floor, his document's definitional rule";
          if (f0) {
            rowObj.model_factor = f0.key;
            rowObj.model_factor_t = round(f0.test.t);
            rowObj.model_factor_df = round(f0.test.df);
          }
        }
        rowObj.model_P = round4(P);
        rowObj.control_low = round12(lowerCL);
        rowObj.control_high = round12(upperCL);
        rowObj.control_range = round12(R);
        rowObj.model_projection = round12(projection);
        rowObj.model_band_position = bandPos(projection) === null ? "" : round12(snapMidpoint(bandPos(projection)));
        rowObj.baseline_band_position = bandPos(baseline) === null ? "" : round12(snapMidpoint(bandPos(baseline)));
        rowObj.actual_band_position = bandPos(actual) === null ? "" : round12(snapMidpoint(bandPos(actual)));
        // The verdicts are stored, not left to be recomputed from rounded
        // columns: up / down / no call, decided at full precision.
        rowObj.model_direction = directionOf(bandPos(projection));
        rowObj.baseline_direction = directionOf(bandPos(baseline));
        rowObj.outcome_class = outcomeClassOf(actual, lowerCL, upperCL);
        // The engine's own 90% interval, at its own P.
        rowObj.model_low90 = round12(proj.low90);
        rowObj.model_high90 = round12(proj.high90);
        rowObj.model_contained = containedOf(actual, proj.low90, proj.high90);

        // The peaks that don't belong: the outliers the engine separated out
        // of the earlier games, counted by the half they came from. These
        // are his own boom/bust identification inside the training data.
        const sortedIdx = earlierEng
          .map((g, i) => ({ i, score: g.score }))
          .sort((a, b) => a.score - b.score);
        const mid = Math.floor(sortedIdx.length / 2);
        const lowEnd = sortedIdx.length % 2 === 0 ? mid : mid + 1;
        const lowIdx = new Set(sortedIdx.slice(0, lowEnd).map((e) => e.i));
        const peeled = proj.peeled ?? [];
        rowObj.peeled_high = peeled.filter((i) => !lowIdx.has(i)).length;
        rowObj.peeled_low = peeled.filter((i) => lowIdx.has(i)).length;
      }

      if (!rowObj.justification) {
        rowObj.justification =
          rowObj.model_path + (rowObj.model_factor_condition ? " — " + rowObj.model_factor_condition : "") +
          "; control limits low " + round(rowObj.control_low) + " / high " + round(rowObj.control_high) +
          " (control limit range R=" + round(rowObj.control_range) + " DK points)" +
          "; projection " + round(rowObj.model_projection) +
          " -> band position " + round4(rowObj.model_band_position) +
          "; baseline " + round(rowObj.baseline_projection) +
          " -> band position " + round4(rowObj.baseline_band_position) +
          "; actual " + round(actual) +
          " -> band position " + round4(rowObj.actual_band_position) +
          " -> " + rowObj.outcome_class +
          "; peaks separated out of the earlier games: " + rowObj.peeled_high +
          " outlier high (boom), " + rowObj.peeled_low + " outlier low (bust)" +
          (sampleFlag ? "; [" + sampleFlag + "]" : "");
      }

      csvLines.push(CSV_HEADER.map((h) => csvEscape(rowObj[h])).join(","));

      evalRows.push({
        player: name, athlete_id: id, position: target.pos, team: target.team,
        opponent: rowObj.opponent, date: target.date, season: target.season,
        earlier_n: n, sampleFlag,
        cut: round(cut),
        lowerCL: rowObj.control_low ?? null,
        upperCL: rowObj.control_high ?? null,
        R: rowObj.control_range ?? null,
        outcome: rowObj.outcome_class ?? "",
        actualPos: rowObj.actual_band_position ?? null,
        modelPos: rowObj.model_band_position ?? null,
        baselinePos: rowObj.baseline_band_position ?? null,
        factorCondition: rowObj.model_factor_condition ?? "",
        modelPath: rowObj.model_path, factor: rowObj.model_factor ?? "",
        P: rowObj.model_P ?? null,
        contained: rowObj.model_contained ?? "",
        actual: round(actual), projection: rowObj.model_projection,
        low90: rowObj.model_low90 ?? "", high90: rowObj.model_high90 ?? "",
        baseline: rowObj.baseline_projection,
        peeledHigh: rowObj.peeled_high ?? 0, peeledLow: rowObj.peeled_low ?? 0,
      });
    }

    // full-career chart data for this player (before logs are released)
    careers.set(id, {
      player: name, position: games[0].pos,
      teams: [...new Set(games.map((g) => g.team))].join("/"),
      games: games.length,
      span: games[0].date.slice(0, 10) + " to " + games[games.length - 1].date.slice(0, 10),
      scores: games.map((g) => g.score),
      dates: games.map((g) => g.date),
      flags: detectBreakpoints(
        games.map((g) => ({ date: g.date, score: g.score, factors: { team: g.team } })),
      ),
    });
  }
  // release the logs before aggregation
  const playersSeen = logs.size;
  logs.clear();

  const evaluations = evalRows.length;
  if (evaluations === 0) throw new Error("No evaluations - nothing to report.");
  console.log("Games of record: " + (evaluations + firstGames) +
    " | evaluations (games with >=1 earlier game): " + evaluations +
    " | first games of record: " + firstGames);

  // ---- 5. aggregation -----------------------------------------------------
  // Everything is measured in control-limit-range units (R). The split is
  // logistics: it never appears as a rate.
  const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const medianOf = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const quantileOf = (xs, q) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };
  const pearson = (xs, ys) => {
    const n = xs.length;
    if (n < 3) return null;
    const mx = meanOf(xs);
    const my = meanOf(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const a = xs[i] - mx;
      const b = ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
  };

  const bandScope = (rows) => {
    const scored = rows.filter(
      (r) => r.R !== null && r.R > 0 && r.actualPos !== null && r.modelPos !== null,
    );
    const ranges = scored.map((r) => r.R);
    const booms = scored.filter((r) => r.outcome === "boom (outlier high)");
    const busts = scored.filter((r) => r.outcome === "bust (outlier low)");
    const inside = scored.filter((r) => r.outcome === "inside the band");
    const squaredError = (key) => {
      let s = 0;
      for (const r of scored) { const e = r.actualPos - r[key]; s += e * e; }
      return scored.length ? s / scored.length : null;
    };
    const modelPos = scored.map((r) => r.modelPos);
    const basePos = scored.map((r) => r.baselinePos);
    const actualPos = scored.map((r) => r.actualPos);
    // Only rows with a real band: a zero-width band (R = 0) cannot be
    // placed in a band, so it is not part of the containment scope.
    const withInterval = rows.filter((r) => r.contained !== "" && r.R !== null && r.R > 0);
    const same = withInterval.filter((r) => r.contained === "same").length;
    return {
      evaluations: rows.length,
      withControlLimits: scored.length,
      outcomeClasses: {
        boomOutlierHigh: booms.length,
        bustOutlierLow: busts.length,
        insideTheBand: inside.length,
      },
      controlLimitRange: {
        mean: meanOf(ranges),
        median: medianOf(ranges),
        p10: quantileOf(ranges, 0.1),
        p90: quantileOf(ranges, 0.9),
      },
      bandError: { model: squaredError("modelPos"), baseline: squaredError("baselinePos") },
      bandCorrelation: {
        model: pearson(modelPos, actualPos),
        baseline: pearson(basePos, actualPos),
      },
      peaksSeparated: {
        outlierHigh: rows.reduce((a, r) => a + (r.peeledHigh ?? 0), 0),
        outlierLow: rows.reduce((a, r) => a + (r.peeledLow ?? 0), 0),
      },
      containment: {
        evaluationsWithInterval: withInterval.length,
        same,
        different: withInterval.length - same,
        rate: pct(same, withInterval.length),
      },
    };
  };

  // Does the projection point at the upper control limit when the game broke
  // out, and at the lower limit when it broke down? The reference is each
  // side's own pointing rate over the same rows - never a fixed line.
  const directionScope = (rows) => {
    const scored = rows.filter(
      (r) => r.R !== null && r.R > 0 && r.actualPos !== null && r.modelPos !== null,
    );
    const boom = scored.filter((r) => r.outcome === "boom (outlier high)");
    const bust = scored.filter((r) => r.outcome === "bust (outlier low)");
    const excessOf = (r) => (r.actualPos > 1 ? r.actualPos - 1 : -r.actualPos);
    const sideStats = (side) => {
      const at = (r) => (side === "model" ? r.modelPos : r.baselinePos);
      const pointsUp = (subset) => subset.filter((r) => at(r) > 0.5).length;
      const pointsDown = (subset) => subset.filter((r) => at(r) < 0.5).length;
      const meanExcess = (subset, keep) => {
        const xs = subset.filter(keep).map(excessOf);
        return xs.length ? meanOf(xs) : null;
      };
      const upOnBoom = (r) => at(r) > 0.5;
      const downOnBust = (r) => at(r) < 0.5;
      return {
        rows: scored.length,
        pointsUp: pointsUp(scored),
        pointsDown: pointsDown(scored),
        noCall: scored.length - pointsUp(scored) - pointsDown(scored),
        boom: {
          games: boom.length,
          pointsUp: pointsUp(boom),
          pointsDown: pointsDown(boom),
          meanExcessWhenPointingUp: meanExcess(boom, upOnBoom),
          meanExcessWhenPointingDown: meanExcess(boom, (r) => !upOnBoom(r)),
        },
        bust: {
          games: bust.length,
          pointsDown: pointsDown(bust),
          pointsUp: pointsUp(bust),
          meanExcessWhenPointingDown: meanExcess(bust, downOnBust),
          meanExcessWhenPointingUp: meanExcess(bust, (r) => !downOnBust(r)),
        },
      };
    };
    return { model: sideStats("model"), baseline: sideStats("baseline") };
  };

  const perEra = ERAS.map((e) => {
    const rows = evalRows.filter((r) => r.season >= e.from && r.season <= e.to);
    return { era: e.label, ...bandScope(rows), direction: directionScope(rows) };
  });

  const perSeason = SEASONS.map((season) => ({
    season,
    ...bandScope(evalRows.filter((r) => r.season === season)),
  }));

  const overall = { ...bandScope(evalRows), direction: directionScope(evalRows) };

  // model paths + factor usage (every count says what it counts)
  const modelPaths = {
    factor: evalRows.filter((r) => r.modelPath === "factor").length,
    rawAverage: evalRows.filter((r) => r.modelPath.startsWith("raw average")).length,
    evenSplitFloor: evalRows.filter((r) => r.modelPath.startsWith("even-split")).length,
    noControlLimitsNLt4: evalRows.filter((r) => r.modelPath.startsWith("no control limits")).length,
  };
  const factorUsage = {};
  for (const r of evalRows) {
    if (r.modelPath === "factor") factorUsage[r.factor] = (factorUsage[r.factor] ?? 0) + 1;
  }
  // P as the engine runs it: 1 (the condition holds for the upcoming game),
  // 0 (it does not), or the even-split floor (0.5) when no factor's state is
  // known. The distribution is the report - there is no average to speak of.
  const pCounts = { p1: 0, p0: 0, pFloor: 0 };
  for (const r of evalRows) {
    const pv = Number(r.P);
    if (!Number.isFinite(pv)) continue;
    if (pv === 1) pCounts.p1++;
    else if (pv === 0) pCounts.p0++;
    else if (pv === 0.5) pCounts.pFloor++;
  }

  // ---- 6. exact ESPN positions for the audited population (best effort) ---
  const playerIds = [...new Set(evalRows.map((r) => r.athlete_id))];
  const positionOf = new Map();
  let posLookups = 0;
  await mapLimit(playerIds.slice(0, POSITION_LOOKUP_CAP), CONCURRENCY, async (id) => {
    posLookups++;
    try {
      const a = await getJson(
        "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/" + id +
        "?lang=en&region=us", "athlete " + id);
      const abbr = a?.position?.abbreviation;
      if (abbr) positionOf.set(id, abbr);
    } catch { /* recorded in FAILURES */ }
  });
  for (const r of evalRows) {
    const exact = positionOf.get(r.athlete_id);
    if (exact) r.position = exact;
  }
  const positionMix = { asEvaluations: {}, asPlayers: {} };
  for (const r of evalRows) {
    positionMix.asEvaluations[r.position] = (positionMix.asEvaluations[r.position] ?? 0) + 1;
  }
  for (const p of new Set(evalRows.map((r) => r.player + "|" + r.position))) {
    const parts = p.split("|");
    positionMix.asPlayers[parts[1]] = (positionMix.asPlayers[parts[1]] ?? 0) + 1;
  }

  // ---- 7. chart data (deterministic, selection reasons included) ---------
  const evalCounts = new Map();
  for (const r of evalRows) {
    evalCounts.set(r.athlete_id, (evalCounts.get(r.athlete_id) ?? 0) + 1);
  }
  const cvOf = (xs) => {
    const m = mean(xs);
    return m === 0 ? 0 : Math.sqrt(sampleVariance(xs)) / m;
  };
  const bimodalityOf = (xs) => {
    // Pearson bimodality coefficient: (skew^2 + 1) / kurtosis (nominal).
    const m = mean(xs);
    let m2 = 0, m3 = 0, m4 = 0;
    for (const x of xs) { const d = x - m; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
    if (xs.length < 2 || m2 === 0) return 0;
    m2 /= xs.length; m3 /= xs.length; m4 /= xs.length;
    const skew = m3 / Math.pow(m2, 1.5);
    const kurtNominal = m4 / (m2 * m2);
    return kurtNominal === 0 ? 0 : (skew * skew + 1) / kurtNominal;
  };
  const picks = [];
  const pool = [...careers.entries()].filter(([aid]) => (evalCounts.get(aid) ?? 0) >= 30);
  const pick = (label, scoreOf, reason) => {
    let best = null;
    for (const [aid, c] of pool) {
      const v = scoreOf(c);
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      if (!best || v > best.v) best = { aid, v };
    }
    if (best) picks.push({ label, reason, ...careerOut(careers.get(best.aid), best.aid) });
  };
  const careerOut = (c, aid) => ({
    athlete_id: aid, player: c.player,
    // the exact ESPN position when the lookup phase got it, else the
    // first-game inference (which can mislabel a whole career)
    position: positionOf.get(aid) ?? c.position, teams: c.teams,
    games: c.games, span: c.span, scores: c.scores, dates: c.dates,
    cut: cutOf(c.scores), flags: c.flags,
  });
  pick("stable", (c) => -cvOf(c.scores),
    "lowest coefficient of variation of games-of-record DK points among players with >= 30 evaluations");
  pick("bimodal", (c) => bimodalityOf(c.scores),
    "highest Pearson bimodality coefficient of games-of-record DK points among players with >= 30 evaluations");
  pick("wild", (c) => cvOf(c.scores),
    "highest coefficient of variation of games-of-record DK points among players with >= 30 evaluations");
  const cvPool = pool.map(([aid, c]) => ({ aid, cv: cvOf(c.scores) })).sort((a, b) => a.cv - b.cv);
  const cvMedian = cvPool[Math.floor(cvPool.length / 2)];
  if (cvMedian) {
    picks.push({
      label: "middling",
      reason: "player whose CV sits at the median of the pool's CVs (>= 30 evaluations)",
      ...careerOut(careers.get(cvMedian.aid), cvMedian.aid),
    });
  }
  const regimeBest = (() => {
    let best = null;
    for (const [aid, c] of pool) {
      for (const f of c.flags) {
        if (f.kind !== "level shift") continue;
        const m = f.detail.match(/mean (-?[\d.]+) to (-?[\d.]+)/);
        if (!m) continue;
        const gap = Math.abs(Number(m[2]) - Number(m[1]));
        if (!best || gap > best.gap) best = { aid, gap };
      }
    }
    return best;
  })();
  if (regimeBest) {
    const c = careers.get(regimeBest.aid);
    picks.push({
      label: "regime",
      reason: "largest flagged level shift (5-on-5 window two-sample t-test) among all players with >= 30 evaluations",
      ...careerOut(c, regimeBest.aid),
    });
  }
  const scatterEvery = Math.max(1, Math.ceil(evaluations / 2000));
  const scatter = evalRows
    .filter((r) => r.contained !== "")
    .filter((_, i) => i % scatterEvery === 0)
    .map((r) => [r.actual, r.projection, r.low90, r.high90]);
  // the ~40-row doc sample: the most-evaluated player, first 40 evaluations
  const samplePlayerId = [...evalCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const docSample = samplePlayerId ? evalRows.filter((r) => r.athlete_id === samplePlayerId).slice(0, 40) : [];
  const docSamplePlayer = careers.get(samplePlayerId)?.player ?? null;

  // ---- 8. outputs ----------------------------------------------------------
  const result = {
    generatedAt: new Date().toISOString(),
    config: {
      teams: TEAMS, seasonStart: SEASON_START, seasonEnd: SEASON_END,
      lowSampleN: LOW_SAMPLE_N,
      factorsFed: ["isHome", "month", "opponent", "restDays", "regimeShifts"],
      pRule: "P = the probability that the winning factor's high-side condition holds for the UPCOMING game, as the engine runs it: 1 when the condition holds, 0 when it does not, and the even-split floor (0.5) when no factor's state is known; projection = highMean x P + lowMean x (1-P)",
      scoringRubric: "DraftKings published rubric",
      dataPath: "ESPN team schedule -> event summary -> DraftKings points",
    },
    definitions: {
      gameOfRecord: "One completed game for one player in the dataset. Every game of record is written to the CSV; nothing is omitted.",
      firstGameOfRecord: "A player's first game in the dataset: no earlier games, no cut, no projection. Recorded as information.",
      earlierGames: "That player's completed games strictly before the target game's date, all seasons, sorted by date. earlier_n is their count.",
      cut: "C = the largest DK-point value in the LOW half of the median split of the earlier games (odd counts put the middle game in the LOW half). This is how the two halves are formed - logistics, not a finding. It is never reported as a rate and it is NOT the definition of a boom.",
      controlLimits: "The mean of the LOW half is the LOWER control limit; the mean of the HIGH half is the UPPER control limit (post-peel). The control limit range R = upper - lower is the width of the band: good players have tight limits, inconsistent players have wide ones. R is the yardstick - every comparison is measured in units of R.",
      highScoringGame: "A game whose DK points are above that player's own average of the earlier games. Every boom is a high scoring game; a high scoring game is not necessarily a boom.",
      boomGame: "BOOM = OUTLIER HIGH: a high scoring game that breaks ABOVE the upper control limit. The peaks that don't belong, on the high side.",
      bustGame: "BUST = OUTLIER LOW: the mirror - below the lower control limit. The peaks that don't belong, on the low side.",
      insideTheBand: "A game between the two control limits: neither a boom nor a bust.",
      bandPosition: "(value - lower control limit) / R. Below 0 on a bust, above 1 on a boom, inside 0..1 otherwise. The model's position is where its projection sits in the band; the baseline's is where its plain average sits.",
      baseline: "The plain prior-games average (arithmetic mean of the earlier games; no split, no factor, no weighting, no outlier removal), scored in the same band units as the model.",
      direction: "Whether a side's projection sits above or below the band midpoint. Reported as each side's own pointing rate over the same rows - never against a fixed line.",
      P: "The probability that the winning factor's high-side condition holds for the UPCOMING game, as the engine runs it: 1 when the condition holds, 0 when it does not, and the even-split floor (0.5) when no factor's state is known.",
      containment: "For evaluations with an interval (earlier_n >= 4): same when the actual DK points fall inside the model's 90% interval, different otherwise.",
      lowSampleAsterisk: "Every game with >=1 earlier game is evaluated; games under " + LOW_SAMPLE_N + " earlier games are flagged in sample_flag and are still evaluated.",
    },
    coverage: {
      teams: TEAMS, seasons: SEASONS,
      playersSeen, // players with >= 1 game of record
      playersEvaluated: playerIds.length, // players with >= 1 evaluation
      gamesOfRecord: evaluations + firstGames, // every completed player-game in the dataset
      evaluations, // games with >= 1 earlier game (each carries a projection)
      firstGamesOfRecord: firstGames,
      evaluationsLowSample: evalRows.filter((r) => r.earlier_n < LOW_SAMPLE_N).length,
      evaluationsFullSample: evalRows.filter((r) => r.earlier_n >= LOW_SAMPLE_N).length,
      eventsHeld: summariesHeld,
      eventsPlanned: events.size,
      positionMix, // asEvaluations = evaluations per position; asPlayers = distinct players per position
      perEra, perSeason,
    },
    controlLimits: overall, // headline: control limit range, outcome classes, band error and direction
    eras: perEra,
    seasons: perSeason,
    modelPaths, factorUsage, pCounts,
    charts: {
      histogramPlayers: picks,
      scatter: {
        sampledEvery: scatterEvery,
        points: scatter,
        note: "1-in-" + scatterEvery + " deterministic sample of evaluations with an interval; x = actual DK points, y = projection, vertical segment = the model's 90% interval",
      },
      timeline: regimeBest
        ? {
            reason: "largest flagged level shift (5-on-5 window two-sample t-test) among all players with >= 30 evaluations",
            ...careerOut(careers.get(regimeBest.aid), regimeBest.aid),
          }
        : null,
      docSample: { player: docSamplePlayer, athlete_id: samplePlayerId ?? null, rows: docSample },
    },
    requestCount: REQUESTS,
    positionLookups: posLookups,
    failureCount: FAILURES.length,
    failures: FAILURES.slice(0, 200),
    runtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };

  // release the big intermediates before writing
  careers.clear();
  evalRows.length = 0;

  mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, csvLines.join("\n"));
  console.log("Wrote " + OUT_CSV + " (" + (csvLines.length - 1) + " rows)");
  writeFileSync(OUT_JSON, JSON.stringify(result, null, 1));
  console.log("Wrote " + OUT_JSON);

  // ---- 9. console headline ------------------------------------------------
  const blk = overall; // same object as the control-limits headline in the JSON
  console.log("");
  console.log("=== HEADLINE: control limits and predictability (the split is logistics) ===");
  console.log("evaluations with control limits: " + blk.withControlLimits + " of " + blk.evaluations);
  console.log("outcome classes - boom (outlier high): " + blk.outcomeClasses.boomOutlierHigh +
    " | bust (outlier low): " + blk.outcomeClasses.bustOutlierLow +
    " | inside the band: " + blk.outcomeClasses.insideTheBand);
  console.log("control limit range R (DK points): median " + round(blk.controlLimitRange.median) +
    ", mean " + round(blk.controlLimitRange.mean) +
    ", p10 " + round(blk.controlLimitRange.p10) + ", p90 " + round(blk.controlLimitRange.p90));
  console.log("band error (squared error, in R units): model " + round(blk.bandError.model) +
    " | baseline " + round(blk.bandError.baseline));
  console.log("band correlation with the actual: model " + round(blk.bandCorrelation.model) +
    " | baseline " + round(blk.bandCorrelation.baseline));
  console.log("model direction - up on boom games: " + blk.direction.model.boom.pointsUp +
    " of " + blk.direction.model.boom.games + " | down on bust games: " +
    blk.direction.model.bust.pointsDown + " of " + blk.direction.model.bust.games);
  console.log("baseline direction - up on boom games: " + blk.direction.baseline.boom.pointsUp +
    " of " + blk.direction.baseline.boom.games + " | down on bust games: " +
    blk.direction.baseline.bust.pointsDown + " of " + blk.direction.baseline.bust.games);
  console.log("containment (model 90% interval, n=" + blk.containment.evaluationsWithInterval + "): " + blk.containment.rate + "% same");
  console.log("runtime " + result.runtimeSeconds + "s, requests " + REQUESTS + ", failures " + FAILURES.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
