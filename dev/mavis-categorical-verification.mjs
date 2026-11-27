#!/usr/bin/env node
// mavis-categorical-verification.mjs
// Checks every figure quoted in docs/mavis-categorical-evaluation.md against the
// generated data, and checks the document's structural rules.
//
//   node dev/mavis-categorical-verification.mjs
//
// Exits 0 when every check passes, 1 otherwise. It reads only generated data and
// the document; it changes nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAT = path.join(ROOT, "frontend", "react", ".tmp-audit", "categorical-evaluation.json");
const PROJ = path.join(ROOT, "frontend", "react", ".tmp-audit", "projection-evaluation.json");
const DOC = path.join(ROOT, "docs", "mavis-categorical-evaluation.md");
const SHOTS = path.join(ROOT, "docs", "shots");

const cat = JSON.parse(fs.readFileSync(CAT, "utf8"));
const proj = JSON.parse(fs.readFileSync(PROJ, "utf8"));
const doc = fs.readFileSync(DOC, "utf8");

const results = [];
const ok = (name, needle) => results.push({ name, needle: String(needle), pass: doc.includes(String(needle)) });
const raw = (name, pass, detail) => results.push({ name, needle: detail || "", pass: !!pass });
const comma = (n) => Number(n).toLocaleString("en-US");
const pct = (v, dp = 1) => (Number(v) * 100).toFixed(dp) + "%";
const pts = (v, dp = 1) => { const x = Number(v) * 100; return (x > 0 ? "+" : "") + x.toFixed(dp) + " points"; };
const sci = (v, dp = 2) => Number(v).toExponential(dp);
const p4 = (v) => (v === 0 ? "0" : Number(v).toFixed(4));

const A = cat.aggregate;
const R = cat.robustness;
const F = cat.factors;
const S = cat.significance;
const SCORED = cat.inputs.scoredRows;

const BT = String.fromCharCode(96);

// ---- The data table ----
const cov = proj.coverage;
ok("rows of record", comma(cov.gamesOfRecord) + " rows, " + comma(cov.playersSeen) + " players");
ok("scored rows", "| scored rows | " + comma(SCORED) + " |");
ok("players scored", "| players that could be scored | " + comma(cat.population.scoreablePlayers) + " |");
ok("players with no projection yet", comma(cat.population.playersWithNoProjectionYet) + " - fewer than four completed games");
ok("events held", "| events held | " + comma(cov.eventsHeld) + " of " + comma(cov.eventsPlanned) + " planned |");
ok("requests and failures", "| requests / failures | " + comma(proj.requestCount) + " / " + proj.failureCount + " |");
ok("actuals compared", comma(proj.actualsCheck.comparedRows) + " rows compared, " + proj.actualsCheck.differingRows + " differing");
ok("actuals new rows", comma(proj.actualsCheck.missingRows) + " rows are new");
raw("actuals: no existing actual changed", proj.actualsCheck.differingRows === 0, "differingRows=" + proj.actualsCheck.differingRows);

// ---- The call census ----
for (const [id, n] of Object.entries(cat.calls)) {
  ok("call " + id, "| " + BT + id + BT + " | " + comma(n) + " | " + pct(n / SCORED) + " |");
}
raw("call census totals the scored rows", Object.values(cat.calls).reduce((a, b) => a + b, 0) === SCORED, "sum=" + Object.values(cat.calls).reduce((a, b) => a + b, 0) + " scored=" + SCORED);

// ---- The outcome census ----
for (const [cls, n] of Object.entries(cat.outcomes)) {
  ok("outcome " + cls, "| " + cls + " | " + comma(n) + " | " + pct(n / SCORED) + " |");
}
raw("outcome census totals the scored rows", Object.values(cat.outcomes).reduce((a, b) => a + b, 0) === SCORED, "sum=" + Object.values(cat.outcomes).reduce((a, b) => a + b, 0));

// ---- The one metric against the reference ----
ok("metric row", "| the model's metric | **" + pct(A.metricMean) + "** | " + pct(A.metricMedian) + " | " + pct(A.metricP25) + " | " + pct(A.metricP75) + " |");
ok("reference row", "| the no-skill reference | **" + pct(A.referenceMean) + "** | " + pct(A.referenceMedian) + " | - | - |");
ok("difference row", "| the difference | **" + pts(A.differenceMean) + "** | " + pts(A.differenceMedian).replace("+", "") + " | - | - |");
ok("players above, at and below", "**" + comma(A.playersAboveReference) + " above their own reference, " + comma(A.playersAtReference) + " on it, " + comma(A.playersBelowReference) + " below**");
raw("the three player counts cover the population", A.playersAboveReference + A.playersAtReference + A.playersBelowReference === A.players, "sum=" + (A.playersAboveReference + A.playersAtReference + A.playersBelowReference) + " players=" + A.players);
raw("the metric is not a pooled rate", A.players === cat.population.scoreablePlayers, "aggregate.players=" + A.players);

// ---- Round 2, the calibration loop ----
ok("round 1 row", "| round 1, the call as it stands | " + pct(A.metricMean) + " |");
ok("round 2 row", "| round 2, the calibrated call | **" + pct(A.calibratedMean) + "** |");
ok("round 2 even row", "| - on the rows the model called " + BT + "even" + BT + " | " + pct(A.calibratedEvenMean) + " |");
ok("round 2 named row", "| - on the rows the model named a category | " + pct(A.calibratedResolvedMean) + " |");
ok("round 2 reference row", "| the no-skill reference | " + pct(A.referenceMean) + " |");
ok("named rows against their own reference", pct(A.calibratedResolvedMean) + " against a reference of " + pct(A.resolvedReferenceMean) + " measured on those same rows");

// ---- Precision ----
ok("residual IQR row", "| residual IQR (points) | " + A.rawResidualIQRMean.toFixed(2) + " | " + A.residualIQRMean.toFixed(2) + " |");
ok("within two points row", "| share within +/- 2 points | " + pct(A.rawResidualWithin2Mean) + " | " + pct(A.residualWithin2Mean) + " |");
ok("mean absolute error row", "| mean absolute error (points) | " + A.rawResidualMAEMean.toFixed(2) + " | " + A.residualMAEMean.toFixed(2) + " |");
ok("mean offset", "**" + A.residualOffsetMean.toFixed(2) + " points**");

// ---- The factors ----
for (const [id, n] of Object.entries(F.usage)) {
  ok("factor usage " + id, "| " + id + " | " + comma(n) + " |");
}
for (const [label, key] of [["a population was separated", "evidenceWhenAPopulationWasSeparated"], ["nothing was separated", "evidenceWhenNothingWasSeparated"]]) {
  const e = F[key];
  const share = e.below05 / e.rows;
  ok("factor evidence: " + label, "| " + label + " | " + comma(e.rows) + " | " + comma(e.below05) + " (" + pct(share) + ") | " + e.expectedBelow05IfUniform.toFixed(2) + " | " + p4(e.pMedian) + " | " + p4(e.pP25) + " | " + p4(e.pP75) + " |");
  raw("stored share matches the raw counts: " + label, Math.abs(e.shareBelow05 - share) <= 5e-5, "stored=" + e.shareBelow05 + " exact=" + share.toFixed(6));
}
raw("the binomial tail supports the stated bound (separated)", -F.evidenceWhenAPopulationWasSeparated.upperTailLog10 > 2550, "log10=" + F.evidenceWhenAPopulationWasSeparated.upperTailLog10);
raw("the binomial tail supports the stated bound (not separated)", -F.evidenceWhenNothingWasSeparated.upperTailLog10 > 5392, "log10=" + F.evidenceWhenNothingWasSeparated.upperTailLog10);
ok("the stated binomial bounds", "smaller than 10^-2550 in the first row and 10^-5392 in the second");

// ---- Sameness: the only accept/reject ----
ok("one population row", "| one population - the halves are the same | " + comma(cat.sameness.onePopulation) + " |");
ok("two populations row", "| two populations - the halves differ | " + comma(cat.sameness.twoPopulations) + " |");
ok("sameness p distribution", "median of " + p4(cat.sameness.pMedian) + ", with P25 at " + p4(cat.sameness.pP25) + ", P75 at " + p4(cat.sameness.pP75) + ", and " + pct(cat.sameness.shareBelow05) + " of the rows below 0.05");
raw("the sameness counts cover the scored rows", cat.sameness.onePopulation + cat.sameness.twoPopulations === SCORED, "sum=" + (cat.sameness.onePopulation + cat.sameness.twoPopulations));

// ---- The significance section ----
const st = S.signTest;
const w = S.wilcoxonSignedRank;
ok("sign test row", "| sign test | " + comma(st.positives) + " above, " + comma(st.negatives) + " below, " + comma(st.ties) + " on | **p = " + sci(st.p) + "** |");
ok("wilcoxon row", "| Wilcoxon signed-rank | n = " + comma(w.n) + " non-zero differences, z = " + w.z.toFixed(2) + " | **p = " + sci(w.p) + "** (" + w.method + ") |");
const tb = S.tieBreakRobustness;
ok("tie-break sign test", "the sign test gives p = " + sci(tb.signTest.p) + " (" + comma(tb.signTest.positives) + " above, " + comma(tb.signTest.negatives) + " below, " + comma(tb.signTest.ties) + " on)");
ok("tie-break wilcoxon", "the Wilcoxon z is " + tb.wilcoxonSignedRank.z.toFixed(2));
ok("tie-break wilcoxon underflow", "log10(p) = " + tb.wilcoxonSignedRank.pLog10.toFixed(2));
raw("the tie-break wilcoxon p really is below the representable range", tb.wilcoxonSignedRank.p === null, "p=" + tb.wilcoxonSignedRank.p);

// ---- The robustness lines ----
const f30 = R.fullSample30;
const res = R.resolvedCallsOnly;
ok("robustness whole population", "| the whole population | " + comma(A.players) + " | " + pct(A.metricMean) + " | " + pct(A.referenceMean) + " | " + pts(A.differenceMean) + " |");
ok("robustness whole population calibrated", "| the whole population, calibrated | " + comma(A.players) + " | " + pct(A.calibratedMean) + " | " + pct(A.referenceMean) + " | " + pts(A.calibratedMean - A.referenceMean) + " |");
ok("robustness 30 days", "| players with 30 or more evaluated days | " + comma(f30.players) + " | " + pct(f30.metricMean) + " | " + pct(f30.referenceMean) + " | " + pts(f30.differenceMean) + " |");
ok("robustness 30 days calibrated", "| - the same 159, calibrated | " + comma(f30.players) + " | " + pct(f30.calibratedMean) + " | " + pct(f30.referenceMean) + " | still below |");
ok("robustness named categories", "| rows where the model named a category | " + comma(res.players) + " | " + pct(res.metricMean) + " | " + pct(res.referenceMean) + " | " + pts(res.differenceMean) + " |");
ok("resolved line sign test", "sign test p = " + sci(res.signTest.p) + " (" + res.signTest.positives + " above, " + res.signTest.negatives + " below, " + res.signTest.ties + " on)");
ok("resolved line wilcoxon", "Wilcoxon p = " + sci(res.wilcoxonSignedRank.p) + " (n = " + comma(res.wilcoxonSignedRank.n) + ")");
ok("the 159-player split", "On the 159-player line the split is " + f30.playersAboveReference + " above, " + f30.playersAtReference + " on, " + f30.playersBelowReference + " below.");

// ---- The worked example: Brett Favre ----
const fav = cat.players.find((p) => p.player === "Brett Favre");
ok("Favre games", "| games of record | " + fav.games + ", of which " + fav.scoredRows + " scored |");
const catText = fav.categories.map((c) => {
  const span = c.lo === null ? "up to " + c.hi : c.hi === null ? "above " + c.lo : c.lo + " to " + c.hi;
  return BT + c.id + BT + " n=" + c.n + ", mean " + c.mean.toFixed(2) + ", " + span;
}).join(" - ");
ok("Favre categories", "| categories | " + catText + " |");
const sep = fav.separated[0];
ok("Favre separated population", "| separated population | " + BT + sep.id + BT + ", " + sep.n + " games, mean " + sep.mean.toFixed(2) + " |");
ok("Favre shape", "| shape | high half " + BT + fav.shapeHigh + BT + ", low half " + BT + fav.shapeLow + BT + " |");
const order = ["opponent", "restDays", "regimeShifts", "isHome"];
ok("Favre factors", "| factor | " + order.map((k) => k + " (" + fav.factors[k] + " rows)").join(", ") + " |");
ok("Favre metric", "| his metric against his own reference | " + pct(fav.metric) + " against " + pct(fav.reference) + " |");
const conds = fav.factorConditions;
const opponents = conds.filter((c) => c.startsWith("opponent ::")).map((c) => c.split(" :: ")[1]);
const regimes = conds.filter((c) => c.startsWith("regimeShifts ::")).map((c) => c.split(" :: ")[1]);
const rest = conds.filter((c) => c.startsWith("restDays ::")).map((c) => c.split(" :: ")[1]);
for (const c of opponents.concat(regimes, ["isHome=false"])) {
  ok("Favre condition " + c, BT + c + BT);
}
const restNums = rest.map((c) => Number(c.split("<")[1].trim()));
const restMax = "restDays < " + Math.max.apply(null, restNums).toFixed(2);
const restMin = "restDays < " + Math.min.apply(null, restNums).toFixed(2);
ok("Favre rest ladder top", BT + restMax + BT);
ok("Favre rest ladder bottom", BT + restMin + BT);
ok("Favre rest ladder size", "ladder of " + rest.length + " ");

// ---- The truths this run carries ----
ok("truth: populations", comma(cat.sameness.twoPopulations) + " of the " + comma(SCORED) + " scored rows have two populations; " + comma(cat.sameness.onePopulation) + " have one.");
ok("truth: outcomes", comma(cat.outcomes["high game"]) + " high games, " + comma(cat.outcomes["low game"]) + " low games, " + comma(cat.outcomes.boom) + " booms, " + comma(cat.outcomes.bust) + " busts.");
ok("truth: metric against reference", "the model's calls score " + pct(A.metricMean) + " to the reference's " + pct(A.referenceMean));
ok("truth: calibration", "The calibration lifts that to " + pct(A.calibratedMean) + ", and the lift comes from the even rows (" + pct(A.calibratedEvenMean) + "); the rows where the model named a category stay at " + pct(A.calibratedResolvedMean) + " against their " + pct(A.resolvedReferenceMean) + " reference.");
ok("truth: the longer the record", pct(f30.metricMean) + " against " + pct(f30.referenceMean) + " on players with 30 or more evaluated days");

// ---- The method table ----
ok("method: one population per player", "| 1. pick a player | " + comma(cov.playersSeen) + " players of record, all read; every player is his own population, never pooled with anyone else's |");
ok("method: repeat for every player", "| 11. repeat for players 2-7000 | " + comma(cat.population.scoreablePlayers) + " players could be scored. " + comma(cat.population.playersWithNoProjectionYet) + " could not - fewer than four completed games, so no two populations exist yet - and they are recorded as a fact, not dropped |");

// ---- Structural rules ----
const section = (heading) => {
  const i = doc.indexOf(heading);
  if (i < 0) return null;
  const j = doc.indexOf("\n## ", i + heading.length);
  return doc.slice(i, j < 0 ? doc.length : j);
};
raw("no coefficient is printed as a variable", !/\bP\s*=\s*[01](\b|$)/.test(doc), "an uppercase P= label is present");
const pValueNumber = /p\s*=\s*\d/;
const pValueLabel = /p-value\s*[:=]?\s*\d/;
for (const h of ["## The metric against the reference", "## Round 2: the calibration loop", "## Precision"]) {
  const s = section(h);
  raw("no p-value number in " + h, s !== null && !pValueNumber.test(s) && !pValueLabel.test(s), s === null ? "section missing" : "a p-value number is present");
}
const removed = "Out: " + BT + "p" + BT + ", " + BT + "peeled" + BT + ", " + BT + "normality" + BT + ", " + BT + "factorDetail" + BT + ".";
const docLive = doc.replace(removed, "");
for (const token of ["peeled", "band_position", "control_low", "control_high", "model_P", "MAX_PEELS"]) {
  raw("no legacy token: " + token, !docLive.includes(token), "the token is present");
}
ok("the reference is stated as not 50%", "The reference is not 50%.");
raw("the reference is each player's own no-skill rate", A.referenceMean !== 0.5, "referenceMean=" + A.referenceMean);

// ---- The charts ----
const histSvg = path.join(SHOTS, "mavis-categorical-histograms.svg");
const ratesSvg = path.join(SHOTS, "mavis-categorical-hit-rates.svg");
const histPng = path.join(SHOTS, "mavis-categorical-histograms.png");
const ratesPng = path.join(SHOTS, "mavis-categorical-hit-rates.png");
for (const f of [histSvg, ratesSvg, histPng, ratesPng]) {
  raw("chart file exists: " + path.basename(f), fs.existsSync(f) && fs.statSync(f).size > 0, f);
}
const panelPlayers = cat.chartPlayers.filter((p) => p.scoredRows >= 15).slice(0, 12);
const hist = fs.existsSync(histSvg) ? fs.readFileSync(histSvg, "utf8") : "";
for (const p of panelPlayers) {
  raw("histogram panel: " + p.player, hist.includes(p.player), "the name is not in the SVG");
}
raw("twelve histogram panels", panelPlayers.length === 12, "panelPlayers=" + panelPlayers.length);
ok("the document says twelve", "The twelve longest records.");

// ---- The companion records ----
const qaDoc = path.join(ROOT, "docs", "QA-2026-11-26-mavis-categorical-evaluation.md");
raw("the QA record exists", fs.existsSync(qaDoc), qaDoc);
if (fs.existsSync(qaDoc)) {
  const qa = fs.readFileSync(qaDoc, "utf8");
  raw("the QA record names the verifier", qa.includes("dev/mavis-categorical-verification.mjs"), "not named");
  raw("the QA record carries the house sections", ["## Symptom", "## Cause", "## Change", "## After"].every((h) => qa.includes(h)), "a section is missing");
}
raw("the evaluation document names the verifier", doc.includes("dev/mavis-categorical-verification.mjs"), "not named");
const old = path.join(ROOT, "docs", "mavis-player-scoped-evaluation.md");
raw("the superseded document carries a pointer", fs.existsSync(old) && fs.readFileSync(old, "utf8").includes("supersede"), "no pointer");

// ---- Report ----
const failed = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass) console.log("FAIL  " + r.name + (r.needle ? "  ->  " + r.needle : ""));
}
console.log("checks: " + results.length + ", failed: " + failed.length);
if (failed.length) {
  console.log("DOCUMENT VERIFICATION FAILED");
  process.exit(1);
}
console.log("DOCUMENT VERIFICATION PASSED: every figure in docs/mavis-categorical-evaluation.md matches the generated data");
