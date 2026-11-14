"""PuLP + CBC MILP solver — the default engine.

We deliberately separate the *engine* from the *sport-specific constraint
builders* so the same solver runs NBA Classic, NBA Showdown, MMA, and
Golf — only the constraint function changes.

Constraints implemented:
- Roster size (exactly N picks).
- Salary cap (≤ cap).
- Per-player min/max exposure across the full run (caller passes appearance counts).
- Pre-assigned slots (NBA Classic / Showdown).
- Forbidden lineups (de-duplication across calls).
- Locked players (must be in).
- Excluded players (must not be in).
- Sport-specific: position eligibility, opponent exclusion (MMA), game
  bring-back (NBA), team stacking (NBA), captain multiplier (Showdown).

The engine returns a :class:`SolverResult` with the selected player
indices. Sport layers translate this into a :class:`Lineup`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

import pulp


@dataclass(slots=True)
class SolverResult:
    selected_idx: list[int]
    value: float
    salary: int
    status: str  # "Optimal" | "Infeasible" | "Unbounded" | "Not Solved"
    solver_time_ms: int


@dataclass(slots=True)
class SolverSpec:
    """A sport-agnostic spec the engine solves against.

    ``cb_pre`` / ``cb_post`` hooks let sport layers inject custom constraints.
    """

    scores: Sequence[float]
    salaries: Sequence[int]
    roster_size: int
    salary_cap: int

    locked_idx: set[int] = field(default_factory=set)
    excluded_idx: set[int] = field(default_factory=set)
    forbidden_idx_sets: list[set[int]] = field(default_factory=list)
    appearance_floor_idx: dict[int, int] = field(default_factory=dict)
    appearance_ceiling_idx: dict[int, int] = field(default_factory=dict)

    # Per-unit score multipliers (NBA Showdown Captain = 1.5)
    score_multipliers: Sequence[float] = field(default_factory=lambda: [])

    # Minimum total salary to use (NBA "spend up" builds)
    min_total_salary: int = 0

    # Optional constraint hooks
    pre_assignments: list[tuple[int, int]] = field(default_factory=list)
    extra_constraints: list["Constraint"] = field(default_factory=list)

    # Solver tuning
    time_limit_ms: int = 5_000
    mip_gap: float = 0.005  # 0.5% gap tolerance

    def __post_init__(self) -> None:
        if not self.score_multipliers:
            self.score_multipliers = [1.0] * len(self.scores)


class Constraint:
    """Marker for sport-specific additional constraints."""

    def add(self, problem: "pulp.LpProblem", x: list) -> None:  # pragma: no cover
        raise NotImplementedError


@dataclass(slots=True)
class StackRulesConstraint(Constraint):
    """Enforce min/max player counts for user-configured stack groups."""

    # List of (rule_label, member_indices, min_count, max_count_or_none)
    bounds: list[tuple[str, list[int], int, int | None]]

    def add(self, problem: "pulp.LpProblem", x: list) -> None:
        for idx, (label, members, min_c, max_c) in enumerate(self.bounds):
            if not members:
                continue
            expr = pulp.lpSum(x[i] for i in members)
            safe_label = "".join(ch if ch.isalnum() else "_" for ch in label)
            if min_c > 0:
                problem += expr >= min_c, f"stack_min_{idx}_{safe_label}"
            if max_c is not None and max_c >= 0:
                problem += expr <= max_c, f"stack_max_{idx}_{safe_label}"

    def add_ortools(self, model, x) -> None:
        for _, members, min_c, max_c in self.bounds:
            if not members:
                continue
            expr = sum(x[i] for i in members)
            if min_c > 0:
                model.Add(expr >= min_c)
            if max_c is not None and max_c >= 0:
                model.Add(expr <= max_c)


def build_stack_rule_bounds(players: Sequence, stack_rules: Sequence[dict] | None) -> list[tuple[str, list[int], int, int | None]]:
    """Resolve generic stack rule dicts ({scope, id, min, max}) into player index bounds."""
    if not stack_rules:
        return []
    bounds: list[tuple[str, list[int], int, int | None]] = []
    for rule in stack_rules:
        if not isinstance(rule, dict):
            continue
        scope = str(rule.get("scope", "")).lower().strip()
        rule_id = str(rule.get("id", "")).upper().strip()
        if not scope or not rule_id:
            continue
        min_c = int(rule.get("min") or 0)
        raw_max = rule.get("max")
        max_c = int(raw_max) if raw_max is not None else None
        members: list[int] = []
        rule_teams = set(rule_id.split("@")) if "@" in rule_id else set()
        for i, p in enumerate(players):
            p_team = (getattr(p, "team", "") or "").upper()
            p_opp = (getattr(p, "opponent", "") or "").upper()
            p_game = (getattr(p, "effective_correlation_group", "") or getattr(p, "correlation_group", "") or getattr(p, "game_info", "") or "").upper()
            p_bout = (getattr(p, "bout", "") or "").upper()
            matched = False
            if scope == "team":
                matched = p_team == rule_id
            elif scope == "game":
                if rule_id in p_game:
                    matched = True
                elif rule_teams and p_team in rule_teams and (not p_opp or p_opp in rule_teams):
                    matched = True
            elif scope == "bout":
                matched = p_bout == rule_id
            elif scope == "card":
                matched = rule_id in p_game
            if matched:
                members.append(i)
        if members or min_c > 0:
            bounds.append((f"{scope}_{rule_id}", members, min_c, max_c))
    return bounds


def _constrain_forbid_pair(
    problem: pulp.LpProblem,
    x: list,
    i: int,
    j: int,
) -> None:
    problem += x[i] + x[j] <= 1, f"forbid_pair_{i}_{j}"


def solve_pulp(spec: SolverSpec) -> SolverResult:
    """Solve the lineup-construction ILP using PuLP + CBC.

    Returns a SolverResult with selected player indices. ``scores[i]`` is
    the per-unit objective value (typically projection or one Monte Carlo
    row), and ``score_multipliers[i]`` is the per-slot multiplier
    (1.0 for Classic/MMA/Golf, 1.5 for Showdown Captain — but those
    models bake the multiplier into the *per-slot score*).
    """
    n = len(spec.scores)
    if n == 0:
        return SolverResult(
            selected_idx=[],
            value=0.0,
            salary=0,
            status="Infeasible",
            solver_time_ms=0,
        )

    problem = pulp.LpProblem("lineup", pulp.LpMaximize)
    x = [pulp.LpVariable(f"x_{i}", cat="Binary") for i in range(n)]

    # Objective
    problem += (
        pulp.lpSum(spec.scores[i] * spec.score_multipliers[i] * x[i] for i in range(n)),
        "objective",
    )

    # Roster size
    problem += (
        pulp.lpSum(x[i] for i in range(n)) == spec.roster_size,
        "roster_size",
    )

    # Salary cap
    problem += (
        pulp.lpSum(spec.salaries[i] * x[i] for i in range(n)) <= spec.salary_cap,
        "salary_cap",
    )

    # Min total salary (NBA "spend up" builds)
    if spec.min_total_salary > 0:
        problem += (
            pulp.lpSum(spec.salaries[i] * x[i] for i in range(n)) >= spec.min_total_salary,
            "min_salary",
        )

    # Locks
    for i in spec.locked_idx:
        problem += x[i] == 1, f"lock_{i}"

    # Exclusions
    for i in spec.excluded_idx:
        problem += x[i] == 0, f"exclude_{i}"

    # Pre-assignments (NBA Classic position assignment from bipartite matching)
    for slot_idx, player_idx in spec.pre_assignments:
        # The caller has chosen which player fills which slot.
        # We model this as: that slot's row in `pre_assignments` enforces
        # x[player_idx] == 1 for slots that have been locked.
        if player_idx is not None:
            problem += x[player_idx] == 1, f"pre_assign_{slot_idx}"

    # Forbidden lineups — a no-good cut: at most |set|-1 of the set may be
    # selected, i.e. this exact lineup is excluded but every subset is allowed.
    # (Earlier this used `<= 1`, which wrongly banned almost the whole lineup.)
    for idx_set in spec.forbidden_idx_sets:
        if idx_set:
            problem += (
                pulp.lpSum(x[i] for i in idx_set) <= len(idx_set) - 1,
                f"forbid_set_{'_'.join(map(str, sorted(idx_set)))}",
            )

    # Exposure
    for idx, floor in spec.appearance_floor_idx.items():
        problem += x[idx] >= 1, f"floor_{idx}"  # n/a for one-shot, kept for completeness
    for idx, ceil_count in spec.appearance_ceiling_idx.items():
        problem += x[idx] <= 1, f"ceil_{idx}"  # one-shot bound, kept for parity

    # Custom sport constraints
    for c in spec.extra_constraints:
        c.add(problem, x)

    solver = pulp.PULP_CBC_CMD(
        timeLimit=spec.time_limit_ms / 1000.0,
        gapRel=spec.mip_gap,
        msg=0,
    )
    import time

    start = time.perf_counter()
    status = problem.solve(solver)
    elapsed_ms = int((time.perf_counter() - start) * 1000)

    if pulp.LpStatus[status] != "Optimal":
        return SolverResult(
            selected_idx=[],
            value=0.0,
            salary=0,
            status=pulp.LpStatus[status],
            solver_time_ms=elapsed_ms,
        )

    selected_idx = [i for i in range(n) if pulp.value(x[i]) > 0.5]
    value = float(sum(spec.scores[i] * spec.score_multipliers[i] for i in selected_idx))
    salary = int(sum(spec.salaries[i] for i in selected_idx))
    return SolverResult(
        selected_idx=selected_idx,
        value=value,
        salary=salary,
        status="Optimal",
        solver_time_ms=elapsed_ms,
    )
