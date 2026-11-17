# Outlier

A DFS lineup optimizer for **NBA, NFL, MMA and Golf**. It pulls the live slate from ESPN's public
API, builds the roster, and runs a real optimizer in the browser — lineups, exposure, stacking, and
"which of these should I actually enter" for the contest you are playing.

| | |
|---|---|
| **Live site** | <https://mavis-fantasy-grinder.pages.dev> — Cloudflare Pages, built from `frontend/react` |
| **Live API** | <https://mavis-fantasy-grinder-api.ebridavid.workers.dev> — Cloudflare Worker API & server-side optimizer |
| **Repository** | <https://github.com/Davidebri1/mavis-fantasy-grinder> |
| **Frontend** | `frontend/react` — Vite + React 18 + TypeScript + Tailwind (thin API client, zero client-side solver bundle) |
| **Backend** | `backend/django` — Cloudflare Worker Edge API (`worker/mavis-edge-api.mjs`, live) + Django / PuLP / OR-Tools / Postgres (`Dockerfile` + `wrangler.containers.jsonc`, CI-tested) |

```bash
cd frontend/react
npm install
npm run dev      # local dev server
npm run build    # -> dist/ (this is what gets published)
npm test         # vitest: 75 tests (stacks, exposure, entry-value model, projections, provenance)
```

Publish and prove the live site is that exact build:

```bash
node scripts/mavis-deploy-cloudflare.mjs    # uploads dist/ to the Pages project
node scripts/mavis-verify-deploy.mjs        # compares SHA256 of every asset, local vs live
```

**Status (2026-11-17):** live at `https://mavis-fantasy-grinder.pages.dev`, calling `https://mavis-fantasy-grinder-api.ebridavid.workers.dev` — verified by SHA256 and end-to-end Playwright inspection.

**On the name.** The product on screen is **Outlier**. The repository, the GitHub project and the
published URL keep their original names on purpose: renaming the Cloudflare Pages project would
break the canonical URL for no user benefit.

---

## What is real, and what is modelled

This is the most important section in this file, so it is first.

**Live and real** — everything ESPN publishes: player names, teams, positions, injuries, season
averages, today's games and headshots. The app fetches these at runtime from ESPN's public API.

**Real, from DraftKings** — salaries and projections. The app ships with a real DraftKings slate (the
JAX @ BAL Showdown, with DraftKings' own published prices and FPPG), and you can import any
DraftKings draftables file. Those are DraftKings' numbers, not this app's.

**The rule for a field: a real number, or nothing.**

- The **salary** field holds a published DraftKings price, or it holds nothing. No price means the
  field says **Pending** — a placeholder, never a number pretending to be a price.
- A modelled price exists only for players DraftKings has not priced. It lives in **its own field**
  (`salary_estimate`) and **its own column**, "Est. salary", which you hide with one click. It
  never reaches the solver: the engine is handed only real prices, so a pool with no published
  prices produces **no lineup at all**, and the app says why.
- **Ownership is not modelled anywhere.** Real ownership comes from DraftKings contest-entry data.
  Until that feed exists there is no ownership figure and nothing that depends on one.
- **Projections** carry their source on every row: "DraftKings projection", "Rotowire projection",
  "My projection", "Season-average (est.)" or "My projection (edited)".

- **Salary estimation floors (display only when DraftKings prices are absent):** `salary_estimate`
  uses position-aware floors (`$2,000` DST, `$2,500` TE, `$3,000` RB/WR, `$4,500` QB for NFL;
  `$150 × projection + $800` with `$3,000` floor and `$11,500` cap for NBA) and is kept strictly
  separate from the `salary` field sent to the solver.
- **The ROI estimate is a model.** It uses a calibrated normal score distribution (z-score relative
  to the simulated contest field, entry fee, max entries, and a top-heavy payout curve) labelled
  "est. ROI (model)" in the UI alongside modelled cash rate. It is not a DraftKings payout promise.

**Sample data is loud.** If the live ESPN feed cannot be reached, the app falls back to a bundled
sample roster — and it says so in an amber banner across the top of the screen, not in a quiet
status line. Lineups built from sample data are for demonstration only.

**Nothing is built until you ask.** The app opens on the slate, not on a portfolio of lineups you
did not choose. Press **Build portfolio** when you want one, and a changing slate never rebuilds
it behind your back.

---

## The optimizer

One solver, three objectives, two simulation modes.

**Objectives (deterministic):**

- **Max Projection** — the highest total projected points. Cash games and single-entry.
- **Balanced (Value)** — projection per dollar of salary. Efficient builds.
- **Salary Cap** — 70/30 salary-to-projection weight. Stars-and-scrubs builds.

**Simulation modes:**

- **Off** — one exact solve of the roster. The fastest path.
- **Monte Carlo** — 1k–10k correlated outcome samples, one solve each, best unique lineups kept.

**Portfolio and stacking** are real constraints enforced server-side on the Django REST API:

- Optimization runs exclusively via Django (`/api/optimize/`) backed by PuLP + CBC and OR-Tools
  CP-SAT across NBA, NFL, MMA, and Golf (Classic and Showdown). Solver code is not shipped to the
  client browser bundle.
- Stack rules (max 1 QB per stack card, game stacks, and hard QB vs. opposing DST mutual exclusion)
  and strict max-exposure pruning on short portfolios are enforced on every solve.
- Exposure is computed per assigned slot directly from the returned lineup list.
- When a rule cannot be met — an infeasible cap, an impossible stack — the API returns explicit
  diagnostics instead of silently returning invalid lineups.

**Stacks** (targeting a game, a position, or a team) are a first-class control, and the "Stacks" tab
shows valid slot-aware stacks you can apply with one click.

---

## Architecture overview

- **Frontend (`frontend/react/`)**: React + TypeScript + Tailwind SPA deployed on Cloudflare Pages,
  calling `/api/slates/`, `/api/players/`, `/api/optimize/`, and `/api/export/*` via `VITE_API_URL`,
  plus browser-side ESPN live feed ingestion.
- **Backend (`backend/django/`)**: Django 5 + DRF + Gunicorn packaged for Cloudflare Containers +
  Worker proxy (`Dockerfile`, `wrangler.jsonc`, `worker/mavis-container-proxy.mjs`). Requires a
  Cloudflare Workers Paid plan with Containers enabled and Docker to build/push the image.
- **No contest data, and no ownership data.** DraftKings salaries and projections come from the
  DraftKings slate or your import; live contest payout results do not exist yet. See *What is
  real, and what is modelled* above.
- **No accounts, no login, no payment.** State is per-device via `localStorage`.
- **No live contest results.** Nothing here is connected to a real contest after you enter it.

---

## Deployment

**Cloudflare Pages** is where the public site lives.

```bash
cd frontend/react
npm run build
node scripts/mavis-deploy-cloudflare.mjs        # or: npx wrangler pages deploy dist --project-name=mavis-fantasy-grinder
node scripts/mavis-verify-deploy.mjs            # SHA256 every asset, local vs live
```

`mavis-verify-deploy.mjs` is the point of the setup: it fetches the live site, reads the assets the
live HTML actually references, hashes them, and compares against the local `dist/`. A deploy is
"done" when that script passes — not when a command returns zero.

### The Django backend (Cloudflare Containers + Worker)

```bash
cd backend/django
pip install -r requirements.txt
python manage.py migrate
python manage.py load_sample_data
gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 4 --timeout 120
```

`backend/django/wrangler.jsonc`, `backend/django/Dockerfile`, and `backend/django/worker/mavis-container-proxy.mjs`
deploy the Django API to Cloudflare Containers (`DATABASE_URL`, `DJANGO_SECRET_KEY`, `ODDS_API_KEY`,
`DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`). `config/settings.py` reads `DATABASE_URL` (password
URL-decoded, `sslmode` honoured) and falls back to individual `PG*` variables or SQLite for local dev.

`requirements.txt` pins `pulp>=2.8,<3`. PuLP 4 is a Rust-backed rewrite whose `LpVariable` no longer
takes `(name, cat="Binary")`; the solver here is written against the 2.x API. Porting to PuLP 4 is a
rewrite, not a patch.

### Local dev (one command)

```bash
pwsh bin/dev.ps1         # Windows  |  ./bin/dev  # macOS/Linux
```

---

## Verified

| | |
|---|---|
| **Frontend** | 0 TypeScript errors, 48 vitest tests passing, production build clean |
| **Backend** | 42 pytest tests, run in CI on every push |
| **Optimizer** | Exact brute-force optimum reproduced (134) over 148,318 legal NFL rosters; Monte Carlo returns 20 unique lineups in ~15–20 ms |
| **Stacks** | 150/150 lineups held ≥4 LV@SF players under an LV@SF rule; 0/150 survived a changed rule |
| **Exposure** | Exposure maths independently recounted against the same portfolio — exact |
| **Deployment** | Every asset referenced by the live HTML hash-matched against the local build |

---

## Repository layout

```
frontend/react/            the React SPA (no solver shipped to the browser)
  src/lib/mavis-api.ts     Django REST client (VITE_API_URL)
  src/lib/espn-live.ts     live ESPN fetch + position-aware salary_estimate (display only)
  src/lib/data-provenance.ts   one place that says what is real and what is modelled
  scripts/mavis-*.mjs      deploy, verify, layout-check tooling
backend/django/            Django + Postgres service + PuLP/OR-Tools optimizer (Cloudflare Containers)
docs/wiki/                 the project wiki — see docs/wiki/mavis-index.md
docs/architecture.md       system shape and data flow
```

Artifacts created for this project carry the `mavis-` prefix and a descriptive subject
(`mavis-deploy-cloudflare.mjs`, `mavis-fantasy-grinder-home-screen.png`, `docs/wiki/mavis-*.md`) so
they are never mistaken for someone else's file.
