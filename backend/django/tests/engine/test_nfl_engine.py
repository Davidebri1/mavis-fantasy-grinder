"""Tests for NFL optimizer sports module and strategies."""
from __future__ import annotations

import pytest

from optimizer.run import run_optimization
from optimizer.schema import (
    ContestType,
    OptimizerSettings,
    Player,
    Sport,
    Strategy,
)
from optimizer.sports import nfl


@pytest.fixture
def sample_nfl_players() -> list[Player]:
    return [
        Player(id="p01", name="Patrick Mahomes", sport=Sport.NFL, salary=7500, projection=24.0, team="KC", opponent="BAL", game_info="KC@BAL 8:00pm ET", positions=["QB"], roster_positions=["QB"], correlation_group="KC@BAL"),
        Player(id="p02", name="Lamar Jackson", sport=Sport.NFL, salary=8000, projection=25.0, team="BAL", opponent="KC", game_info="KC@BAL 8:00pm ET", positions=["QB"], roster_positions=["QB"], correlation_group="KC@BAL"),
        Player(id="p03", name="Derrick Henry", sport=Sport.NFL, salary=7000, projection=18.0, team="BAL", opponent="KC", game_info="KC@BAL 8:00pm ET", positions=["RB"], roster_positions=["RB", "FLEX"], correlation_group="KC@BAL"),
        Player(id="p04", name="Isiah Pacheco", sport=Sport.NFL, salary=4500, projection=15.0, team="KC", opponent="BAL", game_info="KC@BAL 8:00pm ET", positions=["RB"], roster_positions=["RB", "FLEX"], correlation_group="KC@BAL"),
        Player(id="p05", name="Rashee Rice", sport=Sport.NFL, salary=5200, projection=16.0, team="KC", opponent="BAL", game_info="KC@BAL 8:00pm ET", positions=["WR"], roster_positions=["WR", "FLEX"], correlation_group="KC@BAL"),
        Player(id="p06", name="Travis Kelce", sport=Sport.NFL, salary=5800, projection=14.5, team="KC", opponent="BAL", game_info="KC@BAL 8:00pm ET", positions=["TE"], roster_positions=["TE", "FLEX"], correlation_group="KC@BAL"),
        Player(id="p07", name="Zay Flowers", sport=Sport.NFL, salary=4800, projection=13.5, team="BAL", opponent="KC", game_info="KC@BAL 8:00pm ET", positions=["WR"], roster_positions=["WR", "FLEX"], correlation_group="KC@BAL"),
        Player(id="p08", name="Mark Andrews", sport=Sport.NFL, salary=4200, projection=11.0, team="BAL", opponent="KC", game_info="KC@BAL 8:00pm ET", positions=["TE"], roster_positions=["TE", "FLEX"], correlation_group="KC@BAL"),
        Player(id="p09", name="Christian McCaffrey", sport=Sport.NFL, salary=8500, projection=22.0, team="SF", opponent="LAR", game_info="SF@LAR 4:25pm ET", positions=["RB"], roster_positions=["RB", "FLEX"], correlation_group="SF@LAR"),
        Player(id="p10", name="Cooper Kupp", sport=Sport.NFL, salary=6200, projection=17.0, team="LAR", opponent="SF", game_info="SF@LAR 4:25pm ET", positions=["WR"], roster_positions=["WR", "FLEX"], correlation_group="SF@LAR"),
        Player(id="p11", name="Puka Nacua", sport=Sport.NFL, salary=5000, projection=16.5, team="LAR", opponent="SF", game_info="SF@LAR 4:25pm ET", positions=["WR"], roster_positions=["WR", "FLEX"], correlation_group="SF@LAR"),
        Player(id="p12", name="Kyren Williams", sport=Sport.NFL, salary=5200, projection=16.0, team="LAR", opponent="SF", game_info="SF@LAR 4:25pm ET", positions=["RB"], roster_positions=["RB", "FLEX"], correlation_group="SF@LAR"),
        Player(id="p13", name="49ers DST", sport=Sport.NFL, salary=3200, projection=8.5, team="SF", opponent="LAR", game_info="SF@LAR 4:25pm ET", positions=["DST"], roster_positions=["DST"], correlation_group="SF@LAR"),
        Player(id="p14", name="Rams DST", sport=Sport.NFL, salary=2800, projection=7.0, team="LAR", opponent="SF", game_info="SF@LAR 4:25pm ET", positions=["DST"], roster_positions=["DST"], correlation_group="SF@LAR"),
    ]


@pytest.mark.parametrize("strategy", [
    Strategy.MAX_PROJECTION,
    Strategy.BALANCED,
    Strategy.SALARY_CAP,
    Strategy.MONTE_CARLO,
    Strategy.CONTRARIAN,
])
@pytest.mark.parametrize("backend", ["pulp", "ortools"])
def test_nfl_strategies_and_backends(sample_nfl_players, strategy, backend):
    settings = OptimizerSettings(
        sport=Sport.NFL,
        strategy=strategy,
        salary_cap=50000,
        num_lineups=2,
        simulation_count=50,
        contest_type=ContestType.CLASSIC,
        seed=42,
    )
    result = run_optimization(
        sport=Sport.NFL,
        players=sample_nfl_players,
        settings=settings,
        solver_backend=backend,
    )
    assert len(result.lineups) > 0
    for lineup in result.lineups:
        assert lineup.total_salary <= 50000
        assert len(lineup.assignments) == 9
        slots = [a.slot for a in lineup.assignments]
        assert "QB" in slots
        assert "DST" in slots
        assert "TE" in slots
        # Check QB vs opposing DST exclusion
        qb_assignments = [a for a in lineup.assignments if a.slot == "QB"]
        dst_assignments = [a for a in lineup.assignments if a.slot == "DST"]
        if qb_assignments and dst_assignments:
            qb_p = next(p for p in sample_nfl_players if p.id == qb_assignments[0].player_id)
            dst_p = next(p for p in sample_nfl_players if p.id == dst_assignments[0].player_id)
            assert qb_p.opponent != dst_p.team


def test_nfl_qb_opposing_dst_hard_exclusion(sample_nfl_players):
    """Explicitly verify that a QB is never paired with an opposing DST."""
    # Force KC QB Mahomes and BAL DST to conflict
    players = list(sample_nfl_players)
    # Add BAL DST
    players.append(
        Player(id="p15", name="Ravens DST", sport=Sport.NFL, salary=2500, projection=20.0, team="BAL", opponent="KC", game_info="KC@BAL 8:00pm ET", positions=["DST"], roster_positions=["DST"], correlation_group="KC@BAL")
    )
    # Lock Mahomes
    players[0].is_locked = True

    settings = OptimizerSettings(
        sport=Sport.NFL,
        strategy=Strategy.MAX_PROJECTION,
        salary_cap=50000,
        num_lineups=1,
        contest_type=ContestType.CLASSIC,
    )
    result = run_optimization(
        sport=Sport.NFL,
        players=players,
        settings=settings,
        solver_backend="pulp",
    )
    assert len(result.lineups) == 1
    selected_ids = {a.player_id for a in result.lineups[0].assignments}
    assert "p01" in selected_ids
    assert "p15" not in selected_ids, "QB Mahomes must not be paired with opposing Ravens DST"


def test_nfl_game_stack_respects_qb_vs_opp_dst_exclusion(sample_nfl_players):
    """Even when a KC@BAL game stack is active, QB vs opposing DST remains forbidden."""
    players = list(sample_nfl_players)
    players.append(
        Player(id="p15", name="Ravens DST", sport=Sport.NFL, salary=2500, projection=20.0, team="BAL", opponent="KC", game_info="KC@BAL 8:00pm ET", positions=["DST"], roster_positions=["DST"], correlation_group="KC@BAL")
    )
    settings = OptimizerSettings(
        sport=Sport.NFL,
        strategy=Strategy.MAX_PROJECTION,
        salary_cap=50000,
        num_lineups=3,
        contest_type=ContestType.CLASSIC,
        extras={"stack_rules": [{"scope": "game", "id": "KC@BAL", "min": 4}]},
    )
    result = run_optimization(
        sport=Sport.NFL,
        players=players,
        settings=settings,
        solver_backend="pulp",
    )
    assert len(result.lineups) >= 1
    for lineup in result.lineups:
        qb_ids = {a.player_id for a in lineup.assignments if a.slot == "QB"}
        dst_ids = {a.player_id for a in lineup.assignments if a.slot == "DST"}
        for q_id in qb_ids:
            q_p = next(p for p in players if p.id == q_id)
            for d_id in dst_ids:
                d_p = next(p for p in players if p.id == d_id)
                assert q_p.opponent != d_p.team
        kc_bal_count = sum(1 for a in lineup.assignments if next(p for p in players if p.id == a.player_id).correlation_group == "KC@BAL")
        assert kc_bal_count >= 4


def test_nfl_short_portfolio_strict_max_exposure(sample_nfl_players):
    """When constrained portfolio finishes short, no non-locked player exceeds max_exposure%."""
    settings = OptimizerSettings(
        sport=Sport.NFL,
        strategy=Strategy.MAX_PROJECTION,
        salary_cap=50000,
        num_lineups=20,
        max_exposure=35.0,
        contest_type=ContestType.CLASSIC,
        seed=7,
    )
    result = run_optimization(
        sport=Sport.NFL,
        players=sample_nfl_players,
        settings=settings,
        solver_backend="pulp",
    )
    m = len(result.lineups)
    assert m >= 1
    if m > 1:
        counts: dict[str, int] = {}
        for l in result.lineups:
            for p_id in {a.player_id for a in l.assignments}:
                counts[p_id] = counts.get(p_id, 0) + 1
        for p_id, c in counts.items():
            assert (c / m) * 100.0 <= 35.0 + 1e-6, f"Player {p_id} exposure {c}/{m} exceeded 35%"


def test_nfl_exposure_cap_preserves_multi_lineup_portfolio():
    """Verify 50% max_exposure preserves a healthy multi-lineup portfolio without cascade collapse."""
    from apps.common.management.commands.load_sample_data import _NFL_SAMPLE_PLAYERS, _nfl_roster_positions_for

    pool = [
        Player(
            id=f"nfl-{idx}",
            name=name,
            sport=Sport.NFL,
            salary=salary,
            projection=proj,
            team=team,
            opponent=opp,
            game_info=game_info,
            positions=[pos],
            roster_positions=_nfl_roster_positions_for(pos),
            correlation_group=game_info.split(" ")[0],
            projected_ownership=own,
        )
        for idx, (name, team, opp, game_info, pos, salary, proj, own) in enumerate(_NFL_SAMPLE_PLAYERS)
    ]
    settings = OptimizerSettings(
        sport=Sport.NFL,
        strategy=Strategy.MAX_PROJECTION,
        salary_cap=50000,
        num_lineups=20,
        max_exposure=50.0,
        contest_type=ContestType.CLASSIC,
        seed=42,
    )
    res = run_optimization(sport=Sport.NFL, players=pool, settings=settings, solver_backend="pulp")
    m = len(res.lineups)
    assert m >= 10, f"Expected multi-lineup portfolio (>=10), got {m}"
    counts: dict[str, int] = {}
    for l in res.lineups:
        for pid in {a.player_id for a in l.assignments}:
            counts[pid] = counts.get(pid, 0) + 1
    for pid, c in counts.items():
        assert (c / m) * 100.0 <= 50.0 + 1e-6, f"{pid} exposure {c}/{m} > 50%"


def test_nfl_showdown_cpt_projection_and_150_build():
    """Verify Showdown CPT gets highest projected 1.5x and deterministic build scales past ceil(N/2)."""
    pool = [
        Player(id="s1", name="QB A", sport=Sport.NFL, salary=10000, projection=24.0, team="KC", opponent="BUF", positions=["QB"], roster_positions=["CPT", "FLEX"]),
        Player(id="s2", name="WR A", sport=Sport.NFL, salary=8000, projection=18.0, team="KC", opponent="BUF", positions=["WR"], roster_positions=["CPT", "FLEX"]),
        Player(id="s3", name="QB B", sport=Sport.NFL, salary=9500, projection=23.0, team="BUF", opponent="KC", positions=["QB"], roster_positions=["CPT", "FLEX"]),
        Player(id="s4", name="WR B", sport=Sport.NFL, salary=7500, projection=16.0, team="BUF", opponent="KC", positions=["WR"], roster_positions=["CPT", "FLEX"]),
        Player(id="s5", name="RB A", sport=Sport.NFL, salary=6000, projection=14.0, team="KC", opponent="BUF", positions=["RB"], roster_positions=["CPT", "FLEX"]),
        Player(id="s6", name="TE B", sport=Sport.NFL, salary=5000, projection=12.0, team="BUF", opponent="KC", positions=["TE"], roster_positions=["CPT", "FLEX"]),
        Player(id="s7", name="K A", sport=Sport.NFL, salary=3500, projection=8.0, team="KC", opponent="BUF", positions=["K"], roster_positions=["CPT", "FLEX"]),
        Player(id="s8", name="DST B", sport=Sport.NFL, salary=3000, projection=7.0, team="BUF", opponent="KC", positions=["DST"], roster_positions=["CPT", "FLEX"]),
    ]
    settings = OptimizerSettings(
        sport=Sport.NFL,
        strategy=Strategy.MAX_PROJECTION,
        salary_cap=50000,
        num_lineups=10,
        contest_type=ContestType.SHOWDOWN,
        seed=1,
    )
    res = run_optimization(sport=Sport.NFL, players=pool, settings=settings, solver_backend="pulp")
    # 8 choose 6 = 28 possible lineups -> deterministic continuation should find all 10!
    assert len(res.lineups) == 10
    first = res.lineups[0]
    cpt = next(a for a in first.assignments if a.slot == "CPT")
    assert cpt.score_multiplier == 1.5
    by_id = {p.id: p for p in pool}
    expected_proj = sum(by_id[a.player_id].projection * a.score_multiplier for a in first.assignments)
    assert first.total_projection == pytest.approx(expected_proj)
