/**
 * mavis-dk-slate-probe.mjs
 *
 * Ground truth for one live DraftKings slate: which draft group is the
 * current one, what its draftables look like, and whether DraftKings
 * publishes its own projection (FPPG) alongside the salary.
 *
 * Read-only. Fetches and prints; writes nothing.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const HEADER = { "user-agent": UA, accept: "application/json, text/plain, */*" };

const SPORT = process.argv[2] ?? "nfl";
const NOW = Date.now();

async function getJson(url) {
  const res = await fetch(url, { headers: HEADER });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, url, text: text.slice(0, 200) };
  try {
    return { ok: true, status: res.status, url, json: JSON.parse(text), bytes: text.length };
  } catch {
    return { ok: false, status: res.status, url, text: text.slice(0, 200) };
  }
}

const lobby = await getJson(`https://api.draftkings.com/lobbies/v1/lobbies/${SPORT}`);
if (!lobby.ok) {
  console.log("lobby failed:", lobby.status, lobby.text);
  process.exit(1);
}
const L = lobby.json.lobby ?? {};
const contests = Array.isArray(L.contests) ? L.contests : [];
console.log(`lobby ${SPORT}: ${lobby.bytes} bytes, contests=${contests.length}`);

// Group contests by draft group, keeping what each slate looks like.
const groups = new Map();
for (const c of contests) {
  const dg = c.draftGroupId ?? c.draftGroupID ?? c.dg;
  if (dg === undefined || dg === null) continue;
  if (!groups.has(dg)) {
    groups.set(dg, {
      id: dg,
      gameTypeId: c.gameTypeId,
      gameTypeName: c.gameTypeName,
      names: new Set(),
      startTimes: new Set(),
      entries: 0,
      contests: 0,
      payout: c.payoutDescription ?? c.payoutDescriptions ?? null,
    });
  }
  const g = groups.get(dg);
  g.contests += 1;
  g.entries += Number(c.entries ?? 0);
  if (c.name) g.names.add(String(c.name));
  const start = c.contestStartTime ?? c.startTime;
  if (start) g.startTimes.add(String(start));
}

const rows = [...groups.values()].map((g) => {
  const starts = [...g.startTimes].map((s) => Date.parse(s)).filter((n) => Number.isFinite(n));
  const soonest = starts.length ? Math.min(...starts) : null;
  return {
    ...g,
    soonest,
    hoursOut: soonest === null ? null : (soonest - NOW) / 3_600_000,
    sampleName: [...g.names][0] ?? "",
  };
});
rows.sort((a, b) => (a.hoursOut ?? 1e9) - (b.hoursOut ?? 1e9));

console.log("\ndraft groups by soonest contest start:");
for (const g of rows.slice(0, 12)) {
  console.log(
    `  dg=${g.id} type=${g.gameTypeId}/${g.gameTypeName} contests=${g.contests} entries=${g.entries}` +
      ` hoursOut=${g.hoursOut === null ? "?" : g.hoursOut.toFixed(1)} name="${g.sampleName.slice(0, 70)}"`,
  );
}

// The slate to inspect: the soonest-starting draft group that is still ahead
// of us, preferring a Classic slate with the most entries.
const upcoming = rows.filter((g) => g.hoursOut !== null && g.hoursOut > -1);
const classic = upcoming.filter((g) => g.gameTypeId === 1);
const pick = (classic.length ? classic : upcoming).sort(
  (a, b) => b.entries - a.entries || (a.hoursOut ?? 0) - (b.hoursOut ?? 0),
)[0];
if (!pick) {
  console.log("no upcoming draft group found");
  process.exit(1);
}
console.log(`\nchosen draft group: ${pick.id} (${pick.sampleName})`);

const dgInfo = await getJson(`https://api.draftkings.com/draftgroups/v1/${pick.id}`);
if (dgInfo.ok) {
  const info = dgInfo.json;
  console.log("draft group keys:", Object.keys(info).join(", "));
  const games = info.games ?? info.GameSet ?? [];
  console.log("games:", games.length);
  for (const g of (Array.isArray(games) ? games : []).slice(0, 14)) {
    console.log(
      `   ${g.name ?? ""} away=${g.awayTeamAbbreviation ?? ""} home=${g.homeTeamAbbreviation ?? ""}` +
        ` start=${g.startTime ?? ""} type=${g.gameTypeId ?? ""}`,
    );
  }
} else {
  console.log("draft group info failed:", dgInfo.status, dgInfo.text);
}

const dl = await getJson(
  `https://api.draftkings.com/draftgroups/v1/draftgroups/${pick.id}/draftables`,
);
if (!dl.ok) {
  console.log("draftables failed:", dl.status, dl.text);
  process.exit(1);
}
const draftables = dl.json.draftables ?? [];
console.log(`\ndraftables: ${draftables.length} (${dl.bytes} bytes)`);
if (draftables.length) {
  console.log("first entry keys:", Object.keys(draftables[0]).join(", "));
  console.log("first entry:", JSON.stringify(draftables[0]).slice(0, 900));
  const salaries = draftables.map((d) => Number(d.salary ?? 0)).filter((n) => n > 0);
  console.log("salary range:", Math.min(...salaries), "-", Math.max(...salaries));
  const withFppg = draftables.filter((d) =>
    (d.draftStatAttributes ?? []).some((a) => Number(a.id) === 90),
  );
  console.log(`entries carrying DK FPPG (draftStatAttributes id 90): ${withFppg.length}`);
  if (withFppg.length) console.log("fppg sample:", JSON.stringify(withFppg[0].draftStatAttributes).slice(0, 400));
  const rosterSlots = new Set(draftables.map((d) => d.rosterSlot ?? d.rosterSlotId ?? "none"));
  console.log("roster slots:", [...rosterSlots].join(", "));
  const comps = new Set(draftables.map((d) => d.competition?.name ?? "none"));
  console.log("competitions:", [...comps].join(" | "));
}
