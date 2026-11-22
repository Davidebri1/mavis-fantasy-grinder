import fs from "node:fs";
const shots = "C:/Users/D/mavis-fantasy-grinder/docs/shots/";
const names = ["stable","bimodal","wild","middling","regime"];
for (const n of names) {
  const t = fs.readFileSync(shots + "mavis-eval-histogram-" + n + ".svg", "utf8");
  const lim = t.match(/Control limits: lower ([^<]+), upper ([^<]+), R = ([^<]+)/);
  const title = t.match(/font-size="15"[^>]*>([^<]+)/);
  console.log(n + " | " + (lim ? lim[1] + " / " + lim[2] + " / R " + lim[3] : "NOT FOUND") + " | " + (title ? title[1] : ""));
}
// a live sample of CSV rows for the most-evaluated player
const csv = fs.readFileSync("C:/Users/D/mavis-fantasy-grinder/frontend/react/.tmp-audit/projection-evaluation.csv", "utf8");
function parseCsv(text) {
  const rows = []; let field = ""; let row = []; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; continue; }
    if (ch === '"') { inQ = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const [header, ...body] = parseCsv(csv);
const ix = Object.fromEntries(header.map((h, i) => [h, i]));
const counts = {};
for (const r of body) { const p = r[ix.player]; counts[p] = (counts[p] || 0) + 1; }
const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
console.log("\nmost-evaluated player: " + top[0] + " with " + top[1] + " rows");
const picked = body.filter((r) => r[ix.player] === top[0] && r[ix.status] === "evaluation" && Number(r[ix.earlier_n]) >= 30).slice(0, 10);
const cols = ["date","earlier_n","sample_flag","control_low","control_high","control_range","outcome_class","actual_band_position","model_path","model_factor","model_P","model_projection","model_band_position","model_direction","model_low90","model_high90","model_contained","baseline_projection","baseline_band_position","baseline_direction","peeled_high","peeled_low"];
for (const r of picked) {
  console.log(JSON.stringify(Object.fromEntries(cols.map((c) => [c, r[ix[c]]]))));
}
