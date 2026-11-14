"""Top-level orchestrator for the optimizer engine.

This module is the **public** API: callers (Django views, CLI, parity
tests) pass in players + settings, get back :class:`OptimizeResult`.

The structure mirrors the Flutter ``OptimizerService.generateLineups``
method. Step-by-step:

1. **Filter eligible players** (excluded, zero salary, min projection).
2. **Validate inputs** (locks fit, salary cap, sport-specific bipartite).
3. **Build correlation matrix** (sport-keyed) and run Monte Carlo if needed.
4. **Per strategy**: walk iteration plan (see :mod:`optimizer.strategies`),
   solve each via MILP, collect unique lineups.
5. **Post-filter**: NBA bring-back / team stacking / exposure.
6. **Sort by total_projection desc**, return top-K.
"""
from __future__ import annotations

from collections import defaultdict
import time
from typing import Sequence

import numpy as np

from .engines.milp_pulp import solve_pulp
from .engines.milp_ortools import solve_ortools
from .schema import (
    ContestType,
    Lineup,
    OptimizeResult,
    OptimizerSettings,
    Player,
    Sport,
    Strategy,
    filter_eligible,
)
from .simulation.cholesky import correlation_matrix_from
from .simulation.monte_carlo import run_batched
from .strategies import StrategyPipeline
from .sports import golf as golf_constraints
from .sports import mma as mma_constraints
from .sports import nba as nba_constraints
from .sports import nfl as nfl_constraints


_SPORT_MODULES = {
    Sport.NBA: nba_constraints,
    Sport.NFL: nfl_constraints,
    Sport.MMA: mma_constraints,
    Sport.GOLF: golf_constraints,
}


def _nba_pre_assign(sport: Sport, eligible: list[Player], settings: OptimizerSettings) -> list[tuple[int, int]]:
    """Run NBA bipartite position matching and return pre_assignments for the MILP.

    Returns ``[(slot_idx, player_idx), ...]``. If the match is incomplete
    (some slot has no eligible player), we return ``[]`` and the MILP will
    fall back to picking without position locks. The downstream lineup
    builder then drops these unlocked lineups.

    For non-NBA sports this is a no-op.
    """
    if sport != Sport.NBA:
        return []
    if settings.contest_type == ContestType.SHOWDOWN:
        # Showdown: lock the highest-projection player as CPT, no slot logic
        best = max(range(len(eligible)), key=lambda i: eligible[i].effective_projection)
        return [(0, best)]
    # Classic: bipartite fill
    assignments = nba_constraints.bipartite_assign(
        eligible, nba_constraints.CLASSIC_SLOTS
    )
    return [
        (slot_idx, assignment.player_idx)
        for slot_idx, assignment in enumerate(assignments)
        if assignment is not None
    ]


def _resolve_backend(backend: str) -> callable:
    if backend == "ortools":
        return solve_ortools
    return solve_pulp


def run_optimization(
    *,
    sport: Sport,
    players: Sequence[Player],
    settings: OptimizerSettings,
    solver_backend: str = "pulp",
) -> OptimizeResult:
    """Run the optimizer and return lineups.

    Args:
        sport: NBA, MMA, or GOLF.
        players: any iterable of :class:`Player` records.
        settings: strategy, salary cap, sim count, sport-specific extras.
        solver_backend: ``"pulp"`` (default) or ``"ortools"``.

    Raises:
        ValueError if inputs are infeasible.
    """
    started = time.perf_counter()
    warnings: list[str] = []

    # 1. Filter
    eligible = filter_eligible(players, settings, settings.extras)
    if len(eligible) < _roster_size_for(sport, settings):
        return OptimizeResult(
            lineups=[],
            strategy=settings.strategy,
            solver_backend=solver_backend,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            warnings=[
                f"Need >= {_roster_size_for(sport, settings)} eligible players; have {len(eligible)}."
            ],
        )

    sport_module = _SPORT_MODULES[sport]
    backend_solver = _resolve_backend(solver_backend)

    # 2. NBA Classic uses a slot-aware MILP solver (x[i] + y[i,s] formulation)
    #    so we don't lose diversity by pre-locking positions. Showdown/MMA/Golf
    #    fall through to the slot-agnostic path.
    use_slot_aware_nba = (
        sport == Sport.NBA and settings.contest_type == ContestType.CLASSIC
    )

    pipeline = StrategyPipeline(strategy=settings.strategy)

    simulated_slate: np.ndarray | None = None
    if settings.strategy in (Strategy.MONTE_CARLO, Strategy.CONTRARIAN):
        means = np.array([p.effective_projection for p in eligible])
        stds = np.array([p.effective_stddev for p in eligible])
        correlation = _build_correlation(sport, eligible, settings)
        simulated_slate = run_batched(
            means=means,
            stds=stds,
            correlation=correlation,
            sim_count=settings.simulation_count,
            seed=settings.seed,
        )

    # 3. Iterate the strategy plan (with deterministic continuation if target not met)
    iteration_plan = list(pipeline.iter(eligible, settings, simulated_slate))
    forbidden: list[set[int]] = []
    collected: dict[str, Lineup] = {}

    def _compute_temp_excluded_and_scores(
        base_scores: Sequence[float],
        mode: str = "target",
    ) -> tuple[set[int], list[float]]:
        import math

        excluded_now: set[int] = set()
        paced_scores = list(base_scores)
        target_n = settings.num_lineups
        n_built = len(collected)
        has_cap = any(
            not p.is_locked and min(settings.max_exposure, p.max_exposure) < 100.0
            for p in eligible
        )
        app_counts: dict[str, int] = defaultdict(int)
        if has_cap and collected:
            for l in collected.values():
                for p_id in {a.player_id for a in l.assignments}:
                    app_counts[p_id] += 1

        for p_idx, p in enumerate(eligible):
            if p.is_locked:
                continue
            eff_cap_pct = min(settings.max_exposure, p.max_exposure)
            if eff_cap_pct <= 0.0:
                excluded_now.add(p_idx)
            elif eff_cap_pct < 100.0:
                target_app = max(1, int(target_n * (eff_cap_pct / 100.0) + 1e-9))
                running_allowed = int(((n_built + 1) * eff_cap_pct + 1e-9) / 100.0)
                if mode == "running_floor" and n_built > 0:
                    max_app = min(target_app, running_allowed)
                else:
                    max_app = target_app
                cur_app = app_counts.get(p.id, 0)
                if cur_app >= max_app:
                    excluded_now.add(p_idx)
                elif n_built > 0 and cur_app > 0:
                    if cur_app >= max(1, running_allowed):
                        # Soft penalty instead of hard exclusion keeps salary-tight slates
                        # feasible while still rotating every swappable slot away from core.
                        paced_scores[p_idx] = paced_scores[p_idx] * 0.25
                    else:
                        ratio = min(1.0, cur_app / max(1, target_app))
                        paced_scores[p_idx] = paced_scores[p_idx] * max(0.35, 1.0 - 0.50 * ratio)
        return excluded_now, paced_scores

    def _solve_iteration(
        temp_excluded: set[int],
        paced_scores: list[float],
    ) -> tuple[Lineup | None, list[int]]:
        if use_slot_aware_nba:
            from .sports.nba_classic_solver import (
                lineup_from_slot_solution,
                solve_classic_with_slots,
            )

            locked = {i for i, p in enumerate(eligible) if p.is_locked}
            excluded = {i for i, p in enumerate(eligible) if p.is_excluded} | temp_excluded

            selected, value, salary, status, _ms = solve_classic_with_slots(
                players=eligible,
                scores=paced_scores,
                salary_cap=settings.salary_cap,
                locked_idx=locked,
                excluded_idx=excluded,
                forbidden_lineups=forbidden,
                stack_rules=settings.extras.get("stack_rules"),
            )
            if status != "Optimal" or not selected:
                return None, []

            from .sports.nba import CLASSIC_SLOTS, bipartite_assign

            slot_assigns = bipartite_assign(
                [eligible[i] for i in selected], CLASSIC_SLOTS
            )
            if any(s is None for s in slot_assigns):
                return None, []
            slot_player_idx = [s.player_idx for s in slot_assigns if s is not None]
            lineup = lineup_from_slot_solution(
                players=[eligible[i] for i in selected],
                scores=[paced_scores[i] for i in selected],
                slot_assignments=list(range(len(slot_player_idx))),
                solver_backend=solver_backend,
                strategy=settings.strategy,
                rank=0,
            )
            return lineup, sorted([selected[a] for a in slot_player_idx])

        spec = sport_module.build_solver_spec(
            players=eligible,
            scores=paced_scores,
            settings=settings,
            pre_assignments=[],
            forbidden_lineups=forbidden,
        )
        spec.excluded_idx = spec.excluded_idx | temp_excluded

        if settings.max_attempts and settings.max_attempts < 5000:
            spec.time_limit_ms = min(spec.time_limit_ms, settings.max_attempts)

        result = backend_solver(spec)
        if result.status != "Optimal" or not result.selected_idx:
            return None, []

        lineup_kwargs = dict(
            selected_idx=result.selected_idx,
            players=eligible,
            strategy=settings.strategy.value,
            solver_backend=solver_backend,
            rank=0,
        )
        if sport in (Sport.NBA, Sport.NFL):
            lineup_kwargs["contest_type"] = settings.contest_type
        lineup = sport_module.lineup_from_solver_result(**lineup_kwargs)
        if len(lineup.assignments) != len(result.selected_idx):
            return None, []
        return lineup, sorted(result.selected_idx)

    def _run_iteration(strat_result) -> bool:
        has_cap = any(
            not p.is_locked and min(settings.max_exposure, p.max_exposure) < 100.0
            for p in eligible
        )
        modes = (
            ("running_floor", "target")
            if has_cap and collected
            else ("target",)
        )
        lineup: Lineup | None = None
        lineup_unique_ids: list[int] = []
        for mode in modes:
            temp_excluded, paced_scores = _compute_temp_excluded_and_scores(
                strat_result.scores, mode=mode
            )
            lineup, lineup_unique_ids = _solve_iteration(temp_excluded, paced_scores)
            if lineup is not None:
                break
        if lineup is None:
            return False

        unique_key = "|".join(str(i) for i in lineup_unique_ids)
        if unique_key in collected:
            return False
        collected[unique_key] = lineup
        forbidden.append(set(lineup_unique_ids))
        return True

    for strat_result in iteration_plan:
        _run_iteration(strat_result)
        if len(collected) >= settings.num_lineups:
            break

    # Continue generating perturbed score vectors for deterministic strategies
    # when the initial plan didn't reach settings.num_lineups.
    if len(collected) < settings.num_lineups:
        extra_iter = len(iteration_plan)
        consecutive_misses = 0
        max_extra = max(settings.num_lineups * 2, 50)
        attempts_left = min(settings.max_attempts or max_extra, max_extra)
        while (
            len(collected) < settings.num_lineups
            and consecutive_misses < 15
            and attempts_left > 0
        ):
            extra_sr = pipeline.extra_deterministic_iteration(eligible, settings, extra_iter)
            if extra_sr is None:
                break
            extra_iter += 1
            attempts_left -= 1
            if _run_iteration(extra_sr):
                consecutive_misses = 0
            else:
                consecutive_misses += 1

    # 5. Sort by total_projection desc, assign ranks
    ordered = sorted(collected.values(), key=lambda l: l.total_projection, reverse=True)
    ordered = ordered[: settings.num_lineups]

    # Enforce max exposure caps when portfolio finishes short or at limit
    ordered = _enforce_exposure_caps(ordered, eligible, settings, warnings)

    for i, lineup in enumerate(ordered):
        lineup.rank = i + 1

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return OptimizeResult(
        lineups=ordered,
        strategy=settings.strategy,
        solver_backend=solver_backend,
        elapsed_ms=elapsed_ms,
        warnings=warnings,
    )


def _enforce_exposure_caps(
    lineups: list[Lineup],
    players: Sequence[Player],
    settings: OptimizerSettings,
    warnings: list[str],
) -> list[Lineup]:
    """Prune lineups via exact MILP subset selection so every player meets max_exposure%."""
    if not lineups:
        return lineups

    cap_by_player_id = {
        p.id: min(settings.max_exposure, p.max_exposure)
        for p in players
        if not p.is_locked
    }
    if not any(cap < 100.0 for cap in cap_by_player_id.values()):
        return lineups

    m = len(lineups)
    lineup_pids = [{a.player_id for a in l.assignments} for l in lineups]
    player_to_lineups: dict[str, list[int]] = defaultdict(list)
    for j, pids in enumerate(lineup_pids):
        for p_id in pids:
            player_to_lineups[p_id].append(j)

    def _has_violation(subset_count: int, counts: dict[str, int]) -> bool:
        if subset_count == 0:
            return False
        for p_id, count in counts.items():
            cap_pct = cap_by_player_id.get(p_id)
            if cap_pct is not None and cap_pct < 100.0:
                if count > int((subset_count * cap_pct + 1e-9) / 100.0):
                    return True
        return False

    initial_counts = {p_id: len(idxs) for p_id, idxs in player_to_lineups.items()}
    if not _has_violation(m, initial_counts):
        return lineups

    # Solve maximum-cardinality valid subset MILP:
    #   sum_{j: p in L_j} 100 * y_j <= cap_p * sum_j y_j
    # Keeps as many lineups as possible (tie-breaking on total_projection)
    # without triggering greedy cascade collapse down to 1 lineup.
    import pulp

    prob = pulp.LpProblem("exposure_subset_prune", pulp.LpMaximize)
    y = [pulp.LpVariable(f"y_{j}", cat="Binary") for j in range(m)]
    total_kept = pulp.lpSum(y)
    prob += total_kept >= 2

    for p_id, idxs in player_to_lineups.items():
        cap_pct = cap_by_player_id.get(p_id)
        if cap_pct is None or cap_pct >= 100.0:
            continue
        if cap_pct <= 0.0:
            for j in idxs:
                prob += y[j] == 0
        else:
            prob += pulp.lpSum(100.0 * y[j] for j in idxs) <= cap_pct * total_kept

    max_proj = max((l.total_projection for l in lineups), default=1.0) or 1.0
    prob += pulp.lpSum(
        (1000.0 + max(0.0, l.total_projection) / max_proj) * y[j]
        for j, l in enumerate(lineups)
    )
    prob.solve(pulp.PULP_CBC_CMD(msg=False, timeLimit=5))

    if pulp.LpStatus[prob.status] == "Optimal":
        kept = [l for j, l in enumerate(lineups) if (pulp.value(y[j]) or 0) > 0.5]
        if len(kept) >= 2:
            warnings.append(
                f"Portfolio pruned from {len(lineups)} to {len(kept)} lineups to strictly enforce max exposure cap ({settings.max_exposure}%)."
            )
            return kept

    warnings.append(
        f"Max exposure cap ({settings.max_exposure}%) cannot be satisfied across >=2 lineups given pool depth; returning top lineup."
    )
    return lineups[:1]


def _roster_size_for(sport: Sport, settings: OptimizerSettings) -> int:
    if sport == Sport.NBA:
        from .sports.nba import roster_size
        return roster_size(settings.contest_type)
    if sport == Sport.NFL:
        from .sports.nfl import roster_size as nfl_roster_size
        return nfl_roster_size(settings.contest_type)
    if sport == Sport.MMA:
        return mma_constraints.MMA_ROSTER_SIZE
    if sport == Sport.GOLF:
        return golf_constraints.GOLF_ROSTER_SIZE
    raise ValueError(f"Unknown sport: {sport}")


def _build_correlation(sport: Sport, players: Sequence[Player], settings: OptimizerSettings):
    from .simulation.cholesky import (
        build_nba_correlation,
        build_nfl_correlation,
        build_pairwise_mma_correlation,
    )

    n = len(players)
    if sport == Sport.NBA:
        teams = [p.team for p in players]
        opponents = [p.opponent for p in players]
        m = build_nba_correlation(
            teams=teams,
            opponents=opponents,
            teammate_corr=settings.extras.get("teammate_correlation", 0.35),
            opponent_corr=settings.extras.get("opponent_correlation", 0.20),
            n=n,
        )
    elif sport == Sport.NFL:
        teams = [p.team for p in players]
        opponents = [p.opponent for p in players]
        positions = [p.positions or p.roster_positions for p in players]
        m = build_nfl_correlation(
            teams=teams,
            opponents=opponents,
            positions=positions,
            n=n,
            qb_wr_te_corr=settings.extras.get("qb_wr_te_correlation", 0.45),
            qb_opp_wr_corr=settings.extras.get("qb_opp_wr_correlation", 0.25),
            qb_opp_dst_corr=settings.extras.get("qb_opp_dst_correlation", -0.60),
            teammate_corr=settings.extras.get("teammate_correlation", 0.20),
        )
    elif sport == Sport.MMA:
        opp_ids = [p.opponent_id for p in players]
        bouts = [p.bout for p in players]
        m = build_pairwise_mma_correlation(
            opponent_ids=opp_ids,
            bout_ids=bouts,
            opponent_corr=settings.extras.get("opponent_correlation", -0.40),
            card_corr=settings.extras.get("card_correlation", 0.10),
            n=n,
        )
    else:  # GOLF
        m = np.eye(n)
    return correlation_matrix_from(m)
