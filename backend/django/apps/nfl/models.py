"""NFL models: projection rows, injury rows, news rows, slate players."""
from __future__ import annotations

import uuid

from django.db import models

from apps.common.models import Slate


class NflProjectionRow(models.Model):
    """Historical projections for NFL players."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slate = models.ForeignKey(
        Slate,
        on_delete=models.CASCADE,
        related_name="nfl_projection_rows",
        limit_choices_to={"sport": "nfl"},
        null=True,
        blank=True,
    )
    projection_date = models.DateField()
    player_id = models.CharField(max_length=64)
    name = models.CharField(max_length=128)
    projection = models.FloatField()
    stddev = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["projection_date", "name", "-created_at"]),
        ]


class NflInjuryRow(models.Model):
    """ESPN-synced injuries per slate for NFL."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slate = models.ForeignKey(
        Slate,
        on_delete=models.CASCADE,
        related_name="nfl_injury_rows",
        limit_choices_to={"sport": "nfl"},
        null=True,
        blank=True,
    )
    player_id = models.CharField(max_length=64)
    name = models.CharField(max_length=128)
    team = models.CharField(max_length=8, blank=True, default="")
    status = models.CharField(max_length=64, blank=True, default="")
    severity = models.CharField(max_length=32, blank=True, default="")
    short_comment = models.TextField(blank=True, default="")
    long_comment = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(null=True, blank=True)
    raw_row = models.JSONField(default=dict, blank=True)
    ingested_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["slate", "name"]),
        ]


class NflNewsRow(models.Model):
    """ESPN-synced news per slate for NFL."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slate = models.ForeignKey(
        Slate,
        on_delete=models.CASCADE,
        related_name="nfl_news_rows",
        limit_choices_to={"sport": "nfl"},
        null=True,
        blank=True,
    )
    player_id = models.CharField(max_length=64, blank=True, default="")
    title = models.TextField()
    published = models.DateTimeField(null=True, blank=True)
    link = models.URLField(blank=True, default="")
    raw_row = models.JSONField(default=dict, blank=True)
    ingested_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["slate", "-published"]),
        ]


class NflPlayer(models.Model):
    """A single NFL player from a DraftKings roster (snapshot per slate)."""

    id = models.CharField(max_length=64, primary_key=True)  # DK player ID
    slate = models.ForeignKey(
        Slate,
        on_delete=models.CASCADE,
        related_name="nfl_players",
        limit_choices_to={"sport": "nfl"},
    )
    name = models.CharField(max_length=128)
    salary = models.IntegerField()
    projection = models.FloatField(default=0.0)
    user_projection = models.FloatField(null=True, blank=True)

    team = models.CharField(max_length=8, blank=True, default="")
    opponent = models.CharField(max_length=8, blank=True, default="")
    game_info = models.CharField(max_length=64, blank=True, default="")
    game_time = models.DateTimeField(null=True, blank=True)

    positions = models.JSONField(default=list, blank=True)
    roster_positions = models.JSONField(default=list, blank=True)
    correlation_group = models.CharField(max_length=64, blank=True, default="")

    projected_ownership = models.FloatField(default=0.0)
    max_ownership = models.FloatField(default=100.0)
    min_exposure = models.FloatField(default=0.0)
    max_exposure = models.FloatField(default=100.0)
    stddev = models.FloatField(null=True, blank=True)

    is_locked = models.BooleanField(default=False)
    is_excluded = models.BooleanField(default=False)
    is_liked = models.BooleanField(default=False)

    injury_status = models.CharField(max_length=32, blank=True, default="")
    injury_severity = models.CharField(max_length=32, blank=True, default="")
    injury_short_comment = models.TextField(blank=True, default="")
    injury_long_comment = models.TextField(blank=True, default="")

    photo_url = models.URLField(max_length=512, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["slate", "salary"]),
            models.Index(fields=["slate", "name"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.team}) — ${self.salary}"
