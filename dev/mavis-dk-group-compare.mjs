// Compare the Classic draft groups: how many games and players does each carry?
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { accept: "application/json", "user-agent": UA, referer: "https://www.draftkings.com/" };

const now = Date.now();
const lobby = await (await fetch("https://api.draftkings.com/lobbies/v1/lobbies/nfl", { headers: H })).json();

const groups = new Map();
for (const c of lobby?.lobby?.contests ?? []) {
  if (String(c.gameTypeName ?? "").trim().toLowerCase() !== "classic") continue;
  const start = new Date(c.contestStartTime).getTime();
  if (!Number.isFinite(start) || start <= now) continue;
  const id = c.draftGroupId;
  const g = groups.get(id) ?? { id, start, contests: 0, entries: 0 };
  g.contests += 1;
  g.entries += Number(c.entries ?? 0);
  if (start < g.start) g.start = start;
  groups.set(id, g);
}

const sorted = [...groups.values()].sort((a, b) => a.start - b.start);
console.log("candidate classic groups:", sorted.length);
console.log(JSON.stringify(sorted.map((g) => ({ id: g.id, start: new Date(g.start).toISOString(), contests: g.contests, entries: g.entries }))));

for (const g of sorted.slice(0, 6)) {
  const res = await fetch(
    "https://api.draftkings.com/draftgroups/v1/draftgroups/" + g.id + "/draftables",
    { headers: H },
  );
  if (!res.ok) { console.log(JSON.stringify({ id: g.id, status: res.status })); continue; }
  const p = await res.json();
  const draftables = p?.draftables ?? [];
  const games = new Set(draftables.map((d) => d?.competition?.name).filter(Boolean));
  const players = new Set(draftables.map((d) => d?.playerId ?? d?.playerDkId ?? d?.draftableId));
  console.log(JSON.stringify({
    id: g.id,
    start: new Date(g.start).toISOString(),
    contests: g.contests,
    entries: g.entries,
    draftableEntries: draftables.length,
    distinctPlayers: players.size,
    games: games.size,
    gameNames: [...games].slice(0, 12),
  }));
}
