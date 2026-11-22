import { readFileSync } from "node:fs";
const p = "C:\\Users\\D\\mavis-fantasy-grinder\\frontend\\react\\.tmp-audit\\projection-evaluation.csv";
function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let i = 0; let q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; } field += c; i++; continue; }
    if (c === '"') { q = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const rows = parseCsv(readFileSync(p, "utf8"));
const head = rows[0]; const I = Object.fromEntries(head.map((h, i) => [h, i]));
const data = rows.slice(1).filter(r => r.length === head.length);
const scored = data.filter(r => r[I.control_range] !== "" && Number(r[I.control_range]) > 0);
console.log("data rows:", data.length, "| scored (with control limits):", scored.length);
const num = r => Number(r);
// band error = mean squared distance in band-position units
const sq = (a, b) => { const d = a - b; return d * d; };
const errM = scored.reduce((s, r) => s + sq(num(r[I.actual_band_position]), num(r[I.model_band_position])), 0) / scored.length;
const errB = scored.reduce((s, r) => s + sq(num(r[I.actual_band_position]), num(r[I.baseline_band_position])), 0) / scored.length;
const corr = (xs, ys) => {
  const n = xs.length; const mx = xs.reduce((a,b)=>a+b,0)/n; const my = ys.reduce((a,b)=>a+b,0)/n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i]-mx, dy = ys[i]-my; sxy += dx*dy; sxx += dx*dx; syy += dy*dy; }
  return sxy / Math.sqrt(sxx * syy);
};
const ap = scored.map(r => num(r[I.actual_band_position]));
console.log("band error  model:", errM.toFixed(4), " baseline:", errB.toFixed(4), " diff(model-base):", (errM-errB).toFixed(4));
console.log("correlation model:", corr(ap, scored.map(r => num(r[I.model_band_position]))).toFixed(4), " baseline:", corr(ap, scored.map(r => num(r[I.baseline_band_position]))).toFixed(4));
// direction: up if band pos > 0.5, down if < 0.5, no call if == 0.5
const dir = (key) => {
  let up = 0, down = 0, none = 0;
  for (const r of scored) { const v = num(r[I[key]]); if (v > 0.5) up++; else if (v < 0.5) down++; else none++; }
  return { up, down, none, upRate: up/scored.length, downRate: down/scored.length };
};
console.log("model direction:", JSON.stringify(dir("model_band_position")));
console.log("baseline direction:", JSON.stringify(dir("baseline_band_position")));
// boom / bust direction vs own reference
for (const [label, key] of [["model", "model_band_position"], ["baseline", "baseline_band_position"]]) {
  for (const oc of ["boom (outlier high)", "bust (outlier low)"]) {
    const sub = scored.filter(r => r[I.outcome_class] === oc);
    const up = sub.filter(r => num(r[I[key]]) > 0.5).length;
    const down = sub.filter(r => num(r[I[key]]) < 0.5).length;
    const none = sub.length - up - down;
    const allUp = scored.filter(r => num(r[I[key]]) > 0.5).length;
    const allDown = scored.filter(r => num(r[I[key]]) < 0.5).length;
    console.log(label, oc, "| n=" + sub.length, "| up=" + up, "down=" + down, "noCall=" + none, "| rate=" + (oc.startsWith("boom") ? up/sub.length : down/sub.length).toFixed(4), "| ref=" + (oc.startsWith("boom") ? allUp/scored.length : allDown/scored.length).toFixed(4));
  }
}
// containment: actual inside [model_low90, model_high90]
let same = 0;
for (const r of scored) { const a = num(r[I.actual_dk_points]); const lo = num(r[I.model_low90]), hi = num(r[I.model_high90]); if (a >= lo - 1e-9 && a <= hi + 1e-9) same++; }
console.log("containment same:", same, "/", scored.length, "=", (same/scored.length*100).toFixed(1) + "%");
// path x P cross-tab
const tab = {};
for (const r of scored) { const k = r[I.model_path] + " | P=" + r[I.model_P]; tab[k] = (tab[k] || 0) + 1; }
console.log("path x P:", JSON.stringify(tab, null, 1));
// outcome classes
const oc = {}; for (const r of scored) oc[r[I.outcome_class]] = (oc[r[I.outcome_class]] || 0) + 1;
console.log("outcome classes:", JSON.stringify(oc));
// peeled totals
let ph = 0, pl = 0; for (const r of scored) { ph += num(r[I.peeled_high] || 0); pl += num(r[I.peeled_low] || 0); }
console.log("peeled high total:", ph, "| peeled low total:", pl);