# Evidence Log Format

**Purpose.** This is the normative grammar for `research/evidence-log.md`, the append-only structured claim ledger defined in S-08 (schemas and file formats) section 6 and D-07 (claim ledger with stable IDs). `bin/ns-claims` and `bin/ns-doctor` parse against this document; every field name, value constraint, and structural rule below is authoritative. A parser author must be able to implement a conformant reader without consulting any other document.

## ID format

Evidence entry headings follow this pattern:

```
### EV-NNNN (handle)
```

`NNNN` is a zero-padded four-digit decimal integer, starting at `0001` and incrementing monotonically. IDs are never reused. The parenthesized handle is required and must be a short, unique human-readable label for the entry (for example, `EV-0012 (retention study)`).

`research-librarian` is the sole allocator of EV IDs per the ledger interaction protocol in S-03 (agents: research and evidence) section 1.2. The allocator reads the highest existing EV number, increments by one, and writes the next entry at the end of the file.

## Field grammar

Each entry is a Markdown bullet list directly under its heading. The parser reads each line as `- key: value`. All keys are lowercase with hyphens. The eight fields below are the complete set; no additional keys are permitted in a valid entry.

| Field | Type | Required | Allowed values and notes |
|---|---|---|---|
| `claim` | string | required | The factual assertion in the author's own words, as a single line |
| `source` | SRC-NNNN ID or literal `none` | required | A registered source ID (for example, `SRC-0004`) or the literal `none` when no source is yet identified |
| `locator` | string | optional | Page, section, timestamp, or paragraph pointer within the cited source; may be left blank |
| `verbatim` | string | optional | The exact source text for a quoted span, as a single line. Anchored in chapter prose with a `[quote: EV-nnnn]` marker (docs/formats/claim-markers.md form 4) and compared character-for-character, with no normalization, by the quote-fidelity check. An entry without `verbatim` is valid and behaves exactly as an entry predating this field |
| `confidence` | enum | required | One of `high`, `medium`, `low` |
| `status` | enum | required | One of `pending`, `verified`, `unverified`, `source-unverifiable`, `interpretation` |
| `added-by` | roster slug | required | The agent slug or `author` that logged this entry |
| `date` | YYYY-MM-DD | required | Calendar date the entry was added |

### The `verbatim` field is distinct from `claim`

`claim` is the assertion in the author's own words; it may paraphrase, summarize, or restate the source. `verbatim` is the source's own words, unedited, for the specific span a chapter quotes directly. Logging a `verbatim` excerpt does not change how `claim` is written or evaluated; the two fields serve different checks (`claim` feeds claim-coverage resolution; `verbatim` feeds quote-fidelity comparison) and may both be present on the same entry.

Comparison against `verbatim` is character-for-character with no normalization: typographic quote variants, Unicode normalization, ellipses, bracketed clarifications, and OCR or transcript cleanup are NOT reconciled automatically. This is deliberate. A normalization and adjudication policy for those benign mismatch classes is planned but not yet shipped, so the quote-fidelity check runs in warn mode only until it lands.

### Status values

| Value | Meaning | Set by |
|---|---|---|
| `pending` | Logged; not yet reviewed by `fact-checker` | `research-librarian` on creation |
| `verified` | Claim confirmed against the cited source | `fact-checker` |
| `unverified` | `fact-checker` could not confirm the claim against the cited source | `fact-checker` |
| `source-unverifiable` | Online resolution pass failed to resolve the DOI or URL for the linked source | `fact-checker` (online pass only) |
| `interpretation` | `fact-checker` judges the assertion to be opinion or interpretation rather than a falsifiable claim, per the S-03 (research and evidence) transition table | `fact-checker` |

### Confidence values

| Value | Meaning |
|---|---|
| `high` | Directly stated in a primary source |
| `medium` | Inferred from a reliable secondary source or corroborated across multiple sources |
| `low` | Single secondary source or paraphrase |

## Ordering and placement rules

- `research/evidence-log.md` is append-only. New entries are always added at the end of the file.
- EV IDs are assigned in strict ascending order with no gaps.
- If a claim is superseded or retracted, the `status` field is updated; the entry is never deleted.
- A blank `locator` line (for example, `- locator:`) is valid when no locator is available.
- `bin/ns-claims` parses the file from top to bottom; entry order does not affect coverage computation.
- `fact-checker` may update only the `status` field of an existing entry; it never modifies the `claim`, `source`, `locator`, `confidence`, `added-by`, or `date` fields.
- `SubagentStop` hook (Phase 2, not yet shipped): will write entries on the same append-only basis as `research-librarian`, once built.

## Example

A sourced and verified entry:

```markdown
### EV-0012 (retention study)
- claim: Spaced repetition raises thirty-day recall by roughly forty percent over massed practice.
- source: SRC-0004
- locator: pp. 112-114
- confidence: high
- status: verified
- added-by: research-librarian
- date: 2026-07-17
```

A sourced and verified entry that also anchors a direct quote, carrying `verbatim`:

```markdown
### EV-0013 (direct quote)
- claim: The researchers describe the effect as durable across study populations.
- source: SRC-0004
- locator: p. 116
- verbatim: The effect held across every population we sampled, with no measurable decay at thirty days.
- confidence: high
- status: verified
- added-by: research-librarian
- date: 2026-07-17
```

A pending entry with no source yet identified:

```markdown
### EV-0031 (survey figure)
- claim: More than half of surveyed authors disclose AI assistance to their editor.
- source: none
- locator:
- confidence: low
- status: pending
- added-by: research-librarian
- date: 2026-07-17
```

## Consumed by

- `bin/ns-claims` (TSK-025 (ns-claims engine)): resolves every `[claim: EV-NNNN]` chapter marker against this file, computes per-chapter `open_claim_count`, and produces the coverage report. With `--quotes` (OPP-D03 (quote fidelity and source packets)), resolves every `[quote: EV-nnnn]` marker against `verbatim` instead; with `--packets`, generates the per-chapter research packets under `research/packets/`.
- `bin/ns-doctor` (TSK-028 (ns-doctor engine)): validates field presence and value constraints, cross-references every `source` field against `research/sources.md`, and reports orphaned or missing EV IDs.
- `fact-checker`: reads entries and updates the `status` field only; never modifies claim text.
- `drafting-partner`: reads entries regardless of status and anchors `[claim: EV-nnnn]` markers to any EV ID that exists in the ledger at drafting time, per the agent's own claim-marking rule; requiring `status: verified` entries only would mark every drafted sentence `[UNVERIFIED]` given the pipeline order.
- `citation-manager`: reads entries for export-path citation assembly.
- `Stop` gate (via `bin/ns-claims`): warns or blocks when `open_claim_count` is non-zero, per `config.json` gate settings.
- `Stop` gate `quote_fidelity` check (D-03 (layered Stop gate), `hooks/lib/gate-engine.mjs`): compares each `[quote: EV-nnnn]` anchor's preceding quoted span against `verbatim` character-for-character. Warn mode only; block mode is structurally coerced to warn until the normalization and adjudication policy ships (roadmap row 1.5).
