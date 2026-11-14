# Fantasy Grinder — Architecture (React + Django)

Target system shape: React single-page app talking to a Django REST API + Postgres.

> **Current architecture (2026-11-14):** the React SPA on **Cloudflare Pages**
> (<https://mavis-fantasy-grinder.pages.dev>) calls the **Django REST API** configured for
> **Cloudflare Containers + Worker proxy** (`backend/django/wrangler.jsonc`, `Dockerfile`,
> `worker/mavis-container-proxy.mjs`, forwarding to Gunicorn on port `8000`) via `VITE_API_URL`.
> Client-side solver code has been removed from the browser bundle; ESPN live feed ingestion runs
> in the browser while all optimization (`/api/optimize/`), slates/players (`/api/slates/`,
> `/api/players/`), and exports (`/api/export/*`) execute server-side across NBA, NFL, MMA, and Golf.

## Why React (instead of keeping Flutter web)

- The original Flutter web build is static and ships ~36k lines of Dart. Customer wants a JS-native stack so they can hire general frontend devs.
- React gives us a richer ecosystem for grid/table components (TanStack Table), file parsing (SheetJS), and PDF (pdfmake) than Flutter's web canvas.
- Trade-off: losing the native mobile binaries. This delivery is **web-only** (intentional).

## Why Django (instead of keeping Supabase)

- Self-hosted Postgres gives the customer full ownership of slate/projection data with no per-row pricing.
- Django lets us colocate the optimizer compute with the database — important because the optimizer is CPU-bound and can run in the same request or be offloaded without crossing a vendor boundary.
- Trade-off: container cold starts on serverless infrastructure, mitigated by `sleepAfter: "15m"` in Cloudflare Containers + Worker proxy.

## High-level layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Customer browser (Cloudflare Pages)                             │
│  └── React SPA (Vite + TS + Tailwind + shadcn/ui)              │
│      ├── Routes: /, /nba, /nfl, /nba/admin, /mma, /golf        │
│      ├── TanStack Query   → server state                       │
│      ├── Zustand          → local UI state                     │
│      └── TanStack Table   → player pool grids                  │
└─────────────────────────────────────────────────────────────────┘
                │ HTTPS / JSON (VITE_API_URL)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker Proxy + Container (Django REST API)           │
│  ├── Django 5 + Django REST Framework                           │
│  ├── Gunicorn (4 workers, port 8000, timeout 120s)              │
│  ├── Endpoints:                                                 │
│  │    /api/slates/        GET, POST                             │
│  │    /api/players/       GET (sport-keyed)                     │
│  │    /api/import/csv/    POST multipart                        │
│  │    /api/import/excel/  POST multipart                        │
│  │    /api/optimize/      POST (the core endpoint)              │
│  │    /api/export/csv/    POST (returns CSV)                    │
│  │    /api/export/excel/  POST (returns XLSX)                   │
│  │    /api/export/injury-pdf/ GET (NBA injury report PDF)       │
│  │    /api/feed/odds/     POST (The Odds API integration)       │
│  │    /api/feed/espn/     POST (ESPN news/injury sync)          │
│  └── optimizer/                                               │
│       ├── engines/                                              │
│       │    ├── milp_pulp.py   (CBC, parity-default)             │
│       │    └── milp_ortools.py (CP-SAT, speed-opt-in)           │
│       ├── simulation/                                           │
│       │    ├── cholesky.py   (correlated normal sampling)       │
│       │    └── monte_carlo.py                                  │
│       ├── sports/                                               │
│       │    ├── nba.py        (Classic + Showdown)               │
│       │    ├── nfl.py        (Classic + Showdown)               │
│       │    ├── mma.py                                           │
│       │    └── golf.py                                         │
│       └── strategies.py       (5 strategies, pluggable solvers) │
└─────────────────────────────────────────────────────────────────┘
                │ psycopg / Django ORM (DATABASE_URL)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL                                                     │
│  Tables: slates, nba_projection_rows, nfl_projection_rows,      │
│          nfl_injury_rows, nfl_news_rows, mma_projection_rows,   │
│          nba_injury_rows, nba_news_rows, golf_projection_rows,  │
│          optimization_runs, slate_state                         │
└─────────────────────────────────────────────────────────────────┘
```

## Strategy pipeline (preserves the Flutter reference semantics)

The Flutter app uses a two-engine design: `SimulationEngine → MilpSolver`. The Django port
keeps the same shape with **two MILP backends**:

1. **PuLP + CBC** (default): linear programming relaxation, branch-and-bound. Deterministic,
   1:1 parity with the Dart reference for hand-crafted canonical inputs.
2. **OR-Tools CP-SAT** (opt-in via `solver_backend=ortools`): constraint programming solver,
   typically 5–10× faster on real-world slates. May pick a different optimum on tied scores
   (we document this and let the customer choose).

```
client request → validator → strategy.solver_backend → result
                   │
                   ├── MILP (CBC default, CP-SAT opt-in)
                   ├── pre-filter (min proj, excluded, locked)
                   ├── for each strategy:
                   │     MaxProjection / Balanced / SalaryCap → 1 MILP solve + perturbations
                   │     MonteCarlo                         → N Monte Carlo sims → 1 solve each
                   ├── post-filter (NBA only: stacking, bring-back, exposure)
                   └── return top-K lineups
```

## Module boundary rules

- **`optimizer/`** must remain pure-Python with no Django imports so it can be unit-tested
  without a database. It accepts plain dataclasses, not Django models.
- **`apps/*/models.py`** translates between Django models and optimizer dataclasses.
- **`api/`** is the only layer that knows about HTTP. Serializers live next to views.

## Data flow per request

```
POST /api/optimize
  body: { sport, strategy, settings, players, slate_id? }
    ↓
  view.validate(settings)        # budget, contest type, sims
    ↓
  sport_strategy.run(players, settings, solver_backend)
    ↓
  return { lineups, run_metadata }
```

## Environment variables

| Var | Owner | Purpose |
|---|---|---|
| `DATABASE_URL` | Cloudflare Container Secret | Postgres connection string |
| `DJANGO_SECRET_KEY` | Cloudflare Container Secret | Django session signing |
| `DJANGO_DEBUG` | Cloudflare Worker Var | `false` in prod |
| `DJANGO_ALLOWED_HOSTS` | Cloudflare Worker Var | Allowed API/Container hostnames |
| `CORS_ALLOWED_ORIGINS` | Cloudflare Worker Var | Allowed frontend origins (`https://mavis-fantasy-grinder.pages.dev`) |
| `ODDS_API_KEY` | Cloudflare Container Secret | The Odds API |
| `VITE_API_URL` | Frontend build env | Base URL of Django Worker `/api` endpoint |

## Out of v1

- Native mobile binaries
- Real-money contest integration (DraftKings/FanDuel login)
- Multi-tenant accounts / billing
- Re-parsing the ESPN PDF injury report input format (we'll keep generating PDFs, not extending parser)
