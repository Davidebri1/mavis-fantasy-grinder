/**
 * Probe: how does the live DraftKings NFL classic slate encode roster slots?
 *
 * Answers: the position x rosterSlotId cross-tab, whether a player can
 * appear twice (one entry per eligible slot), and whether FPPG and salaries
 * are present for every entry.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADERS = {
  accept: "application/json",
  "user-agent": UA,
  referer: "https://www.draftkings.com/",
};

const lobbyRes = await fetch("https://api.draftkings.com/lobbies/v1/lobbies/nfl", { headers: HEADERS });
console.log("lobby status:", lobbyRes.status);
const lobby = await lobbyRes.json();
const contests = lobby?.lobby?.contests ?? [];
const now = Date.now();

const classic = contests.filter(
  (c) => Number(c.gameTypeId) === 1 && new Date(c.contestStartTime).getTime() > now,
);
const byGroup = new Map();
for (const c of classic) {
  const id = c.draftGroupId;
  const t = new Date(c.contestStartTime).getTime();
  const prev = byGroup.get(id);
  if (!prev || t < prev.start) byGroup.set(id, { start: t, name: c.name, count: 0 });
  byGroup.get(id).count += 1;
}
const ranked = [...byGroup.entries()].sort((a, b) => a[1].start - b[1].start);
console.log("classic draft groups (soonest first):");
for (const [id, v] of ranked.slice(0, 5)) {
  console.log(`  dg=${id} start=${new Date(v.start).toISOString()} contests=${v.count} "${v.name}"`);
}
const chosen = ranked[0][0];
console.log("chosen draft group:", chosen);

const dgRes = await fetch(
  `https://api.draftkings.com/draftgroups/v1/draftgroups/${chosen}/draftables`,
  { headers: HEADERS },
);
console.log("draftables status:", dgRes.status);
const blob = await dgRes.json();
const entries = blob.draftables ?? [];
console.log("entries:", entries.length);

const tab = new Map();
for (const e of entries) {
  const key = `${e.position}|${e.rosterSlotId}`;
  if (!tab.has(key)) tab.set(key, { n: 0, samples: [] });
  const row = tab.get(key);
  row.n += 1;
  if (row.samples.length < 3) row.samples.push(e.displayName);
}
console.log("position x rosterSlotId:");
for (const key of [...tab.keys()].sort()) {
  const row = tab.get(key);
  console.log(`  ${key} -> ${row.n}  [${row.samples.join(", ")}]`);
}

const byId = new Map();
let dupes = 0;
for (const e of entries) {
  const k = e.playerId ?? e.playerDkId;
  if (byId.has(k)) dupes += 1;
  byId.set(k, (byId.get(k) ?? 0) + 1);
}
console.log("distinct players:", byId.size, "duplicate entries:", dupes);
const dupSample = [...byId.entries()].filter(([, n]) => n > 1).slice(0, 3);
console.log("sample duplicated player keys:", JSON.stringify(dupSample));

let noFppg = 0;
let noSalary = 0;
let disabled = 0;
const fppgVals = [];
for (const e of entries) {
  const a = (e.draftStatAttributes ?? []).find((x) => Number(x.id) === 90);
  if (!a || !Number.isFinite(Number(a.value))) noFppg += 1;
  else fppgVals.push(Number(a.value));
  if (!Number.isFinite(Number(e.salary)) || Number(e.salary) <= 0) noSalary += 1;
  if (e.isDisabled) disabled += 1;
}
console.log("entries missing FPPG:", noFppg, "| missing salary:", noSalary, "| disabled:", disabled);
console.log("fppg range:", Math.min(...fppgVals), "-", Math.max(...fppgVals));

const comps = new Map();
for (const e of entries) {
  const c = e.competition ?? {};
  const k = c.name ?? "?";
  if (!comps.has(k)) comps.set(k, { start: c.startTime, n: 0 });
  comps.get(k).n += 1;
}
console.log("competitions:", comps.size);
for (const [k, v] of [...comps.entries()].sort()) {
  console.log(`  ${k} start=${v.start} players=${v.n}`);
}

const flexSample = entries.find((e) => e.rosterSlotId === 71);
console.log("FLEX(71) sample entry:", JSON.stringify(flexSample, null, 2).slice(0, 1800));
