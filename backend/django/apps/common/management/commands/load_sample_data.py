"""Sample data management command.

Loads three sample slates (one each for NBA, MMA, Golf) with realistic
player rosters so the customer can immediately run an optimize end-to-end
without uploading their own files.

Usage:
    python manage.py load_sample_data
    python manage.py load_sample_data --reset
"""
from __future__ import annotations

import random
from datetime import date, time, timedelta

from django.core.management.base import BaseCommand

from apps.common.models import Slate
from apps.golf.models import GolfPlayer
from apps.mma.models import MmaFighter
from apps.nba.models import NbaPlayer
from apps.nfl.models import NflPlayer


_NBA_TEAMS = [
    ("LAL", "GSW", 0, ("LeBron James", "Anthony Davis", "Austin Reaves", "D'Angelo Russell", "Rui Hachimura")),
    ("GSW", "LAL", 1, ("Stephen Curry", "Klay Thompson", "Andrew Wiggins", "Draymond Green", "Chris Paul")),
    ("BOS", "MIA", 2, ("Jayson Tatum", "Jaylen Brown", "Derrick White", "Jrue Holiday", "Kristaps Porzingis")),
    ("MIA", "BOS", 3, ("Jimmy Butler", "Bam Adebayo", "Tyler Herro", "Terry Rozier", "Caleb Martin")),
    ("NYK", "PHI", 4, ("Jalen Brunson", "Julius Randle", "OG Anonoby", "Josh Hart", "Donte DiVincenzo")),
    ("PHI", "NYK", 5, ("Joel Embiid", "Tyrese Maxey", "Tobias Harris", "Kelly Oubre Jr", "DeAnthony Melton")),
]

_MMA_FIGHTERS = [
    ("Jon Jones", "Stipe Miocic", "Heavyweight"),
    ("Islam Makhachev", "Arman Tsarukyan", "Lightweight"),
    ("Sean O'Malley", "Merab Dvalishvili", "Bantamweight"),
    ("Alex Pereira", "Jiri Prochazka", "Light Heavyweight"),
    ("Dustin Poirier", "Max Holloway", "Lightweight"),
    ("Zhang Weili", "Tatiana Suarez", "Women's Strawweight"),
]

_GOLF_PLAYERS = [
    "Scottie Scheffler", "Rory McIlroy", "Jon Rahm", "Brooks Koepka",
    "Xander Schauffele", "Viktor Hovland", "Justin Thomas", "Collin Morikawa",
    "Tommy Fleetwood", "Wyndham Clark", "Ludvig Aberg", "Patrick Cantlay",
]


_NBA_SALARY_BUCKETS = [3500, 4000, 4500, 5000, 5500, 6000, 7000, 8500, 10500]
_NBA_POSITIONS = ["PG", "SG", "SF", "PF", "C"]


_NFL_SAMPLE_PLAYERS = [
    # KC vs BUF
    ("Patrick Mahomes", "KC", "BUF", "KC@BUF 4:25pm ET", "QB", 7400, 23.6, 15.0),
    ("Isiah Pacheco", "KC", "BUF", "KC@BUF 4:25pm ET", "RB", 5600, 15.8, 12.0),
    ("Rashee Rice", "KC", "BUF", "KC@BUF 4:25pm ET", "WR", 6800, 18.9, 18.0),
    ("Xavier Worthy", "KC", "BUF", "KC@BUF 4:25pm ET", "WR", 5300, 14.1, 10.0),
    ("Travis Kelce", "KC", "BUF", "KC@BUF 4:25pm ET", "TE", 6100, 15.9, 14.0),
    ("Chiefs DST", "KC", "BUF", "KC@BUF 4:25pm ET", "DST", 2900, 7.6, 7.0),
    ("Josh Allen", "BUF", "KC", "KC@BUF 4:25pm ET", "QB", 8100, 25.4, 21.0),
    ("James Cook", "BUF", "KC", "KC@BUF 4:25pm ET", "RB", 6600, 17.5, 16.0),
    ("Khalil Shakir", "BUF", "KC", "KC@BUF 4:25pm ET", "WR", 5900, 15.2, 13.0),
    ("Keon Coleman", "BUF", "KC", "KC@BUF 4:25pm ET", "WR", 4700, 12.6, 8.0),
    ("Dalton Kincaid", "BUF", "KC", "KC@BUF 4:25pm ET", "TE", 4900, 12.8, 11.0),
    ("Bills DST", "BUF", "KC", "KC@BUF 4:25pm ET", "DST", 2700, 7.1, 6.0),
    # SF vs DAL
    ("Brock Purdy", "SF", "DAL", "SF@DAL 4:25pm ET", "QB", 6500, 20.1, 11.0),
    ("Christian McCaffrey", "SF", "DAL", "SF@DAL 4:25pm ET", "RB", 8600, 23.2, 24.0),
    ("Deebo Samuel", "SF", "DAL", "SF@DAL 4:25pm ET", "WR", 6300, 16.4, 14.0),
    ("George Kittle", "SF", "DAL", "SF@DAL 4:25pm ET", "TE", 5700, 15.1, 13.0),
    ("49ers DST", "SF", "DAL", "SF@DAL 4:25pm ET", "DST", 3300, 8.7, 9.0),
    ("Dak Prescott", "DAL", "SF", "SF@DAL 4:25pm ET", "QB", 6700, 20.4, 12.0),
    ("Rico Dowdle", "DAL", "SF", "SF@DAL 4:25pm ET", "RB", 5200, 13.8, 10.0),
    ("CeeDee Lamb", "DAL", "SF", "SF@DAL 4:25pm ET", "WR", 8200, 21.8, 22.0),
    ("Jake Ferguson", "DAL", "SF", "SF@DAL 4:25pm ET", "TE", 4300, 11.6, 9.0),
    ("Cowboys DST", "DAL", "SF", "SF@DAL 4:25pm ET", "DST", 2500, 6.8, 5.0),
    # PHI vs DET
    ("Jalen Hurts", "PHI", "DET", "PHI@DET 8:20pm ET", "QB", 7800, 24.1, 17.0),
    ("Saquon Barkley", "PHI", "DET", "PHI@DET 8:20pm ET", "RB", 8300, 22.5, 23.0),
    ("A.J. Brown", "PHI", "DET", "PHI@DET 8:20pm ET", "WR", 7700, 20.1, 19.0),
    ("DeVonta Smith", "PHI", "DET", "PHI@DET 8:20pm ET", "WR", 6200, 16.2, 13.0),
    ("Eagles DST", "PHI", "DET", "PHI@DET 8:20pm ET", "DST", 3100, 8.1, 8.0),
    ("Jared Goff", "DET", "PHI", "PHI@DET 8:20pm ET", "QB", 6600, 20.8, 13.0),
    ("Jahmyr Gibbs", "DET", "PHI", "PHI@DET 8:20pm ET", "RB", 7500, 20.3, 19.0),
    ("Amon-Ra St. Brown", "DET", "PHI", "PHI@DET 8:20pm ET", "WR", 7900, 20.7, 20.0),
    ("Sam LaPorta", "DET", "PHI", "PHI@DET 8:20pm ET", "TE", 5100, 13.4, 10.0),
    ("Lions DST", "DET", "PHI", "PHI@DET 8:20pm ET", "DST", 2800, 7.4, 6.0),
]


def _nfl_roster_positions_for(pos: str) -> list[str]:
    if pos in ("RB", "WR", "TE"):
        return [pos, "FLEX"]
    return [pos]


def _roster_positions_for(pos: str) -> list[str]:
    if pos in ("PG", "SG"):
        return [pos, "G", "UTIL"]
    if pos in ("SF", "PF"):
        return [pos, "F", "UTIL"]
    return [pos, "UTIL"]


class Command(BaseCommand):
    help = "Load three sample slates (NBA, MMA, Golf) with realistic rosters."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing sample slates before reloading.",
        )

    def handle(self, *args, **options):
        random.seed(42)
        if options["reset"]:
            Slate.objects.filter(name__startswith="[SAMPLE]").delete()
            self.stdout.write(self.style.WARNING("Cleared existing sample slates."))

        today = date.today()
        slate_date = today + timedelta(days=1)
        slate_time = time(19, 0)

        nba_slate = self._seed_nba(slate_date, slate_time)
        nfl_slate = self._seed_nfl(slate_date, slate_time)
        mma_slate = self._seed_mma(slate_date, slate_time)
        golf_slate = self._seed_golf(slate_date, slate_time)

        self.stdout.write(
            self.style.SUCCESS(
                f"Loaded {nba_slate.players.count()} NBA players, "
                f"{nfl_slate.nfl_players.count()} NFL players, "
                f"{mma_slate.mma_fighters.count()} MMA fighters, "
                f"{golf_slate.golf_players.count()} Golf players."
            )
        )

    def _seed_nba(self, slate_date, slate_time):
        slate, _ = Slate.objects.get_or_create(
            sport="nba",
            name="[SAMPLE] NBA Main Slate",
            slate_date=slate_date,
            slate_time=slate_time,
            defaults={
                "file_name": "sample_nba.csv",
                "source_format": "csv",
                "is_active": True,
            },
        )
        if slate.players.exists():
            self.stdout.write(f"  NBA slate already populated.")
            return slate

        players: list[NbaPlayer] = []
        for team_a, team_b, idx, names in _NBA_TEAMS:
            for offset, name in enumerate(names):
                pos = _NBA_POSITIONS[offset % len(_NBA_POSITIONS)]
                players.append(
                    NbaPlayer(
                        id=f"nba-{idx}-{offset}",
                        slate=slate,
                        name=name,
                        salary=random.choice(_NBA_SALARY_BUCKETS),
                        projection=round(random.uniform(15.0, 60.0), 1),
                        team=team_a if offset < 5 else team_b,
                        opponent=team_b if offset < 5 else team_a,
                        game_info=f"{team_a}@{team_b} 7:00pm ET",
                        positions=[pos],
                        roster_positions=_roster_positions_for(pos),
                        correlation_group=f"{team_a}@{team_b}",
                        projected_ownership=round(random.uniform(2.0, 35.0), 1),
                    )
                )
        NbaPlayer.objects.bulk_create(players)
        self.stdout.write(f"  Seeded {len(players)} NBA players into slate {slate.id}")
        return slate

    def _seed_mma(self, slate_date, slate_time):
        slate, _ = Slate.objects.get_or_create(
            sport="mma",
            name="[SAMPLE] MMA Main Card",
            slate_date=slate_date,
            slate_time=slate_time,
            defaults={
                "file_name": "sample_mma.csv",
                "source_format": "csv",
                "is_active": True,
            },
        )
        if slate.mma_fighters.exists():
            self.stdout.write(f"  MMA slate already populated.")
            return slate

        fighters: list[MmaFighter] = []
        for i, (a, b, div) in enumerate(_MMA_FIGHTERS):
            for j, name in enumerate([a, b]):
                fighters.append(
                    MmaFighter(
                        id=f"mma-{i}-{j}",
                        slate=slate,
                        name=name,
                        salary=random.choice([4500, 5500, 6500, 7500, 8500, 9500]),
                        projection=round(random.uniform(40.0, 90.0), 1),
                        opponent_id=f"mma-{i}-{1-j}",
                        bout=f"{a} vs {b}",
                        projected_ownership=round(random.uniform(5.0, 40.0), 1),
                    )
                )
        MmaFighter.objects.bulk_create(fighters)
        self.stdout.write(f"  Seeded {len(fighters)} MMA fighters into slate {slate.id}")
        return slate

    def _seed_golf(self, slate_date, slate_time):
        slate, _ = Slate.objects.get_or_create(
            sport="golf",
            name="[SAMPLE] PGA Main Field",
            slate_date=slate_date,
            slate_time=slate_time,
            defaults={
                "file_name": "sample_golf.csv",
                "source_format": "csv",
                "is_active": True,
            },
        )
        if slate.golf_players.exists():
            self.stdout.write(f"  Golf slate already populated.")
            return slate

        players = []
        for i, name in enumerate(_GOLF_PLAYERS):
            players.append(
                GolfPlayer(
                    id=f"golf-{i}",
                    slate=slate,
                    name=name,
                    salary=random.choice([6500, 7000, 7500, 8000, 8500, 9000, 10000, 11000]),
                    projection=round(random.uniform(45.0, 95.0), 1),
                    projected_ownership=round(random.uniform(2.0, 30.0), 1),
                )
            )
        GolfPlayer.objects.bulk_create(players)
        self.stdout.write(f"  Seeded {len(players)} golf players into slate {slate.id}")
        return slate

    def _seed_nfl(self, slate_date, slate_time):
        slate, _ = Slate.objects.get_or_create(
            sport="nfl",
            name="[SAMPLE] NFL Main Slate",
            slate_date=slate_date,
            slate_time=slate_time,
            defaults={
                "file_name": "sample_nfl.csv",
                "source_format": "csv",
                "is_active": True,
            },
        )
        if slate.nfl_players.exists():
            self.stdout.write("  NFL slate already populated.")
            return slate

        players = [
            NflPlayer(
                id=f"nfl-{idx}",
                slate=slate,
                name=name,
                salary=salary,
                projection=proj,
                team=team,
                opponent=opp,
                game_info=game_info,
                positions=[pos],
                roster_positions=_nfl_roster_positions_for(pos),
                correlation_group=f"{game_info.split(' ')[0]}",
                projected_ownership=own,
            )
            for idx, (name, team, opp, game_info, pos, salary, proj, own) in enumerate(_NFL_SAMPLE_PLAYERS)
        ]
        NflPlayer.objects.bulk_create(players)
        self.stdout.write(f"  Seeded {len(players)} NFL players into slate {slate.id}")
        return slate
