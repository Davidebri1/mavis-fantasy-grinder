/**
 * End-to-end proof of the live path, using the app's own browser module.
 *
 * It imports the frontend's live DraftKings client (TypeScript, type-stripped
 * by Node), pulls the live slate, and posts that pool to the deployed
 * optimizer API exactly as the page does.
 */
const { fetchLiveDkRoster } = await import(
  "file:///C:/Users/D/mavis-fantasy-grinder/frontend/react/src/lib/dk-live.ts"
);

console.log("node", process.version);

const live = await fetchLiveDkRoster("nfl");
console.log("slate:", JSON.stringify(live.slate));
console.log("players:", live.players.length);
console.log("warnings:", JSON.stringify(live.warnings, null, 2));

const withPrices = live.players.filter((p) => p.salary_source === "dk" && p.salary > 0).length;
const withProjections = live.players.filter((p) => p.projection_source === "dk").length;
const eligible = live.players.filter(
  (p) =>
    p.salary_source === "dk" &&
    p.salary > 0 &&
    p.projection_source === "dk" &&
    p.projection > 0 &&
    !["OUT", "IR"].includes(String(p.injury_status ?? "").toUpperCase()),
).length;
console.log({ withPrices, withProjections, eligible });

const pool = live.players.map((p) => ({
  id: p.id,
  name: p.name,
  salary: p.salary_source === "dk" && p.salary > 0 ? p.salary : 0,
  projection: p.projection_source === "dk" ? p.projection : 0,
  user_projection: null,
  team: p.team ?? "",
  opponent: p.opponent ?? "",
  game_info: p.game_info ?? "",
  positions: p.positions ?? [],
  roster_positions: p.roster_positions ?? [],
  correlation_group: p.correlation_group ?? "",
  injury_status: p.injury_status ?? null,
  injury_severity: null,
}));

const res = await fetch("https://mavis-fantasy-grinder-api.ebridavid.workers.dev/api/optimize/", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sport: "nfl",
    solver_backend: "pulp",
    settings: {
      salary_cap: 50000,
      num_lineups: 20,
      strategy: "maxProjection",
      contest_type: "classic",
      max_exposure: 100,
      min_projection: 0,
      simulation_count: 1000,
      teammate_correlation: 0.35,
      opponent_correlation: 0.1,
      enable_bring_back: false,
      allow_opponents: false,
      card_correlation: 0,
      stack_rules: [],
    },
    players: pool,
  }),
});
const json = await res.json();
console.log("optimize status", res.status, "elapsed_ms", json.elapsed_ms, "top_score", json.top_score);
for (const lu of (json.lineups ?? []).slice(0, 2)) {
  console.log(
    JSON.stringify(
      {
        rank: lu.rank,
        total_salary: lu.total_salary,
        total_projection: lu.total_projection,
        games: lu.games,
        players: lu.assignments.map((a) => a.slot + ":" + a.player_name),
      },
      null,
      2,
    ),
  );
}
