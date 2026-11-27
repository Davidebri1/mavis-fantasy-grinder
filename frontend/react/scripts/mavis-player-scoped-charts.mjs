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
 * Its input is pinned to the pre-correction CSV so it still runs against the
 * data it was written for. The current method is:
 *   scripts/mavis-categorical-evaluation.mjs   - the analysis
 *   scripts/mavis-categorical-charts.mjs       - the charts
 *   docs/mavis-categorical-evaluation.md       - the write-up
 *
 * Point it at another file with MAVIS_PRE_CSV, or MAVIS_PRE_JSON where the
 * input is the harness JSON.
 * =========================================================================== */

/**
 * mavis-player-scoped-charts.mjs
 *
 * Charts for the per-player evaluation:
 *   1. mavis-player-scoped-histograms.svg - each player's own distribution,
 *      his humps and the thresholds between them. Small multiples, because a
 *      pooled chart of 10,961 games is the thing this whole rebuild is about
 *      not doing.
 *   2. mavis-player-scoped-hit-rates.svg - the one metric against each
 *      player's own no-skill reference, and the model's residual offset.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const IN = path.join(REPO, "frontend", "react", ".tmp-audit", "player-scoped-evaluation.json");
const SHOTS = path.join(REPO, "docs", "shots");

const AMP = String.fromCharCode(38);
const esc = (s) => String(s).replace(new RegExp(AMP, "g"), AMP + "amp;").replace(/</g, AMP + "lt;").replace(/>/g, AMP + "gt;");
const INK = "#14161E", MUTE = "#6B7280", LINE = "#D8DCE6", RED = "#C0392B", AZURE = "#1C6FD0", PAPER = "#FFFFFF", WASH = "#F4F5F8";

const P = JSON.parse(fs.readFileSync(IN, "utf8"));
const AGG = P.aggregate;
/** The players his own rule splits, and the subset whose clusters are usable. */
const splitPlayers = P.players.filter((p) => p.primary.thresholds.length >= 1);
const metricPlayers = splitPlayers.filter((p) => p.primary.clusterValid);
const loosePlayers = P.players.filter((p) => p.distribution.looseThresholds.length >= 1);
const pct = (x) => (x === null || x === undefined ? "n/a" : (x * 100).toFixed(0) + "%");

// ------------------------------------------------------ histograms ---------
function histograms() {
  const panels = splitPlayers.slice(0, 24);
  const cols = 6, rows = Math.ceil(panels.length / cols);
  const pw = 240, ph = 158, gap = 16, top = 74;
  const W = cols * pw + (cols + 1) * gap;
  const H = top + rows * ph + (rows + 1) * gap + 40;
  let s = [];
  s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Inter, Helvetica, Arial, sans-serif">');
  s.push('<rect width="' + W + '" height="' + H + '" fill="' + PAPER + '"/>');
  s.push('<text x="' + gap + '" y="30" font-size="18" font-weight="600" fill="' + INK + '">Each player is his own population</text>');
  s.push('<text x="' + gap + '" y="49" font-size="12" fill="' + MUTE + '">Own DraftKings fantasy points, his own humps, his own thresholds. Red marks a threshold between clusters; blue marks the high cluster. The ' + panels.length + ' of ' + splitPlayers.length + ' players whose own distribution splits under his rule (median/mode + kurtosis ' + AGG.gate.parameters.platykurticCut + '), most games first.</text>');
  s.push('<text x="' + gap + '" y="65" font-size="11" fill="' + MUTE + '">' + metricPlayers.length + ' of the ' + splitPlayers.length + ' have clusters that each pass the normality test and are therefore usable categories; the rest are marked WRONG FACTOR.</text>');

  panels.forEach((p, idx) => {
    const cx = gap + (idx % cols) * (pw + gap);
    const cy = top + Math.floor(idx / cols) * (ph + gap);
    const d = p.distribution;
    const counts = d.counts, min = d.histogramMin;
    const maxC = Math.max(...counts);
    const plotH = ph - 40, plotW = pw - 12;
    const nBins = counts.length;
    const bw = plotW / nBins;
    const th = p.primary.thresholds;
    const topStart = th.length ? Math.max(0, Math.floor((th[th.length - 1] - min))) : nBins;
    s.push('<g>');
    s.push('<rect x="' + cx + '" y="' + cy + '" width="' + pw + '" height="' + ph + '" fill="' + WASH + '" rx="6"/>');
    if (th.length) {
      const hx = cx + 6 + bw * topStart;
      s.push('<rect x="' + hx.toFixed(2) + '" y="' + cy + '" width="' + (cx + 6 + plotW - hx).toFixed(2) + '" height="' + plotH + '" fill="' + AZURE + '" opacity="0.07"/>');
    }
    counts.forEach((c, i) => {
      const h = maxC ? (c / maxC) * (plotH - 14) : 0;
      if (h <= 0) return;
      const x = cx + 6 + i * bw;
      const inTop = th.length && i >= topStart;
      s.push('<rect x="' + (x + 0.5).toFixed(2) + '" y="' + (cy + plotH - h).toFixed(2) + '" width="' + Math.max(1, bw - 1).toFixed(2) + '" height="' + h.toFixed(2) + '" fill="' + (inTop ? AZURE : INK) + '" opacity="' + (inTop ? 0.85 : 0.55) + '"/>');
    });
    th.forEach((t) => {
      const x = cx + 6 + bw * ((t - min) / d.histogramWidth);
      s.push('<line x1="' + x.toFixed(2) + '" y1="' + cy + '" x2="' + x.toFixed(2) + '" y2="' + (cy + plotH) + '" stroke="' + RED + '" stroke-width="1.5" stroke-dasharray="3 3"/>');
    });
    s.push('<text x="' + (cx + 10) + '" y="' + (cy + 16) + '" font-size="11" font-weight="600" fill="' + INK + '">' + esc(p.player) + '</text>');
    s.push('<text x="' + (cx + 10) + '" y="' + (cy + 29) + '" font-size="9.5" fill="' + MUTE + '">' + esc(p.position) + " - " + p.games + " games - median " + d.median + " - mode " + d.mode + " - kurtosis " + d.kurtosis + "</text>");
    s.push('<text x="' + (cx + 10) + '" y="' + (cy + 41) + '" font-size="9.5" fill="' + MUTE + '">thresholds ' + (th.length ? th.map((t) => t.toFixed(1)).join(", ") : "none") + " - clusters " + p.primary.clusters.length + "</text>");
    const ok = p.primary.clusterValid;
    s.push('<text x="' + (cx + 10) + '" y="' + (cy + plotH + 13) + '" font-size="9.5" fill="' + (ok ? AZURE : RED) + '" font-weight="' + (ok ? "600" : "700") + '">' + (ok ? "USABLE CATEGORIES" : "WRONG FACTOR - NOT USABLE") + "</text>");
    s.push('<text x="' + (cx + 10) + '" y="' + (cy + plotH + 25) + '" font-size="9.5" fill="' + MUTE + '">model ' + pct(p.primary.metric.modelHitRate) + " of his own cluster - his no-skill rate " + pct(p.primary.reference.majorityShare) + "</text>");
    s.push('</g>');
  });
  s.push('</svg>');
  fs.writeFileSync(path.join(SHOTS, "mavis-player-scoped-histograms.svg"), s.join("\n"));
  return panels.length;
}

// ------------------------------------------------------ hit rates -----------
function hitRates() {
  const W = 1180, H = 880;
  const s = [];
  s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Inter, Helvetica, Arial, sans-serif">');
  s.push('<rect width="' + W + '" height="' + H + '" fill="' + PAPER + '"/>');
  s.push('<text x="24" y="32" font-size="18" font-weight="600" fill="' + INK + '">The one metric, per player, against his own no-skill rate</text>');
  s.push('<text x="24" y="50" font-size="12" fill="' + MUTE + '">Each dot is one player. X is the share of his games in his largest cluster (what a predictor with no information scores). Y is the model landing in the actual cluster. Below the line means the model lost to doing nothing.</text>');
  s.push('<text x="24" y="66" font-size="11" fill="' + MUTE + '">Top row: the ' + metricPlayers.length + ' players whose clusters are usable categories. Third panel: the same test on the ' + loosePlayers.length + ' players split by humps alone, as the robustness line.</text>');

  function panel(ox, oy, pw, ph, title, get, color, label, pop, note) {
    s.push('<rect x="' + ox + '" y="' + oy + '" width="' + pw + '" height="' + ph + '" fill="' + WASH + '" rx="6"/>');
    s.push('<text x="' + (ox + 12) + '" y="' + (oy + 20) + '" font-size="12" font-weight="600" fill="' + INK + '">' + esc(title) + "</text>");
    const px = ox + 54, py = oy + 34, pw2 = pw - 74, ph2 = ph - 84;
    s.push('<rect x="' + px + '" y="' + py + '" width="' + pw2 + '" height="' + ph2 + '" fill="' + PAPER + '" stroke="' + LINE + '"/>');
    for (let i = 0; i <= 4; i++) {
      const yy = py + (ph2 * i) / 4;
      s.push('<line x1="' + px + '" y1="' + yy.toFixed(1) + '" x2="' + (px + pw2) + '" y2="' + yy.toFixed(1) + '" stroke="' + LINE + '" stroke-width="0.5"/>');
      s.push('<text x="' + (px - 6) + '" y="' + (yy + 3).toFixed(1) + '" font-size="9" text-anchor="end" fill="' + MUTE + '">' + (100 - i * 25) + "%</text>");
    }
    s.push('<line x1="' + px + '" y1="' + (py + ph2) + '" x2="' + (px + pw2) + '" y2="' + py + '" stroke="' + MUTE + '" stroke-width="1" stroke-dasharray="4 4"/>');
    let beats = 0;
    pop.forEach((p) => {
      const v = get(p);
      if (v === null || v === undefined) return;
      const x = px + p.reference.majorityShare * pw2;
      const y = py + (1 - v) * ph2;
      const isBeat = v > p.reference.majorityShare;
      if (isBeat) beats++;
      s.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="' + (isBeat ? AZURE : RED) + '" opacity="0.8"/>');
    });
    s.push('<text x="' + px + '" y="' + (py + ph2 + 18) + '" font-size="9.5" fill="' + MUTE + '">' + esc(label) + " - " + beats + " of " + pop.length + " above their own line" + (note ? " - " + esc(note) : "") + "</text>");
    s.push('<text x="' + (px - 40) + '" y="' + (py + ph2 / 2) + '" font-size="9.5" fill="' + MUTE + '" transform="rotate(-90 ' + (px - 40) + ' ' + (py + ph2 / 2) + ')">model hit rate</text>');
  }

  panel(24, 82, 560, 330, "Raw model", (p) => p.primary.metric.modelHitRate, AZURE, "player no-skill rate", metricPlayers, "");
  panel(608, 82, 560, 330, "After the walk-forward offset (round 2)", (p) => p.primary.metric.calibratedHitRate, INK, "player no-skill rate", metricPlayers, "");
  panel(24, 430, 560, 330, "Robustness: humps only, gate ignored", (p) => p.metric.modelHitRate, AZURE, "player no-skill rate", loosePlayers, "");

  // panel 4: residual offset and spread, for the usable-category population
  const ox = 608, oy = 430, pw = 560, ph = 330;
  s.push('<rect x="' + ox + '" y="' + oy + '" width="' + pw + '" height="' + ph + '" fill="' + WASH + '" rx="6"/>');
  s.push('<text x="' + (ox + 12) + '" y="' + (oy + 20) + '" font-size="12" font-weight="600" fill="' + INK + '">Precision: consistently off by a little, then consistently off by a lot</text>');
  const px = ox + 54, py = oy + 36, pw2 = pw - 74, ph2 = ph - 88;
  const off = metricPlayers.map((p) => p.primary.precision.residualOffset).filter((x) => x !== null);
  const lo = Math.min(-30, Math.min(...off) - 2), hi = Math.max(2, Math.max(...off) + 2);
  const sx = (v) => px + ((v - lo) / (hi - lo)) * pw2;
  s.push('<rect x="' + px + '" y="' + py + '" width="' + pw2 + '" height="' + ph2 + '" fill="' + PAPER + '" stroke="' + LINE + '"/>');
  [0, -10, -20, -30].forEach((v) => {
    if (v < lo || v > hi) return;
    s.push('<line x1="' + sx(v).toFixed(1) + '" y1="' + py + '" x2="' + sx(v).toFixed(1) + '" y2="' + (py + ph2) + '" stroke="' + (v === 0 ? MUTE : LINE) + '" stroke-width="0.8"/>');
    s.push('<text x="' + sx(v).toFixed(1) + '" y="' + (py + ph2 + 14) + '" font-size="9" text-anchor="middle" fill="' + MUTE + '">' + v + "</text>");
  });
  metricPlayers.forEach((p) => {
    const o = p.primary.precision.residualOffset, iqr = p.primary.precision.residualIQR;
    if (o === null || iqr === null) return;
    const x = sx(o);
    s.push('<line x1="' + x.toFixed(1) + '" y1="' + py + '" x2="' + x.toFixed(1) + '" y2="' + (py + ph2) + '" stroke="' + AZURE + '" stroke-width="1" opacity="0.45"/>');
    s.push('<circle cx="' + x.toFixed(1) + '" cy="' + (py + 20) + '" r="2.6" fill="' + AZURE + '" opacity="0.7"/>');
    const spread = Math.min(30, iqr);
    s.push('<line x1="' + sx(o - spread / 2).toFixed(1) + '" y1="' + (py + 34) + '" x2="' + sx(o + spread / 2).toFixed(1) + '" y2="' + (py + 34) + '" stroke="' + RED + '" stroke-width="1" opacity="0.5"/>');
  });
  s.push('<text x="' + px + '" y="' + (py + ph2 + 18) + '" font-size="9.5" fill="' + MUTE + '">blue: the offset added to every projection for that player (negative = the model projects above the actual).</text>');
  s.push('<text x="' + px + '" y="' + (py + ph2 + 30) + '" font-size="9.5" fill="' + MUTE + '">red: the middle half of his residuals around that offset (spread).</text>');
  s.push('<text x="' + px + '" y="' + (py + ph2 + 42) + '" font-size="9.5" fill="' + MUTE + '">median offset ' + AGG.precision.residualOffset.median + " points, median spread " + AGG.precision.residualIQR.median + " points.</text>");
  s.push('</svg>');
  fs.writeFileSync(path.join(SHOTS, "mavis-player-scoped-hit-rates.svg"), s.join("\n"));
  return metricPlayers.length;
}

fs.mkdirSync(SHOTS, { recursive: true });
console.log("split players:", splitPlayers.length, "| usable categories:", metricPlayers.length, "| loose:", loosePlayers.length);
console.log("histogram panels:", histograms());
console.log("hit-rate players:", hitRates());
console.log("wrote", path.join(SHOTS, "mavis-player-scoped-histograms.svg"));
console.log("wrote", path.join(SHOTS, "mavis-player-scoped-hit-rates.svg"));
