/**
 * Mavis Outlier — live DraftKings smoke test.
 *
 * Runs the Worker's own code against DraftKings: fetch the live slate, map
 * it, and ask the Worker's optimizer for lineups built from it.
 */
import { handleEdgeApiRequest } from "../backend/django/worker/mavis-edge-api.mjs";
import { fetchLiveDkSlate } from "../backend/django/worker/mavis-dk-live.mjs";

const env = { CORS_ALLOWED_ORIGINS: "*" };
const base = "https://api.local/api";
const show = (label, value) => console.log("\n=== " + label + " ===\n" + value);

const live = await fetchLiveDkSlate("nfl");
show("slate", JSON.stringify(live.slate, null, 2));

const sources = new Map();
for (const p of live.players) sources.set(p.projection_source, (sources.get(p.projection_source) ?? 0) + 1);
const statuses = new Map();
for (const p of live.players) statuses.set(p.injury_status ?? "none", (statuses.get(p.injury_status ?? "none") ?? 0) + 1);
const prices = live.players.map((p) => p.salary);
show("players", [
  "count: " + live.players.length,
  "projection sources: " + JSON.stringify([...sources.entries()]),
  "injury statuses: " + JSON.stringify([...statuses.entries()]),
  "salary range: " + Math.min(...prices) + " - " + Math.max(...prices),
  "duplicate names: " + (live.players.length - new Set(live.players.map((p) => p.name)).size),
].join("\n"));
show("sample player", JSON.stringify(live.players.find((p) => p.name.includes("Allen")), null, 2));
show("warnings", JSON.stringify(live.warnings, null, 2));

const slatesRes = await handleEdgeApiRequest(new Request(base + "/slates/?sport=nfl"), env);
show("/api/slates/?sport=nfl", slatesRes.status + " " + JSON.stringify(await slatesRes.json()));

const playersRes = await handleEdgeApiRequest(
  new Request(base + "/players/?sport=nfl&slate_id=" + live.slate.id),
  env,
);
const playersJson = await playersRes.json();
show("/api/players/", [
  playersRes.status,
  "results=" + (playersJson.results ?? []).length,
  "data_source=" + playersJson.data_source,
].join(" | "));

const optRes = await handleEdgeApiRequest(
  new Request(base + "/optimize/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sport: "nfl",
      players: playersJson.results,
      settings: {
        strategy: "maxProjection",
        contest_type: "classic",
        salary_cap: 50000,
        num_lineups: 20,
        max_exposure: 100,
        unique_lineups: true,
      },
    }),
  }),
  env,
);
const opt = await optRes.json();
show("/api/optimize/", [
  "status: " + optRes.status,
  "lineups: " + (opt.lineups ?? []).length,
  "top score: " + opt.top_score,
  "elapsed_ms: " + opt.elapsed_ms,
  "warnings: " + JSON.stringify(opt.warnings ?? []),
].join("\n"));
const top = (opt.lineups ?? [])[0];
if (top) {
  show("top lineup", [
    "total salary: " + top.total_salary,
    "total projection: " + Number(top.total_projection).toFixed(2),
    top.assignments.map((a) => a.slot + ": " + a.player_name + " ($" + a.salary + ")").join("\n"),
  ].join("\n"));
}

const mmaRes = await handleEdgeApiRequest(new Request(base + "/slates/?sport=mma"), env);
show("/api/slates/?sport=mma (no live Classic slate)", mmaRes.status + " " + JSON.stringify(await mmaRes.json()));
