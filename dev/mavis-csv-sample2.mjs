import { readFileSync } from "node:fs";
const p = "C:\\Users\\D\\mavis-fantasy-grinder\\frontend\\react\\.tmp-audit\\projection-evaluation.csv";
function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let i = 0; let q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += c; i++; continue;
    }
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
const head = rows[0];
const I = Object.fromEntries(head.map((h, i) => [h, i]));
const data = rows.slice(1).filter(r => r.length === head.length);
console.log("parsed rows:", data.length, "| header cols:", head.length);
const cols = ["date","earlier_n","sample_flag","cut","actual_dk_points","control_low","control_high","control_range","outcome_class","model_path","model_factor","model_factor_t","model_P","model_projection","model_band_position","model_low90","model_high90","model_contained","baseline_projection","baseline_band_position","peeled_high","peeled_low"];
const show = r => cols.map(c => (r[I[c]] === undefined ? "" : r[I[c]])).join(" | ");
console.log("");
console.log("=== Tom Brady, first 16 ===");
console.log(cols.join(" | "));
data.filter(r => r[I.player] === "Tom Brady").slice(0, 16).forEach(r => console.log(show(r)));
console.log("");
console.log("=== rows where a peak was separated (peeled_high or peeled_low > 0) ===");
const peeled = data.filter(r => Number(r[I.peeled_high] || 0) > 0 || Number(r[I.peeled_low] || 0) > 0);
console.log("count:", peeled.length);
peeled.slice(0, 3).forEach(r => { console.log(show(r)); console.log("   just: " + r[I.justification]); });
console.log("");
console.log("=== boom rows on the factor path ===");
data.filter(r => r[I.outcome_class] === "boom (outlier high)" && r[I.model_path] === "factor").slice(0, 2).forEach(r => { console.log(show(r)); console.log("   just: " + r[I.justification]); });
console.log("");
console.log("=== bust rows on the factor path ===");
data.filter(r => r[I.outcome_class] === "bust (outlier low)" && r[I.model_path] === "factor").slice(0, 2).forEach(r => { console.log(show(r)); console.log("   just: " + r[I.justification]); });
console.log("");
console.log("=== inside-the-band rows on the factor path ===");
data.filter(r => r[I.outcome_class] === "inside the band" && r[I.model_path] === "factor").slice(0, 2).forEach(r => { console.log(show(r)); console.log("   just: " + r[I.justification]); });