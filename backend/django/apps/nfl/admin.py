from django.contrib import admin

from .models import NflInjuryRow, NflNewsRow, NflPlayer, NflProjectionRow


@admin.register(NflPlayer)
class NflPlayerAdmin(admin.ModelAdmin):
    list_display = ["name", "team", "salary", "projection", "slate"]
    list_filter = ["team", "slate"]
    search_fields = ["name", "team"]


@admin.register(NflProjectionRow)
class NflProjectionRowAdmin(admin.ModelAdmin):
    list_display = ["name", "projection", "projection_date", "slate"]
    search_fields = ["name"]


@admin.register(NflInjuryRow)
class NflInjuryRowAdmin(admin.ModelAdmin):
    list_display = ["name", "team", "status", "severity", "slate"]
    search_fields = ["name", "team"]


@admin.register(NflNewsRow)
class NflNewsRowAdmin(admin.ModelAdmin):
    list_display = ["title", "published", "slate"]
    search_fields = ["title"]
