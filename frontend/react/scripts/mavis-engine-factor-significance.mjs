/**
 * mavis-engine-factor-significance.mjs
 *
 * Is the engine's own factor any better than a random condition? The null
 * rate was measured (77 of 1,335 random conditions cleared p<0.05 = 5.8%).
 * This tests the engine's 16 of 177 against that rate, with a binomial test,
 * and counts how many of the "clearing" conditions rest on a tiny cell.
 *
 * Also samples the conditions that could not be parsed, so the reason is
 * named rather than guessed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const CSV = path.join(REPO, "frontend", "react", ".tmp-audit", "projection-evaluation.csv");

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function erf(x) {
  const sign = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}
const pFromZ = (z) => Math.max(0, Math.min(1, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)))));
function twoProportion(aHit, aN, bHit, bN) {
  if (!aN || !bN) return { z: NaN, p: NaN };
  const p1 = aHit / aN, p2 = bHit / bN, pooled = (aHit + bHit) / (aN + bN);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / aN + 1 / bN));
  if (se === 0) return { z: 0, p: 1 };
  const z = (p1 - p2) / se;
  return { z, p: pFromZ(z) };
}
/** exact one-sided binomial tail: P(X >= k | n, p) */
function binomialTail(k, n, p) {
  if (n === 0) return 1;
  let acc = 0;
  for (let i = k; i <= n; i++) {
    let coef = 1;
    for (let j = 0; j < i; j++) coef = coef * (n - j) / (j + 1);
    acc += coef * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return Math.min(1, acc);
}

const raw = parseCsv(fs.readFileSync(CSV, "utf8"));
const header = raw[0];
const recs = raw.slice(1).filter((r) => r.length === header.length)
  .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));

// sample the conditions that do not parse
const odd = [];
for (const r of recs) {
  const cond = (r.model_factor_condition || "").trim();
  if (!cond) continue;
  if (cond.includes("even-split floor")) continue;
  if (!/^(opponent|team|month|decade|isHome|restDays|regimeShifts)(\s*!?=|\s*<|\s*>)/.test(cond)) {
    if (odd.length < 8) odd.push({ path: r.model_path, cond: cond.slice(0, 220) });
  }
}
console.log("unparsed condition samples:");
for (const o of odd) console.log("  [" + o.path + "] " + o.cond);

// engine condition tests, reproduced with the cell sizes kept
const payload = JSON.parse(fs.readFileSync(path.join(REPO, "frontend", "react", ".tmp-audit", "player-scoped-evaluation.json"), "utf8"));
const thresholdsByKey = new Map(payload.players.map((p) => [p.key, p.distribution.looseThresholds]));
const classOf = (v, th) => { let c = 0; for (const t of th) if (v >= t) c++; return c; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const monthOf = (d) => Number(d.slice(5, 7));

function parseCondition(condition) {
  const m = /^(opponent|team|month)(\s*!?=|\s*<|\s*>)([^\s(]+)/.exec(condition.trim());
  if (!m) return null;
  return { key: m[1], op: m[2].replace(/\s+/g, ""), val: m[3] };
}
function condHolds(parsed, row) {
  let actual = null;
  if (parsed.key === "opponent") actual = row.opponent;
  else if (parsed.key === "team") actual = row.team;
  else if (parsed.key === "month") actual = String(monthOf(row.date));
  else return null;
  if (parsed.op === "=") return actual === parsed.val;
  if (parsed.op === "!=") return actual !== parsed.val;
  if (parsed.op === "<") return Number(actual) < Number(parsed.val);
  if (parsed.op === ">") return Number(actual) > Number(parsed.val);
  return null;
}
const byPlayer = new Map();
for (const r of recs) {
  const k = r.athlete_id || r.player;
  if (!byPlayer.has(k)) byPlayer.set(k, []);
  byPlayer.get(k).push(r);
}
const tests = [];
for (const [key, rowsAll] of byPlayer) {
  const th = thresholdsByKey.get(key);
  if (!th || th.length < 1) continue;
  const top = th.length - 1;
  const rows = rowsAll.filter((r) => num(r.actual_dk_points) !== null && num(r.model_projection) !== null && num(r.earlier_n) >= 4);
  if (rows.length < 8) continue;
  const inTop = rows.map((r) => classOf(num(r.actual_dk_points), th) === top ? 1 : 0);
  const byCond = new Map();
  for (const r of rows) {
    const cond = (r.model_factor_condition || "").trim();
    if (!cond || cond.includes("even-split floor")) continue;
    const parsed = parseCondition(cond);
    if (!parsed) continue;
    const k2 = parsed.key + " " + parsed.op + " " + parsed.val;
    if (!byCond.has(k2)) byCond.set(k2, parsed);
  }
  for (const [condKey, parsed] of byCond.entries()) {
    const idx = rows.map((r, i) => ({ h: condHolds(parsed, r), inTop: inTop[i] })).filter((x) => x.h !== null);
    const withN = idx.filter((x) => x.h).length, withoutN = idx.length - withN;
    if (withN < 3 || withoutN < 3) continue;
    const withTop = idx.filter((x) => x.h && x.inTop).length;
    const withoutTop = idx.filter((x) => !x.h && x.inTop).length;
    const t = twoProportion(withTop, withN, withoutTop, withoutN);
    tests.push({ player: rowsAll[0].player, condition: condKey, p: t.p, withN, withoutN, withTop, withoutTop });
  }
}
const cleared = tests.filter((t) => t.p < 0.05);
const tiny = cleared.filter((t) => t.withN < 5 || t.withoutN < 5);
const nullRate = 77 / 1335;
const pBinom = binomialTail(cleared.length, tests.length, nullRate);
console.log("");
console.log("engine player-condition tests:", tests.length);
console.log("cleared p<0.05:", cleared.length, "of", tests.length, "=" + (cleared.length / tests.length).toFixed(4));
console.log("measured null rate for a random condition of the same shape:", (nullRate * 100).toFixed(1) + "%");
console.log("expected by chance at the null rate:", (nullRate * tests.length).toFixed(1));
console.log("binomial test, engine vs null rate: one-sided p =", pBinom.toFixed(4));
console.log("cleared conditions resting on a cell under 5 games:", tiny.length, "of", cleared.length);
console.log("cleared conditions with BOTH cells >= 5:", cleared.length - tiny.length);
console.log("cells for the cleared set:", JSON.stringify(cleared.map((t) => ({ p: t.player, c: t.condition, wn: t.withN, won: t.withoutN, p: t.p })).slice(0, 20)));
