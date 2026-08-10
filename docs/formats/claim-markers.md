# Claim Marker Format

**Purpose.** This is the normative grammar for the four machine-read markers embedded inline within chapter files under `chapters/`, as defined in S-08 (schemas and file formats) section 8. `bin/ns-claims` scans chapter files for these markers to compute claim coverage and quote fidelity. Every syntax rule and placement constraint below is authoritative. A parser author must be able to implement a conformant scanner without consulting any other document.

## Marker forms

There are exactly four marker forms. All appear inline within chapter prose, written by `drafting-partner` and maintained by `fact-checker`.

### Form 1: linked claim marker

```
[claim: EV-NNNN]
```

Links the preceding factual sentence or sentence cluster to a specific evidence ledger entry. `NNNN` is a four-digit zero-padded EV ID that must match an entry in `research/evidence-log.md` (for example, `[claim: EV-0012]`).

A marker pointing to a missing EV entry, or to an entry whose `status` is `pending`, `unverified`, or `source-unverifiable`, counts as one open claim in `open_claim_count`. Entries with status `verified` or `interpretation` are resolved.

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

### Form 4: quote anchor

```
[quote: EV-NNNN]
```

Anchors a directly quoted span of chapter prose to the `verbatim` field of a specific evidence ledger entry (Task 4: quote fidelity and research packets, warn mode; OPP-D03 quote fidelity and source packets). `NNNN` is a four-digit zero-padded EV ID that must carry a `verbatim` field in `research/evidence-log.md` (for example, `[quote: EV-0013]`).

**Span definition, authoritative.** The quoted span is the text between the nearest preceding pair of straight double quotation marks that closes immediately before the anchor, allowing only whitespace and sentence-terminal punctuation between the closing quotation mark and the anchor. Place the anchor immediately after the closing `"`, with at most whitespace and a period, question mark, or exclamation mark in between; anything else between the closing quote and the anchor means no span is found for that anchor.

`bin/ns-claims --quotes` and the Stop gate's `quote_fidelity` check compare the extracted span against the entry's `verbatim` field character-for-character, with no normalization: typographic quote variants, Unicode normalization, ellipses, bracketed clarifications, and OCR or transcript cleanup are NOT reconciled automatically, because normalization is precisely the deferred adjudication policy (roadmap row 1.5). A mismatch produces a warning (never a block, until that policy ships), showing the exact diff between the stored excerpt and the quoted span.

A `[quote: EV-nnnn]` anchor referencing a missing EV entry, an entry with no `verbatim` field, or having no preceding quoted span per the rule above, is also a finding: `bin/ns-claims --quotes` and the `quote_fidelity` gate check name the specific problem and the anchor's ID.

## Placement rules

1. **Position.** A marker is placed after the sentence's terminal punctuation (period, question mark, or exclamation mark), separated by a single space.

2. **Cluster rule.** A tight cluster of consecutive sentences expressing ONE assertion spread across sentences carries one marker at the end of the cluster. Consecutive sentences making DISTINCT assertions each carry their own marker, even when they resolve to the same ledger entry. Coverage counting is marker-granular: every marker counts independently toward `open_claim_count`.

3. **Unverified position.** An asserted fact with no ledger entry yet carries `[UNVERIFIED]` in the same position where a `[claim: EV-NNNN]` marker would appear.

4. **Source-unverifiable pairing.** When the online pass fails for a linked claim, `[SOURCE-UNVERIFIABLE]` is placed immediately after the existing `[claim: EV-NNNN]` marker, separated by a single space, forming the pair `[claim: EV-NNNN] [SOURCE-UNVERIFIABLE]`. The claim marker trail to the failed source is preserved.

5. **Orphan tag behavior.** A `[SOURCE-UNVERIFIABLE]` tag with no paired `[claim: EV-NNNN]` marker on the same sentence is a grammar error; `bin/ns-doctor` (TSK-028 (ns-doctor engine)) reports it and `bin/ns-claims` (TSK-025 (ns-claims engine)) counts it as one open claim rather than ignoring it (fail-safe on malformed input).

6. **No marker for non-factual sentences.** Opinion, transition, and narrative sentences carry no marker. Coverage is measured over factual sentences only. `fact-checker` determines which sentences are factual.

7. **Quote anchor position.** A `[quote: EV-nnnn]` marker is placed immediately after the closing straight double quotation mark of the span it anchors, separated from that closing quote by nothing but whitespace and, optionally, the sentence's terminal punctuation (period, question mark, or exclamation mark). Do not place a `[quote: EV-nnnn]` anchor anywhere a quoted span does not immediately precede it per this rule; doing so produces a no-span finding rather than a silent pass.

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

A quote anchor added to sentence 2, assuming `EV-0012` also carries a `verbatim` field matching the quoted words exactly:

```markdown
The researchers wrote plainly: "spaced repetition raises thirty-day recall by roughly
forty percent over massed practice." [quote: EV-0012]
```

- The quoted span is the text between the two straight double quotation marks: `spaced repetition raises thirty-day recall by roughly forty percent over massed practice.` (the period sits inside the closing quote, so it is part of the span).
- The anchor sits immediately after the closing quote, separated by a single space: the gap contains only whitespace, satisfying placement rule 7.
- `bin/ns-claims --quotes` compares this span against `EV-0012`'s `verbatim` field character-for-character. An exact match produces no finding; even a single altered word produces a warning showing the diff.

## Coverage computation

`bin/ns-claims` resolves every `[claim: EV-NNNN]` marker against `research/evidence-log.md`. A marker is counted as an open claim when:

- The referenced EV entry does not exist in the ledger.
- The referenced EV entry exists but has a `status` of `pending`, `unverified`, or `source-unverifiable`.

Entries with status `verified` or `interpretation` are resolved (open_claim_count contribution: 0). A recorded interpretation judgment is a resolution, not an unresolved claim; an opinion can never become verified, so counting it open would make blocking mode unusable for any book containing judged opinion. (Corrected 2026-07-18 per TSK-019 (golden sample book) adjudication.)

Every `[UNVERIFIED]` tag is also counted as one open claim. A `[SOURCE-UNVERIFIABLE]` tag with no paired `[claim: EV-NNNN]` marker on the same sentence is also counted as one open claim (fail-safe; see Placement Rule 5).

The per-chapter `open_claim_count` in `.studio/progress.json` is this total. Coverage is `1.0` (satisfying the `claim_coverage_min` threshold in `config.json`) only when `open_claim_count` is zero.

`[quote: EV-nnnn]` anchors (form 4) are NOT part of `open_claim_count` or claim coverage. They feed an entirely separate check, quote fidelity, which has its own report (`quote_fidelity`) and its own gate check; see the Form 4 section above.

## Consumed by

- `bin/ns-claims` (TSK-025 (ns-claims engine)): scans chapter files for the three claim-coverage marker forms and resolves them against `research/evidence-log.md`. Does not detect unmarked sentences; that judgment belongs to the fact-checker agent and the gate's judgment layer. State-coherence drift is caught by bin/ns-doctor per `docs/formats/gate-report.md`. Computes the per-chapter `open_claim_count`; the PostToolBatch hook persists it to `.studio/progress.json` per D-06 (single-writer state discipline). With `--quotes` (Task 4: quote fidelity and research packets, warn mode), scans for form 4 instead and resolves each against the referenced entry's `verbatim` field.
- `bin/ns-doctor` (TSK-028 (ns-doctor engine)): validates that every `[claim: EV-NNNN]` references an existing EV entry; reports broken markers and orphan `[SOURCE-UNVERIFIABLE]` tags (tags with no paired `[claim: EV-NNNN]` on the same sentence).
- `fact-checker`: writes `[UNVERIFIED]` and `[SOURCE-UNVERIFIABLE]` tags, and replaces `[UNVERIFIED]` with `[claim: EV-NNNN]` once a claim is sourced and verified; never removes `[claim: EV-NNNN]` markers.
- `Stop` gate: reads the `open_claim_count` derived from marker resolution to compute the `claim_coverage` gate verdict. Its `quote_fidelity` check separately resolves every `[quote: EV-nnnn]` anchor and warns on a mismatch; block mode is structurally unreachable until the quote normalization and adjudication policy ships (roadmap row 1.5).
