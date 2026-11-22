# Live DraftKings slate — the optimizer runs on the real board

Date: 2026-11-22
Deployed: `https://9065d39b.mavis-fantasy-grinder.pages.dev` (project `mavis-fantasy-grinder`, branch `main`); edge Worker `a153160d-f11c-446e-9b18-f17ead1d3f2b` (`mavis-fantasy-grinder-api.ebridavid.workers.dev`).

## Symptom

The optimizer ran against a hardcoded `[SAMPLE]` roster with no salaries and no DraftKings projections. A user could not build a real lineup, and the screen did not say that the pool it was offering was a sample.

## Cause

The Worker had no route to DraftKings' live data: the only DK endpoint the server could reach was refused. DraftKings' lobby and draft-group APIs return `access-control-allow-origin: *` on GET and OPTIONS, so the browser can read them directly — the live slate has to be fetched **client-side**, and the pool posted to the existing optimize endpoint.

## Change

- `frontend/react/src/lib/dk-live.ts` — new: fetches the live lobby, picks the fullest board among the boards sharing the earliest start, reads the draft group, maps DraftKings roster slots to positions, reads the fantasy-points-per-game stat id from DraftKings' own `draftStats` (never hard-coded: 90 for NFL and 219 for NBA were both observed live), and returns real salaries and projections with an honest source label.
- `frontend/react/src/lib/dk-live.test.ts` — new: 11 tests over the parsing, the board selection, the slot mapping and the stat-id lookup.
- `frontend/react/src/store.ts` — the pool loads live first and falls back to the sample with the label that says which one it is.
- `frontend/react/src/pages/SportOptimizerScreen.tsx` — shows the live slate's board, game count and roster counts, and warns on a multi-day board.
- `frontend/react/src/lib/mavis-api.ts`, `run-optimizer.ts`, `projection-source.ts`, `data-provenance.ts`, `components/DataDisclosure.tsx` — the live pool is posted to `/api/optimize/`, and the source shown on screen matches the pool actually used.
- `backend/django/worker/mavis-dk-live.mjs` — new: the same fetch for the Worker, kept as a fallback.
- `backend/django/worker/mavis-edge-api.mjs` — the Worker routes and the debug route removal.

## After

| | before | after |
|---|---|---|
| pool the optimizer receives | hardcoded `[SAMPLE]` roster, no salaries | the live DraftKings board: 12 games, 630 players, 492 with DK projections, 356 eligible |
| on-screen source label | none | "Live DraftKings slate · Sun-Mon board · 12 games · real DraftKings salaries and projections" |
| optimize call | sample pool | live pool posted to `/api/optimize/` → HTTP 200, top score 152.8, total salary $50,000, 8 games |
| salary | none | real DraftKings salary, per player |
| projection | none | DraftKings' own projection where published (492 of 630 players); 138 players carry no DK projection and are marked as such, not given an invented one |
| out-of-game positions | — | 85 OUT/IR are marked out and excluded from lineups |
| board selection | — | the fullest board among those sharing the earliest start, with DraftKings' own board name shown; a multi-day board raises an explicit warning |

Limits, stated plainly:

- **The browser is the live path.** DraftKings' API host refuses Cloudflare Workers (HTTP 403 from datacenter egress), so `mavis-dk-live.mjs` cannot run in production today. It is kept as a fallback, not as the mechanism.
- **MMA and golf have no live Classic DraftKings slate today.** Those sports fall back to the sample, which is labelled a sample, carries no salary, and therefore produces no lineups. NFL and NBA do.
- Sample data is never presented as a DraftKings slate. Only genuine live DraftKings data carries that label.

Verification: browser — the live slate rendered with its board name, game list and roster counts; server-side end-to-end script `dev/mavis-live-e2e-verify.mjs` — slate 156776, 630 players, 492 with DK projections, 356 eligible, `POST /api/optimize/` → 200, top_score 152.8, total_salary $50,000, 8 games; frontend build clean; **86/86** tests pass, including the 11 new live-slate tests.

**These changes are committed with this record. The verification above was run on this exact tree.**
