#!/usr/bin/env node
/**
 * mavis-projection-evaluation.mjs - walk-forward evaluation of Dave's
 * projection model on real DraftKings-point actuals. Built by mavis for Dave.
 * Supersedes scripts/mavis-accuracy-history.mjs (its proven ESPN fetch layer
 * is reused here verbatim).
 *
 * The engine is src/lib/dave-projection.ts; this script runs its bare-Node
 * mirror scripts/dave-port.mjs (parity-tested in scripts/dave-port.test.mjs).
 * The engine supplies the median split, the two populations, the separated
 * hump inside a population, the categories, the ranked factor list with its
 * two-sample t-tests, and the sameness test. The harness applies the owner's
 * evaluation spec on top of that.
 *
 * -------------------------------------------------------------------------
 * DEFINITIONS (authoritative - the JSON's "definitions" block repeats these
 * word for word; the two are diffed by dev/mavis-definition-parity.mjs)
 * -------------------------------------------------------------------------
 * gameOfRecord: One completed game for one player in the dataset (ESPN box score, scored with DraftKings' published rubric). Every game of record is written to the CSV. Nothing is omitted.
 * firstGameOfRecord: A player's first game in the dataset. It has no earlier games, so no cut, no categories and no projection exist for it. It is recorded as information, not silence.
 * earlierGames: For a target game: that player's completed games whose date is STRICTLY before the target game's date, all seasons, sorted by date. earlier_n is their count.
 * cut: CUT - LOGISTICS, NOT A FINDING. The earlier games are split in half at the median: sorted ascending, the LOW half takes the first ceil(n/2) games (an odd count puts the middle game in the LOW half). For a row with two populations the cut is the score boundary between them: the midpoint between the largest score in the LOW half and the smallest score in the HIGH half, or the largest score in the LOW half when the two halves meet at the same score. For a row with fewer than 4 completed games (no populations yet) it is the median-split value of the earlier games. The cut can be decided any way you like - it is how the populations are formed; it is never reported as a rate and it is NOT the definition of a boom.
 * highGame: HIGH GAME - the upper population. A game whose DK points fall in the high half of the player's earlier games, at or above the cut. A population is NEVER called a boom.
 * lowGame: LOW GAME - the lower population. A game whose DK points fall in the low half of the player's earlier games, below the cut.
 * boom: BOOM - a genuine outlier beyond the upper limit. The actual fell in the separated category on the HIGH side AND that separated category sits ABOVE the high side's main body. Every boom is a high game; not every high game is a boom.
 * bust: BUST - the mirror of boom. The actual fell in the separated category on the LOW side AND that separated category sits BELOW the low side's main body.
 * call: THE CALL - categorical, never a coefficient. It names the category the projection represents: high, high-outlier, high-normal, low, low-outlier, low-normal, or even. The probability was external and is turned into a constant - a given - so the model inherits a resolved constant, not a variable.
 * evenFloor: THE FLOOR - even. When no factor's state is known for the upcoming game, the projection is the even split between the high and low populations: half the high population mean + half the low population mean. "half high half low = total projection".
 * sameness: SAMENESS - the only accept/reject in the model. Welch's two-sample t-test on the two halves: when the halves are one population, the call is even and the projection is the raw average of all the earlier games. Nothing else in this model is accepted or rejected.
 * factors: FACTORS - a categorization, not a set of verdicts. A factor condition is a common thread through a separated population, or the condition that separates the two populations. Every candidate is reported with its two-sample t-test, its df and its p-value. No factor is accepted, rejected, passed or failed.
 * categories: CATEGORIES - every earlier game falls in exactly one category, and the categories tile the score space exactly once: high, high-outlier, high-normal, low, low-outlier, low-normal. The category ranges are half-open [lo, hi), null = unbounded. Nothing gets dropped as a miss: every possible outcome has a category.
 * actualCategory: ACTUAL CATEGORY - the id of the category the actual DK points fall in, decided at full precision against the engine's category ranges. It is the fact the owner's one metric is scored on: did the projection equal the actual on this day.
 * outcomeClass: OUTCOME CLASS - the same fact in the owner's words: boom, bust, high game or low game.
 * largestCategory: LARGEST CATEGORY - the category holding the most of the player's earlier games at that point; ties go to the higher-scoring category. It is the player's own no-skill reference: a predictor with no information about the outcome scores the rate of days on which the actual landed in this category.
 * baseline: BASELINE - the plain prior-games average (arithmetic mean of the earlier games; no split, no factor, no weighting, no outlier removal), recorded in the data as the no-factor comparator.
 * lowSampleAsterisk: LOW-SAMPLE ASTERISK - every game with at least 1 earlier game is evaluated; games under the low-sample threshold (30 by default, set by MAVIS_LOW_SAMPLE_N) are flagged in sample_flag and are still evaluated. The 30-game line is the Central Limit Theorem threshold; rows below it are asterisked, never dropped.
 * factorFeed: FACTORS FED (all known before kickoff, all objective) - isHome (boolean), month (categorical), team (categorical), opponent (categorical), restDays (numeric: days since that player's previous game of record), regimeShifts (numeric: the number of level-shift breakpoints recorded for the player strictly before that game).
 * notFeedable: NOT FEEDABLE TODAY (listed, never faked) - receiver availability and injuries, snap counts and targets (in-game), weather, betting lines, coaching changes.
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
} from "./dave-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_CSV = process.env.MAVIS_OUT_CSV
  ? join(process.env.MAVIS_OUT_CSV)
  : join(HERE, "..", ".tmp-audit", "projection-evaluation.csv");
const OUT_JSON = process.env.MAVIS_OUT_JSON
  ? join(process.env.MAVIS_OUT_JSON)
  : join(HERE, "..", ".tmp-audit", "projection-evaluation.json");
const PRE_CSV = process.env.MAVIS_PRE_CSV
  ? join(process.env.MAVIS_PRE_CSV)
  : join(HERE, "..", ".tmp-audit", "projection-evaluation-pre-correction.csv");
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

// The definitions, repeated word for word from the comment block above.
// dev/mavis-definition-parity.mjs diffs this object against the comment
// block in this file and against the JSON's "definitions" block.
const DEFINITIONS = {
  gameOfRecord: "One completed game for one player in the dataset (ESPN box score, scored with DraftKings' published rubric). Every game of record is written to the CSV. Nothing is omitted.",
  firstGameOfRecord: "A player's first game in the dataset. It has no earlier games, so no cut, no categories and no projection exist for it. It is recorded as information, not silence.",
  earlierGames: "For a target game: that player's completed games whose date is STRICTLY before the target game's date, all seasons, sorted by date. earlier_n is their count.",
  cut: "CUT - LOGISTICS, NOT A FINDING. The earlier games are split in half at the median: sorted ascending, the LOW half takes the first ceil(n/2) games (an odd count puts the middle game in the LOW half). For a row with two populations the cut is the score boundary between them: the midpoint between the largest score in the LOW half and the smallest score in the HIGH half, or the largest score in the LOW half when the two halves meet at the same score. For a row with fewer than 4 completed games (no populations yet) it is the median-split value of the earlier games. The cut can be decided any way you like - it is how the populations are formed; it is never reported as a rate and it is NOT the definition of a boom.",
  highGame: "HIGH GAME - the upper population. A game whose DK points fall in the high half of the player's earlier games, at or above the cut. A population is NEVER called a boom.",
  lowGame: "LOW GAME - the lower population. A game whose DK points fall in the low half of the player's earlier games, below the cut.",
  boom: "BOOM - a genuine outlier beyond the upper limit. The actual fell in the separated category on the HIGH side AND that separated category sits ABOVE the high side's main body. Every boom is a high game; not every high game is a boom.",
  bust: "BUST - the mirror of boom. The actual fell in the separated category on the LOW side AND that separated category sits BELOW the low side's main body.",
  call: "THE CALL - categorical, never a coefficient. It names the category the projection represents: high, high-outlier, high-normal, low, low-outlier, low-normal, or even. The probability was external and is turned into a constant - a given - so the model inherits a resolved constant, not a variable.",
  evenFloor: "THE FLOOR - even. When no factor's state is known for the upcoming game, the projection is the even split between the high and low populations: half the high population mean + half the low population mean. \"half high half low = total projection\".",
  sameness: "SAMENESS - the only accept/reject in the model. Welch's two-sample t-test on the two halves: when the halves are one population, the call is even and the projection is the raw average of all the earlier games. Nothing else in this model is accepted or rejected.",
  factors: "FACTORS - a categorization, not a set of verdicts. A factor condition is a common thread through a separated population, or the condition that separates the two populations. Every candidate is reported with its two-sample t-test, its df and its p-value. No factor is accepted, rejected, passed or failed.",
  categories: "CATEGORIES - every earlier game falls in exactly one category, and the categories tile the score space exactly once: high, high-outlier, high-normal, low, low-outlier, low-normal. The category ranges are half-open [lo, hi), null = unbounded. Nothing gets dropped as a miss: every possible outcome has a category.",
  actualCategory: "ACTUAL CATEGORY - the id of the category the actual DK points fall in, decided at full precision against the engine's category ranges. It is the fact the owner's one metric is scored on: did the projection equal the actual on this day.",
  outcomeClass: "OUTCOME CLASS - the same fact in the owner's words: boom, bust, high game or low game.",
  largestCategory: "LARGEST CATEGORY - the category holding the most of the player's earlier games at that point; ties go to the higher-scoring category. It is the player's own no-skill reference: a predictor with no information about the outcome scores the rate of days on which the actual landed in this category.",
  baseline: "BASELINE - the plain prior-games average (arithmetic mean of the earlier games; no split, no factor, no weighting, no outlier removal), recorded in the data as the no-factor comparator.",
  lowSampleAsterisk: "LOW-SAMPLE ASTERISK - every game with at least 1 earlier game is evaluated; games under the low-sample threshold (30 by default, set by MAVIS_LOW_SAMPLE_N) are flagged in sample_flag and are still evaluated. The 30-game line is the Central Limit Theorem threshold; rows below it are asterisked, never dropped.",
  factorFeed: "FACTORS FED (all known before kickoff, all objective) - isHome (boolean), month (categorical), team (categorical), opponent (categorical), restDays (numeric: days since that player's previous game of record), regimeShifts (numeric: the number of level-shift breakpoints recorded for the player strictly before that game).",
  notFeedable: "NOT FEEDABLE TODAY (listed, never faked) - receiver availability and injuries, snap counts and targets (in-game), weather, betting lines, coaching changes.",
};

// ---------------------------------------------------------------------------
// ESPN fetch layer - reused verbatim from the proven
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

/** The arithmetic mean. Same semantics as the engine's private helper. */
function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample variance (n - 1 denominator). A single game has no spread. */
function sampleVariance(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
}

const round = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const round4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
// The numbers that feed a category are written at 12 decimals so the CSV
// reproduces its own labels: anyone recomputing the category of an actual
// from these columns gets the same answer as the stored category.
const round12 = (x) => (Number.isFinite(x) ? Math.round(x * 1e12) / 1e12 : null);
// A compact number for the prose: no trailing zeros, no exponential form.
const fmt = (x) => {
  if (!Number.isFinite(x)) return "";
  const r = Math.round(x * 10000) / 10000;
  return String(r);
};
const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Parse one CSV line (quoted fields, doubled quotes). */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// The categories, as the owner names them
// ---------------------------------------------------------------------------

/** The half-open range of one category: [lo, hi), null = unbounded. */
function rangeText(c) {
  const lo = c.lo === null ? "-inf" : fmt(c.lo);
  const hi = c.hi === null ? "inf" : fmt(c.hi);
  return "[" + lo + "," + hi + ")";
}

/** The compact readable summary of every category in one row. */
function categoriesText(cats) {
  return cats
    .map((c) => c.id + " " + rangeText(c) + " n=" + c.n + " mean=" + fmt(c.mean))
    .join(" | ");
}

/** The score boundary between the low and high categories. */
function boundaryOf(cats) {
  const los = cats.filter((c) => c.side === "high").map((c) => c.lo).filter((v) => v !== null);
  return los.length ? Math.min(...los) : null;
}

/** The category the value falls in. The ranges tile the score space once. */
function categoryOf(cats, value) {
  for (const c of cats) {
    const loOk = c.lo === null || value >= c.lo;
    const hiOk = c.hi === null || value < c.hi;
    if (loOk && hiOk) return c;
  }
  return null;
}

/**
 * The outcome class in the owner's words.
 * A boom is the separated category on the HIGH side that sits ABOVE the
 * high side's main body; a bust is the mirror on the LOW side.
 */
function outcomeClassOf(cats, actualCat) {
  if (!actualCat) return "no populations yet (n<4)";
  if (actualCat.id === "high-outlier") {
    const main = cats.find((c) => c.id === "high-normal" || c.id === "high");
    const sepLo = actualCat.lo === null ? -Infinity : actualCat.lo;
    const mainLo = main && main.lo !== null ? main.lo : -Infinity;
    if (sepLo > mainLo) return "boom";
  }
  if (actualCat.id === "low-outlier") {
    const main = cats.find((c) => c.id === "low-normal" || c.id === "low");
    const sepHi = actualCat.hi === null ? Infinity : actualCat.hi;
    const mainHi = main && main.hi !== null ? main.hi : Infinity;
    if (sepHi < mainHi) return "bust";
  }
  return actualCat.side === "high" ? "high game" : "low game";
}

/**
 * The biggest category the player had at that point. Ties go to the
 * higher-scoring category - fixed before the actual is known.
 */
function largestCategoryOf(cats) {
  let best = null;
  for (const c of cats) {
    if (!best || c.n > best.n || (c.n === best.n && c.mean > best.mean)) best = c;
  }
  return best ? best.id : "";
}

/** The p-value of the factor the engine actually used, matched on key AND condition. */
function factorPOf(proj) {
  if (!proj.factor) return null;
  const f = proj.factors.find(
    (x) => x.key === proj.factor && x.condition === proj.factorCondition,
  );
  return f && f.test ? f.test.p : null;
}

/**
 * The row's prose truth: what the engine did and why. It names the call, the
 * factor and its condition or the even-split floor, and it names the
 * sameness state. No coefficient, no probability label.
 */
function justificationFor(proj, actualCat, outcomeClass, factorEntry) {
  const parts = [];
  if (proj.sameMeans) {
    parts.push(
      "the two halves are one population (Welch two-sample t-test t=" + fmt(proj.sameMeansT) +
      ", df=" + fmt(proj.sameMeansDf) + ", p-value " + fmt(proj.sameMeansP) + ")" +
      " -> the call is even and the projection is the raw average of all " +
      (proj.nHigh + proj.nLow) + " earlier games",
    );
  } else if (factorEntry && factorEntry.state !== null) {
    parts.push(
      "factor " + factorEntry.key + " - " + factorEntry.condition + " " +
      (factorEntry.state ? "holds" : "does not hold") + " for this game" +
      " (Welch two-sample t-test t=" + fmt(factorEntry.test.t) +
      ", df=" + fmt(factorEntry.test.df) + ", p-value " + fmt(factorEntry.test.p) +
      "; the games where it holds average " + fmt(factorEntry.test.withMean) + " over n=" +
      factorEntry.test.withN + " and the games where it does not average " +
      fmt(factorEntry.test.withoutMean) + " over n=" + factorEntry.test.withoutN + ")" +
      " -> the call is " + proj.call + " and the projection is that category's mean",
    );
  } else if (factorEntry) {
    parts.push(
      "factor " + factorEntry.key + " - " + factorEntry.condition +
      " has no known state for this game" +
      " (Welch two-sample t-test t=" + fmt(factorEntry.test.t) +
      ", df=" + fmt(factorEntry.test.df) + ", p-value " + fmt(factorEntry.test.p) + ")" +
      " -> the even-split floor: half the high population mean + half the low population mean",
    );
  } else {
    parts.push(
      "no candidate factor reached |t| >= 2 -> the even-split floor: half the high population mean + half the low population mean",
    );
  }
  parts.push(
    "the high half averages " + fmt(proj.highMean) + " over n=" + proj.nHigh +
    " and the low half averages " + fmt(proj.lowMean) + " over n=" + proj.nLow,
  );
  if (proj.shape.high.verdict === "multimodal") {
    const sep = proj.categories.find((c) => c.id === "high-outlier");
    parts.push(
      "the high half is multimodal - a separated group of n=" + (sep ? sep.n : 0) +
      " averaging " + (sep ? fmt(sep.mean) : "n/a") + " sits apart from its main body",
    );
  }
  if (proj.shape.low.verdict === "multimodal") {
    const sep = proj.categories.find((c) => c.id === "low-outlier");
    parts.push(
      "the low half is multimodal - a separated group of n=" + (sep ? sep.n : 0) +
      " averaging " + (sep ? fmt(sep.mean) : "n/a") + " sits apart from its main body",
    );
  }
  if (actualCat) {
    parts.push("the actual fell in the category " + actualCat.id + " - " + outcomeClass);
  }
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now();
  console.log("mavis-projection-evaluation: teams=" + TEAMS.join(",") +
    " seasons=" + SEASON_START + ".." + SEASON_END +
    " lowSampleN=" + LOW_SAMPLE_N);

  // ---- 0. the previous run's actuals, kept as ground truth ---------------
  let preActuals = null;
  let preMalformed = 0;
  if (existsSync(PRE_CSV)) {
    const lines = readFileSync(PRE_CSV, "utf8").split("\n");
    const header = parseCsvLine(lines[0].replace(/\r$/, ""));
    const idxAid = header.indexOf("athlete_id");
    const idxDate = header.indexOf("date");
    const idxAct = header.indexOf("actual_dk_points");
    preActuals = new Map();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, "");
      if (!line) continue;
      const f = parseCsvLine(line);
      if (f.length !== header.length) { preMalformed++; continue; }
      preActuals.set(f[idxAid] + "|" + f[idxDate], Number(f[idxAct]));
    }
    console.log("Previous run's actuals loaded for comparison: " + preActuals.size +
      " rows (malformed lines: " + preMalformed + ")");
  } else {
    console.log("No pre-correction CSV found - the actuals comparison is skipped.");
  }

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

  // full-career chart data for this player (before logs are released)
  const careers = new Map(); // athlete_id -> the player's whole career, in date order
  for (const [id, games] of logs) {
    careers.set(id, {
      player: games[0].name, position: games[0].pos,
      teams: [...new Set(games.map((g) => g.team))].join("/"),
      games: games.length,
      span: games[0].date.slice(0, 10) + " to " + games[games.length - 1].date.slice(0, 10),
      scores: games.map((g) => g.score),
      dates: games.map((g) => g.date),
      ordered: games,
      flags: detectBreakpoints(
        games.map((g) => ({ date: g.date, score: g.score, factors: { team: g.team } })),
      ),
    });
  }
  // release the logs before aggregation
  const playersSeen = logs.size;
  logs.clear();

  // ---- 4. walk-forward evaluation: EVERY game recorded --------------------
  const CSV_HEADER = [
    "player", "athlete_id", "position", "team", "opponent", "date", "season",
    "status", "earlier_n", "sample_flag", "cut", "actual_dk_points",
    "actual_category", "outcome_class",
    "model_call", "model_largest_category",
    "model_projection", "model_low90", "model_high90",
    "model_high_mean", "model_low_mean",
    "model_high_population_mean", "model_low_population_mean",
    "model_high_outlier_mean", "model_high_outlier_n",
    "model_low_outlier_mean", "model_low_outlier_n",
    "model_same_means", "model_same_means_p",
    "model_factor", "model_factor_condition", "model_factor_p",
    "model_shape_high", "model_shape_low", "model_categories",
    "baseline_projection", "baseline_call", "justification",
  ];
  if (CSV_HEADER.length !== 38) {
    throw new Error("The CSV header must carry 38 columns; got " + CSV_HEADER.length);
  }
  const csvLines = [CSV_HEADER.join(",")];
  const evalRows = []; // compact per-evaluation records for aggregation
  const actualsByKey = new Map(); // athlete_id|date -> the actual DK points
  let firstGames = 0;

  for (const [id, games] of careers) {
    // the games in date order (the careers map keeps them sorted)
    const ordered = games.ordered;
    const name = games.player;
    for (let k = 0; k < ordered.length; k++) {
      const target = ordered[k];
      const earlier = ordered.slice(0, k);
      const n = earlier.length;

      const rowObj = {
        player: name, athlete_id: id, position: target.pos, team: target.team,
        opponent: target.opponent ?? "", date: target.date, season: target.season,
        status: "evaluation", earlier_n: n, sample_flag: "",
        cut: "", actual_dk_points: round12(target.score),
        actual_category: "", outcome_class: "",
        model_call: "", model_largest_category: "",
        model_projection: "", model_low90: "", model_high90: "",
        model_high_mean: "", model_low_mean: "",
        model_high_population_mean: "", model_low_population_mean: "",
        model_high_outlier_mean: "", model_high_outlier_n: "",
        model_low_outlier_mean: "", model_low_outlier_n: "",
        model_same_means: "", model_same_means_p: "",
        model_factor: "", model_factor_condition: "", model_factor_p: "",
        model_shape_high: "", model_shape_low: "",
        model_categories: "", baseline_projection: "", baseline_call: "",
        justification: "",
      };
      actualsByKey.set(id + "|" + target.date, { score: target.score, player: name, date: target.date });

      if (n === 0) {
        firstGames++;
        rowObj.status = "first game of record";
        rowObj.sample_flag = "first game of record (n=0)";
        rowObj.justification =
          "first game of record: no earlier games, so no cut, no categories and no projection exist for this game";
        csvLines.push(CSV_HEADER.map((h) => csvEscape(rowObj[h])).join(","));
        continue;
      }

      const earlierScores = earlier.map((g) => g.score);
      const medianSplit = cutOf(earlierScores);
      const actual = target.score;
      const sampleFlag = n < LOW_SAMPLE_N ? "low sample (n=" + n + ")" : "";
      const baseline = mean(earlierScores);
      rowObj.sample_flag = sampleFlag;
      rowObj.cut = round(medianSplit);
      rowObj.baseline_projection = round12(baseline);
      rowObj.baseline_call = baseline > medianSplit ? "high" : "low";

      if (n < 4) {
        // His method needs four completed games to form two populations, so
        // there are no categories and no projection to score. The row is
        // recorded - nothing is omitted - and it is not scored.
        rowObj.outcome_class = "no populations yet (n<4)";
        rowObj.justification =
          "earlier_n=" + n + ": fewer than 4 completed games, so his method has no halves, no categories and no projection yet; recorded as information, not scored";
      } else {
        // regime flag: level-shift breakpoints recorded strictly before the
        // target game (leads, not firings) - feedable as a count.
        const shiftDates = detectBreakpoints(
          earlier.map((g) => ({ date: g.date, score: g.score, factors: { team: g.team } })),
        )
          .filter((f) => f.kind === "level shift")
          .map((f) => f.date);
        const regimeFor = (date) => shiftDates.reduce((c, d) => (d <= date ? c + 1 : c), 0);

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

        const cats = proj.categories;
        const boundary = boundaryOf(cats);
        rowObj.cut = round(boundary);
        rowObj.baseline_call = baseline > boundary ? "high" : "low";
        const actualCat = categoryOf(cats, actual);
        const outcomeClass = outcomeClassOf(cats, actualCat);

        rowObj.actual_category = actualCat ? actualCat.id : "";
        rowObj.outcome_class = outcomeClass;
        rowObj.model_call = proj.call;
        rowObj.model_largest_category = largestCategoryOf(cats);
        rowObj.model_projection = round12(proj.projection);
        rowObj.model_low90 = round12(proj.low90);
        rowObj.model_high90 = round12(proj.high90);
        rowObj.model_high_mean = round12(proj.highMean);
        rowObj.model_low_mean = round12(proj.lowMean);
        rowObj.model_high_population_mean = round12(proj.highPopulationMean);
        rowObj.model_low_population_mean = round12(proj.lowPopulationMean);
        const hOut = cats.find((c) => c.id === "high-outlier");
        rowObj.model_high_outlier_mean = hOut ? round12(hOut.mean) : "";
        rowObj.model_high_outlier_n = hOut ? hOut.n : "";
        const lOut = cats.find((c) => c.id === "low-outlier");
        rowObj.model_low_outlier_mean = lOut ? round12(lOut.mean) : "";
        rowObj.model_low_outlier_n = lOut ? lOut.n : "";
        rowObj.model_same_means = proj.sameMeans ? "true" : "false";
        rowObj.model_same_means_p =
          proj.sameMeansTest && proj.sameMeansTest.p !== null ? round12(proj.sameMeansTest.p) : "";
        rowObj.model_factor = proj.factor ?? "";
        rowObj.model_factor_condition = proj.factorCondition ?? "";
        const fp = factorPOf(proj);
        rowObj.model_factor_p = fp === null || fp === undefined ? "" : round12(fp);
        rowObj.model_shape_high = proj.shape.high.verdict;
        rowObj.model_shape_low = proj.shape.low.verdict;
        rowObj.model_categories = categoriesText(cats);

        // The factor the engine used, and whether its state is known for
        // this game - the prose needs both.
        let factorEntry = null;
        if (proj.factor) {
          const f = proj.factors.find(
            (x) => x.key === proj.factor && x.condition === proj.factorCondition,
          );
          if (f) {
            const state = f.holds(upcoming[proj.factor]);
            factorEntry = {
              key: f.key, condition: f.condition, test: f.test,
              state: state === true ? true : state === false ? false : null,
            };
          }
        }
        rowObj.justification = justificationFor(proj, actualCat, outcomeClass, factorEntry);
        if (sampleFlag) rowObj.justification += "; [" + sampleFlag + "]";
      }

      csvLines.push(CSV_HEADER.map((h) => csvEscape(rowObj[h])).join(","));

      evalRows.push({
        player: name, athlete_id: id, position: target.pos, team: target.team,
        opponent: target.opponent ?? "", date: target.date, season: target.season,
        earlier_n: n, sampleFlag,
        cut: rowObj.cut,
        actual: round(actual),
        actualCategory: rowObj.actual_category,
        outcomeClass: rowObj.outcome_class,
        call: rowObj.model_call,
        largestCategory: rowObj.model_largest_category,
        factor: rowObj.model_factor,
        sameMeans: rowObj.model_same_means === "true",
        categories: rowObj.model_categories,
        shapeHigh: rowObj.model_shape_high,
        shapeLow: rowObj.model_shape_low,
        projection: rowObj.model_projection,
        baseline: rowObj.baseline_projection,
      });
    }
  }

  const evaluations = evalRows.length;
  if (evaluations === 0) throw new Error("No evaluations - nothing to report.");
  console.log("Games of record: " + (evaluations + firstGames) +
    " | evaluations (games with >=1 earlier game): " + evaluations +
    " | first games of record: " + firstGames);

  // ---- 5. aggregation -----------------------------------------------------
  // The censuses count what happened. Nothing is accepted or rejected here:
  // sameness is the only accept/reject, and it is counted as a fact.
  const scopeCensus = (rows) => {
    const out = {
      evaluations: rows.length,
      calls: {},
      sides: { high: 0, low: 0, even: 0 },
      outcomeClasses: {
        boom: 0, bust: 0, "high game": 0, "low game": 0,
        "no populations yet (n<4)": 0,
      },
      onePopulation: 0,
      twoPopulations: 0,
      noCall: 0,
      highMultimodal: 0,
      lowMultimodal: 0,
    };
    for (const r of rows) {
      out.outcomeClasses[r.outcomeClass] = (out.outcomeClasses[r.outcomeClass] ?? 0) + 1;
      if (r.shapeHigh === "multimodal") out.highMultimodal++;
      if (r.shapeLow === "multimodal") out.lowMultimodal++;
      if (!r.call) { out.noCall++; continue; }
      out.calls[r.call] = (out.calls[r.call] ?? 0) + 1;
      const side = r.call === "even" ? "even" : r.call.startsWith("high") ? "high" : "low";
      out.sides[side]++;
      if (r.sameMeans) out.onePopulation++; else out.twoPopulations++;
    }
    return out;
  };

  const overall = scopeCensus(evalRows);
  const factorUsage = {};
  for (const r of evalRows) {
    if (r.factor) factorUsage[r.factor] = (factorUsage[r.factor] ?? 0) + 1;
  }
  const perEra = ERAS.map((e) => ({
    era: e.label,
    ...scopeCensus(evalRows.filter((r) => r.season >= e.from && r.season <= e.to)),
  }));
  const perSeason = SEASONS.map((season) => ({
    season,
    ...scopeCensus(evalRows.filter((r) => r.season === season)),
  }));

  // per-player game counts
  const perPlayer = new Map();
  for (const r of evalRows) {
    const e = perPlayer.get(r.athlete_id) ?? {
      athlete_id: r.athlete_id, player: r.player, position: r.position,
      evaluations: 0, firstGames: 0, lowSample: 0,
    };
    e.evaluations++;
    if (r.earlier_n < LOW_SAMPLE_N) e.lowSample++;
    perPlayer.set(r.athlete_id, e);
  }
  for (const c of careers.values()) {
    const e = perPlayer.get(c.ordered[0].id);
    if (e) e.firstGames = 1;
  }
  const perPlayerRows = [...perPlayer.values()].sort((a, b) => b.evaluations - a.evaluations);

  // ---- 6. the actuals comparison against the previous run -----------------
  let actualsCheck = null;
  if (preActuals) {
    let comparedRows = 0;
    let differingRows = 0;
    let missingRows = 0;
    const examples = [];
    const missingExamples = [];
    for (const [key, rec] of actualsByKey) {
      const val = rec.score;
      if (!preActuals.has(key)) {
        missingRows++;
        if (missingExamples.length < 20) missingExamples.push({ key, player: rec.player, date: rec.date, current: val });
        continue;
      }
      comparedRows++;
      const prev = preActuals.get(key);
      if (!Number.isFinite(prev) || Math.abs(prev - val) > 1e-9) {
        differingRows++;
        if (examples.length < 20) examples.push({ key, previous: prev, current: val });
      }
    }
    actualsCheck = {
      comparedRows, differingRows, missingRows, examples, missingExamples,
      previousCsvRows: preActuals.size,
      previousCsvMalformedLines: preMalformed,
      newCsvRows: csvLines.length - 1,
      note: "The actual DK points are re-derived from the same ESPN box scores; a difference here would mean the ground truth moved.",
    };
  }

  // ---- 7. exact ESPN positions for the audited population (best effort) ---
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

  // ---- 8. chart data (deterministic, selection reasons included) ---------
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
  const careerOut = (c, aid) => ({
    athlete_id: aid, player: c.player,
    position: positionOf.get(aid) ?? c.position, teams: c.teams,
    games: c.games, span: c.span, scores: c.scores, dates: c.dates,
    cut: cutOf(c.scores), flags: c.flags,
  });
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
    picks.push({
      label: "regime",
      reason: "largest flagged level shift (5-on-5 window two-sample t-test) among all players with >= 30 evaluations",
      ...careerOut(careers.get(regimeBest.aid), regimeBest.aid),
    });
  }
  // the ~40-row doc sample: the most-evaluated player, first 40 evaluations
  const samplePlayerId = [...evalCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const docSample = samplePlayerId ? evalRows.filter((r) => r.athlete_id === samplePlayerId).slice(0, 40) : [];
  const docSamplePlayer = careers.get(samplePlayerId)?.player ?? null;

  // ---- 9. outputs ---------------------------------------------------------
  const result = {
    generatedAt: new Date().toISOString(),
    config: {
      teams: TEAMS, seasonStart: SEASON_START, seasonEnd: SEASON_END,
      lowSampleN: LOW_SAMPLE_N,
      factorsFed: ["isHome", "month", "team", "opponent", "restDays", "regimeShifts"],
      scoringRubric: "DraftKings published rubric",
      dataPath: "ESPN team schedule -> event summary -> DraftKings points",
      cacheDir: CACHE_DIR,
    },
    definitions: DEFINITIONS,
    coverage: {
      teams: TEAMS, seasons: SEASONS,
      playersSeen,
      playersEvaluated: playerIds.length,
      gamesOfRecord: evaluations + firstGames,
      evaluations,
      firstGamesOfRecord: firstGames,
      evaluationsLowSample: evalRows.filter((r) => r.earlier_n < LOW_SAMPLE_N).length,
      evaluationsFullSample: evalRows.filter((r) => r.earlier_n >= LOW_SAMPLE_N).length,
      eventsHeld: summariesHeld,
      eventsPlanned: events.size,
      positionMix,
      perEra,
      perSeason,
    },
    census: overall,
    factorUsage,
    perPlayer: perPlayerRows,
    actualsCheck,
    charts: {
      histogramPlayers: picks,
      docSample: { player: docSamplePlayer, athlete_id: samplePlayerId ?? null, rows: docSample },
    },
    requestCount: REQUESTS,
    positionLookups: posLookups,
    failureCount: FAILURES.length,
    failures: FAILURES.slice(0, 200),
    runtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };

  mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, csvLines.join("\n"));
  console.log("Wrote " + OUT_CSV + " (" + (csvLines.length - 1) + " rows)");
  writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
  console.log("Wrote " + OUT_JSON);
  console.log("calls: " + JSON.stringify(overall.calls));
  console.log("outcome classes: " + JSON.stringify(overall.outcomeClasses));
  console.log("sameness - one population: " + overall.onePopulation +
    " | two populations: " + overall.twoPopulations);
  console.log("high half multimodal: " + overall.highMultimodal +
    " | low half multimodal: " + overall.lowMultimodal);
  if (actualsCheck) {
    console.log("actuals check: compared " + actualsCheck.comparedRows +
      ", differing " + actualsCheck.differingRows +
      ", missing " + actualsCheck.missingRows +
      " (previous run held " + actualsCheck.previousCsvRows + " rows)");
  }
  console.log("runtime " + result.runtimeSeconds + "s, requests " + REQUESTS +
    ", failures " + FAILURES.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
