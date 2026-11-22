/**
 * Probe 2: the distinct-player view of the live DK NFL classic slate.
 *
 * The classic slate lists every RB/WR/TE twice (position slot + FLEX slot).
 * This measures: price delta between the two entries, FPPG coverage on the
 * position-slot entry, DK status/news fields, and bye-week attributes.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADERS = { accept: "application/json", "user-agent": UA, referer: "https://www.draftkings.com/" };

const lobby = await (await fetch("https://api.draftkings.com/lobbies/v1/lobbies/nfl", { headers: HEADERS })).json();
const contests = lobby?.lobby?.contests ?? [];
const now = Date.now();
const groups = new Map();
for (const c of contests) {
  if (Number(c.gameTypeId) !== 1) continue;
  const t = new Date(c.contestStartTime).getTime();
  if (!(t > now)) continue;
  const prev = groups.get(c.draftGroupId);
  if (prev === undefined || t < prev) groups.set(c.draftGroupId, t);
}
const chosen = [...groups.entries()].sort((a, b) => a[1] - b[1])[0][0];
const blob = await (
  await fetch(`https://api.draftkings.com/draftgroups/v1/draftgroups/${chosen}/draftables`, { headers: HEADERS })
).json();
const entries = blob.draftables ?? [];

const POSITION_SLOTS = new Set([66, 67, 68, 69, 71]); // QB,RB,WR,TE,DST
const byPlayer = new Map();
for (const e of entries) {
  const k = e.playerId ?? e.playerDkId;
  if (!byPlayer.has(k)) byPlayer.set(k, []);
  byPlayer.get(k).push(e);
}

const slotNames = { 66: "QB", 67: "RB", 68: "WR", 69: "TE", 70: "FLEX", 71: "DST" };
let dualListed = 0;
let flexHasDifferentSalary = 0;
const deltas = [];
let flexOnly = 0;
let posOnly = 0;
for (const [pid, list] of byPlayer) {
  const posEntry = list.find((e) => POSITION_SLOTS.has(e.rosterSlotId));
  const flexEntry = list.find((e) => e.rosterSlotId === 70);
  if (!posEntry && flexEntry) flexOnly += 1;
  if (posEntry && !flexEntry) posOnly += 1;
  if (posEntry && flexEntry) {
    dualListed += 1;
    if (posEntry.salary !== flexEntry.salary) {
      flexHasDifferentSalary += 1;
      deltas.push(flexEntry.salary - posEntry.salary);
    }
  }
}
console.log("distinct players:", byPlayer.size);
console.log("position-slot only:", posOnly, "| flex-slot only:", flexOnly, "| dual-listed:", dualListed);
console.log("dual-listed with a DIFFERENT flex price:", flexHasDifferentSalary);
if (deltas.length) {
  console.log("  flex price delta: min", Math.min(...deltas), "max", Math.max(...deltas), "distinct", [...new Set(deltas)].sort((a,b)=>a-b));
}
console.log("rosterSlotId x position across all entries:");
const tab = new Map();
for (const e of entries) {
  const k = `${slotNames[e.rosterSlotId] ?? e.rosterSlotId}/${e.position}`;
  tab.set(k, (tab.get(k) ?? 0) + 1);
}
for (const [k, v] of [...tab.entries()].sort()) console.log("  ", k, "->", v);

// FPPG coverage on the position-slot entry only
let noFppg = 0;
let negFppg = 0;
const statusCounts = new Map();
const newsCounts = new Map();
let byeTagged = 0;
const byePlayers = [];
for (const e of entries) {
  if (!POSITION_SLOTS.has(e.rosterSlotId)) continue;
  const attr = (e.draftStatAttributes ?? []).find((x) => Number(x.id) === 90);
  const val = Number(attr?.value);
  if (!Number.isFinite(val)) noFppg += 1;
  else if (val < 0) negFppg += 1;
  statusCounts.set(e.status ?? "(none)", (statusCounts.get(e.status ?? "(none)") ?? 0) + 1);
  newsCounts.set(e.newsStatus ?? "(none)", (newsCounts.get(e.newsStatus ?? "(none)") ?? 0) + 1);
  const bye = (e.playerAttributes ?? []).some((a) => /bye/i.test(a.name ?? ""));
  if (bye) { byeTagged += 1; if (byePlayers.length < 8) byePlayers.push(e.displayName + " (" + e.teamAbbreviation + ")"); }
}
console.log("position-slot entries missing numeric FPPG:", noFppg, "| negative FPPG:", negFppg);
console.log("status values:", JSON.stringify([...statusCounts.entries()]));
console.log("newsStatus values:", JSON.stringify([...newsCounts.entries()]));
console.log("position-slot entries tagged ByeWeek:", byeTagged, byePlayers);
console.log("alert keys:", JSON.stringify([...new Set(entries.flatMap((e) => (e.draftAlerts ?? []).map((a) => Object.keys(a).join("/"))))].slice(0, 10)));

// distinct players per game
const perGame = new Map();
for (const e of entries) {
  if (!POSITION_SLOTS.has(e.rosterSlotId)) continue;
  const g = e.competition?.name ?? "?";
  perGame.set(g, (perGame.get(g) ?? 0) + 1);
}
console.log("distinct players per game:", JSON.stringify([...perGame.entries()].sort()));
