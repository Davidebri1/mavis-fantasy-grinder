"""Sport-specific constraint builders for NFL lineups.

NFL Classic:
- 9 players: QB, RB1, RB2, WR1, WR2, WR3, TE, FLEX, DST.
- Salary cap: $50,000 default.
- At least 2 different teams represented.
- Hard mutual exclusion: A lineup cannot pair a team's QB with the opposing team's DST (x_QB,t + x_DST,opp(t) <= 1).
- Slot-aware assignment: Each slot is filled by an eligible player, and each selected player fills exactly one slot.

NFL Showdown:
- 6 players: 1 CPT + 5 FLEX.
- CPT gets 1.5x score multiplier.
- At least 2 teams represented.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Sequence

import pulp

from ..engines.milp_pulp import (
    Constraint,
    SolverSpec,
    StackRulesConstraint,
    build_stack_rule_bounds,
)
from ..schema import (
    ContestType,
    Lineup,
    OptimizerSettings,
    Player,
    SlotAssignment,
    Strategy,
)


@dataclass(frozen=True, slots=True)
class RosterSlot:
    label: str
    accepts: tuple[str, ...] | None  # None = accepts any

    def can_accept(self, player_roster_positions: Sequence[str]) -> bool:
        if self.accepts is None:
            return True
        return any(p in self.accepts for p in player_roster_positions)


CLASSIC_SLOTS: tuple[RosterSlot, ...] = (
    RosterSlot("QB", ("QB",)),
    RosterSlot("RB", ("RB", "FB")),
    RosterSlot("RB", ("RB", "FB")),
    RosterSlot("WR", ("WR",)),
    RosterSlot("WR", ("WR",)),
    RosterSlot("WR", ("WR",)),
    RosterSlot("TE", ("TE",)),
    RosterSlot("FLEX", ("RB", "FB", "WR", "TE")),
    RosterSlot("DST", ("DST", "D")),
)

SHOWDOWN_SLOTS: tuple[RosterSlot, ...] = (
    RosterSlot("CPT", None),
    RosterSlot("FLEX", None),
    RosterSlot("FLEX", None),
    RosterSlot("FLEX", None),
    RosterSlot("FLEX", None),
    RosterSlot("FLEX", None),
)


def slots_for(contest: ContestType) -> tuple[RosterSlot, ...]:
    return SHOWDOWN_SLOTS if contest == ContestType.SHOWDOWN else CLASSIC_SLOTS


def roster_size(contest: ContestType) -> int:
    return len(slots_for(contest))


# ───────────────────────────────────────────────────────────────────────────
# Constraints
# ───────────────────────────────────────────────────────────────────────────
@dataclass(slots=True)
class QbOpposingDstConstraint(Constraint):
    """Hard mutual exclusion: cannot pair team QB with opposing team's DST."""

    conflict_pairs: list[tuple[int, int]]

    def add(self, problem: pulp.LpProblem, x: list) -> None:
        for qb_idx, dst_idx in self.conflict_pairs:
            problem += (
                x[qb_idx] + x[dst_idx] <= 1,
                f"no_qb_vs_opp_dst_{qb_idx}_{dst_idx}",
            )

    def add_ortools(self, model, x) -> None:
        for qb_idx, dst_idx in self.conflict_pairs:
            model.Add(x[qb_idx] + x[dst_idx] <= 1)


@dataclass(slots=True)
class NflClassicSlotConstraint(Constraint):
    """Slot assignment constraint ensuring exact NFL Classic position requirements."""

    slots: tuple[RosterSlot, ...]
    eligibility: list[list[bool]]  # eligibility[i][s] is True if player i can fill slot s

    def add(self, problem: pulp.LpProblem, x: list) -> None:
        n = len(x)
        num_slots = len(self.slots)
        # y[i][s] is binary variable indicating player i fills slot s
        y = [
            [pulp.LpVariable(f"nfl_y_{i}_{s}", cat="Binary") for s in range(num_slots)]
            for i in range(n)
        ]
        # Each selected player fills exactly one slot: sum_s y[i][s] == x[i]
        for i in range(n):
            problem += (
                pulp.lpSum(y[i][s] for s in range(num_slots)) == x[i],
                f"nfl_player_{i}_one_slot",
            )
        # Each slot filled by exactly one player: sum_i y[i][s] == 1
        for s in range(num_slots):
            problem += (
                pulp.lpSum(y[i][s] for i in range(n)) == 1,
                f"nfl_slot_{s}_filled",
            )
        # Ineligible slots must be 0
        for i in range(n):
            for s in range(num_slots):
                if not self.eligibility[i][s]:
                    problem += y[i][s] == 0, f"nfl_inelig_{i}_{s}"

    def add_ortools(self, model, x) -> None:
        n = len(x)
        num_slots = len(self.slots)
        y = [
            [model.NewBoolVar(f"nfl_y_{i}_{s}") for s in range(num_slots)]
            for i in range(n)
        ]
        for i in range(n):
            model.Add(sum(y[i][s] for s in range(num_slots)) == x[i])
        for s in range(num_slots):
            model.Add(sum(y[i][s] for i in range(n)) == 1)
        for i in range(n):
            for s in range(num_slots):
                if not self.eligibility[i][s]:
                    model.Add(y[i][s] == 0)


@dataclass(slots=True)
class MinTeamsConstraint(Constraint):
    """DraftKings requirement: players from at least 2 different teams."""

    team_members: dict[str, list[int]]
    max_from_one_team: int

    def add(self, problem: pulp.LpProblem, x: list) -> None:
        for team, members in self.team_members.items():
            problem += (
                pulp.lpSum(x[i] for i in members) <= self.max_from_one_team,
                f"max_team_{team}",
            )

    def add_ortools(self, model, x) -> None:
        for team, members in self.team_members.items():
            model.Add(sum(x[i] for i in members) <= self.max_from_one_team)


# ───────────────────────────────────────────────────────────────────────────
# Conflict pair detection
# ───────────────────────────────────────────────────────────────────────────
def find_qb_opposing_dst_conflicts(players: Sequence[Player]) -> list[tuple[int, int]]:
    """Return all (qb_idx, dst_idx) pairs where DST plays against QB."""
    conflicts: list[tuple[int, int]] = []
    qb_indices: list[int] = []
    dst_indices: list[int] = []

    for i, p in enumerate(players):
        pos = set(p.positions + p.roster_positions)
        if "QB" in pos:
            qb_indices.append(i)
        if "DST" in pos or "D" in pos:
            dst_indices.append(i)

    for q_i in qb_indices:
        q = players[q_i]
        q_team = (q.team or "").upper()
        q_opp = (q.opponent or "").upper()
        q_game = effective_correlation_group(q)

        for d_i in dst_indices:
            d = players[d_i]
            d_team = (d.team or "").upper()
            d_opp = (d.opponent or "").upper()
            d_game = effective_correlation_group(d)

            is_opp = False
            if q_opp and d_team and q_opp == d_team:
                is_opp = True
            elif q_team and d_opp and q_team == d_opp:
                is_opp = True
            elif q_game and d_game and q_game == d_game and q_team != d_team:
                is_opp = True

            if is_opp:
                conflicts.append((q_i, d_i))

    return conflicts


def effective_correlation_group(p: Player) -> str:
    """Auto-derive correlationGroup from gameInfo if not explicitly set."""
    if p.correlation_group:
        return p.correlation_group
    m = re.search(r"([A-Z0-9]{2,4}@[A-Z0-9]{2,4})", p.game_info or "")
    return m.group(1) if m else ""


# ───────────────────────────────────────────────────────────────────────────
# Bipartite slot matching
# ───────────────────────────────────────────────────────────────────────────
def bipartite_assign(
    players: Sequence[Player],
    slots: Sequence[RosterSlot],
) -> list[int | None]:
    """Assign selected players to slots via exact augmenting-path matching.

    Sorts player candidates by descending effective projection so higher
    projected players prefer earlier/tighter slots when ties exist.
    Returns a list of length len(slots) with player indices.
    """
    n = len(players)
    m = len(slots)
    assigned_player: list[int | None] = [None] * m
    player_order = sorted(
        range(n), key=lambda i: players[i].effective_projection, reverse=True
    )

    adj: list[list[int]] = []
    for p_idx in range(n):
        pos = players[p_idx].positions or players[p_idx].roster_positions
        adj.append([s_idx for s_idx, slot in enumerate(slots) if slot.can_accept(pos)])

    # Kuhn's augmenting path from player -> slot
    slot_owner: list[int | None] = [None] * m

    def _dfs(p_idx: int, seen: list[bool]) -> bool:
        for s_idx in adj[p_idx]:
            if seen[s_idx]:
                continue
            seen[s_idx] = True
            cur = slot_owner[s_idx]
            if cur is None or _dfs(cur, seen):
                slot_owner[s_idx] = p_idx
                return True
        return False

    for p_idx in player_order:
        _dfs(p_idx, [False] * m)

    for s_idx, p_idx in enumerate(slot_owner):
        assigned_player[s_idx] = p_idx
    return assigned_player


# ───────────────────────────────────────────────────────────────────────────
# Build solver spec
# ───────────────────────────────────────────────────────────────────────────
def build_solver_spec(
    *,
    players: Sequence[Player],
    scores: Sequence[float],
    settings: OptimizerSettings,
    pre_assignments: list[tuple[int, int]] | None = None,
    forbidden_lineups: list[set[int]] | None = None,
    team_max: int = 0,
) -> SolverSpec:
    pre_assignments = pre_assignments or []
    forbidden_lineups = forbidden_lineups or []

    locked_idx = {i for i, p in enumerate(players) if p.is_locked}
    excluded_idx = {i for i, p in enumerate(players) if p.is_excluded}
    salaries = [p.salary for p in players]

    slots = slots_for(settings.contest_type)
    r_size = len(slots)

    extra_constraints: list[Constraint] = []

    # 1. Hard QB vs opposing DST constraint
    conflicts = find_qb_opposing_dst_conflicts(players)
    if conflicts:
        extra_constraints.append(QbOpposingDstConstraint(conflict_pairs=conflicts))

    # 2. Classic position slot constraint
    if settings.contest_type == ContestType.CLASSIC:
        eligibility = [
            [slot.can_accept(p.positions or p.roster_positions) for slot in slots]
            for p in players
        ]
        extra_constraints.append(
            NflClassicSlotConstraint(slots=slots, eligibility=eligibility)
        )

    # 3. Min 2 teams constraint & optional team stack max
    team_members: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(players):
        if p.team:
            team_members[p.team].append(i)

    max_one_team = r_size - 1  # Ensures >= 2 teams represented
    eff_team_max = team_max or int(settings.extras.get("team_max_players", 0) or 0)
    if eff_team_max > 0:
        max_one_team = min(max_one_team, eff_team_max)
    if team_members:
        extra_constraints.append(
            MinTeamsConstraint(
                team_members=team_members, max_from_one_team=max_one_team
            )
        )

    # 4. User stack rules (team / game min & max)
    stack_rules = settings.extras.get("stack_rules") or []
    rule_bounds = build_stack_rule_bounds(players, stack_rules)
    if rule_bounds:
        extra_constraints.append(StackRulesConstraint(bounds=rule_bounds))

    score_multipliers = [1.0] * len(players)
    if settings.contest_type == ContestType.SHOWDOWN:
        # Showdown CPT pre-assignment if specified
        pre_locked_pairs = [(s, p) for s, p in pre_assignments if p is not None]
        cpt_idx = next((p for s, p in pre_locked_pairs if s == 0), None)
        if cpt_idx is not None:
            score_multipliers[cpt_idx] = 1.5

    return SolverSpec(
        scores=list(scores),
        salaries=salaries,
        roster_size=r_size,
        salary_cap=settings.salary_cap,
        locked_idx=locked_idx,
        excluded_idx=excluded_idx,
        forbidden_idx_sets=forbidden_lineups,
        pre_assignments=pre_assignments,
        score_multipliers=score_multipliers,
        extra_constraints=extra_constraints,
    )


# ───────────────────────────────────────────────────────────────────────────
# Lineup translation
# ───────────────────────────────────────────────────────────────────────────
def lineup_from_solver_result(
    *,
    selected_idx: list[int],
    players: Sequence[Player],
    contest_type: ContestType = ContestType.CLASSIC,
    strategy: str,
    solver_backend: str,
    rank: int,
) -> Lineup:
    slots = slots_for(contest_type)
    selected_players = [players[i] for i in selected_idx]

    assignments: list[SlotAssignment] = []

    if contest_type == ContestType.SHOWDOWN:
        # Promote highest projected selected player to CPT (1.5x) so Showdown
        # valuation aligns with DFS rules rather than arbitrary input order.
        ordered_sel = sorted(
            selected_idx,
            key=lambda i: players[i].effective_projection,
            reverse=True,
        )
        for idx, sel_idx in enumerate(ordered_sel):
            slot_label = "CPT" if idx == 0 else "FLEX"
            mult = 1.5 if slot_label == "CPT" else 1.0
            assignments.append(
                SlotAssignment(
                    slot=slot_label,
                    score_multiplier=mult,
                    player_id=players[sel_idx].id,
                    player_name=players[sel_idx].name,
                )
            )
    else:
        # Classic: run bipartite assignment
        assigned = bipartite_assign(selected_players, slots)
        for s_idx, p_subset_idx in enumerate(assigned):
            if p_subset_idx is not None:
                p = selected_players[p_subset_idx]
                assignments.append(
                    SlotAssignment(
                        slot=slots[s_idx].label,
                        score_multiplier=1.0,
                        player_id=p.id,
                        player_name=p.name,
                    )
                )

    by_id = {players[i].id: players[i] for i in selected_idx}
    total_salary = sum(players[i].salary for i in selected_idx)
    total_proj = sum(
        by_id[a.player_id].effective_projection * a.score_multiplier
        for a in assignments
        if a.player_id in by_id
    )
    total_ceiling = sum(
        by_id[a.player_id].ceiling * a.score_multiplier
        for a in assignments
        if a.player_id in by_id
    )
    teams = {players[i].team for i in selected_idx if players[i].team}
    games = {
        effective_correlation_group(players[i])
        for i in selected_idx
        if effective_correlation_group(players[i])
    }

    lineup = Lineup(
        assignments=assignments,
        strategy=Strategy(strategy),
        solver_backend=solver_backend,
        rank=rank,
    )
    lineup.total_salary = total_salary
    lineup.total_projection = total_proj
    lineup.total_ceiling = total_ceiling
    lineup.teams = teams
    lineup.games = games
    return lineup
