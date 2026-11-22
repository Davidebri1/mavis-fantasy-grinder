import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/D/mavis-fantasy-grinder/dev/dk-lobby-client.js', 'utf8');
const re = /["'`]((?:https?:\/\/|\/)[A-Za-z0-9_\-\/\.\{\}\$%]{3,140})["'`]/g;
const seen = new Map();
let m;
while ((m = re.exec(t))) {
  const s = m[1];
  const low = s.toLowerCase();
  if (/(draft|slate|salar|game|contest|player|pool|v1|v2|api)/.test(low)) {
    seen.set(s, (seen.get(s) || 0) + 1);
  }
}
const out = [...seen.entries()].sort((a, b) => b[1] - a[1]);
console.log('total candidates', out.length);
for (const [s, c] of out.slice(0, 160)) console.log(c, s);
