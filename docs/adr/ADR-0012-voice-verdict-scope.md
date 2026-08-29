# ADR-0012: Where the Blocking Voice Verdict Lives - the Combining Rule, Not the Budget

**TL;DR:** The voice drift check does not work. Measured at chapter scale it separates ghostwritten prose from the author's own writing at AUC 0.53 on two of three sources, which is a coin flip, and it blocks 98 to 100 percent of chapters the author genuinely wrote. The cause is not the budget, the corpus size, or the chapter length: it is the combining rule. `computeDrift` sums eight per-marker deviations, which accumulates noise from all eight while a real signal concentrates in one or two. Replacing the sum with the largest standardized deviation, measured against a null the author's own corpus calibrates, separates at AUC 0.984 and 0.987 on two genuine prose sources with a 1.3 to 1.7 percent false-block rate. This ADR adopts that change, adds a second tier for authors whose own base rates are too sparse to support a chapter-scale verdict, retires the budget and the per-marker bound that ADR-0011 (tranche 2 decisions) established, and rules roadmap row 1.7 (voice registers) advisory-only, which unblocks it. It also records why ADR-0011's divisor sweep could not have succeeded.

- Status: **Accepted.** Prepared 2026-08-26 as Claude's recommendation from the design session PF-01 (voice verdict scope) reserved, after the maintainer declined to choose between the options and asked for a call. Accepted 2026-08-29 under the maintainer's delegation of that session's open decisions ("move forward with your best recommendations and decisions"); the recommendation and the acceptance therefore share an author, and this line records that provenance rather than hiding it.
- Date: 2026-08-26 (proposed), 2026-08-29 (accepted)
- Task: PF-01 (voice verdict scope) from the 2026-08-21 pre-flight audit; unblocks roadmap row 1.7 (voice registers) and corpus authoring
- Decision: the chapter verdict moves from a CAPPED SUM of relative deviations to the LARGEST STANDARDIZED deviation against an empirically calibrated null; a SECOND TIER blocks at book scale for authors whose corpus cannot support a chapter verdict; the baseline gains per-marker NOISE SCALES at `marker_set_version` 5; registers are ADVISORY-ONLY
- Amends: ADR-0011 (tranche 2 decisions) Decision 3, whose budget of 25 and per-marker bound of one third both retire; D-08 (hybrid voice scoring) gains a calibrated null and a two-tier verdict
- Supersedes: nothing. ADR-0011's Decision 4 (`marker_set_version` required) is reused rather than replaced, and is what makes this change deliverable

---

## Context

ADR-0011 (tranche 2 decisions) set the drift budget to 25 and bounded each marker's contribution to one third of it, after sweeping the divisor from 1.00 to 10.00 at two budgets and finding, in its own words, "no separating value." It recorded that outcome honestly and adopted the least-bad point. It also disclosed that the chosen budget worked partly because of a population-mismatch floor in the sample book's own baseline, and that replacing that baseline would require revisiting the number.

Two rounds of measurement since have explained why that search failed, and the explanation is not the one anyone expected.

**Round one, the corpus-sizing experiment.** Growing the voice-sample corpus from 550 to 70,400 words, with the scored text held at one realistic chapter, does not reduce same-voice drift at all. The median stays flat around 41 to 45 and the block rate stays at 98 to 100 percent across that entire range, on three independent single-voice sources. The cause is arithmetic: in a 550-word chapter at the sample book's rates, `first_person_rate` rests on about 4.0 expected occurrences and `contraction_rate` on about 5.0, carrying relative standard errors of 50.0 and 44.7 percent against a per-marker cap of 8.33. Those markers pin at the cap from sampling noise alone, and three pinned markers is enough to block. Reaching 288 expected occurrences, the point where a typical draw stays under the cap, would need 30,384 words for contractions and 37,980 for first person. That is not a corpus, it is another book.

**Round two, PF-21 (pooled statistic), which corrected round one.** Round one concluded that standardization "fails at chapter scale." That conclusion was wrong, and wrong for an instructive reason: it summed absolute z across the markers, which is the worst available combining rule. Summing accumulates noise from every marker linearly while a real signal concentrates in one or two. The negative result measured the rule, not the data.

Re-measured with better combining rules, at 550 scored words, 300 replicates per class, with the null scale calibrated on a disjoint set so the negative class is never scored against a scale fitted to itself:

| Statistic | Essay AUC | Technical AUC | Sample book AUC | Best FPR@90 |
|---|---|---|---|---|
| **largest standardized deviation** | **0.984** | **0.987** | 0.700 | **1.3%** |
| top 2 summed | 0.957 | 0.978 | 0.779 | 3.0% |
| chi-square | 0.936 | 0.975 | 0.781 | 4.3% |
| sum of absolute z | 0.825 | 0.944 | 0.765 | 9.7% |
| count of markers past z of 2 | 0.853 | 0.877 | 0.469 | 27.3% |
| **current, as shipped** | **0.532** | **0.667** | **0.529** | **67.3%** |

AUC 0.50 is a coin flip and 1.00 is perfect. FPR@90 is the false-block rate at the threshold catching 90 percent of ghostwriting passes.

**Why ADR-0011's divisor sweep could not have succeeded.** A threshold sweep over a statistic with AUC 0.53 is a sweep over a coin flip. The ghostwriting score and the honest-variance score moved together across every divisor because the statistic barely distinguishes them; there was no separating value to find. ADR-0011 was searching the wrong parameter, and its record of the failure is what made the real cause findable. The budget was never the problem.

**Evidence provenance, and what was and was not re-verified.** The corpus-sizing findings document of 2026-08-21 and the six probe scripts beside it.

The PF-21 comparison table above was re-measured at `3f68081` before being quoted here, per this repository's standing rule to verify figures against current code rather than copy them. It reproduces, and the re-run corrected four items in the source document, recorded in the PF-01 (voice verdict scope) decision brief of 2026-08-25, Section 0. All four corrections move in the favourable direction and none changes a conclusion.

The round-one figures are quoted from the 2026-08-21 findings document and were **not** re-run this session: the 98 to 100 percent block rate, the flat median of 41 to 45 across the corpus sweep, and the expected-count and words-needed tables. The findings document pins only its PF-21 section to a commit, so those figures cannot be attributed to a known engine state. They are directional context here. **The decision rests on the PF-21 table, which was verified.** Re-running the marker-stability sweep script at HEAD would close the gap and is not required to accept this ADR.

## Decision 1: the chapter verdict is the largest standardized deviation, not a capped sum

`computeDrift` currently computes, for each of eight markers, the relative deviation from baseline as a percentage, caps it at one third of the budget, sums the eight, and blocks when the total reaches 25.

It will instead standardize each marker's deviation by that marker's own measured noise scale, take the largest of the eight, and block when that value exceeds a quantile of the calibrated null.

The reason to prefer the maximum over every alternative measured is that it is the only rule that does not dilute. A ghostwriting pass moves one or two markers hard and leaves the rest alone; summing then averages a strong signal against seven quiet channels. Taking the maximum asks the question the author actually cares about, which is whether any single dimension of their voice has moved further than that dimension normally moves.

What this gives up is the intuition that many small deviations should add up to a verdict. They should not, at this scale: the measurement says that when they appear to, it is noise.

## Decision 2: a second tier, for authors whose corpus cannot support a chapter verdict

The sample book does not separate at 550 words under any rule tested, scoring 0.700 to 0.781. The cause is not the bootstrap and not the engine. The technical guide has a nearly identical usable-word count, 1,153 against 1,102, and separates at 0.987. The difference is the author's own base rates: the sample book's `first_person_rate` is 0.7583 per 100 words against the essay's 2.4291, so a 550-word passage holds about 4 first-person tokens rather than about 13. Removing all of them is a 100 percent relative change either way, but signal-to-noise scales as the square root of the count, so the same ghostwriting pass is roughly 1.8 times harder to detect.

**An author who rarely writes in first person is genuinely harder to protect, and no statistic fixes that.**

So the verdict is tiered. `capture-voice` measures the author's own detectability at capture time, from the same resampling that calibrates the null, and assigns one of two regimes:

- **Chapter-blocking regime.** The corpus supports a chapter-scale verdict. Drift blocks the chapter, as today, on the Decision 1 statistic.
- **Book-scale regime.** The corpus does not. The per-chapter number is reported as advice and never blocks; the blocking check runs at section or book scale, where every statistic measured exceeds 0.96 on every source by 2,200 scored words.

The alternative was to give every author the chapter-blocking verdict and disclose its accuracy. That was rejected because a check that wrongly blocks roughly 36 percent of an author's own chapters is not a check, it is an obstacle they will learn to route around, and routing around it costs the product the thing it exists to provide.

## Decision 3: the baseline gains per-marker noise scales, at `marker_set_version` 5

The null is calibrated empirically rather than assumed: draw many same-voice pairs from the author's corpus, measure each marker's signed relative deviation, and take that distribution's standard deviation as the marker's noise scale.

Empirical calibration is chosen over closed-form standard errors for a reason that decides the design. Three of the eight markers, `type_token_ratio`, `avg_word_length` and `avg_sentence_length`, are means rather than counts and have no closed-form standard error. Resampling handles all eight uniformly. The PF-21 script confirms this is what was measured: its marker list includes all eight, so the 0.984 is a whole-vector result, not a five-marker one.

`stylometry.baseline` therefore gains a third field beside `markers` and `marker_set_version`, holding the per-marker noise scales and the assigned regime from Decision 2. `CURRENT_MARKER_SET_VERSION` moves 4 to 5.

This reuses ADR-0011's Decision 4 rather than inventing anything: the stale-baseline guard already refuses to score a baseline whose version does not match, `capture-voice` already documents recapture as the remedy, and `run-quality-gate` and `status-dashboard` already narrate the skipped-check state. No baselines exist outside this repository, so invalidation costs a fixture regeneration.

**`capture-voice` becomes computational.** It currently measures a vector once. It will resample the corpus to calibrate the null, which is a bounded cost proportional to corpus size and must be stated in the skill's own documentation rather than surprising an author.

## Decision 4: registers are advisory-only, which closes roadmap row 1.7

Row 1.7 (voice registers) called for register-aware voice scoring. Per-register scoring makes the measured unit smaller than a chapter, and smaller is precisely what the measurement says breaks: everything works by 2,200 scored words and everything degrades below it. A register inside a single chapter holds a few hundred words at best.

`--by-register`, per-register baselines, and `capture-voice` bucketing therefore ship as diagnostic output with no blocking verdict attached. The row closes on the feature being useful and honest rather than on it gating.

The alternative, blocking a register once it accumulates roughly 2,200 words across the book, was rejected because in a normal book most registers never reach that bar, so the feature would mostly sit silent while appearing to be a gate.

## Consequences

- **Roadmap row 1.7 (voice registers) is unblocked and closable.** Corpus authoring is unblocked. The corpus should be sized for independence and register coverage, a few thousand words, not for marker stability: sweep 1 shows baseline size past a few thousand words buys nothing while the scored unit stays a chapter.
- **ADR-0011 (tranche 2 decisions) Decision 3 retires.** `drift_score_max` and `MARKER_CONTRIBUTION_DIVISOR` are artifacts of the capped-sum rule and have no meaning under the new statistic. Proposal: keep `drift_score_max` readable in config for one release, ignored with a warning, so a config shipping today does not break.
- **ADR-0011's disclosed dependency dissolves.** That ADR recorded that its budget worked partly because of the sample book's population-mismatch floor, and that a well-fit baseline would rescore the ghostwriting signature at 22.72 and let it pass. Under a calibrated null there is no floor to depend on, because the null is fitted to the author rather than assumed. This removes the awkward disclosure in `docs/reference/cli/ns-stylometry.md` that moving to independent author samples is "not a strict improvement."
- **The golden per-chapter drift assertion must be re-scoped.** As currently written it is an assertion about how uniform the sample book is, not about drift detection. It will not survive the change and should not be patched to.
- **Only one drift type has been measured.** The pronoun-and-contraction ghostwriting signature. A wholesale rewrite by a different author, or an LLM paraphrase, is untested and may behave differently. Decision 2's tiering is partly a hedge against this, but it is not evidence.
- **Three sources, and they are small.** An essay of 3,094 usable words, a technical guide of 1,153, and the sample book at 1,102. The agreement across all three is what makes the shape credible, not the size of any one. This is not a corpus survey.
- **The largest-deviation statistic has an inflated null by construction**, because taking a maximum over eight draws shifts the distribution. This is handled here only because the threshold is chosen empirically from the calibrated null. An implementation must do the same and must not assume a z of 2 is significant.
- **No engine prerequisite blocks this.** The one candidate, `CONTRACTION_RE` reading zero on typographic apostrophes, was already fixed in PR #9 (commit `5674bde`, the 2 to 3 version bump) before the evidence was gathered, so every figure here already reflects the fixed engine. The corpus-sizing document's "Incidental defect" section reports it as live and is stale. PF-24 (ASCII-only tokenizer siblings) correctly scoped and accepted what remains, which is an accented stem in a possessive.
- **This ADR authorises no code.** It records a decision so that implementation can be planned against something reviewed. The implementation is: the combining rule in `hooks/lib/stylometry-engine.mjs`, the noise-scale schema and version bump, the two-tier regime in `capture-voice` and the gate, the register flag, and the re-scoped golden assertion.
