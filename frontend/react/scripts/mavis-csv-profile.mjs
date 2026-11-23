
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const CSV = path.join(REPO, 'frontend', 'react', '.tmp-audit', 'projection-evaluation.csv');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const head = rows[0];
const recs = rows.slice(1).filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));

const uniq = (k) => { const m = new Map(); for (const r of recs) m.set(r[k], (m.get(r[k]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const perPlayer = new Map();
for (const r of recs) {
  const key = r.athlete_id || r.player;
  if (!perPlayer.has(key)) perPlayer.set(key, []);
  perPlayer.get(key).push(r);
}
const gameCounts = [...perPlayer.values()].map(v => v.length).sort((a, b) => b - a);
const bucket = (n) => gameCounts.filter(x => x >= n).length;

console.log('rows', recs.length, 'players', perPlayer.size);
console.log('status', JSON.stringify(uniq('status').slice(0, 5)));
console.log('outcome_class', JSON.stringify(uniq('outcome_class').slice(0, 8)));
console.log('teams', JSON.stringify(uniq('team').slice(0, 12)));
console.log('positions', JSON.stringify(uniq('position')));
console.log('model_factor', JSON.stringify(uniq('model_factor').slice(0, 12)));
console.log('model_factor_condition sample', JSON.stringify(uniq('model_factor_condition').slice(0, 12)));
console.log('model_path', JSON.stringify(uniq('model_path')));
console.log('sample_flag', JSON.stringify(uniq('sample_flag')));
console.log('players with >=30 games', bucket(30), ' >=40', bucket(40), ' >=50', bucket(50), ' >=80', bucket(80));
console.log('top game counts', JSON.stringify(gameCounts.slice(0, 8)));
const sample = recs.find(r => r.model_projection !== '' && r.actual_dk_points !== '');
console.log('sample row', JSON.stringify(sample, null, 1));

// ---- PERSIST: the dataset profile the write-up cites ----
const profileOut = {
  gamesOfRecord: recs.length,
  playersOfRecord: perPlayer.size,
  positions: Object.fromEntries(uniq('position')),
  teams: Object.fromEntries(uniq('team')),
  modelPath: Object.fromEntries(uniq('model_path')),
  modelFactor: Object.fromEntries(uniq('model_factor')),
  playersAtLeast: { 30: bucket(30), 40: bucket(40), 50: bucket(50), 80: bucket(80) },
  topGameCounts: gameCounts.slice(0, 8),
};
fs.writeFileSync(path.join(REPO, "frontend", "react", ".tmp-audit", "csv-profile.json"), JSON.stringify(profileOut, null, 1));
console.log("");
console.log("wrote frontend/react/.tmp-audit/csv-profile.json");
