const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { accept: "application/json", "user-agent": UA, referer: "https://www.draftkings.com/" };
const lobby = await (await fetch("https://api.draftkings.com/lobbies/v1/lobbies/nfl", { headers: H })).json();
const now = Date.now();
const groups = new Map();
for (const c of lobby.lobby.contests ?? []) {
  if (String(c.gameTypeName).toLowerCase() !== "classic") continue;
  const t = new Date(c.contestStartTime).getTime();
  if (!(t > now)) continue;
  const g = groups.get(c.draftGroupId) ?? { start: t, n: 0 };
  g.n += 1;
  if (t < g.start) g.start = t;
  groups.set(c.draftGroupId, g);
}
const pick = [...groups.entries()].sort((a, b) => a[1].start - b[1].start || b[1].n - a[1].n)[0];
const url = `https://api.draftkings.com/draftgroups/v1/draftgroups/${pick[0]}/draftables`;
const res = await fetch(url, { headers: H });
const text = await res.text();
console.log("status:", res.status, "bytes:", text.length);
const json = JSON.parse(text);
console.log("top-level keys:", Object.keys(json).join(","));
if (json.draftStats) console.log("draftStats:", JSON.stringify(json.draftStats));
if (json.draftGroup) console.log("draftGroup keys:", Object.keys(json.draftGroup).join(","));
