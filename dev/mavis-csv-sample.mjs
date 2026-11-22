import { readFileSync } from "node:fs";
const p = "C:\\Users\\D\\mavis-fantasy-grinder\\frontend\\react\\.tmp-audit\\projection-evaluation.csv";
const t = readFileSync(p, "utf8");
const lines = t.split(/\r?\n/).filter(Boolean);
const head = lines[0].split(",");
console.log("HEADER (" + head.length + "):", head.join(" | "));
console.log("ROWS:", lines.length - 1);
const idx = Object.fromEntries(head.map((h, i) => [h, i]));
const rows = lines.slice(1).map(l => l.split(","));
const pick = (r, cols) => cols.map(c => r[idx[c]]).join(" | ");
const cols = ["date","earlier_n","sample_flag","cut","actual_dk_points","control_low","control_high","control_range","outcome_class","model_path","model_factor","model_P","model_projection","model_band_position","model_contained","baseline_projection","baseline_band_position","peeled_high","peeled_low"];
console.log("");
console.log("--- Tom Brady, first 14 evaluations ---");
console.log(cols.join(" | "));
rows.filter(r => r[idx.player] === "Tom Brady").slice(0, 14).forEach(r => console.log(pick(r, cols)));
console.log("");
console.log("--- 3 rows with peeled_high or peeled_low non-empty ---");
rows.filter(r => (r[idx.peeled_high] || r[idx.peeled_low]).length > 0).slice(0, 3).forEach(r => {
  console.log(pick(r, cols));
  console.log("   justification: " + r[idx.justification]);
});
console.log("");
console.log("--- 2 boom rows and 2 bust rows with a factor path ---");
for (const oc of ["boom (outlier high)", "bust (outlier low)"]) {
  rows.filter(r => r[idx.outcome_class] === oc && r[idx.model_path] === "F").slice(0, 2).forEach(r => {
    console.log(pick(r, cols));
    console.log("   justification: " + r[idx.justification]);
  });
}
console.log("");
console.log("--- distinct outcome_class values ---");
console.log(JSON.stringify([...new Set(rows.map(r => r[idx.outcome_class]))]));
console.log("--- distinct model_path values ---");
console.log(JSON.stringify([...new Set(rows.map(r => r[idx.model_path]))]));
console.log("--- status values ---");
console.log(JSON.stringify([...new Set(rows.map(r => r[idx.status]))].slice(0, 6)));