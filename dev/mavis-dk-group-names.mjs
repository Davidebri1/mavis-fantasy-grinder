// What does DraftKings call each draft group, and what fields do contests carry?
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { accept: "application/json", "user-agent": UA, referer: "https://www.draftkings.com/" };

const now = Date.now();
const lobby = await (await fetch("https://api.draftkings.com/lobbies/v1/lobbies/nfl", { headers: H })).json();
const contests = lobby?.lobby?.contests ?? [];

const sample = contests.find((c) => String(c.gameTypeName ?? "").toLowerCase() === "classic");
console.log("contest keys:", JSON.stringify(Object.keys(sample ?? {})));
console.log("sample contest:", JSON.stringify(sample));

const groups = new Map();
for (const c of contests) {
  if (String(c.gameTypeName ?? "").trim().toLowerCase() !== "classic") continue;
  const start = new Date(c.contestStartTime).getTime();
  if (!Number.isFinite(start) || start <= now) continue;
  const g = groups.get(c.draftGroupId) ?? { id: c.draftGroupId, start, names: new Map(), count: 0 };
  g.start = Math.min(g.start, start);
  g.count += 1;
  const n = String(c.name ?? "");
  if (!g.names.has(n)) g.names.set(n, 0);
  g.names.set(n, g.names.get(n) + 1);
  groups.set(c.draftGroupId, g);
}

for (const g of [...groups.values()].sort((a, b) => a.start - b.start)) {
  const names = [...g.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log(JSON.stringify({
    id: g.id,
    start: new Date(g.start).toISOString(),
    contests: g.count,
    topNames: names,
  }));
}
