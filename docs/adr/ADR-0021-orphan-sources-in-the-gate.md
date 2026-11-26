# ADR-0021: A Claim Whose Source Is Gone Warns in the Gate

**TL;DR:** Before this record, deleting a source record from `research/sources.md` left every claim that cited it passing the gate. Only `ns-doctor` reported the missing source, and the Stop hook does not run `ns-doctor`. This record adds a `claim_coverage.orphan-source` finding to the gate. It fires when a claim marker in a scanned chapter resolves to a ledger entry whose `source` names an SRC ID that the registry does not define. The finding is capped at `warn` in every mode, and it does not change the coverage arithmetic. The doctor and the gate compute the missing set with one shared function.

- Status: Accepted. The maintainer approved building this fix on 2026-11-26. The design choices below were the implementer's judgment and are open to the maintainer's review. The record shipped with its implementation.
- Date: 2026-11-26
- Related: [ADR-0013 (wave 1 exit surfaces)](ADR-0013-wave-1-exit-surfaces.md) sets the gate's precedence and coercion rules. [ADR-0020 (zero-marker guard)](ADR-0020-zero-marker-guard.md) set the pattern this record follows: a warn-capped finding inside `claim_coverage`, reported in `detail` and `evidence` without changing the entry's shape. The registry grammar is in [docs/formats/sources.md](../formats/sources.md).
- Decision: A CLAIM MARKER WHOSE LEDGER ENTRY CITES A MISSING SOURCE MAKES CLAIM_COVERAGE WARN, NEVER BLOCK; THE DOCTOR AND THE GATE SHARE ONE COMPUTATION.

---

## Context

A claim marker resolves when its ledger entry's status is `verified` or `interpretation`. The claims engine reads only the evidence log. It never opens the source registry. So when a source record disappears, the entries that cite it keep their status, and the gate keeps passing the chapters that cite them.

An audit of what happens after a claim is verified found this case directly. A copy of the sample book had the SRC-0003 record deleted while EV-0001 and EV-0005 still cited it, and both are marked in chapter 01. The gate passed with 100 percent claim coverage. `ns-doctor --check` reported `src-ref.orphan-referenced`, which is the only surface that saw it. `tests/engines/orphan-source.test.mjs` reproduces that case, and its first test was written and run red before the fix.

The registry's own rules say a record is never deleted, so this is a corruption case rather than a normal workflow. It still happens: a hand edit, a bad merge, or a tool that rewrites the file can drop a record.

## Decision

### 1. What fires the finding

The finding fires for a `[claim: EV-nnnn]` marker in a chapter the gate scans when three things are true: the EV entry exists, its `source` field is an SRC ID, and `research/sources.md` has no record with that ID. A missing registry file counts as an empty registry, so every SRC ID is missing; that matches the doctor.

The scope is the scanned chapters. Under `--chapter`, only that chapter's markers count. A whole-ledger scan stays the doctor's job, because a missing source cited only by an unused entry does not touch any chapter the gate is judging. `[UNVERIFIED]` tags and quote anchors are out of scope: an `[UNVERIFIED]` claim is already open, and a quote anchor is judged by `quote_fidelity`.

### 2. The verdict

The finding is `warn` in every mode, as ADR-0020's unmarked finding is. The entry's verdict is the most severe of the open-marker verdict, the unmarked verdict and this one. Coverage is unchanged: the entries keep their statuses, so no marker is counted open, and the coverage percentage is computed as before.

The cap is a choice, not a limit of the check. The check is deterministic, and ADR-0013 lets a deterministic check block when the author opts in. It is capped for now because blocking would change what passes for any book already in block mode on upgrade, and the right fix is often to restore one registry record. A later record can lift the cap.

### 3. The report

The entry keeps the shape of every other check entry. `detail` gains a part such as `1 source(s) missing from research/sources.md: SRC-0003 (cited by EV-0001, EV-0005); claim_coverage.orphan-source`. `evidence` gains each citing marker as `chapters/<file>.md#L<line>`, then `research/sources.md`. `next` says to restore the record or have `research-librarian` re-register the source, then run `nfs-fact-check` on the chapter. SRC IDs and EV IDs are sorted by code unit, so the output is the same on every platform.

### 4. One computation

`missingSourceRefs(evEntries, srcEntries)` in `hooks/lib/doctor-engine.mjs` returns each missing SRC ID with the IDs of the entries that cite it. The doctor's orphan check calls it with the whole ledger. The gate calls it with only the entries its scanned chapters cite. This follows the existing pattern in which the gate imports `checkWordCountCoherence` from the same module, so the two surfaces cannot disagree about what is missing.

## What this does not fix

- **A source whose content changed.** No mechanism here sees a web page that was edited after a claim was verified. Nothing stores the source text for an ordinary claim.
- **A reworded sentence or ledger claim.** A verified status still survives an edit to the sentence it sits on, an edit to the ledger's claim text, or a marker copied onto another sentence. Closing that needs a fingerprint of what was verified, which is larger work and needs its own record.
- **The fact-checker's own check.** The `fact-checker` agent already confirms that a source record exists, but only for entries it re-verifies. This record does not change the agent.

## Alternatives considered

- **Report it in `state_coherence`.** Rejected. That check has no adoption gate, so a book that has not adopted claims would be checked against a ledger it does not use. Its detail also describes word counts only.
- **Count the marker as open.** Rejected. The status in the ledger did not change, and counting it open would make coverage disagree with `ns-claims`, which reads the ledger alone.
- **Scan the whole ledger in the gate.** Rejected. It would repeat the doctor and would warn on a chapter that cites nothing missing.

## Consequences

- The implementation ships in the same pull request as this record. It changes `hooks/lib/doctor-engine.mjs` and `hooks/lib/gate-engine.mjs`, and adds `tests/engines/orphan-source.test.mjs`.
- One mutation proof was run: deriving the orphan-source verdict from the configured mode, instead of capping it, turns the block-mode test red. The test file names it.
- Documentation changes in the same pull request: the README's "What the gate does not check" section, `docs/formats/sources.md`, `docs/formats/gate-report.md`, and the reference pages for `ns-gate` and `ns-doctor`.
- A book that upgrades sees a new warning only when a chapter cites a ledger entry whose source record is missing. Nothing that passes today will block.
