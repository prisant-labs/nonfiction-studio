# ADR-0020: A Chapter With No Claim Markers Is Unmeasured, Not Covered

**TL;DR:** Before this record, a chapter with no claim markers scored 100 percent claim coverage and passed the gate, even in block mode. A chapter of unchecked, partly false prose therefore read as fully covered. This record decides that such a chapter, above a small word floor, gets a `warn` finding named `claim_coverage.unmarked`. The finding never blocks, in any mode. An author can clear it for a chapter that truly makes no factual claims by recording a dated attestation in `context/decisions.md`. No text an author reads calls the chapter "100%"; it says "unmarked" instead. The JSON keeps `coveragePct` at 100.0 for compatibility and adds an `unmarked` flag beside it.

- Status: Accepted, Option A. The maintainer chose Option A on 2026-11-15, and the record ships with its implementation.
- Date: 2026-11-15
- Related: [ADR-0013 (wave 1 exit surfaces)](ADR-0013-wave-1-exit-surfaces.md) sets the gate's precedence and coercion rules, which the cap below follows. [ADR-0019 (Stop hook judgment layer)](ADR-0019-stop-hook-judgment-layer.md) rules out a model-judged check on Stop, which is why this guard is deterministic. [ADR-0016 (adopting an existing book)](ADR-0016-adopting-an-existing-book.md) owns the prose boundary that the word floor reuses. The claim-marker grammar is in [docs/formats/claim-markers.md](../formats/claim-markers.md).
- Decision: A ZERO-MARKER CHAPTER ABOVE THE FLOOR WARNS AND NEVER BLOCKS; AN AUTHOR ATTESTATION CLEARS IT; THE JSON CONTRACT GROWS ADDITIVELY; NO AUTHOR-FACING TEXT CALLS IT 100 PERCENT.

---

## Context

`computeCoverage` in `hooks/lib/claims-engine.mjs` divides resolved markers by total markers. When a chapter has no markers, it returns 100.0 for that chapter, and the book total does the same when no chapter has any. The gate's `claim_coverage` check then sees no open claims and reports `pass` with the detail "claim coverage 100%; no open markers". A unit test in `tests/engines/claims.test.mjs` pins the 100.0 result, which is why this change needs a record.

The effect on an author is that green means less than it appears to. A test written before the fix, and committed with it, shows the problem directly. It adds a third chapter of about 300 words to a copy of the sample book. The chapter makes several factual statements, two of them false, and carries no marker. The gate passes it in both `warn` and `block` mode with the detail "claim coverage 100%; no open markers". The book total also stays at 100 percent, because the other two chapters' markers all resolve.

The README's section "What the gate does not check" already says that unmarked claims are invisible to the gate. This record does not change that for a chapter that has at least one marker. It closes only the case where a chapter has none at all.

Every committed example chapter carries five markers, so no existing fixture or test outcome changes under any option below except the one pinning test.

## Options

The two options below were weighed. Each is shown by what the author sees for the weak-ties chapter in the failing test.

### Option A: an engine warning (recommended)

The claims engine counts a chapter as unmarked when it has zero claim markers of any form and at least 200 words of prose. The gate adds one `claim_coverage.unmarked` finding per such chapter.

| Surface | Before | After |
|---|---|---|
| `ns-gate`, warn mode | `claim_coverage` pass: "claim coverage 100%; no open markers" | `claim_coverage` warn: "1 chapter(s) unmarked: no claim markers in 300 words of prose" |
| `ns-gate`, block mode | pass, as above | warn, the same. The finding is capped at `warn`, so it cannot block |
| `ns-claims` | "pass: coverage 100.0% (10/10 markers resolved)" | The same line without "pass", plus "1 chapter(s) unmarked: chapters/03-weak-ties.md". For the unmarked chapter alone, "no claim markers found; coverage not measured". The JSON verdict is `warn`; the exit code is unchanged |
| `ns-status` board, Open Claims column | 0 | "unmarked" |

Option A is recommended because the gate is the place an author looks to learn whether a chapter was checked. A warning there is the smallest change that makes green honest. It never blocks, so a memoir passage or an opinion chapter costs the author one warning, or one attestation, and never a stopped turn.

### Option B: wording only

The engine and the verdict stay as they are. The gate detail and `ns-claims` text say "no claim markers found; coverage unmeasured" instead of "100%". The verdict stays `pass` in both modes.

Option B is the lighter change. The 2026-11-10 review that found this defect included a second analysis that preferred wording over a new check. Its weakness is that a `pass` is still a pass: the board, the statusline, and any script reading the verdict see green. It also cannot be raised later without this same record.

## Decision (Option A)

### 1. The rule

A chapter is unmarked when both of these hold:
- It has zero claim markers of the three resolvable forms in `docs/formats/claim-markers.md`: `[claim: EV-nnnn]`, `[UNVERIFIED]` and `[SOURCE-UNVERIFIABLE]`. A `[quote: EV-nnnn]` anchor does not count, because quote fidelity is a separate check.
- Its prose has at least 200 words. Prose is the chapter text before the book's prose-boundary heading, as `proseOf` in `hooks/lib/prose.mjs` already computes for ADR-0016. Words are whitespace-separated tokens.

The floor of 200 words is not calibrated. No committed chapter has zero markers, so there is no data to tune it against. It exists so that a dedication, an epigraph or a stub does not warn. It is a constant in the engine, with no config key, so a later change to it is a code change with its own test.

### 2. The cap

The `claim_coverage.unmarked` finding is capped at `warn`. When the check runs in `block` mode, an open, unresolved marker still blocks as it does today, and an unmarked chapter still only warns. When both are present, the verdict is the more severe of the two.

This cap is structural, in the same sense as the existing coercion of `quote_fidelity` under ADR-0013. No config key and no settings file can raise it. ADR-0013's never-un-coerce rule is therefore not touched: the cap adds no setting that could be overridden.

The cap exists for two reasons. Some chapters legitimately make no factual claims. And a guard that blocks on absence would teach authors to scatter markers to clear it, which makes coverage mean less, not more.

### 3. Clearing the warning

An author clears the warning for one chapter by appending an attestation to `context/decisions.md`, in the existing grammar of `docs/formats/decisions.md`:

```markdown
### 2026-11-15 - no factual claims, chapter 03
- actor: author
- decision: Chapter 03 makes no factual claims that need a source.
- rationale: It is a personal reflection with no figures, quotations or attributions.
- links: chapters/03-weak-ties.md
```

The match rule is the one the promotion ceremony already uses: `actor` is exactly `author`, the required fields are present, and `links` names the chapter. The `decision` must contain the phrase "no factual claims", so that a promotion attestation for the same chapter does not clear the warning by accident.

The attestation does not lapse when the chapter is edited. The promotion ceremony can demote on edit because `hooks/post-tool-batch.mjs` sees each write, but the claims engine runs on demand and has no reliable edit signal; a file's modification time changes on checkout. So a chapter attested as claim-free that later gains unmarked claims stays silent. That is the same blind spot as a chapter with one marker, and it is listed under "What this does not fix".

This reuses a reader and a grammar that already ship, so no new marker enters chapter prose. It also carries the same limit the README already states for attestations: the plugin records that an entry says `author`, and cannot prove who wrote it.

### 4. The JSON contract

The change is additive, so no existing consumer breaks:
- Each entry in the `chapters` array of `ns-claims --json` gains `unmarked` (boolean) and `proseWords` (integer).
- The top level gains `unmarkedChapters`, an array of chapter paths sorted by code unit.
- `coveragePct` keeps its type and its current arithmetic. A chapter with no markers still computes 100.0 there, and readers are expected to check `unmarked` first. The reference page for `ns-claims` says so.
- The gate report's `claim_coverage` entry keeps its shape. The finding appears in `evidence` as a chapter path, and in `detail` as above.

The new fields carry no wall-clock value, so unchanged input still gives byte-identical output.

### 5. Where the change lives

The rule is computed once, in `hooks/lib/claims-engine.mjs`. The gate and `ns-claims` call it directly. The status board reads it from each chapter's newest gate report, as it reads every other gate result, so no two surfaces can disagree. The statusline is unchanged: it shows the open-claims total from `progress.json`, which this record does not touch.

`ns-claims` keeps its exit code tied to open markers. The `nfs-fact-check` skill runs it on exactly the chapters that need checking, so an unmarked chapter must not make it look like a failure.

## What this does not fix

- **A chapter with one marker is still fully covered.** A 5,000-word chapter with one resolved marker scores 100 percent. Finding factual sentences that carry no marker needs a different tool, and that work is deferred.
- **A marker on the wrong sentence still resolves.** The engine checks that a marker's ledger entry is verified, not that it supports the sentence it sits on.
- **An attested chapter stays attested.** The log is append-only, and no entry withdraws another. Unmarked claims added after the attestation go unnoticed; adding any marker takes the chapter out of this rule.
- **The floor is a guess.** It should be revisited when real books show how often authors attest chapters as claim-free.

## Alternatives considered

- **Keep the current behavior.** Rejected in both options. It is the defect.
- **Block on an unmarked chapter in block mode.** Rejected. It would stop a session over a chapter that may be correct, and would reward adding markers for their own sake.
- **Require a marker density, such as one marker per 500 words.** Rejected. Any density is arbitrary, and it pushes authors to mark easy sentences rather than the claims that matter.
- **Declare a claim-free chapter with a marker in the prose, such as an HTML comment.** Rejected in favor of the attestation. A marker in the chapter could be written by a drafting agent in the same edit as the prose. The attestation has an existing author-only grammar and lives outside the chapter.
- **Make `coveragePct` null for an unmarked chapter.** Rejected for now. The skills and any author script read it as a number, and the additive fields carry the same information without breaking them.

## Consequences

- The implementation ships in the same pull request as this record. It changes `hooks/lib/claims-engine.mjs`, `hooks/lib/gate-engine.mjs`, `bin/ns-claims`, `hooks/lib/status-engine.mjs`, and their tests. The pinning test in `tests/engines/claims.test.mjs` now also asserts the `unmarked` field.
- Documentation changes in the same pull request: the README's "What the gate does not check" section, `docs/formats/claim-markers.md`, `docs/formats/decisions.md`, `docs/formats/gate-report.md`, and the reference pages for `ns-claims`, `ns-gate`, `ns-status`, `nfs-fact-check` and `nfs-status-dashboard`.
- The `nfs-fact-check` skill reports an unmarked chapter in its pre-count, and the `nfs-status-dashboard` skill shows "unmarked" in its Open Claims column and suggests a fact-check for it. Both are author-visible changes, so both skills' versions move under ADR-0017 (per-skill versioning).
- Two mutation proofs were run: removing the cap turns the block-mode test red, and removing the attestation match turns the cleared-chapter test red. `tests/engines/zero-marker-guard.test.mjs` names both.
- A book that upgrades sees new warnings only on chapters with no markers. Nothing that passes today will block.
- The change is a candidate for patch release v0.2.2, together with the honest-claims copy pass already merged.
