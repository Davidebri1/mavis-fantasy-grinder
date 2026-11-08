#!/usr/bin/env node
/**
 * mavis-evaluation-charts.mjs - renders the evaluation charts as SVG
 * artifacts. matplotlib is not installed, and the spec says install
 * nothing, so these are hand-rendered SVGs. Reads the harness summary
 * JSON (frontend/react/.tmp-audit/projection-evaluation.json) and writes
 * into docs/shots/:
 *   mavis-eval-histogram-<label>.svg - per-player career DK-point
 *     histograms, cut line, halves shaded (stable / bimodal / wild /
 *     middling / regime players, selection reasons recorded in the JSON)
 *   mavis-eval-scatter.svg - projection vs actual, identity line, the
 *     model 90% interval as a vertical segment per sampled evaluation
 *   mavis-eval-agreement.svg - model vs baseline categorization
 *     agreement on booms, busts, overall, with the 50% line
 *   mavis-eval-timeline.svg - the regime player career timeline with
 *     breakpoints marked
 *
 * Colour rule: neutrals for structure, colour only where it means
 * something - the cut line, level shifts and the 50% reference are red
 * (statistical convention for the outlier boundary); everything else is
 * gray. Built by mavis for Dave.
 *
 * USAGE: node scripts/mavis-evaluation-charts.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN_JSON = join(HERE, "..", ".tmp-audit", "projection-evaluation.json");
const OUT_DIR = join(HERE, "..", "..", "..", "docs", "shots");

const GRAY_LOW = "#c3cad3";   // low half bins
const GRAY_HIGH = "#697382";  // high half bins
const INK = "#22272e";
const RED = "#c23b2e";
const GRAY_BASE = "#9aa5b1";  // baseline series
const MUTED = "#5a6472";
const GRID = "#e4e8ee";
const FONT = "Segoe UI, Arial, sans-serif";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f1 = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) : "?");

function svg(W, H, body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
    '" viewBox="0 0 ' + W + " " + H + '"><rect width="100%" height="100%" fill="white"/>' +
    '<g font-family="' + FONT + '">' + body + "</g></svg>";
}

function txt(x, y, s, size, fill, anchor, weight) {
  return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + (fill || INK) + '"' +
    (anchor ? ' text-anchor="' + anchor + '"' : "") +
    (weight ? ' font-weight="' + weight + '"' : "") + ">" + esc(s) + "</text>";
}

function seg(x1, y1, x2, y2, stroke, width, dash) {
  return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
    '" stroke="' + stroke + '" stroke-width="' + (width || 1) + '"' +
    (dash ? ' stroke-dasharray="' + dash + '"' : "") + "/>";
}

function box(x, y, w, h, fill, extra) {
  return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0, w) + '" height="' + Math.max(0, h) +
    '" fill="' + fill + '"' + (extra ? " " + extra : "") + "/>";
}

/** nice axis steps: 1/2/5 x 10^k covering the range. */
function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}

// ---------------------------------------------------------------------------
// (a) per-player career histogram, cut line, halves shaded
// ---------------------------------------------------------------------------

function histogramSvg(p) {
  const W = 860, H = 620, M = { t: 84, r: 30, b: 96, l: 74 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const scores = p.scores;
  const cut = p.cut;
  const binW = 2;
  const hi = Math.ceil(Math.max(...scores, cut) / binW) * binW;
  const nb = Math.round(hi / binW);
  const counts = new Array(nb).fill(0);
  let lowN = 0, highN = 0;
  for (const s of scores) {
    const b = Math.min(nb - 1, Math.floor(s / binW));
    counts[b]++;
    if (s <= cut) lowN++; else highN++;
  }
  const maxC = Math.max(...counts, 1);
  const x = (v) => M.l + (v / hi) * pw;
  const y = (c) => M.t + ph - (c / maxC) * ph;
  let b = "";
  for (let i = 0; i < nb; i++) {
    if (!counts[i]) continue;
    const v0 = i * binW;
    const isLow = v0 + binW / 2 <= cut;
    b += box(x(v0), y(counts[i]), (binW / hi) * pw - 1, M.t + ph - y(counts[i]),
      isLow ? GRAY_LOW : GRAY_HIGH, 'stroke="white" stroke-width="0.5"');
  }
  b += seg(M.l, M.t, M.l, M.t + ph, INK, 1);
  b += seg(M.l, M.t + ph, M.l + pw, M.t + ph, INK, 1);
  const step = niceStep(hi, 8);
  for (let v = 0; v <= hi; v += step) {
    b += seg(x(v), M.t + ph, x(v), M.t + ph + 4, INK, 1);
    b += txt(x(v), M.t + ph + 18, String(Math.round(v)), 11, MUTED, "middle");
  }
  const cstep = niceStep(maxC, 5);
  for (let c = 0; c <= maxC; c += cstep) {
    b += txt(M.l - 8, y(c) + 4, String(Math.round(c)), 11, MUTED, "end");
  }
  b += txt(M.l + pw / 2, M.t + ph + 40, "DraftKings fantasy points (bin width " + binW + ")", 12, MUTED, "middle");
  b += '<text x="' + (M.l - 46) + '" y="' + (M.t + ph / 2) + '" font-size="12" fill="' + MUTED + '" text-anchor="middle" transform="rotate(-90 ' + (M.l - 46) + " " + (M.t + ph / 2) + ')">games</text>';
  b += seg(x(cut), M.t - 6, x(cut), M.t + ph, RED, 2);
  b += txt(x(cut) + 6, M.t - 10, "cut C = " + f1(cut), 13, RED, "start", 600);
  b += box(M.l, M.t - 30, 12, 12, GRAY_LOW);
  b += txt(M.l + 17, M.t - 20, "low half (<= C), n=" + lowN, 12, INK);
  b += box(M.l + 178, M.t - 30, 12, 12, GRAY_HIGH);
  b += txt(M.l + 195, M.t - 20, "high half (> C), n=" + highN, 12, INK);
  b += txt(M.l, 24, p.player + " (" + p.position + ", " + p.teams + ") - DK points in the games of record, " + p.games + " games, " + p.span, 15, INK, "start", 700);
  b += txt(M.l, 44, "Games of record = this player's games inside the sampled teams' schedules; a log can be part of a career.", 11.5, MUTED);
  b += txt(M.l, M.t + ph + 62, "Cut C = the largest value in the low half of the median split.", 10.5, MUTED);
  b += txt(M.l, M.t + ph + 78, "Selection: " + p.reason, 10.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------
// (b) projection vs actual scatter, identity line, interval segments
// ---------------------------------------------------------------------------

function scatterSvg(sc) {
  const W = 900, H = 640, M = { t: 70, r: 30, b: 66, l: 76 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const pts = sc.points; // [actual, projection, low90, high90]
  let lo = 0, hi = 40;
  for (const p of pts) {
    lo = Math.min(lo, p[0], p[1], p[2]);
    hi = Math.max(hi, p[0], p[1], p[3]);
  }
  const x = (v) => M.l + ((v - lo) / (hi - lo)) * pw;
  const y = (v) => M.t + ph - ((v - lo) / (hi - lo)) * ph;
  let b = '<clipPath id="plot"><rect x="' + M.l + '" y="' + M.t + '" width="' + pw + '" height="' + ph + '"/></clipPath>';
  b += box(M.l, M.t, pw, ph, "#fbfcfd");
  const step = niceStep(hi - lo, 8);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    b += seg(x(v), M.t, x(v), M.t + ph, GRID, 1);
    b += seg(M.l, y(v), M.l + pw, y(v), GRID, 1);
    b += txt(x(v), M.t + ph + 18, String(Math.round(v)), 11, MUTED, "middle");
    b += txt(M.l - 8, y(v) + 4, String(Math.round(v)), 11, MUTED, "end");
  }
  b += seg(M.l, M.t + ph, M.l + pw, M.t + ph, INK, 1);
  b += seg(M.l, M.t, M.l, M.t + ph, INK, 1);
  b += txt(M.l + pw / 2, H - 20, "actual DK points", 13, MUTED, "middle");
  b += '<text x="' + (M.l - 50) + '" y="' + (M.t + ph / 2) + '" font-size="13" fill="' + MUTED + '" text-anchor="middle" transform="rotate(-90 ' + (M.l - 50) + " " + (M.t + ph / 2) + ')">model projection</text>';
  let marks = "";
  for (const p of pts) marks += seg(x(p[0]), y(p[2]), x(p[0]), y(p[3]), GRAY_BASE, 1, "2 2");
  for (const p of pts) {
    marks += '<circle cx="' + x(p[0]) + '" cy="' + y(p[1]) + '" r="1.7" fill="#39424e" fill-opacity="0.75"/>';
  }
  b += '<g clip-path="url(#plot)">' + marks + "</g>";
  b += seg(x(lo), y(lo), x(hi), y(hi), INK, 1.4, "6 4");
  b += '<text x="' + (x(hi) - 6) + '" y="' + (y(hi) - 8) + '" font-size="12" fill="' + INK + '" text-anchor="end" font-weight="600" stroke="white" stroke-width="3" paint-order="stroke">identity (projection = actual)</text>';
  b += seg(x(lo) + 14, y(lo) - 16, x(lo) + 44, y(lo) - 16, GRAY_BASE, 1, "2 2");
  b += '<text x="' + (x(lo) + 50) + '" y="' + (y(lo) - 12) + '" font-size="12" fill="' + MUTED + '" stroke="white" stroke-width="3" paint-order="stroke">the model 90% interval, one segment per sampled evaluation</text>';
  b += txt(M.l, 24, "Model projection vs actual - " + pts.length + " sampled evaluations (1-in-" + sc.sampledEvery + " of the " + "evaluations with an interval)", 15, INK, "start", 700);
  b += txt(M.l, 46, sc.note, 11.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------
// (c) model vs baseline categorization agreement, 50% line
// ---------------------------------------------------------------------------

function agreementSvg(ag) {
  const W = 900, H = 560, M = { t: 92, r: 30, b: 110, l: 74 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const groups = [
    { name: "boom games", model: ag.model.boom, baseline: ag.baseline.boom },
    { name: "bust games", model: ag.model.bust, baseline: ag.baseline.bust },
    { name: "all evaluations", model: ag.model.overall, baseline: ag.baseline.overall },
  ];
  const y = (v) => M.t + ph - (v / 100) * ph;
  const groupW = pw / groups.length;
  const barW = groupW * 0.22;
  let b = "";
  for (let v = 0; v <= 100; v += 10) {
    b += seg(M.l, y(v), M.l + pw, y(v), v === 50 ? RED : GRID, v === 50 ? 1.6 : 1, v === 50 ? "7 5" : "");
    b += txt(M.l - 8, y(v) + 4, v + "%", 11, v === 50 ? RED : MUTED, "end", v === 50 ? 600 : undefined);
  }
  b += seg(M.l, M.t + ph, M.l + pw, M.t + ph, INK, 1);
  b += seg(M.l, M.t, M.l, M.t + ph, INK, 1);
  groups.forEach((g, gi) => {
    const gx = M.l + gi * groupW;
    const cx = gx + groupW / 2;
    const bars = [
      { v: g.model.rate, n: g.model.evaluations, z: g.model.z, fill: "#39424e", label: "model" },
      { v: g.baseline.rate, n: g.baseline.evaluations, z: g.baseline.z, fill: GRAY_BASE, label: "baseline" },
    ];
    bars.forEach((bar, bi) => {
      const bx = cx + (bi === 0 ? -barW - 8 : 8);
      b += box(bx, y(bar.v), barW, M.t + ph - y(bar.v), bar.fill);
      b += txt(bx + barW / 2, y(bar.v) - 8, f1(bar.v) + "%", 12.5, INK, "middle", 700);
      b += txt(bx + barW / 2, y(bar.v) - 24, "z=" + bar.z, 11, MUTED, "middle");
      b += txt(bx + barW / 2, M.t + ph + 34, bar.label, 12, INK, "middle", 600);
      b += txt(bx + barW / 2, M.t + ph + 50, "n=" + bar.n, 11, MUTED, "middle");
    });
    b += txt(cx, M.t + ph + 80, g.name, 13, INK, "middle", 700);
  });
  b += txt(M.l, 24, "Categorization agreement: does the categorization match the actual category?", 15, INK, "start", 700);
  b += txt(M.l, 46, "Agree (same) = high on a boom, low on a bust, cut C per game. One-sample z-test against 50% on each bar. Red line = 50%.", 11.5, MUTED);
  b += txt(M.l, 64, "Booms and busts are separate populations here, never complements - each bar carries its own n.", 11.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------
// (d) regime player timeline with breakpoints
// ---------------------------------------------------------------------------

function timelineSvg(p) {
  const W = 960, H = 620, M = { t: 92, r: 30, b: 66, l: 74 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const xs = p.scores;
  const n = xs.length;
  const lo = Math.min(0, ...xs), hi = Math.max(...xs) * 1.05;
  const x = (i) => M.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v) => M.t + ph - ((v - lo) / (hi - lo)) * ph;
  let b = "";
  const step = niceStep(hi - lo, 8);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    b += seg(M.l, y(v), M.l + pw, y(v), GRID, 1);
    b += txt(M.l - 8, y(v) + 4, String(Math.round(v)), 11, MUTED, "end");
  }
  b += seg(M.l, M.t + ph, M.l + pw, M.t + ph, INK, 1);
  b += seg(M.l, M.t, M.l, M.t + ph, INK, 1);
  b += txt(M.l + pw / 2, H - 18, "career games, in date order (game 1 to " + n + ")", 12, MUTED, "middle");
  b += '<text x="' + (M.l - 50) + '" y="' + (M.t + ph / 2) + '" font-size="12" fill="' + MUTED + '" text-anchor="middle" transform="rotate(-90 ' + (M.l - 50) + " " + (M.t + ph / 2) + ')">DraftKings points</text>';
  const pts = xs.map((v, i) => x(i) + "," + y(v)).join(" ");
  b += '<polyline points="' + pts + '" fill="none" stroke="#39424e" stroke-width="1.4"/>';
  let labelFlip = 0;
  for (const f of p.flags) {
    const idx = p.dates.findIndex((d) => d.slice(0, 10) === f.date.slice(0, 10));
    if (idx < 0) continue;
    const atRight = x(idx) > M.l + pw * 0.78;
    const lx = atRight ? x(idx) - 4 : x(idx) + 4;
    const anchor = atRight ? "end" : "start";
    if (f.kind === "level shift") {
      b += seg(x(idx), M.t, x(idx), M.t + ph, RED, 1.4, "5 4");
      b += txt(lx, M.t + 12 + (labelFlip % 2) * 16, "level shift (" + f.date.slice(0, 10) + ")", 11, RED, anchor, 600);
      labelFlip++;
    } else if (f.kind === "team change") {
      b += seg(x(idx), M.t, x(idx), M.t + ph, GRAY_BASE, 1.4, "5 4");
      b += txt(lx, M.t + 12 + (labelFlip % 2) * 16, "team change (" + f.date.slice(0, 10) + ")", 11, MUTED, anchor);
      labelFlip++;
    } else if (f.kind === "big swing") {
      b += '<circle cx="' + x(idx) + '" cy="' + y(xs[idx]) + '" r="5" fill="none" stroke="' + RED + '" stroke-width="1.6"/>';
    }
  }
  const legendY = M.t - 14;
  b += seg(M.l, legendY, M.l + 26, legendY, RED, 1.4, "5 4");
  b += txt(M.l + 32, legendY + 4, "level shift", 11.5, RED);
  b += seg(M.l + 120, legendY, M.l + 146, legendY, GRAY_BASE, 1.4, "5 4");
  b += txt(M.l + 152, legendY + 4, "team change", 11.5, MUTED);
  b += '<circle cx="' + (M.l + 258) + '" cy="' + legendY + '" r="5" fill="none" stroke="' + RED + '" stroke-width="1.6"/>';
  b += txt(M.l + 270, legendY + 4, "big swing (>= 15 DK points)", 11.5, MUTED);
  b += txt(M.l, 24, p.player + " (" + p.position + ", " + p.teams + ") - " + p.games + " games, " + p.span, 15, INK, "start", 700);
  b += txt(M.l, 44, "Selection: " + p.reason + ".", 11.5, MUTED);
  b += txt(M.l, 60, "Flags are leads, not firings - each is a candidate factor for the regime, recorded with its date.", 11.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------

const data = JSON.parse(readFileSync(IN_JSON, "utf8"));
mkdirSync(OUT_DIR, { recursive: true });
const written = [];
const put = (name, text) => {
  const p = join(OUT_DIR, name);
  writeFileSync(p, text);
  written.push(p);
  console.log("Wrote " + p);
};

for (const p of data.charts.histogramPlayers) {
  put("mavis-eval-histogram-" + p.label + ".svg", histogramSvg(p));
}
put("mavis-eval-scatter.svg", scatterSvg(data.charts.scatter));
put("mavis-eval-agreement.svg", agreementSvg(data.agreement));
if (data.charts.timeline) {
  const tl = data.charts.timeline;
  tl.reason = (data.charts.histogramPlayers.find((q) => q.label === "regime") || {}).reason
    || "largest flagged level shift in the dataset";
  put("mavis-eval-timeline.svg", timelineSvg(tl));
}

console.log("Charts written: " + written.length);
