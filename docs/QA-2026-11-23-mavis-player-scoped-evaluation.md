# Player-scoped evaluation — the method run as written

Date: 2026-11-23
Deployed: none. Analysis, charts and documentation only — no product code path changed, and the engine (`frontend/react/src/lib/dave-projection.ts`) was not touched.

## Symptom

The projection evaluation was wrong on scope, metric, terminology and significance handling, and it was wrong in the owner's terms rather than in its arithmetic.

- **It mixed populations.** 16,000+ games across all players, all teams, all positions and all eras went into one sample. That is not IID. The average over it is the league's average fantasy score — a variable nobody is after.
- **It measured the wrong thing.** Band error and correlation ask how near the number landed. The method's metric is precision: did this projection equal this actual on this day, reduced to a proportion, with the offset-and-measure calibration loop run again and again.
- **It led with test statistics.** The p-value is the thing, and significance is an early analytical step, not the final validation.
- **It used the wrong words.** A boom is an outlier beyond the upper limit and can never be a small number. The upper cluster is a **high game**. That confusion killed the arithmetic.
- **It reported "+0.8" as a points lift over the high mean.** It was a percentage-point lift in the boom-calling rate.
- **It took thresholds from a control-limit band**, not from each player's own histogram — the humps and the valleys between them — and it never looked for the factor in the multimodal anomalies, which is the population his step 8 describes.

Six defects in the artifact were found while rebuilding, on top of the framing itself.

## Cause

**1 — Pooling instead of one population per player.** Every rate in the old document was a proportion over pooled games. His method defines the population as a single player, so every quantity has to be computed per player and then aggregated as a distribution of per-player proportions. Pooled games and pooled players are two different estimators and the second one is the one the method asks for.

**2 — Closeness instead of precision.** Band error and correlation answer "how near did it land". The metric answers "did it land on the actual's side of the player's own thresholds", which is a classification against a structure derived from that same player's histogram. A predictor that lands in the middle of the band can score well on closeness while being wrong half the time on the metric, and the old document reported the former as the verdict.

**3 — A flat and pooled reference line.** The old document's reference was a pooled control band. A classification task's reference is what the predictor scores with no information about the outcome: for each player, the share of his own games that fall in his majority cluster. Aggregating that per player gives a hard line that differs player by player.

**4 — Test statistics in the headline.** The rebuild reported a paired t of 11.46 and a z of 5.74 where the question was only ever "is this significant". The rebuild now reports p-values, and treats significance as the early analytical step the owner describes.

**5 — "Boom" applied to the upper cluster.** The CSV's label "boom (outlier high)" fires when the actual exceeds the high half's **mean**, which is not an upper limit at all. Under the owner's vocabulary a boom is an outlier beyond the upper limit, and the upper cluster is a high game. Re-reading the old label on the engine's contemporaneous basis, 1,023 of 1,336 old booms (76.6%) are high games, 137 (10.3%) are genuine booms and 176 (13.2%) are ordinary games. The old label's games sit a median 3.25 points above the upper cluster's median; a genuine boom sits a median 15.6 points above it.

**6 — The engine-factor parser swallowed the trailing prose.** `model_factor_condition` holds a full sentence — `opponent=NE (two-sample t-test: t=…, df=…)` — and the parser ran to the end of the string, so every condition failed to parse and the testable population came out at zero. The parser now stops the value at whitespace or an opening parenthesis, and `!=` is handled as an operator.

**7 — Pooling a player's different conditions into one test.** The first version of the factor test combined a player's opponent conditions into a single two-proportion test, which tests a different hypothesis from the one the method asks. Each player-condition pair is now tested separately, which is also the unit the engine applies.

**8 — An arbitrary kurtosis cut.** The gate used a cut of 2, which produced an empty strict population and made the whole result look unmeasurable. The owner's own stated normal reference is 3, so the cut is 3, and the population is now swept across 4 median/mode bands x 5 kurtosis cuts so the sensitivity is on the record rather than hidden in a constant.

**9 — A chart caption that contradicted the computation.** The precision panel said the offset "would be subtracted from every projection". The computation is `proj + off`, and the residual is `actual - projection`, so the offset is **added** and a negative offset means the model projects above the actual. The caption was wrong; it now reads "added", and the charts were regenerated and re-verified.

**10 — A column named like a mean that holds a count.** `peeled_high` is `peeled.filter(...).length` — the number of peeled outliers. It equals `control_high` in 3 of 17,595 rows and the median difference between them (+14.6) is a meaningless number dressed as a points difference. The new evaluation makes no such comparison; the field is recorded here as needing a rename.

**11 — The data does not carry the causes the method names.** The evaluation CSV has opponent, team, date and season. Age, injury status, minutes played, contract year and surrounding cast are absent, and so are the defensive rankings, the sacks leader and the rookie tackle the owner's document lists as examples. The engine's own `isHome` (678 rows), `restDays` (967 rows) and `regimeShifts` (1,251 rows) are not in the CSV either, so those rows apply a factor that cannot be re-evaluated. Step 8 could be executed on four candidate kinds, not on the set the owner named. This is a gap in the data and it is surfaced, not filled.

**12 — The document verifier's own fact list was never defined, and this record quoted a stale count.** The verifier's positive check reads a `required` list of headline facts. When the scan was extended to cover this QA record as well, that list was moved out of scope and the script threw `ReferenceError: required is not defined` before the fact check and the QA scan ever ran — so the evaluation document's own figures were checked, but this record's were not. The list is restored (25 base facts plus 10 derived from the JSON counts, 35 in all), and the verifier now also asserts that the counts this record states about its own run — the distinct numeric tokens checked and the headline facts checked — match the run it just performed, so a stale count cannot ship. It caught exactly that: this record claimed 38 headline facts against a real 35, and was corrected to 35.

## Change

- `frontend/react/scripts/mavis-csv-profile.mjs` — new: profiles the evaluation CSV (rows, players, positions, teams, model paths, factor keys); writes `.tmp-audit/csv-profile.json`.
- `frontend/react/scripts/mavis-player-scoped-evaluation.mjs` — new: the per-player evaluation. One population per player; 1-point histogram with hump detection; thresholds read off the valleys; the owner's gate in his order (median vs mode, then kurtosis against 3); per-cluster validity on the same rule; the one metric against each player's own majority-cluster share; the walk-forward offset calibration; the walk-forward threshold variant; candidate causes with two-proportion z-tests and subset normality verdicts; the gate sweep; writes `.tmp-audit/player-scoped-evaluation.json`.
- `frontend/react/scripts/mavis-player-scoped-audit.mjs` — new: field semantics (what `control_high` and `peeled_high` actually are), the engine's applied factor against the new taxonomy with a measured empirical null, the split population player by player, and four worked examples; writes `.tmp-audit/player-scoped-audit.json`.
- `frontend/react/scripts/mavis-player-scoped-significance.mjs` — new: paired per-player sign test (exact binomial) and Wilcoxon signed-rank (normal approximation, tie correction) for model, baseline, calibrated and walk-forward against each player's own reference; writes `.tmp-audit/player-scoped-significance.json`.
- `frontend/react/scripts/mavis-engine-factor-coverage.mjs` — new: which factors the engine applies and which the CSV can test; writes `.tmp-audit/engine-factor-coverage.json`.
- `frontend/react/scripts/mavis-engine-factor-significance.mjs` — new: the engine's conditions against the measured null rate, with a binomial test.
- `frontend/react/scripts/mavis-boom-semantics.mjs` — new: boom semantics against each player's real upper-cluster mean; writes `.tmp-audit/boom-semantics.json`.
- `frontend/react/scripts/mavis-boom-semantics-walkforward.mjs` — new: boom semantics on the engine's contemporaneous basis, thresholds re-derived from games already seen; writes `.tmp-audit/boom-semantics-walkforward.json`.
- `frontend/react/scripts/mavis-writup-numbers.mjs` — new: the gate reasons, the factor work restricted to the metric population, and the per-player table.
- `frontend/react/scripts/mavis-player-scoped-charts.mjs` — new: the two charts.
- `dev/mavis-player-scoped-doc-facts.mjs` — new: verifies the new document against the generated data. It scans every numeric token in the document and fails if any of them is not backed by a number in the generated JSON or by a quantity the verifier computes from the JSON counts, and it checks a list of headline facts are present verbatim.
- `dev/mavis-player-scoped-svg-check.py` — new: XML parse plus text-node sanity for both SVGs.
- `dev/mavis-player-scoped-pixels.py` — new: pixel measurement of the rendered PNGs (ink coverage, row and column span, bottom-right overflow); writes `.tmp-audit/player-scoped-pixels.json`.
- `docs/mavis-player-scoped-evaluation.md` — new: the evaluation, in the owner's terminology.
- `docs/mavis-projection-evaluation.md` — **marked superseded** with a dated pointer to the new document. Nothing below the pointer has been rewritten.
- `docs/shots/mavis-player-scoped-histograms.svg` / `.png` — new: 24 panels of the 33 split players' own histograms.
- `docs/shots/mavis-player-scoped-hit-rates.svg` / `.png` — new: the one metric per player against the no-skill rate, and the precision panel.

## After

| | before (2026-11-22, control-limit framing) | after (2026-11-23, per-player framing) |
|---|---|---|
| population | 25,104 games pooled across all players, teams, positions and eras | **186 players as 186 populations** — 10,961 games, 10,217 evaluations; nothing pooled |
| metric | squared band error and correlation | **one metric**: the projection lands in the actual's cluster, as a proportion per player |
| reference line | the pooled control band | **each player's own majority-cluster share** — 0.679 median on the metric population; never a flat 50% |
| significance | test statistics in the headline (paired t = 11.46, z = 5.74) | **p-values only**: sign test 0.0001, Wilcoxon 0.0002 for the model against its own reference |
| the headline verdict | "the model's boom edge is not significant (+0.8 pts), the plain average's is" | "the model's median hit rate is 0.500 against its own reference 0.679 and a plain average 0.655; it beats its reference on 4 players of 30 and falls below it on 25" |
| boom | actual above the high half's mean (4,133 rows) | **boom = beyond the upper limit**: 137 of 1,336 old-boom rows (10.3%); 1,023 (76.6%) were high games |
| boom size | "+0.8 pts" read as a points lift | a percentage-point lift in the boom-calling rate; the old label's games sit a median 3.25 points above the upper cluster's median, a genuine boom 15.6 |
| thresholds | the median split and its control-limit band | **the player's own histogram**: humps detected, thresholds read off the valleys, each cluster tested for normality in isolation |
| the factor | best abs(t) over every factor key, abs(t) floor 2.0, no multiplicity control | tested against a measured null: **16 of 177 clear p<0.05 against 5.8%** (binomial one-sided p = **0.0510**) — not distinguishable from chance |
| the factor's source | the kept high and low halves | **the peeled multimodal anomalies**, which is what the owner's step 8 describes — the engine computes the peeled set and never uses it for discovery |
| the P=1 projection | read as "on the upper control limit" | read as **the high half's mean**: median -6.047 from the upper cluster's mean, so a boom is unreachable by construction |
| the strict population | empty under an arbitrary kurtosis cut of 2 | **33 split / 30 usable-category players** at the owner's own reference of 3, with the 4x5 sweep on the record |

Fix-level before/after:

| defect | before | after |
|---|---|---|
| pooled population | one sample across all players | one population per player; rates aggregated as a distribution of per-player proportions |
| metric | band error + correlation | same-cluster hit rate per player |
| reference | pooled control band | each player's own majority-cluster share |
| engine-factor parser | ran to the end of the condition sentence, so **0** conditions parsed | stops at whitespace or "(", handles "!="; **177** testable player-condition pairs |
| factor test | one test pooling a player's different conditions | one test per player-condition pair |
| kurtosis cut | 2, arbitrary | 3, his own stated reference, with a 4x5 sensitivity sweep |
| chart caption | "the offset that would be subtracted from every projection" | "the offset **added** to every projection (negative = the model projects above the actual)" — caption fixed, charts regenerated and re-verified |
| `peeled_high` | treated as a mean somewhere it was compared as one | recorded as a **count**; no comparison of a projection against it is made anywhere in the new document |
| "boom" | the upper cluster | the upper cluster is a **high game**; a boom is beyond the upper limit |
| "+0.8" | a points lift over the high mean | a percentage-point lift in the boom-calling rate, stated as such |
| document verification | figures retyped by hand | every numeric token in the document checked against the generated JSON by `dev/mavis-player-scoped-doc-facts.mjs` |
| the verifier's own fact list | undefined — the script threw before the fact check and the QA scan ever ran | 25 base facts plus 10 derived, 35 in all; the verifier also asserts this record's own token and fact counts against the run it just performed, which caught the stale 38 |

**The engine was not modified by this work.** The four departures between the engine and `docs/DFS Projection Model.md` are reported in the new document with evidence, not fixed: the P=1 target is the high half's mean rather than the high cluster's mean; the factor is derived from the halves rather than from the peeled anomalies; the document's formula is additive while the engine's is a weighted blend (a spec question inside the owner's own document, needing his ruling); and the probability weighting is computed but never applied.

Verification run on this tree: the document verifier passes — **426 distinct numeric tokens checked, none unbacked**, and all 35 headline facts present (25 base facts plus 10 derived from the JSON counts), and this record's own verification claims are asserted against the run it just performed — which is how the stale 38 above was caught; both SVGs parse as well-formed XML with 0 NaN or undefined text nodes; both PNG renders rasterised at their exact canvas size and measured pixel by pixel (72.08% and 29.21% non-white coverage, ink spanning the full canvas, 0 non-white pixels in the bottom-right 12x12); the per-player, significance, audit, coverage, boom-semantics and pixel scripts all re-run clean on this tree.

**Status: the evaluation is rebuilt to the method as written, every figure in it is machine-verified against the data, and the engine is unchanged. The open item that needs the owner is the additive-vs-blend formula question, and the data gaps (age, injury, cast, contract year, minutes) are listed rather than filled.**
