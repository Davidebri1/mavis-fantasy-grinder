/**
 * Probe 3: what live DraftKings publishes for NBA, MMA and golf.
 *
 * For each sport: does the lobby answer, which contest game types exist,
 * and what does one draftables payload look like (slot ids, duplicate
 * pricing, per-player field names)?
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADERS = { accept: "application/json", "user-agent": UA, referer: "https://www.draftkings.com/" };

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return { status: res.status, json: null };
  return { status: res.status, json: await res.json() };
}

for (const sport of ["nba", "mma", "golf"]) {
  console.log("\n================ " + sport.toUpperCase() + " ================");
  const lobbyRes = await getJson(`https://api.draftkings.com/lobbies/v1/lobbies/${sport}`);
  console.log("lobby status:", lobbyRes.status);
  if (!lobbyRes.json) continue;
  const lobby = lobbyRes.json?.lobby;
  if (!lobby) { console.log("no lobby key; top keys:", Object.keys(lobbyRes.json ?? {})); continue; }
  const contests = lobby.contests ?? [];
  console.log("contests:", contests.length, "| lobby keys:", Object.keys(lobby).join(","));
  const typeCounts = new Map();
  for (const c of contests) {
    const k = `${c.gameTypeId}/${c.gameTypeName}`;
    typeCounts.set(k, (typeCounts.get(k) ?? 0) + 1);
  }
  console.log("game types:", JSON.stringify([...typeCounts.entries()].slice(0, 12)));
  const now = Date.now();
  const groups = new Map();
  for (const c of contests) {
    const t = new Date(c.contestStartTime).getTime();
    if (!Number.isFinite(t) || t <= now) continue;
    const g = groups.get(c.draftGroupId) ?? { start: t, n: 0, type: c.gameTypeId, name: c.name };
    g.n += 1;
    if (t < g.start) g.start = t;
    groups.set(c.draftGroupId, g);
  }
  const ranked = [...groups.entries()].sort((a, b) => a[1].start - b[1].start || b[1].n - a[1].n);
  for (const [id, g] of ranked.slice(0, 4)) {
    console.log(`  dg=${id} type=${g.type} start=${new Date(g.start).toISOString()} contests=${g.n} "${g.name}"`);
  }
  const classic = ranked.filter(([, g]) => Number(g.type) === 1).sort((a, b) => a[1].start - b[1].start || b[1].n - a[1].n)[0];
  const pick = classic ?? ranked[0];
  if (!pick) { console.log("  no upcoming draft groups"); continue; }
  const dgId = pick[0];
  const dgRes = await getJson(`https://api.draftkings.com/draftgroups/v1/draftgroups/${dgId}/draftables`);
  console.log("draftables status:", dgRes.status);
  const entries = dgRes.json?.draftables ?? [];
  console.log("entries:", entries.length);
  if (!entries.length) continue;
  console.log("first entry:", JSON.stringify(entries[0]).slice(0, 1400));
  const slots = new Map();
  const posSlots = new Map();
  for (const e of entries) {
    const k = `${e.position}|${e.rosterSlotId}`;
    slots.set(k, (slots.get(k) ?? 0) + 1);
    const p = e.position;
    if (!posSlots.has(p)) posSlots.set(p, new Set());
    posSlots.get(p).add(e.rosterSlotId);
  }
  console.log("position|rosterSlotId:", JSON.stringify([...slots.entries()].sort()));
  // duplicate pricing check
  const byPlayer = new Map();
  for (const e of entries) {
    const k = e.playerId ?? e.playerDkId ?? e.draftableId;
    if (!byPlayer.has(k)) byPlayer.set(k, []);
    byPlayer.get(k).push(e);
  }
  let dual = 0; let priceDiff = 0; const diffs = [];
  for (const [, list] of byPlayer) {
    if (list.length < 2) continue;
    dual += 1;
    const prices = new Set(list.map((e) => e.salary));
    if (prices.size > 1) { priceDiff += 1; diffs.push([...prices].sort((a,b)=>a-b)); }
  }
  console.log("distinct players:", byPlayer.size, "| multi-entry:", dual, "| with differing price:", priceDiff, diffs.slice(0, 5));
  let noFppg = 0;
  for (const e of entries) {
    const a = (e.draftStatAttributes ?? []).find((x) => Number(x.id) === 90);
    if (!a || !Number.isFinite(Number(a.value))) noFppg += 1;
  }
  console.log("entries missing numeric FPPG:", noFppg);
}
