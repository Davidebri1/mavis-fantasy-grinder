# Categorical evaluation: the method rebuilt around categories instead of verdicts

Date: 2026-11-26
Deployed: none. Analysis, charts and documentation only. The engine (`frontend/react/src/lib/dave-projection.ts`) was rewritten, but it is not wired into the live app UI, so no product code path changed and nothing was deployed.

## Symptom

The evaluation was built on the wrong frame. The owner's 2026-11-26 correction names four faults and one authorisation.

- **It accepted and rejected things it was only supposed to categorise.** Factors and clusters were judged. Sameness - are the two halves one population or two - is the only thing that can be accepted or rejected. A factor is a category; a cluster that passes or fails a normality test is not a result at all.
- **A coefficient was printed as a variable.** The engine carried a coefficient and the write-up surfaced it as a headline label. A coefficient is immaterial to the conclusion.
- **A p-value sat next to a median hit rate.** They measure different things and have no business in the same cell.
- **The engine's formulas did not match the method document.** The projection targeted the half's raw mean rather than the category's mean, the call named a side rather than a category, outliers were found by peeling rather than by the hump rule, and clusters that failed normality were excluded from the analysis.
- **The authorisation:** "if the formulas are not correct to what i asked for, fix them."
- **Five figures in the new document were wrong**, and a purpose-built verifier found them. A share was printed one decimal too high (65.4% for 65.3%). A reference mean was printed one decimal too high (50.9% for 50.8%). The worked example's factor row mixed units (`opponent (70 rows)` beside `restDays (19)`). The same example listed four of the five opponent conditions the engine had actually discovered, and two of the three regime-shift thresholds. The Wilcoxon p-value was computed from per-player differences that had been rounded to four decimals, so differences that were genuinely distinct looked tied.
## Cause

Five causes, all of them in how the work was framed rather than in the arithmetic.

1. **The evaluation was written as a verdict machine.** It inherited the framing of the 2026-11-22 control-limit rebuild, where every measure had to pass or fail a test to be reported. That framing produces accept/reject language for things the method never asks to be judged, and it turns a still-bimodal cluster into a rejection rather than a fact about that player.
2. **The engine had been optimised for a different question.** The old engine projected the half's raw mean and called a side, so it could not name a category, and it found outliers by peeling the extremes off a half rather than by reading humps off the histogram. His method says the opposite on all three points, and says it in his document.
3. **The output shape carried a coefficient.** `p` was a field on the projection, so it could be printed as a label. It is now a p-value attached to a named comparison - the sameness test - and it is never a result on its own.
4. **The write-up put significance next to rates.** The p-value and the median hit rate shared a table row, which implied they were about the same thing. They are not: one is evidence that a difference is not zero, the other is a rate.
5. **The legacy analysis scripts were left pointing at the CSV.** They read the old 35-column format. Left alone they would have read the new 38-column CSV and produced garbage or crashed, with nothing to say so.
6. **The statistics were stored rounded to four decimals and then rendered to one.** A mean of 0.5085 is 50.85%, which is exactly on the rounding boundary, so it could be printed as either 50.8% or 50.9% depending on which side the stored value fell. The same applied to the share of rows below 0.05. The stored values now carry six decimals, so the printed percentages are unambiguous, and the Wilcoxon no longer sees artificial ties.
## Change

| file | what changed |
|---|---|
| `frontend/react/src/lib/dave-projection.ts` | rewritten. The call names a category (`high`, `high-normal`, `high-outlier`, `low`, `low-normal`, `low-outlier`, `even`); the projection targets that category's mean; outliers come from the hump rule; the normality gate is gone and the shape is reported as a property; `p`, `peeled` and `normality` are removed and `categories[]`, `separated[]`, `cut`, `factorCondition` and the Welch p-value on the sameness test are added |
| `frontend/react/scripts/dave-port.mjs` | recompiled from the engine with `tsc`, with the regeneration command in its header. It is a copy, not a hand-written mirror |
| `frontend/react/src/lib/dave-projection.test.ts`, `frontend/react/scripts/dave-port.test.mjs` | rewritten: 25 tests and 10 tests, both suites green |
| `frontend/react/scripts/mavis-projection-evaluation.mjs` | rewritten. 38 columns, including `actual_category`, `outcome_class`, `model_call`, `model_largest_category`, `model_categories`, `model_same_means_p` and `model_factor_p`. The `cut` column now carries the category boundary, so any row's categorisation can be re-checked from the columns alone. A defect found and fixed in the process: the prose claimed a factor held on rows where it did not, because the harness stored only whether the state was determinate and discarded the state itself |
| `frontend/react/scripts/mavis-categorical-evaluation.mjs` | new. One population per player, Dave's one metric, the no-skill reference, the round-2 walk-forward offset, the sign test, the Wilcoxon signed-rank, the factor census, the sameness census |
| `frontend/react/scripts/mavis-categorical-charts.mjs`, `frontend/react/scripts/mavis-render-categorical-shots.cjs` | new. Two SVG charts and their PNG renders |
| `dev/mavis-definition-parity.mjs`, `dev/mavis-categorical-verification.mjs` | new. The first diffs the comment block, the `DEFINITIONS` object and the JSON's definitions (20 definitions, word for word). The second checks every figure in the new document against the generated data |
| 13 legacy scripts in `frontend/react/scripts/` | banner-marked SUPERSEDED 2026-11-26 and pinned to the preserved pre-correction CSV (`MAVIS_PRE_CSV`, `MAVIS_PRE_JSON`), so they still run against the data they were written for and cannot silently read the new format |
| `docs/mavis-categorical-evaluation.md` | new. The current evaluation |
| `docs/mavis-player-scoped-evaluation.md` | a supersede pointer at the top. Nothing below it was rewritten |
| `dev/mavis-categorical-verification.mjs` | new, and run. 129 checks: every figure in the evaluation document is looked up in the generated data and compared, plus the document's structural rules - no coefficient printed as a variable, no p-value number in any section that carries a rate, no legacy token, the reference not a flat 50%, the charts present, the QA record and the supersede pointer in place. It fails loudly and names the figure it expected |
| `frontend/react/scripts/mavis-categorical-evaluation.mjs` | the stored statistics now carry six decimals instead of four, so a printed percentage is never decided by a rounding boundary and the Wilcoxon is not run on artificially tied differences |
| `docs/mavis-categorical-evaluation.md` | five figures corrected by the verifier: the separated-population share, the 159-player reference in both places it appears, the worked example's factor row, the worked example's condition list, and the Wilcoxon p-value and z-scores |
## After

| | before | after |
|---|---|---|
| the call | a side, `high` or `low` | a category: `high`, `high-normal`, `high-outlier`, `low`, `low-normal`, `low-outlier`, `even` |
| the projection target | the half's raw mean | the category's mean, so a boom is reachable |
| outliers | peeled off a half | read off the histogram as humps |
| normality | a gate; clusters that failed were excluded | a reported property; nothing is excluded |
| the coefficient | carried as `p` and printed as a label | gone; a p-value belongs to a named comparison |
| significance | printed beside the median hit rate | its own section, at the end, with no rate near it |
| factors | accepted or rejected | categorised: the condition that threads the separated population, with every candidate reported |
| the result | a verdict | truths: categories, boundaries, means, factors, one metric |
| the reference | a flat 50% in places | each player's own no-skill rate - always name his biggest category |
| players | 186 with 30 or more games | 1,227 scoreable, with 1,304 more stated as a fact rather than dropped |
| the charts | control limits and band accuracy | each player's own histogram with his boundaries and means, and the one metric against his own reference |
| the stored statistics | rounded to 4 decimals | 6 decimals, so no printed figure sits on a rounding boundary |
| the separated-population share | 65.4% | 65.3% - 2,885 of 4,415 is 65.345% |
| the 159-player reference | 50.9% | 50.8% - the mean is 50.845% |
| the worked example's factors | `opponent (70 rows), restDays (19), regimeShifts (3), isHome (2)` | every factor carries the same unit |
| the worked example's conditions | four opponent conditions, one regime-shift threshold, an abbreviated ladder | all five opponent conditions, all three regime-shift thresholds, and the ladder from `restDays < 22.40` down to `restDays < 17.77` |
| the Wilcoxon | p = 1.82e-5 on differences rounded to 4 dp | p = 1.41e-5 on the differences themselves |
Verification run on this tree: the engine's two suites pass (25/25 and 10/10, vitest v1.6.1); the definition parity check passes (20 definitions match word for word); the rebuild ran 25,162 rows over 1,541 ESPN events with 2,073 requests and 0 failures; the actuals check compared 25,104 rows against the preserved pre-correction run with 0 differing and 58 new (three more completed games, four more players, no actual changed); the categorical analysis reproduces the CSV's own largest-category column on every scored row (0 disagreements, and 7 rows where the printed rounded ranges put the actual in a different category than the full-precision ranges did); both SVGs parse as well-formed XML with 0 text nodes overflowing the canvas and 0 text nodes carrying a p-value number, and both PNGs were measured pixel by pixel at their exact canvas size; and `dev/mavis-categorical-verification.mjs` ran 129 checks over the new document and failed 0.

**Status: the engine's formulas now match `docs/DFS Projection Model.md`, the evaluation reports categories, factors and means instead of verdicts, significance stands in its own section, no coefficient is carried, and every figure in the new document is checked against the generated data by a verifier that runs and fails loudly. The engine is not wired into the live app, and the data gaps - age, injury, cast, contract year, minutes, defensive rankings - are listed rather than filled.**
