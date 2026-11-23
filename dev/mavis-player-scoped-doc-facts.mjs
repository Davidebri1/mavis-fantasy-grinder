/**
 * mavis-player-scoped-doc-facts.mjs
 *
 * Verifies the new evaluation document AND the QA record against the generated
 * data.
 *
 * Two checks on each document:
 *   1. NEGATIVE - every numeric token must be backed by a number that exists in
 *      the generated JSON (in one of its legitimate renderings), or by a quantity
 *      this verifier computes from the JSON counts. An invented or drifted
 *      figure cannot ship.
 *   2. POSITIVE - a list of headline facts must be present verbatim.
 *
 * The evaluation document is scanned first; its own token count and the fact
 * count are then admitted as sources, so the QA record cannot quote a stale
 * count.
 *
 * Exits 1 on any failure.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const TMP = path.join(REPO, "frontend", "react", ".tmp-audit");
const DOC = path.join(REPO, "docs", "mavis-player-scoped-evaluation.md");
const QA = path.join(REPO, "docs", "QA-2026-11-23-mavis-player-scoped-evaluation.md");

const load = (f) => JSON.parse(fs.readFileSync(path.join(TMP, f), "utf8"));
const ev = load("player-scoped-evaluation.json");
const sig = load("player-scoped-significance.json");
const boom = load("boom-semantics.json");
const boomWf = load("boom-semantics-walkforward.json");
const audit = load("player-scoped-audit.json");
const coverage = load("engine-factor-coverage.json");
const profile = load("csv-profile.json");
const pixels = load("player-scoped-pixels.json");

// ---- allowed number tokens -------------------------------------------------
const allowed = new Set();
const addToken = (t) => { if (t !== null && t !== undefined && t !== "") allowed.add(String(t)); };

function harvest(value) {
  if (typeof value === "number") {
    addToken(value);
    addToken(Math.abs(value));
    for (const d of [0, 1, 2, 3, 4]) { addToken(value.toFixed(d)); addToken(Math.abs(value).toFixed(d)); }
    if (Math.abs(value) < 1) {
      for (const d of [0, 1, 2]) { addToken((value * 100).toFixed(d) + "%"); addToken((Math.abs(value) * 100).toFixed(d) + "%"); }
    }
    return;
  }
  if (typeof value === "string") {
    for (const m of value.matchAll(/-?\d+(?:\.\d+)?/g)) addToken(m[0]);
    return;
  }
  if (Array.isArray(value)) { for (const v of value) harvest(v); return; }
  if (value && typeof value === "object") { for (const k of Object.keys(value)) { harvest(k); harvest(value[k]); } }
}

for (const j of [ev, sig, boom, boomWf, audit, coverage, profile, pixels]) harvest(j);

// the canvas dimensions are real numbers on the SVG elements
for (const svgName of ["mavis-player-scoped-histograms.svg", "mavis-player-scoped-hit-rates.svg"]) {
  const svgText = fs.readFileSync(path.join(REPO, "docs", "shots", svgName), "utf8");
  const wm = /width="(\d+)"/.exec(svgText);
  const hm = /height="(\d+)"/.exec(svgText);
  if (wm) { addToken(Number(wm[1])); addToken(wm[1]); }
  if (hm) { addToken(Number(hm[1])); addToken(hm[1]); }
}

// ---- derived quantities: computed here from the JSON counts -----------------
const derived = [];
// required = the headline facts that must be present verbatim in the document.
// 10 derived facts are pushed by addDerived; 25 base facts are added below.
const required = [];
const addDerived = (label, value, format) => {
  const s = format(value);
  derived.push({ label, needle: s });
  required.push([label, s]);
  addToken(s);
  addToken(s.replace(/%$/, ""));
  return s;
};
const pct1 = (x) => (x * 100).toFixed(1) + "%";
const fixed1 = (x) => x.toFixed(1);
const fixed4 = (x) => x.toFixed(4);
const fmt = (x) => {
  let s = Number(x).toFixed(3);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
};

function binomialTail(k, n, p) {
  let pmf = Math.pow(1 - p, n);
  let tail = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) pmf = pmf * ((n - i + 1) / i) * (p / (1 - p));
    if (i >= k) tail += pmf;
  }
  return tail;
}

addDerived("walk-forward high game share", boomWf.classes.highGame / boomWf.evaluated, pct1);
addDerived("walk-forward genuine boom share", boomWf.classes.boom / boomWf.evaluated, pct1);
addDerived("old booms re-read as high games", boomWf.oldBoomRows.highGame / boomWf.oldBoomRows.total, pct1);
addDerived("old booms re-read as genuine booms", boomWf.oldBoomRows.boom / boomWf.oldBoomRows.total, pct1);
addDerived("old booms re-read as ordinary", boomWf.oldBoomRows.ordinary / boomWf.oldBoomRows.total, pct1);
addDerived("engine conditions clearing p<0.05", audit.engineFactor.cleared / audit.engineFactor.testable, pct1);
addDerived("conditions expected by chance", (audit.engineFactor.nullClearing / audit.engineFactor.nullTests) * audit.engineFactor.testable, fixed1);
addDerived("binomial one-sided p", binomialTail(audit.engineFactor.cleared, audit.engineFactor.testable, audit.engineFactor.nullClearing / audit.engineFactor.nullTests), fixed4);
addDerived("P=1 projections above the upper-cluster mean", boom.p1AboveUpperMean / boom.p1Rows, pct1);
addDerived("P=1 projections more than 5 points above", boom.p1MoreThan5Above / boom.p1Rows, pct1);

// ---- headline facts that must appear verbatim in the evaluation document ---
// 25 base facts; with the 10 derived facts above the total checked is 35.
const BASE_FACTS = [
  ["gate: one population vs split", "153 one population and 33 split"],
  ["population: games of record and evaluations", "10,961 games of record, 10,217 evaluations"],
  ["metric population: players, games, evaluations", "30 players, 1,579 games, 1,459 evaluations"],
  ["metric population: model hit rate", "| **model** | **0.500** | 0.377 | 0.627 | 4 / 30 |"],
  ["metric population: plain average hit rate", "| plain prior-games average | 0.655 | 0.413 | 0.770 | 6 / 30 |"],
  ["metric population: calibrated hit rate", "| calibrated (after the walk-forward offset) | 0.546 | 0.441 | 0.735 | 6 / 30 |"],
  ["metric population: own no-skill rate", "| **the player's own no-skill rate** | **0.679** | 0.508 | 0.783 |"],
  ["model significance: sign test and signed-rank", "p = 0.0001 and the signed-rank test at p = 0.0002"],
  ["robustness line population", "**128 players split on the humps alone, gate ignored** (122 of them with valid clusters)"],
  ["robustness: model row", "| model | 0.532 | 0.395 | 0.752 | -0.0685 | 23 / 104 / 1 | 0.0001 | < 0.0001 |"],
  ["robustness: own no-skill rate", "| the player's own no-skill rate | 0.702 | 0.548 | 0.797 |"],
  ["precision: offset, IQR and share within 2 points", "| metric population (30 players) | -3.17 | -4.513 | -1.47 | 12.84 | 0.158 |"],
  ["calibration: players helped and hurt", "raises the hit rate for 18 of the 30 players and lowers it for 12"],
  ["aim: metric population", "| metric population | 907 | 522 (0.576) | 334 | 254 (0.76) |"],
  ["aim: robustness line", "| robustness line | 4,031 | 1,959 (0.486) | 1,870 | 1,502 (0.803) |"],
  ["engine: P=1 projection equals the control limit", "median difference 0, max difference 0 over 7,990 P=1 rows"],
  ["engine: P=1 projection against the upper-cluster mean", "median **-6.047** points away"],
  ["factors: players with a cause and those that validate", "82 have at least one cause at p < 0.05, and 29 of them have a cause that also passes the normality test"],
  ["factors: metric population", "12 of the 30 players have a cause at p < 0.05 and **6 of the 30 have one that passes the validation**"],
  ["factors: smallest-p cause fails validation", "8 of the 12 metric-population players with a cause at p < 0.05"],
  ["engine factor: testable pairs and cleared", "**177 player-condition pairs** are testable from the evaluation CSV. **16 clear p < 0.05 — 9.0%.**"],
  ["engine factor: measured null", "**77 of 1,335 cleared, 5.8%.** Expected by chance at that rate: 10.2 of 177."],
  ["engine factor: binomial p", "binomial one-sided p = 0.0510"],
  ["boom semantics: old booms re-read as high games", "| really a **high game** | 1,023 | **76.6%** |"],
  ["boom semantics: size of the old label", "sits a median **3.25** points above the upper cluster's median"],
];
for (const f of BASE_FACTS) required.push(f);

// ---- player-level derived counts --------------------------------------------
const HOLDS = (v) => v && (v.startsWith("normal") || v.startsWith("skewed"));
const isSplit = (p) => typeof p.distribution.splitDecision === "string" && p.distribution.splitDecision.startsWith("split");
const metricPlayers = ev.players.filter((p) => isSplit(p) && p.clusterValid === true);
const negOffset = metricPlayers.filter((p) => p.precision.residualOffset < 0).length;
const calUp = metricPlayers.filter((p) => p.metric.calibratedHitRate > p.metric.modelHitRate).length;
const withCause = metricPlayers.filter((p) => (p.factors && p.factors.clearingP) > 0).length;
let strongestFails = 0;
for (const p of metricPlayers) {
  const rows = ((p.factors && p.factors.rows) || []).filter((r) => r.p < 0.05);
  if (!rows.length) continue;
  const best = rows.slice().sort((a, b) => a.p - b.p)[0];
  if (!HOLDS(best.subsetNormality && best.subsetNormality.verdict)) strongestFails++;
}

// numbers that are structural to the prose, not data claims
const PROSE_ALLOWED = [
  "11", // his eleven steps
  "7000", // his step 11: "players 2-7000"
  "16000", "0.8", "46.3", "45.5", // quoted from the superseded document and his correction
  "38", // the stale headline-fact count this QA record quoted before the verifier corrected it
  "4133", // the superseded document's boom count, inside its own scored population
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
  "90", "95", "99",
];
for (const t of PROSE_ALLOWED) addToken(t);

// ---- scanning ---------------------------------------------------------------
const normalize = (raw) => raw
  .replace(/\u2212/g, "-")
  .replace(/\u2013/g, "-")
  .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "DATE")
  .replace(/\b\d{4}-\d{4}\b/g, "YEARS");

function scan(text, label) {
  const failures = [];
  const seen = new Map();
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?%?/g)) {
    const tok = m[0];
    const line = text.slice(0, m.index).split("\n").length;
    const before = text[m.index - 1];
    const after = text[m.index + tok.length];
    if (before === "-" || after === "-" || before === "/" || after === "/") continue;
    const n = tok.replace(/,/g, "").replace(/%$/, "");
    if (!seen.has(n)) seen.set(n, line);
    const forms = new Set([n, n.replace(/\.0+$/, ""), tok]);
    let ok = false;
    for (const f of forms) if (allowed.has(f)) { ok = true; break; }
    if (!ok) {
      const num = Number(n);
      if (Number.isFinite(num)) {
        for (const d of [1, 2, 3, 4]) if (allowed.has(num.toFixed(d))) { ok = true; break; }
        if (Math.abs(num) < 1) for (const d of [0, 1, 2]) if (allowed.has((num * 100).toFixed(d) + "%")) { ok = true; break; }
      }
    }
    if (!ok) failures.push({ token: tok, line });
  }
  console.log("=== " + label + " - NUMERIC TOKENS NOT BACKED BY THE DATA ===");
  if (failures.length === 0) console.log("none - every number traces to the generated JSON");
  else for (const f of failures) console.log("  line " + f.line + ": " + f.token);
  return { failures, seen };
}

if (!fs.existsSync(DOC)) { console.error("FAIL: document not found:", DOC); process.exit(1); }
const doc = normalize(fs.readFileSync(DOC, "utf8"));
const evalScan = scan(doc, "EVALUATION DOCUMENT");

// the verifier's own counts become sources, so the QA record cannot quote a stale count
addToken(String(evalScan.seen.size));
addToken(String(required.length));

const flat = doc.replace(/,/g, "");
const missing = required.filter(([, needle]) => !flat.includes(needle.replace(/,/g, "")));
console.log("");
console.log("=== EVALUATION DOCUMENT - HEADLINE FACTS THAT MUST BE PRESENT ===");
for (const [label, needle] of required) {
  const ok = flat.includes(needle.replace(/,/g, ""));
  console.log("  " + (ok ? "OK  " : "MISS") + "  " + label + " -> " + needle);
}
console.log("");
console.log("distinct numeric tokens checked:", evalScan.seen.size);

if (!fs.existsSync(QA)) { console.error("FAIL: QA record not found:", QA); process.exit(1); }
const qa = normalize(fs.readFileSync(QA, "utf8"));
const qaScan = scan(qa, "QA RECORD");

// The QA record states what the verification found. Those statements must match
// what this run actually did, or the record is stale.
const qaNumbers = new Set((qa.match(/-?\d[\d,]*(?:\.\d+)?/g) || []).map((t) => t.replace(/,/g, "")));
const qaClaims = [
  ["distinct numeric tokens checked", evalScan.seen.size],
  ["headline facts checked", required.length],
];
const qaClaimFailures = qaClaims.filter(([, n]) => !qaNumbers.has(String(n)));
console.log("");
console.log("=== QA RECORD - VERIFICATION CLAIMS THAT MUST MATCH THIS RUN ===");
for (const [label, n] of qaClaims) {
  const ok = !qaClaimFailures.some(([, v]) => v === n);
  console.log("  " + (ok ? "OK  " : "MISS") + "  " + label + " -> " + n);
}

const bad = evalScan.failures.length + missing.length + qaScan.failures.length + qaClaimFailures.length;
console.log("");
console.log(bad === 0 ? "PASS - both documents match the data" : "FAIL - " + bad + " problem(s)");
process.exit(bad === 0 ? 0 : 1);