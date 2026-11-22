# Render fix — 2000 lineups no longer kill the tab

Date: 2026-11-10
Deployed: `https://mavis-fantasy-grinder.pages.dev` (project `mavis-fantasy-grinder`, branch `main`)

## Symptom

Building 2000 lineups crashed the browser tab. A diagnostic run showed the build taking 36.4 seconds with the DOM growing from 384 nodes to 666,384 nodes and 70,031 image elements; the next build on that page killed the renderer outright.

## Cause

The results list drew every lineup at once. Each lineup draws nine player chips, each with a photo and a crest, so 2000 lineups is a quarter of a million DOM nodes. The optimizer was never the problem — it produces 2000 lineups in roughly 600 ms. The screen was drawing all of it at once.

## Change

Three files:

- `src/pages/SportOptimizerScreen.tsx` — the results list draws 100 lineups at a time, with a "Show 100 more" control and a "Showing 100 of N" count. The portfolio itself is unchanged: every lineup is still built, scored, counted in the stats and written to the export.
- `src/components/RotoLineupCard.tsx` — every card carries `content-visibility: auto`, so a card off the screen costs nothing to lay out.
- `src/components/LineupCountPicker.tsx` — 250, 500, 1000 and 2000 are now one click instead of something you have to type.

## After

| | before | after |
|---|---|---|
| 1000 lineups | 333,384 DOM nodes, 35,031 images, 16.1s | — |
| 2000 lineups | 666,384 DOM nodes, 70,031 images, 36.4s, **tab died** | 32,790 DOM nodes, 3,576 images, 100 cards |
| rebuild on the same page | renderer crash | no crash |
| JS heap after 2000 | — | ~50 MB |

Console errors: 0. Uncaught exceptions: 0. Suite: 90/90. Typecheck: clean. Deploy: 3/3 assets hash-match the local build.

**Changes are not committed.**
