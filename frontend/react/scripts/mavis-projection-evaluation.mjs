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
 * CUT (C)
 *   Split the earlier games' DK points in half at the median: sorted
 *   ascending, the LOW half takes the first ceil(n/2) games (an odd count
 *   puts the middle game in the LOW half). C = the largest value in the
 *   LOW half. Defined ONCE and applied identically to the model, the
 *   baseline, and the actual outcome.
 *
 * BOOM GAME / BUST GAME (the ACTUAL outcome)
 *   Boom  iff actual DK points > C.  Bust iff actual DK points <= C.
 *   Booms and busts are never presented as complements; each is reported
 *   with its own count.
 *
 * MODEL CATEGORIZATION
 *   The model categorizes the target game HIGH iff its projection > C,
 *   LOW otherwise. Same/different only: there are no "misses". Every row
 *   carries its justification (factor used, P, half means, earlier_n).
 *
 * BASELINE
 *   The plain prior-games average (arithmetic mean of the earlier games;
 *   no split, no factor, no weighting, no outlier removal). It is
 *   categorized against the SAME cut C by the SAME rule: HIGH iff its
 *   average > C.
 *
 * AGREEMENT
 *   A categorization AGREES (same) when it matches the actual category:
 *   high on a boom, low on a bust; otherwise different. Agreement rates
 *   are reported for the model and the baseline on booms, on busts, and
 *   overall, each with its one-sample z-test against 50%.
 *
 * P (the owner's rule)
 *   P = the empirical frequency of the winning factor's high-side
 *   condition for that player: the share of the engine's post-peel
 *   earlier games where the condition holds (games with an unknown value
 *   are excluded from both numerator and denominator). The projection is
 *   high mean x P + low mean x (1 - P) — his document's formula.
 *
 * MODEL PATHS
 *   - factor:            a factor cleared the evidence floor (|t| >= 2);
 *                        P = its empirical frequency, formula applied.
 *   - raw average:       the two halves are the same population (Welch
 *                        two-sample t, |t| < 2.1); the projection is the
 *                        raw average of the earlier games — his document's
 *                        definitional rule. P is not applied (reported as
 *                        empty).
 *   - even-split floor:  no factor cleared the evidence floor; P = 0.5
 *                        and the projection is the balanced average of the
 *                        two half means — his definitional floor.
 *   - plain average:     earlier_n < 4 — too few games to split into
 *                        halves; the only projection available is the
 *                        plain average of the earlier games. Flagged by
 *                        the asterisk field like every low sample.
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
const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);

/** One-sample z-test of a rate against 50%. */
function zTest50(k, n) {
  if (!n) return null;
  const p = k / n;
  return Math.round(((p - 0.5) / Math.sqrt(0.25 / n)) * 100) / 100;
}

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
    "actual_category", "model_path", "model_factor", "model_factor_condition",
    "model_factor_t", "model_factor_df", "model_P", "model_high_mean",
    "model_low_mean", "model_projection", "model_low90", "model_high90",
    "model_contained", "model_category", "model_agrees",
    "baseline_projection", "baseline_category", "baseline_agrees",
    "justification",
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
          sample_flag: "first game of record (n=0)", actual_dk_points: round(target.score),
          justification:
            "first game of record: no earlier games, so no cut and no projection exist for this game",
        };
        csvLines.push(CSV_HEADER.map((h) => csvEscape(rowObj[h])).join(","));
        continue;
      }

      const earlierScores = earlier.map((g) => g.score);
      const cut = cutOf(earlierScores);
      const actual = target.score;
      const actualCategory = actual > cut ? "boom" : "bust";
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
        cut: round(cut), actual_dk_points: round(actual),
        actual_category: actualCategory,
        baseline_projection: round(baseline),
        baseline_category: baseline > cut ? "high" : "low",
      };
      rowObj.baseline_agrees =
        (rowObj.baseline_category === "high" && actualCategory === "boom") ||
        (rowObj.baseline_category === "low" && actualCategory === "bust")
          ? "same" : "different";

      if (n < 4) {
        // Too few games to split into halves: the only projection
        // available is the plain average. Still issued, still asterisked.
        rowObj.model_path = "plain average (n<4)";
        rowObj.model_projection = round(baseline);
        rowObj.model_category = baseline > cut ? "high" : "low";
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
        let P; // the owner's rule: empirical frequency of the winning
              // condition; null on the raw-average path (formula not applied)
        let projection;
        if (proj.sameMeans) {
          P = null;
          projection = proj.projection; // raw average of the earlier games
          rowObj.model_path = "raw average (halves one population)";
          rowObj.model_factor_condition =
            "halves are one population (two-sample t-test t=" +
            round(proj.halvesT) + ", df=" + round(proj.halvesDf) +
            ") -> raw average of all earlier games, his document's definitional rule";
          rowObj.model_factor_t = round(proj.halvesT);
          rowObj.model_factor_df = round(proj.halvesDf);
        } else if (proj.factors.length > 0) {
          const f = proj.factors[0]; // strongest by |t|
          P = f.test.withN / (f.test.withN + f.test.withoutN);
          projection = proj.highMean * P + proj.lowMean * (1 - P);
          rowObj.model_path = "factor";
          rowObj.model_factor = f.key;
          rowObj.model_factor_condition = f.condition +
            " (two-sample t-test t=" + round(f.test.t) + ", df=" + round(f.test.df) +
            "; scores average " + round(f.test.withMean) + " in n=" +
            f.test.withN + " games when the condition holds vs " +
            round(f.test.withoutMean) + " in n=" + f.test.withoutN +
            " games when it does not)";
          rowObj.model_factor_t = round(f.test.t);
          rowObj.model_factor_df = round(f.test.df);
        } else {
          P = 0.5;
          projection = proj.highMean * 0.5 + proj.lowMean * 0.5;
          rowObj.model_path = "even-split floor (no factor cleared the evidence floor)";
          rowObj.model_factor_condition =
            "no candidate factor reached |t| >= 2 -> even-split floor, his document's definitional rule";
        }
        rowObj.model_P = P === null ? "" : round4(P);
        rowObj.model_high_mean = round(proj.highMean);
        rowObj.model_low_mean = round(proj.lowMean);
        rowObj.model_projection = round(projection);
        // 90% interval: the engine's two-component mixture variance,
        // rebuilt at this evaluation's own P (engine fields, engine maths).
        const pMix = P === null ? 0.5 : P;
        const variance =
          pMix * pMix * proj.highVar +
          (1 - pMix) * (1 - pMix) * proj.lowVar +
          pMix * (1 - pMix) * Math.pow(proj.highMean - proj.lowMean, 2);
        const halfWidth = Z90 * Math.sqrt(variance);
        rowObj.model_low90 = round(projection - halfWidth);
        rowObj.model_high90 = round(projection + halfWidth);
        rowObj.model_contained =
          actual >= projection - halfWidth && actual <= projection + halfWidth
          ? "same" : "different";
      }

      rowObj.model_category = rowObj.model_category ||
        (rowObj.model_projection > cut ? "high" : "low");
      rowObj.model_agrees =
        (rowObj.model_category === "high" && actualCategory === "boom") ||
        (rowObj.model_category === "low" && actualCategory === "bust")
          ? "same" : "different";

      const pTxt = rowObj.model_P === "" || rowObj.model_P === undefined
        ? "P not applied on this path"
        : "P=" + rowObj.model_P + " (the empirical frequency of the winning condition among the earlier games)";
      rowObj.justification =
        (rowObj.model_path === "factor"
          ? "factor " + rowObj.model_factor + ": " + rowObj.model_factor_condition
          : rowObj.model_path + (rowObj.model_factor_condition ? " — " + rowObj.model_factor_condition : "")) +
        "; " + pTxt +
        "; half means high " + (rowObj.model_high_mean ?? "n/a") +
        " / low " + (rowObj.model_low_mean ?? "n/a") +
        "; cut C=" + round(cut) + " from " + n + " earlier games" +
        "; projection " + rowObj.model_projection + " vs C -> categorized " + rowObj.model_category +
        "; actual " + round(actual) + " vs C -> " + actualCategory +
        "; categorization " + rowObj.model_agrees +
        (sampleFlag ? "; [" + sampleFlag + "]" : "");

      csvLines.push(CSV_HEADER.map((h) => csvEscape(rowObj[h])).join(","));

      evalRows.push({
        player: name, athlete_id: id, position: target.pos, team: target.team,
        opponent: rowObj.opponent, date: target.date, season: target.season,
        earlier_n: n, actualCategory, sampleFlag,
        cut: round(cut), highMean: rowObj.model_high_mean ?? "",
        lowMean: rowObj.model_low_mean ?? "",
        factorCondition: rowObj.model_factor_condition ?? "",
        modelPath: rowObj.model_path, factor: rowObj.model_factor ?? "",
        P: rowObj.model_P, modelCategory: rowObj.model_category,
        modelAgrees: rowObj.model_agrees, baselineCategory: rowObj.baseline_category,
        baselineAgrees: rowObj.baseline_agrees, contained: rowObj.model_contained ?? "",
        actual: round(actual), projection: rowObj.model_projection,
        low90: rowObj.model_low90 ?? "", high90: rowObj.model_high90 ?? "",
        baseline: rowObj.baseline_projection,
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
  const agreementBlock = (rows) => {
    const booms = rows.filter((r) => r.actualCategory === "boom");
    const busts = rows.filter((r) => r.actualCategory === "bust");
    const side = (subset, key) => {
      const n = subset.length;
      const same = subset.filter((r) => r[key] === "same").length;
      return { evaluations: n, same, different: n - same, rate: pct(same, n), z: zTest50(same, n) };
    };
    const highRate = (key) => ({
      evaluations: rows.length,
      categorizedHigh: rows.filter((r) => r[key] === "high").length,
      rate: pct(rows.filter((r) => r[key] === "high").length, rows.length),
    });
    return {
      model: {
        boom: side(booms, "modelAgrees"),
        bust: side(busts, "modelAgrees"),
        overall: side(rows, "modelAgrees"),
      },
      baseline: {
        boom: side(booms, "baselineAgrees"),
        bust: side(busts, "baselineAgrees"),
        overall: side(rows, "baselineAgrees"),
      },
      context: {
        modelCategorizedHigh: highRate("modelCategory"),
        baselineCategorizedHigh: highRate("baselineCategory"),
      },
    };
  };

  const scopeStats = (rows) => {
    const booms = rows.filter((r) => r.actualCategory === "boom").length;
    const busts = rows.filter((r) => r.actualCategory === "bust").length;
    const withInterval = rows.filter((r) => r.contained !== "");
    const same = withInterval.filter((r) => r.contained === "same").length;
    return {
      evaluations: rows.length,
      boomGames: booms,
      bustGames: busts,
      ...agreementBlock(rows),
      containment: {
        evaluationsWithInterval: withInterval.length,
        same,
        different: withInterval.length - same,
        rate: pct(same, withInterval.length),
      },
    };
  };

  const perEra = ERAS.map((e) => {
    const rows = evalRows.filter((r) => r.season >= e.from && r.season <= e.to);
    return { era: e.label, ...scopeStats(rows) };
  });

  const perSeason = SEASONS.map((season) => ({
    season,
    ...scopeStats(evalRows.filter((r) => r.season === season)),
  }));

  const overall = scopeStats(evalRows);

  // model paths + factor usage (every count says what it counts)
  const modelPaths = {
    factor: evalRows.filter((r) => r.modelPath === "factor").length,
    rawAverage: evalRows.filter((r) => r.modelPath.startsWith("raw average")).length,
    evenSplitFloor: evalRows.filter((r) => r.modelPath.startsWith("even-split")).length,
    plainAverageNLt4: evalRows.filter((r) => r.modelPath.startsWith("plain average")).length,
  };
  const factorUsage = {};
  for (const r of evalRows) {
    if (r.modelPath === "factor") factorUsage[r.factor] = (factorUsage[r.factor] ?? 0) + 1;
  }
  const pValues = evalRows.map((r) => Number(r.P)).filter((p) => Number.isFinite(p));
  const meanP = pValues.length ? round4(mean(pValues)) : null;

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
      pRule: "P = the empirical frequency of the winning factor's high-side condition for that player (share of the engine's post-peel earlier games where the condition holds); projection = highMean x P + lowMean x (1-P)",
      scoringRubric: "DraftKings published rubric",
      dataPath: "ESPN team schedule -> event summary -> DraftKings points",
    },
    definitions: {
      gameOfRecord: "One completed game for one player in the dataset. Every game of record is written to the CSV; nothing is omitted.",
      firstGameOfRecord: "A player's first game in the dataset: no earlier games, no cut, no projection. Recorded as information.",
      earlierGames: "That player's completed games strictly before the target game's date, all seasons, sorted by date. earlier_n is their count.",
      cut: "C = the largest DK-point value in the LOW half of the median split of the earlier games (odd counts put the middle game in the LOW half). Defined once, applied identically to model, baseline and actual.",
      boomGame: "A target game whose ACTUAL DK points > C.",
      bustGame: "A target game whose ACTUAL DK points <= C.",
      modelCategorization: "The model categorizes the game HIGH iff its projection > C, LOW otherwise. Same/different only.",
      baseline: "The plain prior-games average, categorized against the SAME cut C by the SAME rule (HIGH iff > C).",
      agreement: "A categorization agrees (same) when it matches the actual category: high on a boom, low on a bust; otherwise different. Reported for model and baseline on booms, busts, and overall, each with a one-sample z-test against 50%.",
      P: "The empirical frequency of the winning factor's high-side condition for that player among the engine's post-peel earlier games.",
      containment: "For evaluations with an interval (earlier_n >= 4): same when the actual DK points fall inside the model's 90% interval, different otherwise.",
      lowSampleAsterisk: "Every game with >=1 earlier game gets a projection; games under " + LOW_SAMPLE_N + " earlier games are flagged in sample_flag and still projected.",
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
    agreement: overall, // headline: model/baseline on booms, busts, overall, each with its z
    eras: perEra,
    seasons: perSeason,
    modelPaths, factorUsage, meanP,
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
  const blk = overall; // same object as the agreement headline in the JSON
  console.log("");
  console.log("=== HEADLINE: categorization agreement, one-sample z vs 50% ===");
  console.log("model    booms:    " + blk.model.boom.rate + "% same (n=" + blk.model.boom.evaluations + ", z=" + blk.model.boom.z + ")");
  console.log("model    busts:    " + blk.model.bust.rate + "% same (n=" + blk.model.bust.evaluations + ", z=" + blk.model.bust.z + ")");
  console.log("model    overall:  " + blk.model.overall.rate + "% same (n=" + blk.model.overall.evaluations + ", z=" + blk.model.overall.z + ")");
  console.log("baseline booms:    " + blk.baseline.boom.rate + "% same (n=" + blk.baseline.boom.evaluations + ", z=" + blk.baseline.boom.z + ")");
  console.log("baseline busts:    " + blk.baseline.bust.rate + "% same (n=" + blk.baseline.bust.evaluations + ", z=" + blk.baseline.bust.z + ")");
  console.log("baseline overall:  " + blk.baseline.overall.rate + "% same (n=" + blk.baseline.overall.evaluations + ", z=" + blk.baseline.overall.z + ")");
  console.log("containment (model 90% interval, n=" + blk.containment.evaluationsWithInterval + "): " + blk.containment.rate + "% same");
  console.log("runtime " + result.runtimeSeconds + "s, requests " + REQUESTS + ", failures " + FAILURES.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
