/**
 * Server-side optimizer runner — delegates exclusively to the Django REST API.
 *
 * Solver algorithms and MILP constraints never ship in the client bundle.
 */
import type { OptimizerUiSettings } from "@/components/optimizer-settings";
import { apiRequest, type ApiOptimizeResponse } from "@/lib/mavis-api";
import { salaryIsReal } from "@/lib/real-salaries";
import type { Lineup, Player, SolverBackend, Sport } from "@/types";

export interface OptimizerRunResult {
  lineups: Lineup[];
  warnings: string[];
  elapsedMs: number;
}

function mapPlayersForApi(players: Player[]): Record<string, unknown>[] {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    salary: salaryIsReal(p) ? p.salary : 0,
    projection: p.projection,
    user_projection: p.user_projection ?? null,
    team: p.team ?? "",
    opponent: p.opponent ?? "",
    game_info: p.game_info ?? "",
    positions: p.positions ?? [],
    roster_positions: p.roster_positions ?? [],
    correlation_group: p.correlation_group ?? "",
    opponent_id: p.opponent_id ?? "",
    bout: p.bout ?? "",
    projected_ownership: p.projected_ownership ?? 0,
    max_ownership: p.max_ownership ?? 100,
    min_exposure: p.min_exposure ?? 0,
    max_exposure: p.max_exposure ?? 100,
    stddev: p.stddev ?? null,
    is_locked: Boolean(p.is_locked),
    is_excluded: Boolean(p.is_excluded),
    is_liked: Boolean(p.is_liked),
    injury_status: p.injury_status ?? null,
    injury_severity: p.injury_severity ?? null,
  }));
}

function mapSettingsForApi(
  sport: Sport,
  s: OptimizerUiSettings,
): Record<string, unknown> {
  const stackRules = (s.stack_rules ?? []).map((r) => ({
    scope: r.scope,
    id: r.id,
    min: r.min,
    max: r.max,
  }));

  return {
    salary_cap: s.salary_cap,
    num_lineups: s.num_lineups,
    strategy: s.strategy,
    contest_type: s.contest_type,
    max_exposure: s.max_exposure,
    min_projection: s.min_projection,
    simulation_count: s.simulation_count,
    teammate_correlation: s.teammate_correlation,
    opponent_correlation: s.opponent_correlation,
    enable_bring_back: s.enable_bring_back,
    allow_opponents: s.allow_opponents,
    card_correlation: s.card_correlation,
    stack_rules: stackRules,
    ...(sport === "nba" ? { team_stacking_rules: stackRules } : {}),
  };
}

export async function runOptimizerAsync(
  sport: Sport,
  settings: OptimizerUiSettings,
  players: Player[],
  solverBackend: SolverBackend = "pulp",
): Promise<OptimizerRunResult> {
  const payload = {
    sport,
    solver_backend: solverBackend,
    settings: mapSettingsForApi(sport, settings),
    players: mapPlayersForApi(players),
  };

  const res = await apiRequest<ApiOptimizeResponse>("/optimize/", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    lineups: res.lineups ?? [],
    warnings: res.warnings ?? [],
    elapsedMs: res.elapsed_ms ?? 0,
  };
}
