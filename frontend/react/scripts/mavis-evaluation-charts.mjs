#!/usr/bin/env node

/* ===========================================================================
 * SUPERSEDED - 2026-11-26 (mavis)
 *
 * This script belongs to the evaluation framing Dave rejected on 2026-11-26:
 * factors and clusters were accepted or rejected, a coefficient was reported
 * as a variable ("P=1"), a p value was printed beside a hit rate, and the
 * framing measured pooled data against control-limit bands.
 *
 * The rejection was of the framing, not of this file. The file stays in the
 * repository as a dated record of that method and is not part of the current
 * evaluation.
 *
 * Its input is pinned to the pre-correction harness JSON so it still runs
 * against the data it was written for. The current method is:
 *   scripts/mavis-categorical-evaluation.mjs   - the analysis
 *   scripts/mavis-categorical-charts.mjs       - the charts
 *   docs/mavis-categorical-evaluation.md       - the write-up
 *
 * Point it at another file with MAVIS_PRE_JSON.
 * =========================================================================== */

/**
 * mavis-evaluation-charts.mjs - renders the CONTROL LIMIT evaluation charts
 * as SVG artifacts. matplotlib is not installed, and the spec says install
 * nothing, so these are hand-rendered SVGs.
 *
 * Reads:
 *   frontend/react/.tmp-audit/projection-evaluation.json              (harness)
 *   frontend/react/.tmp-audit/projection-control-limits.json          (limits)
 *   frontend/react/.tmp-audit/projection-control-limit-significance.json
 * Writes into docs/shots/:
 *   mavis-eval-histogram-<label>.svg - per-player DK-point histograms with
 *     the engine's own LOWER and UPPER control limits, the band between them,
 *     the control limit range R, and the cut C (logistics) marked
 *   mavis-eval-scatter.svg - projection vs actual, identity line, the model
 *     90% interval as a vertical segment per sampled evaluation
 *   mavis-eval-direction.svg - how often each side points at the right
 *     control limit on booms and busts, each bar against its OWN no-skill
 *     reference (its own pointing rate over the same rows - never 50%)
 *   mavis-eval-lift.svg - the same comparison with the lean removed:
 *     points above each side's own no-skill reference
 *   mavis-eval-band-accuracy.svg - how close the number landed to the
 *     actual, in R units: squared band error and correlation with actual
 *   mavis-eval-factor.svg - out of sample, is the winning factor informative?
 *     boom rate on the rows where its condition holds against the rows
 *     where it does not, against the factor path's own base rate
 *   mavis-eval-timeline.svg - the regime player career timeline with
 *     breakpoints marked
 *
 * Colour rule: neutrals for structure, colour only where it means
 * something - the control limits, the cut, level shifts and the no-skill
 * reference marks are red (statistical convention for the outlier
 * boundary); everything else is gray. Built by mavis for Dave.
 *
 * USAGE: node scripts/mavis-evaluation-charts.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectDave } from "./dave-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN_EVAL = process.env.MAVIS_PRE_JSON || join(HERE, "..", ".tmp-audit", "projection-evaluation-pre-correction.json");
const IN_LIMITS = join(HERE, "..", ".tmp-audit", "projection-control-limits.json");
const IN_SIG = join(HERE, "..", ".tmp-audit", "projection-control-limit-significance.json");
const OUT_DIR = join(HERE, "..", "..", "..", "docs", "shots");
if (!existsSync(IN_EVAL)) {
  console.error("This script reads the PRE-CORRECTION harness JSON. The current projection-evaluation.json is the new categorical format and this script cannot read it.");
  console.error("Regenerate the old one with:");
  console.error("  git -C <repo> show 14c3b49:frontend/react/scripts/mavis-projection-evaluation.mjs > .tmp-audit/mavis-projection-evaluation-pre-correction.mjs");
  console.error("  node .tmp-audit/mavis-projection-evaluation-pre-correction.mjs");
  console.error("then copy the generated projection-evaluation.json to projection-evaluation-pre-correction.json");
  process.exit(2);
}

const GRAY_LOW = "#c3cad3";
const GRAY_HIGH = "#697382";
const INK = "#22272e";
const RED = "#c23b2e";
const GRAY_BASE = "#9aa5b1";
const MODEL_FILL = "#39424e";
const MUTED = "#5a6472";
const GRID = "#e4e8ee";
const FONT = "Segoe UI, Arial, sans-serif";

const AMP = String.fromCharCode(38);
const esc = (s) => String(s).replace(/&/g, AMP + "amp;").replace(/</g, AMP + "lt;").replace(/>/g, AMP + "gt;");
const f1 = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) : "?");
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "?");
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : "?");
const fmtInt = (x) => (Number.isFinite(x) ? x.toLocaleString("en-US") : "?");

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
    (dash ? ' stroke-dasharray="' + dash + '"' : "") + '/>';
}
function box(x, y, w, h, fill, extra) {
  return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0, w) + '" height="' + Math.max(0, h) +
    '" fill="' + fill + '"' + (extra ? " " + extra : "") + "/>";
}
function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  for (const m of [1, 2, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}

// ---------------------------------------------------------------------------
// (a) per-player career histogram with the engine's own CONTROL LIMITS
// ---------------------------------------------------------------------------

function limitsFor(p) {
  // The engine's own method on the games shown: split at the median, peel the
  // multimodal peaks, then the two half means ARE the control limits.
  try {
    const games = p.dates.map((d, i) => ({ date: d, score: p.scores[i], factors: {} }));
    const out = projectDave(games, {});
    return {
      lower: out.lowMean,
      upper: out.highMean,
      R: out.highMean - out.lowMean,
      peeled: Array.isArray(out.peeled) ? out.peeled.length : 0,
      source: "the engine's own method (projectDave) on the games shown",
    };
  } catch (e) {
    const s = [...p.scores].sort((a, b) => a - b);
    const half = Math.ceil(s.length / 2);
    const low = s.slice(0, half), high = s.slice(half);
    const m = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return { lower: m(low), upper: m(high), R: m(high) - m(low), peeled: 0, source: "two half means, unpeeled" };
  }
}

function histogramSvg(p) {
  const W = 900, H = 660, M = { t: 104, r: 30, b: 116, l: 74 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const scores = p.scores;
  const lim = limitsFor(p);
  const cut = p.cut;
  const binW = 2;
  const hi = Math.ceil(Math.max(...scores, lim.upper, cut) / binW) * binW;
  const nb = Math.round(hi / binW);
  const counts = new Array(nb).fill(0);
  for (const s of scores) counts[Math.min(nb - 1, Math.floor(s / binW))]++;
  const maxC = Math.max(...counts, 1);
  const x = (v) => M.l + (v / hi) * pw;
  const y = (c) => M.t + ph - (c / maxC) * ph;
  let b = "";

  // the band between the control limits, shaded lightly
  b += box(x(lim.lower), M.t, x(lim.upper) - x(lim.lower), ph, "#f1f4f8");
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
  for (let c = 0; c <= maxC; c += cstep) b += txt(M.l - 8, y(c) + 4, String(Math.round(c)), 11, MUTED, "end");

  // the cut: logistics, dashed gray
  b += seg(x(cut), M.t, x(cut), M.t + ph, GRAY_BASE, 1.2, "5 4");
  b += txt(x(cut) + 5, M.t + ph + 40, "cut C = " + f1(cut), 11, MUTED, "start");

  // the control limits: red, the outlier boundary
  b += seg(x(lim.lower), M.t - 8, x(lim.lower), M.t + ph, RED, 2);
  b += seg(x(lim.upper), M.t - 8, x(lim.upper), M.t + ph, RED, 2);
  b += txt(x(lim.lower), M.t - 14, "lower control limit " + f1(lim.lower), 12, RED, "middle", 600);
  b += txt(x(lim.upper), M.t - 14, "upper control limit " + f1(lim.upper), 12, RED, "middle", 600);
  b += txt((x(lim.lower) + x(lim.upper)) / 2, M.t + 18, "the band", 11.5, MUTED, "middle");
  b += txt((x(lim.lower) + x(lim.upper)) / 2, M.t + 34, "R = " + f1(lim.R) + " DK points", 12, INK, "middle", 700);

  b += txt(M.l + pw / 2, M.t + ph + 62, "DraftKings fantasy points (bin width " + binW + ")", 12, MUTED, "middle");
  b += '<text x="' + (M.l - 46) + '" y="' + (M.t + ph / 2) + '" font-size="12" fill="' + MUTED + '" text-anchor="middle" transform="rotate(-90 ' + (M.l - 46) + " " + (M.t + ph / 2) + ')">games</text>';
  b += txt(M.l, 24, p.player + " (" + p.position + ", " + p.teams + ") - DK points in the games of record, " + p.games + " games, " + p.span, 15, INK, "start", 700);
  b += txt(M.l, 44, "Control limits: lower " + f1(lim.lower) + ", upper " + f1(lim.upper) + ", R = " + f1(lim.R) + " - " + lim.source + ".", 11.5, MUTED);
  b += txt(M.l, 62, "A game above the upper control limit is a boom (outlier high); below the lower control limit is a bust (outlier low).", 11.5, MUTED);
  b += txt(M.l, 80, "Selection: " + p.reason + ".", 10.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------
// (b) projection vs actual scatter, identity line, interval segments
// ---------------------------------------------------------------------------

function scatterSvg(sc, limits) {
  const W = 900, H = 660, M = { t: 88, r: 30, b: 66, l: 76 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const pts = sc.points;
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
  for (const p of pts) marks += '<circle cx="' + x(p[0]) + '" cy="' + y(p[1]) + '" r="1.7" fill="' + MODEL_FILL + '" fill-opacity="0.75"/>';
  b += '<g clip-path="url(#plot)">' + marks + "</g>";
  b += seg(x(lo), y(lo), x(hi), y(hi), INK, 1.4, "6 4");
  b += '<text x="' + (x(hi) - 6) + '" y="' + (y(hi) - 8) + '" font-size="12" fill="' + INK + '" text-anchor="end" font-weight="600" stroke="white" stroke-width="3" paint-order="stroke">identity (projection = actual)</text>';
  b += seg(x(lo) + 14, y(lo) - 16, x(lo) + 44, y(lo) - 16, GRAY_BASE, 1, "2 2");
  b += '<text x="' + (x(lo) + 50) + '" y="' + (y(lo) - 12) + '" font-size="12" fill="' + MUTED + '" stroke="white" stroke-width="3" paint-order="stroke">the model 90% interval, one segment per sampled evaluation</text>';
  b += txt(M.l, 24, "Model projection vs actual - " + fmtInt(pts.length) + " sampled evaluations (1-in-" + sc.sampledEvery + " of the evaluations with an interval)", 15, INK, "start", 700);
  b += txt(M.l, 46, "The control limit range R, the yardstick, is " + f1(limits.median) + " DK points at the median across all evaluations.", 11.5, MUTED);
  b += txt(M.l, 64, "Every evaluation is projected and plotted: nothing is dropped. The interval is the engine's own 90% interval.", 11.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------
// (c) DIRECTION: does the call point at the right control limit?
//     Each bar carries its OWN no-skill reference - the side's own pointing
//     rate over the same rows. There is no 50% line, and there is no
//     complement between booms and busts: each bar has its own n.
// ---------------------------------------------------------------------------

function directionSvg(sig) {
  const W = 960, H = 640, M = { t: 128, r: 30, b: 186, l: 74 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const groups = [
    { name: "boom games", note: "actual above the upper control limit", key: "boom" },
    { name: "bust games", note: "actual below the lower control limit", key: "bust" },
  ];
  const y = (v) => M.t + ph - (v / 100) * ph;
  const groupW = pw / groups.length;
  const barW = groupW * 0.2;
  let b = "";
  for (let v = 0; v <= 100; v += 10) {
    b += seg(M.l, y(v), M.l + pw, y(v), GRID, 1);
    b += txt(M.l - 8, y(v) + 4, v + "%", 11, MUTED, "end");
  }
  b += seg(M.l, M.t + ph, M.l + pw, M.t + ph, INK, 1);
  b += seg(M.l, M.t, M.l, M.t + ph, INK, 1);
  groups.forEach((g, gi) => {
    const gx = M.l + gi * groupW;
    const cx = gx + groupW / 2;
    [["model", MODEL_FILL], ["baseline", GRAY_BASE]].forEach(([side, fill], bi) => {
      const s = sig[side];
      const stat = s[g.key];
      const rate = stat.rate * 100;
      const ref = stat.noSkillReference * 100;
      const bx = cx + (bi === 0 ? -barW - 10 : 10);
      b += box(bx, y(rate), barW, M.t + ph - y(rate), fill);
      b += txt(bx + barW / 2, y(rate) - 9, f1(rate) + "%", 12.5, INK, "middle", 700);
      b += txt(bx + barW / 2, y(rate) - 26, "z=" + f2(stat.z), 11, MUTED, "middle");
      // the side's own no-skill reference, drawn on the bar
      b += seg(bx - 4, y(ref), bx + barW + 4, y(ref), RED, 1.9);
      b += txt(bx + barW / 2, M.t + ph + 36, side, 12.5, INK, "middle", 600);
      b += txt(bx + barW / 2, M.t + ph + 53, "n=" + fmtInt(stat.games), 11, MUTED, "middle");
      b += txt(bx + barW / 2, M.t + ph + 70, "no-skill " + f1(ref) + "%", 10.5, RED, "middle", 600);
      b += txt(bx + barW / 2, M.t + ph + 87, "lift " + (stat.liftPoints >= 0 ? "+" : "") + f1(stat.liftPoints) + " pts", 11, INK, "middle", 600);
      b += txt(bx + barW / 2, M.t + ph + 104, "perm p " + f3(s.permutation[g.key === "boom" ? "pValueBoom" : "pValueBust"]), 10.5, MUTED, "middle");
    });
    b += txt(cx, M.t + ph + 132, g.name, 13.5, INK, "middle", 700);
    b += txt(cx, M.t + ph + 150, g.note, 11, MUTED, "middle");
  });
  b += txt(M.l, 24, "Direction: does the call point at the right control limit?", 15.5, INK, "start", 700);
  b += txt(M.l, 46, "On a boom the call points up; on a bust it points down. A projection exactly at the band midpoint makes no call.", 11.5, MUTED);
  b += txt(M.l, 64, "The red tick is each side's OWN no-skill reference: the rate it scores when it carries no information about the outcome (its own pointing rate over the same rows).", 11.5, MUTED);
  b += txt(M.l, 82, "There is no 50% line here, and booms and busts are separate populations - each bar carries its own n.", 11.5, MUTED);
  b += txt(M.l, 100, "Model pointing up on " + fmtInt(sig.model.pointing.up) + " of " + fmtInt(sig.model.n) + " evaluations; baseline on " + fmtInt(sig.baseline.pointing.up) + ".", 11.5, MUTED);
  b += txt(M.l, 118, "Permutation p is one-sided (shuffled calls against the real outcomes, " + fmtInt(sig.shuffles) + " shuffles, seed " + sig.seed + ").", 11.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------
// (f) the same comparison with the lean removed: points above each side's
//     own no-skill reference
// ---------------------------------------------------------------------------

function liftSvg(sig) {
  const W = 960, H = 560, M = { t: 128, r: 30, b: 176, l: 74 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const items = [
    { side: "model", key: "boom", label: "model - boom" },
    { side: "model", key: "bust", label: "model - bust" },
    { side: "baseline", key: "boom", label: "baseline - boom" },
    { side: "baseline", key: "bust", label: "baseline - bust" },
  ];
  const maxV = 5;
  const y = (v) => M.t + ph - (v / maxV) * ph;
  const slotW = pw / items.length;
  const barW = slotW * 0.46;
  let b = "";
  for (let v = 0; v <= maxV; v += 1) {
    b += seg(M.l, y(v), M.l + pw, y(v), v === 0 ? INK : GRID, v === 0 ? 1.4 : 1);
    b += txt(M.l - 8, y(v) + 4, v + (v === maxV ? " pts" : ""), 11, MUTED, "end");
  }
  b += seg(M.l, M.t, M.l, M.t + ph, INK, 1);
  items.forEach((it, i) => {
    const s = sig[it.side];
    const stat = s[it.key];
    const v = stat.liftPoints;
    const cx = M.l + i * slotW + slotW / 2;
    const bx = cx - barW / 2;
    const fill = it.side === "model" ? MODEL_FILL : GRAY_BASE;
    if (v >= 0) b += box(bx, y(v), barW, M.t + ph - y(v), fill);
    else b += box(bx, y(0), barW, y(v) - y(0), fill);
    b += txt(cx, y(v) + (v >= 0 ? -10 : 18), (v >= 0 ? "+" : "") + f2(v), 13, INK, "middle", 700);
    b += txt(cx, y(v) + (v >= 0 ? -28 : 34), "z=" + f2(stat.z), 11, MUTED, "middle");
    b += txt(cx, M.t + ph + 32, it.label, 12, INK, "middle", 600);
    b += txt(cx, M.t + ph + 50, "n=" + fmtInt(stat.games), 11, MUTED, "middle");
    b += txt(cx, M.t + ph + 68, "observed " + f1(stat.rate * 100) + "%", 11, MUTED, "middle");
    b += txt(cx, M.t + ph + 85, "reference " + f1(stat.noSkillReference * 100) + "%", 10.5, RED, "middle");
  });
  b += txt(M.l, 24, "Lift above each side's own no-skill reference (percentage points)", 15.5, INK, "start", 700);
  b += txt(M.l, 46, "The lean is removed: each side is scored against the rate it reaches carrying no information about the outcome.", 11.5, MUTED);
  b += txt(M.l, 64, "A bar at zero means the side does no better on those games than its own pointing rate already gives it.", 11.5, MUTED);
  b += txt(M.l, 82, "Model booms sit at +" + f1(sig.model.boom.liftPoints) + " points (z=" + f2(sig.model.boom.z) + "): the factor path buys almost nothing on booms.", 11.5, MUTED);
  b += txt(M.l, 100, "The baseline booms sit at +" + f1(sig.baseline.boom.liftPoints) + " points (z=" + f2(sig.baseline.boom.z) + "): the plain prior-games average does.", 11.5, MUTED);
  b += txt(M.l, 118, "Data: " + fmtInt(sig.coverage.withControlLimits) + " evaluations with control limits - " + fmtInt(sig.coverage.boomOutlierHigh) + " booms, " + fmtInt(sig.coverage.bustOutlierLow) + " busts, " + fmtInt(sig.coverage.insideTheBand) + " inside the band.", 11.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------
// (g) BAND ACCURACY: how close the number landed to the actual, in R units
// ---------------------------------------------------------------------------

function bandAccuracySvg(sig) {
  const W = 960, H = 560, M = { t: 128, r: 30, b: 150, l: 74 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const panelW = pw / 2 - 30;
  let b = "";

  // left panel: mean squared band error (lower is better)
  const errMax = Math.ceil(sig.bandAccuracy.bandErrorModel * 1.4);
  const y1 = (v) => M.t + ph - (v / errMax) * ph;
  b += box(M.l, M.t, panelW, ph, "#fbfcfd");
  for (let v = 0; v <= errMax; v += Math.max(1, Math.round(errMax / 5))) {
    b += seg(M.l, y1(v), M.l + panelW, y1(v), GRID, 1);
    b += txt(M.l - 8, y1(v) + 4, f2(v), 11, MUTED, "end");
  }
  b += seg(M.l, M.t + ph, M.l + panelW, M.t + ph, INK, 1);
  b += seg(M.l, M.t, M.l, M.t + ph, INK, 1);
  const bars = [
    { label: "model", v: sig.bandAccuracy.bandErrorModel, fill: MODEL_FILL },
    { label: "baseline", v: sig.bandAccuracy.bandErrorBaseline, fill: GRAY_BASE },
  ];
  const bw1 = panelW * 0.28;
  bars.forEach((bar, i) => {
    const bx = M.l + panelW * (i === 0 ? 0.2 : 0.56);
    b += box(bx, y1(bar.v), bw1, M.t + ph - y1(bar.v), bar.fill);
    b += txt(bx + bw1 / 2, y1(bar.v) - 9, f2(bar.v), 13, INK, "middle", 700);
    b += txt(bx + bw1 / 2, M.t + ph + 28, bar.label, 12, INK, "middle", 600);
  });
  b += txt(M.l + panelW / 2, M.t - 14, "squared band error (R units)", 13, INK, "middle", 700);
  b += txt(M.l + panelW / 2, M.t + 18, "lower is better", 11, MUTED, "middle");

  // right panel: correlation with the actual
  const px = M.l + panelW + 60;
  const corrMax = 0.3;
  const y2 = (v) => M.t + ph - (v / corrMax) * ph;
  b += box(px, M.t, panelW, ph, "#fbfcfd");
  for (let v = 0; v <= corrMax + 1e-9; v += 0.1) {
    b += seg(px, y2(v), px + panelW, y2(v), GRID, 1);
    b += txt(px - 8, y2(v) + 4, f2(v), 11, MUTED, "end");
  }
  b += seg(px, M.t + ph, px + panelW, M.t + ph, INK, 1);
  b += seg(px, M.t, px + panelW, M.t + ph, INK, 1);
  const bars2 = [
    { label: "model", v: sig.bandAccuracy.bandCorrelationModel, fill: MODEL_FILL },
    { label: "baseline", v: sig.bandAccuracy.bandCorrelationBaseline, fill: GRAY_BASE },
  ];
  bars2.forEach((bar, i) => {
    const bx = px + panelW * (i === 0 ? 0.2 : 0.56);
    b += box(bx, y2(bar.v), bw1, M.t + ph - y2(bar.v), bar.fill);
    b += txt(bx + bw1 / 2, y2(bar.v) - 9, f3(bar.v), 13, INK, "middle", 700);
    b += txt(bx + bw1 / 2, M.t + ph + 28, bar.label, 12, INK, "middle", 600);
  });
  b += txt(px + panelW / 2, M.t - 14, "correlation with the actual", 13, INK, "middle", 700);
  b += txt(px + panelW / 2, M.t + 18, "higher is better", 11, MUTED, "middle");

  b += txt(M.l, 24, "Band accuracy: how close the number landed to the actual, in units of R", 15.5, INK, "start", 700);
  b += txt(M.l, 46, "The projection and the actual are both placed in the player's own band, so the distance between them is measured in R.", 11.5, MUTED);
  b += txt(M.l, 64, "The plain prior-games average lands closer than the model: squared error " + f2(sig.bandAccuracy.bandErrorBaseline) + " vs " + f2(sig.bandAccuracy.bandErrorModel) + ".", 11.5, MUTED);
  b += txt(M.l, 82, "Paired t = " + f2(sig.bandAccuracy.pairedT) + " (df " + fmtInt(sig.bandAccuracy.df) + "), p < 0.0001; sign-flip permutation p = " + f3(sig.bandAccuracy.signFlipPermutationP) + ".", 11.5, MUTED);
  b += txt(M.l, 100, "Correlation with the actual: " + f3(sig.bandAccuracy.bandCorrelationModel) + " model vs " + f3(sig.bandAccuracy.bandCorrelationBaseline) + " baseline (Fisher z " + f2(sig.bandAccuracy.correlationDifferenceZ) + ", p < 0.0001).", 11.5, MUTED);
  b += txt(M.l, 118, "Same " + fmtInt(sig.bandAccuracy.n) + " evaluations, paired row by row.", 11.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------
// (h) FACTOR INFORMATIVENESS: out of sample, does the winning factor carry
//     information? The reference is the factor path's own boom rate.
// ---------------------------------------------------------------------------

function factorSvg(sig) {
  const W = 860, H = 540, M = { t: 126, r: 30, b: 156, l: 74 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const fi = sig.factorInformativeness;
  const p1 = fi.p1;
  const y = (v) => M.t + ph - (v / 100) * ph;
  let b = "";
  for (let v = 0; v <= 100; v += 10) {
    b += seg(M.l, y(v), M.l + pw, y(v), GRID, 1);
    b += txt(M.l - 8, y(v) + 4, v + "%", 11, MUTED, "end");
  }
  b += seg(M.l, M.t + ph, M.l + pw, M.t + ph, INK, 1);
  b += seg(M.l, M.t, M.l, M.t + ph, INK, 1);
  const ref = fi.overallBoomRate * 100;
  const bars = [
    { label: "condition holds (P = 1)", rate: p1.rateA * 100, n: p1.nA, count: p1.countA, fill: MODEL_FILL },
    { label: "condition does not hold (P = 0)", rate: p1.rateB * 100, n: p1.nB, count: p1.countB, fill: GRAY_BASE },
  ];
  const slotW = pw / bars.length;
  const barW = slotW * 0.3;
  bars.forEach((bar, i) => {
    const cx = M.l + i * slotW + slotW / 2;
    const bx = cx - barW / 2;
    b += box(bx, y(bar.rate), barW, M.t + ph - y(bar.rate), bar.fill);
    b += txt(cx, y(bar.rate) - 10, f1(bar.rate) + "%", 13.5, INK, "middle", 700);
    b += txt(cx, y(bar.rate) - 28, fmtInt(bar.count) + " booms", 11, MUTED, "middle");
    b += seg(bx - 6, y(ref), bx + barW + 6, y(ref), RED, 1.9);
    b += txt(cx, M.t + ph + 30, bar.label, 12.5, INK, "middle", 600);
    b += txt(cx, M.t + ph + 48, "n=" + fmtInt(bar.n), 11, MUTED, "middle");
  });
  b += txt(M.l + pw / 2, M.t + ph + 80, "red tick = the factor path's own boom rate (" + f1(ref) + "%): if the factor carried nothing, both bars would sit on it", 11.5, RED, "middle", 600);
  b += txt(M.l, 24, "Is the winning factor informative out of sample?", 15.5, INK, "start", 700);
  b += txt(M.l, 46, "On the factor path: boom rate on the games where the winning condition holds, against the games where it does not.", 11.5, MUTED);
  b += txt(M.l, 64, "The factor is chosen from the earlier games only, so these are out-of-sample rows.", 11.5, MUTED);
  b += txt(M.l, 82, "Difference " + (p1.differencePoints >= 0 ? "+" : "") + f1(p1.differencePoints) + " points: z = " + f2(p1.z) + ", p = " + f3(p1.pTwoSided) + " (two-proportion test).", 11.5, MUTED);
  b += txt(M.l, 100, "Small, and real: the condition does carry information - it is not noise. The factor path covers " + fmtInt(fi.factorPathEvaluations) + " evaluations.", 11.5, MUTED);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------
// (d) regime player timeline with breakpoints
// ---------------------------------------------------------------------------

function timelineSvg(p) {
  const W = 960, H = 640, M = { t: 92, r: 30, b: 66, l: 74 };
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
  b += '<polyline points="' + pts + '" fill="none" stroke="' + MODEL_FILL + '" stroke-width="1.4"/>';
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
// write
// ---------------------------------------------------------------------------

const data = JSON.parse(readFileSync(IN_EVAL, "utf8"));
const limits = JSON.parse(readFileSync(IN_LIMITS, "utf8"));
const sig = JSON.parse(readFileSync(IN_SIG, "utf8"));
mkdirSync(OUT_DIR, { recursive: true });

const written = [];
const write = (name, content) => {
  writeFileSync(join(OUT_DIR, name), content);
  written.push(name);
};

for (const p of data.charts.histogramPlayers) {
  write("mavis-eval-histogram-" + p.label + ".svg", histogramSvg(p));
}
write("mavis-eval-scatter.svg", scatterSvg(data.charts.scatter, limits.controlLimitRange));
write("mavis-eval-direction.svg", directionSvg(sig));
write("mavis-eval-lift.svg", liftSvg(sig));
write("mavis-eval-band-accuracy.svg", bandAccuracySvg(sig));
write("mavis-eval-factor.svg", factorSvg(sig));
if (data.charts.timeline) write("mavis-eval-timeline.svg", timelineSvg(data.charts.timeline));

console.log("Charts written: " + written.length);
for (const w of written) console.log("  " + w);
