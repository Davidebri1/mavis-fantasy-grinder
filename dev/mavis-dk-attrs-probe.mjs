/**
 * Probe 4: stat-attribute ids and projection coverage.
 *
 * NFL uses draftStatAttributes id 90 for FPPG. NBA uses a different id.
 * This measures which ids each sport publishes, what the non-numeric
 * values look like, and whether duplicate slot entries of one player carry
 * identical stat attributes.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADERS = { accept: "application/json", "user-agent": UA, referer: "https://www.draftkings.com/" };

async function liveGroup(sport, classicType) {
  const lobby = await (await fetch(`https://api.draftkings.com/lobbies/v1/lobbies/${sport}`, { headers: HEADERS })).json();
  const now = Date.now();
  const groups = new Map();
  for (const c of lobby?.lobby?.contests ?? []) {
    const t = new Date(c.contestStartTime).getTime();
    if (!Number.isFinite(t) || t <= now) continue;
    const g = groups.get(c.draftGroupId) ?? { start: t, n: 0, type: Number(c.gameTypeId) };
    g.n += 1;
    if (t < g.start) g.start = t;
    groups.set(c.draftGroupId, g);
  }
  const ranked = [...groups.entries()].sort((a, b) => a[1].start - b[1].start || b[1].n - a[1].n);
  const classic = ranked.filter(([, g]) => g.type === classicType);
  const pick = (classic.length ? classic : ranked)[0];
  const blob = await (await fetch(`https://api.draftkings.com/draftgroups/v1/draftgroups/${pick[0]}/draftables`, { headers: HEADERS })).json();
  return { dg: pick[0], entries: blob.draftables ?? [] };
}

for (const [sport, classicType] of [["nfl", 1], ["nba", 70]]) {
  console.log("\n================ " + sport.toUpperCase() + " ================");
  const { dg, entries } = await liveGroup(sport, classicType);
  console.log("draft group:", dg, "entries:", entries.length);

  const idCounts = new Map();
  const nonNumeric = new Map();
  for (const e of entries) {
    for (const a of e.draftStatAttributes ?? []) {
      idCounts.set(a.id, (idCounts.get(a.id) ?? 0) + 1);
      if (!Number.isFinite(Number(a.value))) {
        nonNumeric.set(`${a.id}=${JSON.stringify(a.value)}`, (nonNumeric.get(`${a.id}=${JSON.stringify(a.value)}`) ?? 0) + 1);
      }
    }
  }
  console.log("attribute id -> count:", JSON.stringify([...idCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12)));
  console.log("non-numeric attribute values:", JSON.stringify([...nonNumeric.entries()].slice(0, 8)));

  // Do duplicate entries of one player share identical stat attributes?
  const byPlayer = new Map();
  for (const e of entries) {
    const k = e.playerId ?? e.playerDkId;
    if (!byPlayer.has(k)) byPlayer.set(k, []);
    byPlayer.get(k).push(e);
  }
  let same = 0; let differ = 0; const diffSample = [];
  for (const [, list] of byPlayer) {
    if (list.length < 2) continue;
    const key = (e) => JSON.stringify((e.draftStatAttributes ?? []).map((a) => [a.id, a.value]).sort());
    const keys = new Set(list.map(key));
    if (keys.size === 1) same += 1;
    else { differ += 1; if (diffSample.length < 3) diffSample.push(list.map((e) => e.rosterSlotId + ":" + key(e)).slice(0, 3)); }
  }
  console.log("multi-entry players with identical stats:", same, "| differing:", differ, JSON.stringify(diffSample));

  // per-attribute numeric coverage
  for (const [id] of [...idCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 6)) {
    let n = 0; let vals = [];
    for (const e of entries) {
      const a = (e.draftStatAttributes ?? []).find((x) => Number(x.id) === id);
      if (a && Number.isFinite(Number(a.value))) { n += 1; vals.push(Number(a.value)); }
    }
    console.log(`  attr ${id}: numeric on ${n}/${entries.length} entries; range ${vals.length ? Math.min(...vals) + ".." + Math.max(...vals) : "n/a"}`);
  }
}
