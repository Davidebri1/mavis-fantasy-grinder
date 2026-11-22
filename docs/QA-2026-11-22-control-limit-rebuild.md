# Control-limit rebuild — the model measured on R, boom and bust as outliers

Date: 2026-11-22
Deployed: none. Analysis, charts and documentation only — no product code path changed, and the engine (`frontend/react/src/lib/dave-projection.ts`) was not touched.

## Symptom

The projection evaluation measured the model against a plain prior-games average by **categorizing** every game against the median split C and reporting agreement rates. That is not the yardstick the method is built on. The engine's own output is a **control-limit band** — lower limit, upper limit, and R, the range between them — and in the owner's terms a **boom** is an outlier high, a **bust** an outlier low, and the deliverable is **predictability**: how close the number landed, and whether the call pointed at the right control limit.

Under the old framing the document reported a dead heat — "both sides carry roughly +3.5 to +4 points of agreement above what an uninformed predictor scores", McNemar χ²(1) = 0.11, p = 0.74. That reading does not survive the yardstick the method defines. Re-run on the band's own terms, the verdict changes and it changes against the model.

Three defects were found while rebuilding, and all three were in the artifact, not in the engine:

1. the per-game CSV could not reproduce its own verdicts;
2. floating-point noise turned the even-split floor into directional calls;
3. the coverage block in the significance output reported the wrong counts.

## Cause

**1 — The wrong yardstick.** Agreement against a median split C asks "did the call land on the same side of the owner's median as the actual did". R asks "how far, in the player's own control-limit units, did the number land, and did it point at the right limit". The two can disagree, and here they do.

**2 — The CSV stored 2-decimal values while the verdicts were computed at full precision.** Recomputing containment from the CSV's own columns gave **10,298** against the **10,295** the verdict column stored — the artifact could not reproduce its own labels. Every verdict-bearing number is now written at 12 decimal places, and the direction verdicts are stored as columns (`model_direction`, `baseline_direction`) rather than only inside the justification sentence.

**3 — The midpoint test had no tolerance.** Direction is read off the band position: above 0.5 points up, below 0.5 points down. The even-split floor and the equal-sized-halves raw average both sit exactly on the midpoint, and `((high + low) / 2 − low) / (high − low)` lands a hair either side of 0.5 in floating point. Without a tolerance the floor produced directional calls out of arithmetic noise: the model read as **9,469 up / 6,479 down / 1,645 no call** instead of **7,997 / 5,042 / 4,554**. The midpoint now carries a published tolerance of 1e-9, and a projection within it makes no call.

**4 — Limit ties were decided by floating-point noise.** Four evaluations whose actual sat within 1e-9 of a control limit — ReShard Lee 2006-10-29 (being read as a bust), Jason Witten 2017-10-22 (boom), Blake Bell 2020-11-08 (bust) and one more — were classified by the noise rather than by the rule. The rule is now published: a landing within 1e-9 of a limit is **inside the band**. 68 evaluations land exactly on a limit and all 68 are inside the band.

**5 — The significance output's coverage block was wired to the wrong fields.** It reported `gamesOfRecord: 20120` and `noControlLimitsYet` pointing at the first-games count. Corrected to **25,104 games of record / 22,577 evaluations / 4,984 with no control limits yet**, with a separate `evaluationsWithoutControlLimits` counter.

**6 — The containment scope included zero-width bands.** Two evaluations have R = 0 (Rashard Higgins 2017-12-31 and Malik Heath 2023-11-19, both at 4 earlier games) and cannot be placed in a band at all. The scored population is therefore **17,593**, not 17,595; both rows stay in the CSV, recorded and unscored.

**7 — Two chart bugs.** The SVG entity escaper was a no-op, so any label containing an ampersand emitted a bare `&` and broke the XML; and the `seg()` helper emitted `stroke-width="1""/>` on every line. Both are fixed — the escaper builds its entities at runtime, and the line markup closes correctly.

**8 — The old significance script became dead code.** `mavis-evaluation-significance.mjs` reads columns the rebuilt CSV no longer has (`actual_category`, `model_agrees`, `baseline_category`, `baseline_agrees`). Its method — each side's own no-skill reference, z-test, permutation test, McNemar — was carried into the new `mavis-control-limit-significance.mjs`, and the dead script was removed.

## Change

- `frontend/react/scripts/mavis-projection-evaluation.mjs` — rewritten harness: the control-limit band, R, band position, direction, outcome class and containment are computed here; `round12` on every verdict-bearing number; `MIDPOINT_EPS = 1e-9` with `snapMidpoint()` and `directionOf()`; `LIMIT_EPS = 1e-9` with `outcomeClassOf()` and `containedOf()`; stored `model_direction` and `baseline_direction` columns.
- `frontend/react/scripts/mavis-control-limit-evaluation.mjs` — new: the band, R, predictability, direction, diagnostics, eras, positions and the player tables; writes `.tmp-audit/projection-control-limits.json`.
- `frontend/react/scripts/mavis-control-limit-significance.mjs` — new: the no-skill references, z-tests, permutation tests, the paired model-vs-average tests, the factor test and containment; writes `.tmp-audit/projection-control-limit-significance.json`. Its coverage block is corrected and counts `evaluationsWithoutControlLimits` separately.
- `frontend/react/scripts/mavis-evaluation-charts.mjs` — rewritten for the new JSON; imports `projectDave` from `dave-port.mjs` so every histogram carries the engine's own control limits. Writes 11 charts.
- `frontend/react/scripts/mavis-evaluation-significance.mjs` — **deleted** (dead code against the rebuilt CSV).
- `dev/mavis-csv-self-consistency.mjs` — new: recomputes every stored verdict from the CSV's own numeric columns and exits 1 on any mismatch.
- `dev/mavis-verify-from-csv.mjs` — new: an independent second implementation that reproduces the headline numbers from the CSV alone.
- `dev/mavis-svg-xml-check.py` — new: parses every SVG in `docs/shots/` and reports OK or FAIL.
- `dev/mavis-limit-tie-rows.mjs` — new: counts the ties and the zero-width bands.
- `dev/mavis-doc-facts.mjs`, `dev/mavis-doc-facts-print.mjs`, `dev/mavis-doc-sample.mjs`, `dev/mavis-harness-coverage.mjs` — new: pull the quoted facts out of the JSONs and the CSV so the document's numbers are extracted, not retyped.
- `docs/mavis-projection-evaluation.md` — fully rewritten in the owner's terminology: the terms defined once, each term inheriting from its parent; the headline table; predictability; direction; factor informativeness; containment; where the edge appears; the charts; a worked CSV example; the caveats; the verdict without spin.
- `docs/shots/mavis-eval-band-accuracy.svg`, `mavis-eval-direction.svg`, `mavis-eval-factor.svg`, `mavis-eval-lift.svg` — new charts.
- `docs/shots/mavis-eval-histogram-*.svg`, `mavis-eval-scatter.svg`, `mavis-eval-timeline.svg` — regenerated for the control-limit JSON.
- `docs/shots/mavis-eval-agreement.svg`, `mavis-eval-gap.svg`, `mavis-eval-agreement-before.svg` — **kept**, labelled superseded. They are the record of the old framing and the image links in the 2026-11-14 QA record stay valid.

## After

| | before (2026-11-14, agreement framing) | after (2026-11-22, control-limit framing) |
|---|---|---|
| yardstick | agreement against the median split C | the control-limit band, measured in R |
| population | 24,981 games, 22,460 evaluations | 25,104 games, 22,577 evaluations, 17,593 scored |
| boom, model vs its own reference | 75.8% vs 72.1% → **+3.70 pts**, z = 8.92 | 46.3% vs 45.5% → **+0.8 pts**, z = 1.04, permutation p = **0.1187 — not significant** |
| boom, plain average vs its own reference | 82.4% vs 79.0% → +3.36 pts, z = 8.92 | 32.3% vs 28.3% → **+4.0 pts**, z = 5.74, p = 0.0001 |
| bust, model vs its own reference | 31.9% vs 27.9% → **+4.01 pts**, z = 9.28 | 31.4% vs 28.7% → **+2.7 pts**, z = 4.24, p = 0.0001 |
| bust, plain average vs its own reference | 24.6% vs 21.0% → +3.63 pts, z = 9.28 | 38.9% vs 36.0% → **+3.0 pts**, z = 4.37, p = 0.0001 |
| how close the number landed | not measured | squared band error **2.00 model vs 1.80 average** (paired t = 11.46, df 17,592, p < 0.0001; sign-flip permutation p = 0.0001); correlation **0.015 vs 0.182** (Fisher z = −15.85, p < 0.0001) |
| is the winning factor informative out of sample | not measured | **+2.5 pts** boom rate (23.9% when the condition holds vs 21.4% when it does not), z = 3.22, p = 0.0013, on 12,515 out-of-sample rows |
| containment in the 90% interval | 71.0% (n = 17,498) | **58.5%** (10,295 / 17,593) against its own 90% nominal, z = −139.19 |
| model vs average on the same rows | McNemar χ²(1) = 0.11, p = 0.74 — indistinguishable | boom: model alone right on 1,194, average alone right on 616, χ²(1) = 184.58; bust: 883 vs 1,259, χ²(1) = 66 — **not the same instrument** |
| verdict | "statistically indistinguishable, both carry ~+3.5 to +4 points of signal" | "the plain prior-games average lands closer than the model, and the model's boom call is not distinguishable from its own no-skill reference" |

Fix-level before/after:

| defect | before | after |
|---|---|---|
| CSV precision | containment recomputed from the CSV: 10,298 vs 10,295 stored | 12-decimal verdicts; recomputed 10,295 = stored 10,295 |
| midpoint tolerance | model 9,469 up / 6,479 down / 1,645 no call | model **7,997 up / 5,042 down / 4,554 no call** |
| limit ties | four rows classified by float noise | 1e-9 published tolerance; a landing within it is inside the band; 68 exact ties all inside |
| coverage block | gamesOfRecord 20,120; noControlLimitsYet pointed at the first-games count | 25,104 / 22,577 / 4,984, with `evaluationsWithoutControlLimits` counted separately |
| containment scope | n = 17,595, including two R = 0 rows | n = **17,593**; both zero-width rows recorded, unscored |
| SVG entity escaper | labels with `&` emitted a bare `&` — XML invalid | entities built at runtime; all 14 SVGs parse |
| SVG line markup | `stroke-width="1""/>` on every line | `stroke-width="1"/>`; all 14 SVGs parse |
| chart pick (middle of the pool) | Jerricho Cotchery | Vernon Davis — the pool grew and the median coefficient of variation moved; the pick is stated in the caption |

Verification run on this tree: CSV self-consistency **0 verdict mismatches** across all 25,104 rows (outcome class, containment, both directions, all three band positions); the independent second implementation reproduces every headline number from the CSV alone; **14/14** SVGs parse as well-formed XML; the harness made 2,068 requests with **0 failures** in 16 s (run stamp `2026-11-22T13:15:16Z`); frontend build clean; **86/86** tests pass.

**These changes are committed with this record. The verification above was run on this exact tree.**
