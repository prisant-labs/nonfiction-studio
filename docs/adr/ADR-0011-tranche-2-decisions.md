# ADR-0011: Wave 1 Tranche 2 Decisions - Terminal Chapter Status, a Read-Only Board, and a Recalibrated Drift Budget

**TL;DR:** Four decisions made while closing roadmap row 1.4 (promotion ceremony and deterministic board) and row 1.7's measurement half (voice registers). First, the terminal chapter status reuses the existing `progress.json` value `final` rather than adding a `locked` enum value, so no schema version bump and no migration. Second, `bin/ns-status`, the eighth shipped CLI, is read-only; the promotion and demotion writes went to `hooks/post-tool-batch.mjs`, which already owns `progress.json`, so D-06 (single-writer state discipline) needs no second documented exception. Third, the drift budget default moved from 35 to 25, fitted against a committed labeled scenario suite, after two measurement corrections rescaled the score and left a chapter stripped of every contraction and first-person pronoun passing at 33.58 while two honestly written chapters would have blocked. Fourth, `stylometry.baseline.marker_set_version` is now required, because the vocabulary marker's computation changed and a baseline captured under the old one would otherwise be silently misread. This ADR also answers, on the record, the growth-policy test ADR-0009 (apparatus CLI) established for any eighth CLI. One consequence is disclosed rather than buried: the chosen budget works partly because of a population-mismatch floor in the sample book's own baseline, and the recommendation to replace that baseline with independent author samples would tighten the margin it depends on.

- Status: Accepted
- Date: 2026-08-16
- Task: Wave 1 tranche 2 (pre-publication PR 5) and its follow-ups (pre-publication PR 6), roadmap rows 1.4 and 1.7
- Decision: REUSE `final`, NOT a new `locked` value; `bin/ns-status` READ-ONLY with state writes in the hook; drift budget default 25 with the per-marker contribution bound at one third of budget; `marker_set_version` REQUIRED on a stylometry baseline
- Amends: D-05 (five shipped CLIs) grows to eight; D-06 (single-writer state discipline) is preserved rather than amended, which is itself the decision; D-08 (hybrid voice scoring) gains a length-invariant vocabulary marker, a bounded per-marker contribution, and a versioned marker set; D-10 (compliance layer is a feature) gains the human-final-pass attestation trail it called for
- Amended by: ADR-0012 (voice verdict scope), accepted 2026-08-29, which retires this ADR's Decision 3 (the budget of 25 and the per-marker bound) once implemented; Decision 4 (`marker_set_version` required) is reused by that ADR rather than replaced. **Implemented 2026-09-01**: Decision 3 is now retired in code (the calibrated-null verdict reads its threshold from the baseline's own calibration ladder; `thresholds.drift_score_max` is readable but ignored for one release, `MARKER_CONTRIBUTION_DIVISOR` is gone); Decision 4 is reused as described, now at `marker_set_version` 5.
- PA resolved: F-CI-07 (dispatcher and CLI-wrapper skills uncovered) partly closed by a routing-target checker; the acceptance clause "the next gate run after a demotion says so" is recorded as NOT met rather than reworded, and is scoped as separate work

---

## Context

Roadmap row 1.4 called for a chapter lifecycle ending in a locked state, a board computed deterministically by a CLI with the model narrating only, and a lock ceremony carrying a human attestation. Roadmap row 1.7 called for register-aware, explainable voice scoring. Both rows arrived carrying assumptions that measurement did not support, and the decisions below are mostly about which assumption to abandon.

## Decision 1: the terminal chapter status is the existing `final`

The portfolio entry for OPP-D14 (chapter promotion ceremony and deterministic burndown) describes a lifecycle of outlined, drafted, revised, gated, locked. The shipped schema at `templates/book-scaffold/.studio/progress.schema.json` defines `["empty","outlined","drafting","drafted","revised","gated","final"]`. These are the same terminal state under two names.

Adding `locked` as an eighth value would force a schema version bump and a migration touching `meta.json`, `progress.json`, `config.json`, and the gate report's own `version` assertion, in exchange for a rename. It would also collide with three existing uses of "locked" in shipped prose that mean something else: the locked chapter registry in `outline-book`, a locked thesis in `thesis-architect`, and a locked user decision in ADR-0010 (Tier B trigger and credential).

What this gives up is the portfolio entry's vocabulary. Documentation states the mapping so a reader of that entry is not left looking for a status value that does not exist.

## Decision 2: `bin/ns-status` is read-only, and the hook owns the writes

D-06 (single-writer state discipline) reserves `.studio/` machine-state writes for hook scripts. `bin/ns-gate` writes `.studio/gate/` as a documented exception, and a second CLI writing chapter status would have needed a second one.

Instead the board computes and renders only, and the promotion and demotion mechanics live in `hooks/post-tool-batch.mjs`, which already owns `progress.json`. What this gives up is a single command that both shows and changes the board. What it buys is that the deterministic reader stays trivially testable, and D-06 stays a rule rather than a rule with two exceptions.

The eligibility predicate has exactly one implementation, shared between the hook and the board module, because this codebase has already had to collapse three duplicated implementations of a single comparison helper.

The attestation follows the existing normative grammar in `docs/formats/decisions.md` rather than a new shape. That document had claimed `bin/ns-doctor` already validated those entries; verification found no such check anywhere in shipped code, so the validator was built and the document corrected.

## Decision 3: the drift budget default moves from 35 to 25

Two measurement corrections landed first, and they are the reason a recalibration was needed at all.

The vocabulary marker `type_token_ratio` was a plain unique-over-total ratio, which falls as text grows. A chapter measured against a whole-book baseline therefore read as drifted purely because the book is longer. On the sample book's first chapter that single marker contributed 21.24 of a 29.80 total, 71 percent of the score, from zero real drift. It is now a moving average over a fixed 100-token window, length-invariant by construction: measured on real prose it deviates 0.3 percent between a 183-word sample and a 528-word chapter.

Separately, relative deviation was unbounded and unweighted, so one marker resting on very few raw occurrences could consume the entire budget. The sample book's `first_person_rate` baseline rests on roughly six tokens across 1099 words, and a two-token difference between chapters moved that marker by about 33 points of a 35-point budget. A marker's contribution to the score is now bounded to one third of the configured budget, derived at scoring time rather than hardcoded, so at least three markers must deviate substantially before their combined contribution can breach the gate. The bound applies to the contribution only; the per-marker deviation reported to callers stays the honest uncapped number with a flag recording whether the bound was binding, which is what `ns-stylometry --explain` surfaces.

Those two corrections rescaled the score by roughly an order of magnitude while the threshold stayed at 35, which produced an inversion. Measured against a committed labeled scenario suite at `tests/engines/fixtures/drift-scenarios/`, a chapter stripped of every contraction and every first-person pronoun, the canonical signature of a ghostwriting pass, scored 33.58 and passed, while two honestly written chapters of the same book would have blocked. The gate was passing mechanically de-voiced prose and blocking natural variation.

The budget is now 25, chosen against the suite rather than picked. Two other levers were evaluated and rejected on evidence:

- **A smaller divisor behind the per-marker bound.** Rejected because at a fixed budget the ghostwriting score and the honest-variance score move together as the divisor changes, verified by sweeping divisors from 1.00 to 10.00 at two budgets and finding no separating value. Separation does exist in the joint budget-and-divisor space, at a verified working point of budget 50 with divisor 2.5; it was found and deliberately not adopted, because the feasible band is narrow, the margins are bounded on both sides, and any divisor change ripples into the planted fixture's own documented measurements.
- **Damping each marker by the raw occurrence count it rests on.** This was the intuitive fix, since the original defect was a marker resting on six occurrences being unable to support a percentage. It was rejected because it moves the wrong way: the ghostwriting signature lives on the two sparsest markers, so damping them pushes that case further from blocking, not closer. The diagnosis was right and its sign was inverted. Damping suppresses false positives; this defect was a false negative.

## Decision 4: `marker_set_version` is required on a baseline

Correction 3 changed what a stored `type_token_ratio` value means: on the same prose it moves from 0.4171 to roughly 0.7356. Any baseline captured before that change would be silently misread as enormous drift.

`stylometry.baseline.marker_set_version` is therefore required, an absent field is treated as version 1, and a mismatch fails with a named error rather than scoring. `bin/ns-stylometry --measure` emits the field alongside the markers so the documented capture path carries it by construction, rather than depending on prose instructions in five separate files staying in sync with a constant in the engine.

## The D-05 growth-policy test, answered on the record

ADR-0009 (apparatus CLI) established that any proposed new CLI must answer yes to at least one of three questions before choosing a CLI over skill-only logic. `bin/ns-status` passes the first outright: correctness is a deterministic, machine-checkable property, byte-for-byte, that a failing test can be written against before the feature exists. That is OPP-D14's own success bar restated, and a test captures two consecutive runs and compares them.

D-05 (five shipped CLIs) now names an eight-item list. Per ADR-0009 the name is retained deliberately as the decision's identifier; only the list grows.

## Consequences

- Row 1.4 is closed. Row 1.7's measurement half is closed and its feature half is blocked, not on the metric, but on the sample book's baseline being captured from the same two chapters it scores.
- **The chosen budget partly depends on a defect the documentation elsewhere recommends removing.** Decomposed, the ghostwriting signature's genuine contribution is about 6.05 points against the 8.33 needed to block; the remainder comes from the sample book's own population-mismatch floor. Rescored against a well-fit baseline that signature scores 22.72 and passes. `docs/reference/cli/ns-stylometry.md` discloses this in the paragraph adjacent to the one recommending independent author samples, and states plainly that moving to such a baseline is not a strict improvement. Replacing the corpus will require revisiting this number.
- The scenario suite does not uniquely select 25. Eight of its rows are consistent with any budget from roughly 16 to 31, and the test pinning the value is a statistic derived from the chosen number rather than an independent constraint. This is stated in the reference documentation rather than left for a reader to discover.
- A stale baseline causes the stylometry check to skip while the gate's top-level verdict stays `pass`, because a skipped check cannot raise the verdict, a policy uniform across all six checks. The narration, the Stop hook, and `MIGRATION.md` all now surface it so an author is told; the verdict policy itself is deliberately unchanged and remains open.
- The acceptance clause "the next gate run after a demotion says so" is not met. It is recorded as failed rather than reworded to match what was built, and needs a durable marker on a versioned schema plus a warn-level gate check.
- Two new Tier A checks ship alongside these decisions: one asserting that a skill's named CLI target exists, and one deriving component counts from the tree and failing on stale claims. The second exists because prose enforcement of that rule lost four times in a single wave.
