/**
 * mavis-categorical-charts.mjs
 *
 * The charts for the categorical evaluation:
 *   1. mavis-categorical-histograms.svg - each player is his own population:
 *      his own games, his own category boundaries, his own means, his own
 *      factors. Small multiples, because one pooled chart of every player is
 *      the thing this rebuild is about not doing.
 *   2. mavis-categorical-hit-rates.svg - the one metric against each player's
 *      own no-skill reference, and the same after the round-2 offset.
 *
 * No p-value appears on either chart. A p-value belongs to the test, and the
 * test belongs in its own section of the document - not next to a hit rate,
 * where it would read as a property of the rate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const IN = path.join(REPO, "frontend", "react", ".tmp-audit", "categorical-evaluation.json");
const SHOTS = path.join(REPO, "docs", "shots");

const AMP = String.fromCharCode(38);
const esc = (s) => String(s).replace(new RegExp(AMP, "g"), AMP + "amp;").replace(/</g, AMP + "lt;").replace(/>/g, AMP + "gt;");
const INK = "#14161E", MUTE = "#6B7280", LINE = "#D8DCE6", RED = "#C0392B", AZURE = "#1C6FD0", PAPER = "#FFFFFF", WASH = "#F4F5F8";

const P = JSON.parse(fs.readFileSync(IN, "utf8"));
const AGG = P.aggregate;
const ROB = P.robustness;

const pct = (x) => (x === null || x === undefined ? "n/a" : (x * 100).toFixed(1) + "%");
const pp = (x) => (x === null || x === undefined ? "n/a" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + " points");
const n2 = (x) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(2));

/** The players on the histogram chart: the ones with a record worth reading. */
const panelPlayers = P.chartPlayers.filter((p) => p.scoredRows >= 15).slice(0, 12);

/** The category line for a panel: "low-outlier [-inf,5.5) n=18 mean=3.06". */
function categoryLine(c) {
  const lo = c.lo === null ? "-inf" : c.lo;
  const hi = c.hi === null ? "inf" : c.hi;
  return c.id + " [" + lo + "," + hi + ") n=" + c.n + " mean=" + n2(c.mean);
}

/** Split a line of prose into lines that fit the canvas. */
function wrap(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur.length) { cur = w; continue; }
    if ((cur + " " + w).length > maxChars) { lines.push(cur); cur = w; }
    else cur += " " + w;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** The factors that fired for this player, most used first. */
function factorLine(factors) {
  const entries = Object.entries(factors || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!entries.length) return "no factor fired";
  return "factors " + entries.map((e) => e[0] + " " + e[1]).join(" / ");
}

// ---------------------------------------------------------------------------
// 1. The histograms - one panel per player, his own population
// ---------------------------------------------------------------------------

function histograms() {
  const panels = panelPlayers;
  const cols = 4, rows = Math.ceil(panels.length / cols);
  const pw = 300, ph = 214, gap = 16;
  const head = [
    "His own games, his own category boundaries, his own means. A red line is a boundary between two of his categories; a blue tick is a category mean. The categories shown are the ones in force at the end of his record.",
    "The shape under each boundary is a property, not a gate: a half that is still bimodal is a fact about that player, not a failure of the data.",
    "The metric is the share of his evaluated days on which the actual landed in the category the model called. His reference is what naming his biggest category every day scores.",
  ];
  const headLines = [];
  for (const line of head) for (const part of wrap(line, 165)) headLines.push(part);
  const top = 50 + headLines.length * 15 + 18;
  const W = cols * pw + (cols + 1) * gap;
  const H = top + rows * ph + (rows + 1) * gap + 40;
  const s = [];
  s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Inter, Helvetica, Arial, sans-serif">');
  s.push('<rect width="' + W + '" height="' + H + '" fill="' + PAPER + '"/>');
  s.push('<text x="' + gap + '" y="30" font-size="18" font-weight="600" fill="' + INK + '">Each player is his own population</text>');
  let hy = 50;
  for (const part of headLines) {
    s.push('<text x="' + gap + '" y="' + hy + '" font-size="11" fill="' + MUTE + '">' + esc(part) + "</text>");
    hy += 15;
  }

  panels.forEach((p, idx) => {
    const cx = gap + (idx % cols) * (pw + gap);
    const cy = top + Math.floor(idx / cols) * (ph + gap);
    const hist = p.histogram;
    const counts = hist.counts;
    const maxC = Math.max(...counts);
    const plotW = pw - 20;
    const plotH = 96;
    const nBins = counts.length;
    const bw = plotW / nBins;
    const min = hist.min;
    const x0 = cx + 10, y0 = cy;

    s.push('<g>');
    s.push('<rect x="' + cx + '" y="' + cy + '" width="' + pw + '" height="' + ph + '" fill="' + WASH + '" rx="6"/>');
    s.push('<rect x="' + x0 + '" y="' + y0 + '" width="' + plotW + '" height="' + plotH + '" fill="' + PAPER + '" stroke="' + LINE + '" stroke-width="0.5"/>');
    counts.forEach((c, i) => {
      const h = maxC ? (c / maxC) * (plotH - 18) : 0;
      if (h <= 0) return;
      const x = x0 + i * bw;
      s.push('<rect x="' + (x + 0.4).toFixed(2) + '" y="' + (y0 + plotH - h).toFixed(2) + '" width="' + Math.max(1, bw - 0.8).toFixed(2) + '" height="' + h.toFixed(2) + '" fill="' + INK + '" opacity="0.55"/>');
    });
    // the category boundaries
    p.categories.forEach((c, ci) => {
      if (ci === 0 || c.lo === null || c.lo === undefined) return;
      const x = x0 + bw * (c.lo - min);
      s.push('<line x1="' + x.toFixed(2) + '" y1="' + y0 + '" x2="' + x.toFixed(2) + '" y2="' + (y0 + plotH) + '" stroke="' + RED + '" stroke-width="1.5" stroke-dasharray="3 3"/>');
    });
    // the category means
    p.categories.forEach((c) => {
      const x = x0 + bw * (c.mean - min);
      if (x < x0 || x > x0 + plotW) return;
      s.push('<polygon points="' + x.toFixed(2) + "," + (y0 + 4) + " " + (x - 4).toFixed(2) + "," + (y0 + 12) + " " + (x + 4).toFixed(2) + "," + (y0 + 12) + '" fill="' + AZURE + '"/>');
    });
    // the axis: the lowest and highest score he scored
    s.push('<text x="' + x0 + '" y="' + (y0 + plotH + 11) + '" font-size="8.5" fill="' + MUTE + '">' + min + "</text>");
    s.push('<text x="' + (x0 + plotW) + '" y="' + (y0 + plotH + 11) + '" font-size="8.5" text-anchor="end" fill="' + MUTE + '">' + (min + nBins) + " points</text>");

    let ty = y0 + plotH + 25;
    s.push('<text x="' + (cx + 10) + '" y="' + ty + '" font-size="11.5" font-weight="600" fill="' + INK + '">' + esc(p.player) + "</text>");
    ty += 13;
    s.push('<text x="' + (cx + 10) + '" y="' + ty + '" font-size="9.5" fill="' + MUTE + '">' + esc(p.position) + " - " + p.games + " games - metric " + pct(p.metric) + " - his reference " + pct(p.reference) + "</text>");
    ty += 13;
    p.categories.slice(0, 4).forEach((c) => {
      s.push('<text x="' + (cx + 10) + '" y="' + ty + '" font-size="9" fill="' + INK + '" opacity="0.8">' + esc(categoryLine(c)) + "</text>");
      ty += 11;
    });
    s.push('<text x="' + (cx + 10) + '" y="' + ty + '" font-size="9" fill="' + MUTE + '">shape high: ' + esc(p.shapeHigh) + " - low: " + esc(p.shapeLow) + "</text>");
    ty += 11;
    s.push('<text x="' + (cx + 10) + '" y="' + ty + '" font-size="9" fill="' + MUTE + '">' + esc(factorLine(p.factors)) + "</text>");
    s.push('</g>');
  });

  s.push('<text x="' + gap + '" y="' + (H - 14) + '" font-size="10" fill="' + MUTE + '">The ' + panels.length + " players shown are the longest records in the evaluation (" + P.population.scoreablePlayers + " players could be scored at all). Source: frontend/react/.tmp-audit/categorical-evaluation.json</text>");
  s.push('</svg>');
  fs.writeFileSync(path.join(SHOTS, "mavis-categorical-histograms.svg"), s.join("\n"));
  return panels.length;
}

// ---------------------------------------------------------------------------
// 2. The hit rates - the one metric against each player's own no-skill rate
// ---------------------------------------------------------------------------

function scatter(s, ox, oy, pw, ph, title, getY, yLabel, caption) {
  const px = ox + 54, py = oy + 30, pw2 = pw - 74, ph2 = ph - 96;
  s.push('<rect x="' + ox + '" y="' + oy + '" width="' + pw + '" height="' + ph + '" fill="' + WASH + '" rx="6"/>');
  s.push('<text x="' + (ox + 12) + '" y="' + (oy + 20) + '" font-size="12" font-weight="600" fill="' + INK + '">' + esc(title) + "</text>");
  s.push('<rect x="' + px + '" y="' + py + '" width="' + pw2 + '" height="' + ph2 + '" fill="' + PAPER + '" stroke="' + LINE + '"/>');
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const yy = py + ph2 * t;
    const xx = px + pw2 * t;
    s.push('<line x1="' + px + '" y1="' + yy.toFixed(1) + '" x2="' + (px + pw2) + '" y2="' + yy.toFixed(1) + '" stroke="' + LINE + '" stroke-width="0.5"/>');
    s.push('<line x1="' + xx.toFixed(1) + '" y1="' + py + '" x2="' + xx.toFixed(1) + '" y2="' + (py + ph2) + '" stroke="' + LINE + '" stroke-width="0.5"/>');
    s.push('<text x="' + (px - 6) + '" y="' + (yy + 3).toFixed(1) + '" font-size="9" text-anchor="end" fill="' + MUTE + '">' + Math.round((1 - t) * 100) + "%</text>");
    s.push('<text x="' + xx.toFixed(1) + '" y="' + (py + ph2 + 13) + '" font-size="9" text-anchor="middle" fill="' + MUTE + '">' + Math.round(t * 100) + "%</text>");
  }
  s.push('<line x1="' + px + '" y1="' + (py + ph2) + '" x2="' + (px + pw2) + '" y2="' + py + '" stroke="' + MUTE + '" stroke-width="1" stroke-dasharray="4 4"/>');
  let above = 0, on = 0, below = 0;
  for (const p of P.players) {
    const y = getY(p);
    if (y === null || y === undefined) continue;
    const x = px + p.reference * pw2;
    const yy = py + (1 - y) * ph2;
    const isAbove = y > p.reference + 1e-9;
    const isOn = Math.abs(y - p.reference) <= 1e-9;
    if (isAbove) above++; else if (isOn) on++; else below++;
    s.push('<circle cx="' + x.toFixed(1) + '" cy="' + yy.toFixed(1) + '" r="3" fill="' + (isOn ? MUTE : isAbove ? AZURE : RED) + '" opacity="' + (isOn ? "0.45" : "0.8") + '"/>');
  }
  const mY = getY(AGG);
  if (mY !== null && mY !== undefined) {
    const x = px + AGG.referenceMean * pw2;
    const yy = py + (1 - mY) * ph2;
    s.push('<polygon points="' + x.toFixed(1) + "," + (yy - 6).toFixed(1) + " " + (x - 5).toFixed(1) + "," + (yy + 4).toFixed(1) + " " + (x + 5).toFixed(1) + "," + (yy + 4).toFixed(1) + '" fill="' + INK + '"/>');
  }
  s.push('<text x="' + px + '" y="' + (py + ph2 + 28) + '" font-size="9.5" fill="' + MUTE + '">' + esc(yLabel) + "</text>");
  s.push('<text x="' + (px + pw2) + '" y="' + (py + ph2 + 28) + '" font-size="9.5" text-anchor="end" fill="' + MUTE + '">his own no-skill reference</text>');
  s.push('<text x="' + (ox + 12) + '" y="' + (oy + ph - 12) + '" font-size="9.5" fill="' + MUTE + '">' + esc(caption) + "</text>");
  return { above, on, below };
}

function hitRates() {
  const head = [
    "Each dot is one player. X is what naming his biggest category every day scores - a predictor with no information about the outcome. Y is the share of his evaluated days on which the actual landed in the category the model called.",
    "Above the dashed line means the model beat naming that player's biggest category every day. The diamond is the population mean: " + pct(AGG.metricMean) + " against a reference of " + pct(AGG.referenceMean) + ".",
    "The tests on these differences are in their own section of the document. A p value belongs to the test, not to a rate, so none is printed here.",
  ];
  const headLines = [];
  for (const line of head) for (const part of wrap(line, 165)) headLines.push(part);
  const top = 50 + headLines.length * 15 + 18;
  const W = 1180, H = top + 520 + 28;
  const s = [];
  s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Inter, Helvetica, Arial, sans-serif">');
  s.push('<rect width="' + W + '" height="' + H + '" fill="' + PAPER + '"/>');
  s.push('<text x="24" y="30" font-size="18" font-weight="600" fill="' + INK + '">The one metric, per player, against his own no-skill rate</text>');
  let hy = 50;
  for (const part of headLines) {
    s.push('<text x="24" y="' + hy + '" font-size="11" fill="' + MUTE + '">' + esc(part) + "</text>");
    hy += 15;
  }

  const a = scatter(s, 24, top, 520, 520, "The call, before any calibration",
    (p) => (p === AGG ? AGG.metricMean : p.metric),
    "the model's metric",
    AGG.playersAboveReference + " players above their own line, " + AGG.playersAtReference + " on it, " + AGG.playersBelowReference + " below.");
  const b = scatter(s, 568, top, 588, 250, "Round 2 - the walk-forward offset applied",
    (p) => (p === AGG ? AGG.calibratedMean : p.calibratedMetric),
    "the calibrated metric",
    "Population mean " + pct(AGG.calibratedMean) + " against " + pct(AGG.referenceMean) + ". The even rows score " + pct(AGG.calibratedEvenMean) + ", the named-category rows " + pct(AGG.calibratedResolvedMean) + ".");

  // the difference, per player
  const ox = 568, oy = top + 274, pw = 588, ph = 246;
  const px = ox + 54, py = oy + 30, pw2 = pw - 74, ph2 = ph - 96;
  s.push('<rect x="' + ox + '" y="' + oy + '" width="' + pw + '" height="' + ph + '" fill="' + WASH + '" rx="6"/>');
  s.push('<text x="' + (ox + 12) + '" y="' + (oy + 20) + '" font-size="12" font-weight="600" fill="' + INK + '">The difference, per player</text>');
  const diffs = P.players.map((p) => p.difference);
  const lo = -0.5, hi = 0.5, bw2 = 0.02;
  const bins = new Array(Math.round((hi - lo) / bw2)).fill(0);
  for (const d of diffs) {
    if (d === null || d === undefined) continue;
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((d - lo) / bw2)));
    bins[i]++;
  }
  const maxC = Math.max(...bins);
  s.push('<rect x="' + px + '" y="' + py + '" width="' + pw2 + '" height="' + ph2 + '" fill="' + PAPER + '" stroke="' + LINE + '"/>');
  bins.forEach((c, i) => {
    if (!c) return;
    const h = (c / maxC) * (ph2 - 14);
    const x = px + (i / bins.length) * pw2;
    const w = (1 / bins.length) * pw2;
    const mid = lo + (i + 0.5) * bw2;
    s.push('<rect x="' + x.toFixed(2) + '" y="' + (py + ph2 - h).toFixed(2) + '" width="' + Math.max(1, w - 1).toFixed(2) + '" height="' + h.toFixed(2) + '" fill="' + (mid < 0 ? RED : AZURE) + '" opacity="0.8"/>');
  });
  const zx = px + ((0 - lo) / (hi - lo)) * pw2;
  s.push('<line x1="' + zx.toFixed(1) + '" y1="' + py + '" x2="' + zx.toFixed(1) + '" y2="' + (py + ph2) + '" stroke="' + RED + '" stroke-width="1.5"/>');
  s.push('<text x="' + px + '" y="' + (py + ph2 + 13) + '" font-size="9" text-anchor="middle" fill="' + MUTE + '">-50 points</text>');
  s.push('<text x="' + zx.toFixed(1) + '" y="' + (py + ph2 + 13) + '" font-size="9" text-anchor="middle" fill="' + MUTE + '">0</text>');
  s.push('<text x="' + (px + pw2) + '" y="' + (py + ph2 + 13) + '" font-size="9" text-anchor="end" fill="' + MUTE + '">+50 points</text>');
  s.push('<text x="' + px + '" y="' + (py + ph2 + 28) + '" font-size="9.5" fill="' + MUTE + '">the model metric minus his own no-skill reference, per player</text>');
  const diffCaption = "Population mean " + pp(AGG.differenceMean) + ", median " + pp(AGG.differenceMedian) + ". "
    + AGG.playersBelowReference + " players below their own line against " + AGG.playersAboveReference + " above.";
  s.push(`<text x="${ox + 12}" y="${oy + ph - 12}" font-size="9.5" fill="${MUTE}>${esc(diffCaption)}</text>`);

  s.push('</svg>');
  fs.writeFileSync(path.join(SHOTS, "mavis-categorical-hit-rates.svg"), s.join("\n"));
  return { above: a.above, on: a.on, below: a.below, calibratedAbove: b.above };
}

fs.mkdirSync(SHOTS, { recursive: true });
console.log("histogram panels:", histograms());
const h = hitRates();
console.log("hit-rate players:", P.players.length, "| above:", h.above, "| on:", h.on, "| below:", h.below);
console.log("wrote", path.join(SHOTS, "mavis-categorical-histograms.svg"));
console.log("wrote", path.join(SHOTS, "mavis-categorical-hit-rates.svg"));
