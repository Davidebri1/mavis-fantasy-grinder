"""ESPN injury + news sync.

Scrapes the public ESPN NBA injuries feed and news feed and pushes rows
into the corresponding Django models.

The Flutter app used a custom PDF parser for the injury report; this
Python port of the news/injury sync uses ESPN's public JSON-ish endpoints
when available, with a graceful fallback to "no data" if the upstream
blocks us.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

import requests

log = logging.getLogger("fantasy_grinder.integrations.espn")


@dataclass(slots=True)
class EspnInjuryRow:
    player_id: str
    name: str
    team: str
    status: str
    severity: str
    short_comment: str
    long_comment: str
    updated_at: datetime | None


@dataclass(slots=True)
class EspnNewsRow:
    player_id: str
    title: str
    published: datetime | None
    link: str
    raw: dict


@dataclass(slots=True)
class EspnSyncResult:
    injuries_synced: int = 0
    news_synced: int = 0
    warnings: list[str] = None  # type: ignore[assignment]

    def __post_init__(self):
        if self.warnings is None:
            self.warnings = []


class EspnClient:
    """Thin wrapper over the public ESPN injury + news endpoints."""

    INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
    NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news"

    def __init__(self, timeout: int = 30):
        self._timeout = timeout

    def fetch_injuries(self) -> list[EspnInjuryRow]:
        try:
            resp = requests.get(self.INJURIES_URL, timeout=self._timeout)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            log.warning("ESPN injuries fetch failed: %s", exc)
            return []
        return self._parse_injuries(data)

    def fetch_news(self, limit: int = 50) -> list[EspnNewsRow]:
        try:
            resp = requests.get(
                self.NEWS_URL,
                params={"limit": limit},
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            log.warning("ESPN news fetch failed: %s", exc)
            return []
        return self._parse_news(data)

    def sync_all(self) -> EspnSyncResult:
        return EspnSyncResult(
            injuries_synced=len(self.fetch_injuries()),
            news_synced=len(self.fetch_news()),
        )

    @staticmethod
    def _parse_injuries(payload: dict) -> list[EspnInjuryRow]:
        out: list[EspnInjuryRow] = []
        for team_block in payload.get("items", []) or []:
            team_name = team_block.get("team", {}).get("displayName", "")
            for inj in team_block.get("injuries", []) or []:
                athlete = inj.get("athlete", {}) or {}
                status = (inj.get("status") or "").lower()
                severity = (inj.get("type") or {}).get("text", "")
                long_comment = inj.get("longComment", "") or ""
                short_comment = inj.get("shortComment", "") or ""
                updated_str = inj.get("date", "")
                try:
                    updated_at = datetime.fromisoformat(updated_str.replace("Z", "+00:00")) if updated_str else None
                except ValueError:
                    updated_at = None
                out.append(
                    EspnInjuryRow(
                        player_id=str(athlete.get("id", "")),
                        name=athlete.get("displayName", ""),
                        team=team_name,
                        status=status,
                        severity=severity,
                        short_comment=short_comment,
                        long_comment=long_comment,
                        updated_at=updated_at,
                    )
                )
        return out

    @staticmethod
    def _parse_news(payload: dict) -> list[EspnNewsRow]:
        out: list[EspnNewsRow] = []
        for article in payload.get("articles", []) or []:
            published_str = article.get("published", "")
            try:
                published = datetime.fromisoformat(published_str.replace("Z", "+00:00")) if published_str else None
            except ValueError:
                published = None
            out.append(
                EspnNewsRow(
                    player_id=str(article.get("playerId", "") or ""),
                    title=article.get("headline", ""),
                    published=published,
                    link=(article.get("links") or {}).get("web", {}).get("href", ""),
                    raw=article,
                )
            )
        return out


def persist_injuries(slate, rows: Iterable[EspnInjuryRow]) -> int:
    """Insert ESPN injury rows into the database for a slate.

    Returns the number of rows inserted.
    """
    from apps.nba.models import NbaInjuryRow

    inserted = 0
    objs = []
    for r in rows:
        objs.append(
            NbaInjuryRow(
                slate=slate,
                player_id=r.player_id,
                name=r.name,
                team=r.team,
                status=r.status,
                severity=r.severity,
                short_comment=r.short_comment,
                long_comment=r.long_comment,
                updated_at=r.updated_at,
            )
        )
    if objs:
        NbaInjuryRow.objects.bulk_create(objs, ignore_conflicts=True)
        inserted = len(objs)
    return inserted


NFL_SALARY_BANDS: dict[str, dict[str, int]] = {
    "QB": {"rate": 320, "base": 1800, "floor": 4500, "cap": 9500},
    "RB": {"rate": 380, "base": 1400, "floor": 3000, "cap": 9000},
    "FB": {"rate": 380, "base": 1400, "floor": 3000, "cap": 9000},
    "WR": {"rate": 380, "base": 1500, "floor": 3000, "cap": 9000},
    "TE": {"rate": 380, "base": 1100, "floor": 2500, "cap": 6500},
    "DST": {"rate": 420, "base": 700, "floor": 2000, "cap": 4500},
}


def estimate_salary(projection: float, position: str = "", sport: str = "nba") -> int:
    """Estimated salary model consistent with frontend and README documentation.

    Position-aware floors:
    - NFL DST: $2,000 floor (cap $4,500)
    - NFL TE: $2,500 floor (cap $6,500)
    - NFL RB/WR: $3,000 floor (cap $9,000)
    - NFL QB: $4,500 floor (cap $9,500)
    - NBA/General: $3,000 floor, $11,500 cap ($150 * projection + $800, snapped to $100)
    """
    pos = position.upper()
    if sport.lower() == "nfl" and pos in NFL_SALARY_BANDS:
        band = NFL_SALARY_BANDS[pos]
        raw = projection * band["rate"] + band["base"]
        snapped = round(raw / 100) * 100
        return min(band["cap"], max(band["floor"], snapped))

    raw = projection * 150 + 800
    snapped = round(raw / 100) * 100
    return min(11_500, max(3_000, snapped))


def persist_nfl_injuries(slate, rows: Iterable[EspnInjuryRow]) -> int:
    """Insert ESPN injury rows into the database for an NFL slate."""
    from apps.nfl.models import NflInjuryRow

    inserted = 0
    objs = []
    for r in rows:
        objs.append(
            NflInjuryRow(
                slate=slate,
                player_id=r.player_id,
                name=r.name,
                team=r.team,
                status=r.status,
                severity=r.severity,
                short_comment=r.short_comment,
                long_comment=r.long_comment,
                updated_at=r.updated_at,
            )
        )
    if objs:
        NflInjuryRow.objects.bulk_create(objs, ignore_conflicts=True)
        inserted = len(objs)
    return inserted


def persist_nfl_news(slate, rows: Iterable[EspnNewsRow]) -> int:
    """Insert ESPN news rows into the database for an NFL slate."""
    from apps.nfl.models import NflNewsRow

    inserted = 0
    objs = []
    for r in rows:
        objs.append(
            NflNewsRow(
                slate=slate,
                player_id=r.player_id,
                title=r.title,
                published=r.published,
                link=r.link,
                raw_row=r.raw,
            )
        )
    if objs:
        NflNewsRow.objects.bulk_create(objs, ignore_conflicts=True)
        inserted = len(objs)
    return inserted
