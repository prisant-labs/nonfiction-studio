# Claim Marker Format

**Purpose.** This is the normative grammar for the three machine-read markers embedded inline within chapter files under `chapters/`, as defined in S-08 (schemas and file formats) section 8. `bin/ns-claims` scans chapter files for these markers to compute claim coverage. Every syntax rule and placement constraint below is authoritative. A parser author must be able to implement a conformant scanner without consulting any other document.

## Marker forms

There are exactly three marker forms. All appear inline within chapter prose, written by `drafting-partner` and maintained by `fact-checker`.

### Form 1: linked claim marker

```
[claim: EV-NNNN]
```

Links the preceding factual sentence or sentence cluster to a specific evidence ledger entry. `NNNN` is a four-digit zero-padded EV ID that must match an entry in `research/evidence-log.md` (for example, `[claim: EV-0012]`).

A marker pointing to a missing EV entry, or to an entry whose `status` is anything other than `verified`, counts as one open claim in `open_claim_count`.

### Form 2: unverified placeholder

```
[UNVERIFIED]
```

Signals a factual sentence that has no evidence ledger entry yet. This is a legal draft state. Every `[UNVERIFIED]` tag counts as one open claim. `fact-checker` replaces `[UNVERIFIED]` with `[claim: EV-NNNN]` once a source is logged and verified; `bin/ns-claims` counts any remaining `[UNVERIFIED]` tags when computing `open_claim_count`.

### Form 3: source-unverifiable tag

```
[SOURCE-UNVERIFIABLE]
```

Signals that the online resolution pass failed to confirm the source for a linked claim. This marker is always paired with the existing `[claim: EV-NNNN]` marker for the same sentence. The two markers appear together, and the original `[claim: EV-NNNN]` is never removed. The corresponding EV entry in `research/evidence-log.md` carries `status: source-unverifiable`. Set by `fact-checker` during the online pass; removed if the source later resolves.

## Placement rules

1. **Position.** A marker is placed after the sentence's terminal punctuation (period, question mark, or exclamation mark), separated by a single space.

2. **Cluster rule.** A tight cluster of consecutive sentences expressing ONE assertion spread across sentences carries one marker at the end of the cluster. Consecutive sentences making DISTINCT assertions each carry their own marker, even when they resolve to the same ledger entry. Coverage counting is marker-granular: every marker counts independently toward `open_claim_count`.

3. **Unverified position.** An asserted fact with no ledger entry yet carries `[UNVERIFIED]` in the same position where a `[claim: EV-NNNN]` marker would appear.

4. **Source-unverifiable pairing.** When the online pass fails for a linked claim, `[SOURCE-UNVERIFIABLE]` is placed immediately after the existing `[claim: EV-NNNN]` marker, separated by a single space, forming the pair `[claim: EV-NNNN] [SOURCE-UNVERIFIABLE]`. The claim marker trail to the failed source is preserved.

5. **Orphan tag behavior.** A `[SOURCE-UNVERIFIABLE]` tag with no paired `[claim: EV-NNNN]` marker on the same sentence is a grammar error; `bin/ns-doctor` (TSK-028 (ns-doctor engine)) reports it and `bin/ns-claims` (TSK-025 (ns-claims engine)) counts it as one open claim rather than ignoring it (fail-safe on malformed input).

6. **No marker for non-factual sentences.** Opinion, transition, and narrative sentences carry no marker. Coverage is measured over factual sentences only. `fact-checker` determines which sentences are factual.

## Example

```markdown
Massed cramming feels productive because fluency spikes during the session. [UNVERIFIED]
But spaced repetition raises thirty-day recall by roughly forty percent over massed
practice, and the gain widens as the interval lengthens. [claim: EV-0012] The effect
holds across ages and subject matter. [claim: EV-0012]
```

In this example:

- Sentence 1 is a factual claim awaiting a source; it carries `[UNVERIFIED]` and counts as one open claim.
- Sentence 2 resolves to `EV-0012 (retention study)` and carries its own marker because it is a distinct supported assertion.
- Sentence 3 also resolves to `EV-0012 (retention study)` and carries a separate marker for the same reason.
- Coverage reaches `1.0` only when `EV-0012` has `status: verified` in `research/evidence-log.md` and the `[UNVERIFIED]` tag on sentence 1 is resolved.

## Coverage computation

`bin/ns-claims` resolves every `[claim: EV-NNNN]` marker against `research/evidence-log.md`. A marker is counted as an open claim when:

- The referenced EV entry does not exist in the ledger.
- The referenced EV entry exists but has a `status` other than `verified`.

Every `[UNVERIFIED]` tag is also counted as one open claim. A `[SOURCE-UNVERIFIABLE]` tag with no paired `[claim: EV-NNNN]` marker on the same sentence is also counted as one open claim (fail-safe; see Placement Rule 5).

The per-chapter `open_claim_count` in `.studio/progress.json` is this total. Coverage is `1.0` (satisfying the `claim_coverage_min` threshold in `config.json`) only when `open_claim_count` is zero.

## Consumed by

- `bin/ns-claims` (TSK-025 (ns-claims engine)): the primary consumer; scans all chapter files for all three marker forms, resolves linked markers against `research/evidence-log.md`, and writes the per-chapter `open_claim_count` to `.studio/progress.json`.
- `bin/ns-doctor` (TSK-028 (ns-doctor engine)): validates that every `[claim: EV-NNNN]` references an existing EV entry; reports broken markers and orphan `[SOURCE-UNVERIFIABLE]` tags (tags with no paired `[claim: EV-NNNN]` on the same sentence).
- `fact-checker`: writes `[UNVERIFIED]` and `[SOURCE-UNVERIFIABLE]` tags, and replaces `[UNVERIFIED]` with `[claim: EV-NNNN]` once a claim is sourced and verified; never removes `[claim: EV-NNNN]` markers.
- `Stop` gate: reads the `open_claim_count` derived from marker resolution to compute the `claim_coverage` gate verdict.
