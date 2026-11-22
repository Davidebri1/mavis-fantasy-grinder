/**
 * Mavis Outlier — verify the DEPLOYED edge API serves the live
 * DraftKings slate and builds lineups from it.
 */
const BASE = "https://mavis-fantasy-grinder-api.ebridavid.workers.dev/api";
const show = (label, value) => console.log("\n=== " + label + " ===\n" + value);

const health = await fetch(BASE + "/health/");
show("health", health.status + " " + (await health.text()));

const slatesRes = await fetch(BASE + "/slates/?sport=nfl");
const slates = await slatesRes.json();
show("slates", slatesRes.status + " " + JSON.stringify(slates, null, 2));
const slate = Array.isArray(slates) ? slates[0] : slates;

const playersRes = await fetch(BASE + "/players/?sport=nfl&slate_id=" + slate.id);
const payload = await playersRes.json();
const players = payload.results ?? [];
const sources = new Map();
for (const p of players) sources.set(p.projection_source, (sources.get(p.projection_source) ?? 0) + 1);
show("players", [
  "status: " + playersRes.status,
  "count: " + players.length,
  "data_source: " + payload.data_source,
  "projection sources: " + JSON.stringify([...sources.entries()]),
  "salary range: " + Math.min(...players.map((p) => p.salary)) + " - " + Math.max(...players.map((p) => p.salary)),
  "warnings: " + JSON.stringify(payload.warnings),
].join("\n"));

const optRes = await fetch(BASE + "/optimize/", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sport: "nfl",
    players,
    settings: {
      strategy: "maxProjection",
      contest_type: "classic",
      salary_cap: 50000,
      num_lineups: 20,
      max_exposure: 100,
      unique_lineups: true,
    },
  }),
});
const opt = await optRes.json();
show("optimize", [
  "status: " + optRes.status,
  "lineups: " + (opt.lineups ?? []).length,
  "top score: " + opt.top_score,
  "elapsed_ms: " + opt.elapsed_ms,
].join(" | "));
const top = (opt.lineups ?? [])[0];
if (top) {
  show("top lineup", [
    "salary: " + top.total_salary,
    "projection: " + Number(top.total_projection).toFixed(2),
    top.assignments.map((a) => a.slot + ": " + a.player_name).join(" | "),
  ].join("\n"));
}

const mmaRes = await fetch(BASE + "/slates/?sport=mma");
show("mma (no live classic slate)", mmaRes.status + " " + JSON.stringify(await mmaRes.json()));
