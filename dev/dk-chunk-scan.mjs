import fs from 'node:fs';
const base = 'https://www.draftkings.com';
const chunks = [
  '/landingpages-public-build/entry.client-V77HQLMA.js',
  '/landingpages-public-build/_shared/chunk-57DXIVER.js',
  '/landingpages-public-build/_shared/chunk-MNUSYCSQ.js',
  '/landingpages-public-build/_shared/chunk-RZ6QQ2JG.js',
  '/landingpages-public-build/_shared/chunk-DKSH3WAH.js',
  '/landingpages-public-build/root-W4HD3O5F.js',
  '/landingpages-public-build/_shared/chunk-JIMRPJBC.js',
  '/landingpages-public-build/_shared/chunk-2BQHU6GB.js',
  '/landingpages-public-build/routes/$-SQGKM2CU.js',
  '/landingpages-public-build/routes/_index-W3LQNXVT.js'
];
const pats = [/draftab/gi, /lobbies\//gi, /salar/gi, /gameTypeId/gi, /api\.draftkings\.com/gi, /draftGroup/gi];
for (const c of chunks) {
  try {
    const r = await fetch(base + c, { headers: { 'user-agent': 'Mozilla/5.0', accept: '*/*' } });
    const t = await r.text();
    const found = [];
    for (const p of pats) {
      const m = t.match(p);
      if (m) found.push(p.source + '=' + m.length);
    }
    console.log(c, r.status, 'len=' + t.length, found.join(' '));
    if (found.length) {
      const idx = t.search(/draftab|lobbies\/|salar|gameTypeId|draftGroup/i);
      console.log('   ctx:', t.slice(Math.max(0, idx - 140), idx + 220).replace(/\s+/g, ' '));
    }
  } catch (e) { console.log(c, 'ERR', e.message); }
}
