# Open Questions Format

**Purpose.** This is the normative grammar for `research/open-questions.md`, the append-only research agenda ledger that connects `structure-architect`'s outline evidence-needed items to `research-librarian`'s sourcing work, per S-03 (research and evidence agents). No prior document defines this file's entry grammar; this is the first normative definition, following the same discipline as `docs/formats/evidence-log.md` and `docs/formats/sources.md`. Every field name, value literal, and structural rule below is authoritative. A parser author must be able to implement a conformant reader without consulting any other document.

## ID format

Open-question entries use a heading pattern:

```
## OQ-NNN: <short title>
```

`NNN` is a zero-padded three-digit decimal integer, starting at `001` and incrementing monotonically. IDs are never reused. The title after the colon is required and is a short, human-readable label for the question (for example, `OQ-003: Information selection and curation psychology`).

Either `structure-architect` (seeding entries at outline time) or `research-librarian` (appending a question surfaced during research) may allocate a new OQ ID. Whichever agent appends reads the current `research/open-questions.md` from top to bottom to find the highest existing OQ number and increments by one before writing the next entry at the end of the file.

## Field grammar

Each entry begins with the heading, followed by a blank line, then a fixed set of `Label: value` lines with no bullet prefix. The parser reads each non-blank line under the heading as `Label: value`, split on the first colon. Field labels are capitalized exactly as shown below; this is a distinct convention from the lowercase `- key: value` grammar in `docs/formats/evidence-log.md` and `docs/formats/sources.md`, preserved here because it matches every open-questions entry already shipped in `docs/reference/*.example.md`.

| Field | Required | Allowed values and notes |
|---|---|---|
| `Source chapter` | required | The originating chapter as `Chapter <N> (<Working title>)`, or the originating agent's name when the question is not tied to one chapter (for example, a question surfaced during general, un-scoped research) |
| `Outline item` | optional | The `EV-NEEDED` line from `structure/outline.md` that this question traces to; present when `structure-architect` seeds the entry from an outline evidence-needed item, omitted when the question arises independently during a research session |
| `Question` | required | The open question itself, in the author's or agent's own words; may wrap across multiple lines with a two-space continuation indent |
| `Status` | required | One of `open` or `resolved` |
| `Resolved-by` | required when `Status` is `resolved`; absent otherwise | A comma-separated list of the EV and SRC IDs (each with its parenthesized handle) that resolve the question, for example `EV-0012 (intentional-selection-sustainability), SRC-0007 (Johnson 2012)` |
| `Date` | required | Calendar date the entry was added, `YYYY-MM-DD` |

### Status values

| Value | Meaning | Set by |
|---|---|---|
| `open` | Logged; not yet resolved by evidence | `structure-architect` or `research-librarian` on creation |
| `resolved` | The question is addressed by one or more EV entries (and, when relevant, the SRC record backing them), cited in `Resolved-by` | `research-librarian` |

The literal `Status: resolved` is the resolved marker: `research-pass` Step 5 counts every entry in scope whose `Status` line is not exactly `Status: resolved` as still open.

## Ordering and placement rules

- `research/open-questions.md` is append-only: entries are never deleted. New entries are appended at the end of the file.
- OQ IDs are assigned in strict ascending order with no gaps.
- The `Status` field of an existing entry is updated in place from `open` to `resolved`, and a `Resolved-by` field is added at that time. This is the one narrow exception to append-only; no other field of a landed entry is altered.
- `structure-architect` appends one entry per evidence-needed item (and one per `[GAP]` marker) in the same invocation that writes `structure/outline.md`; the appends are never deferred to a follow-up session.
- `research-librarian` reads this file at the start of every session to load the research agenda, marks entries resolved as it logs the EV entries that address them, and may append new entries for questions it surfaces mid-session that were not anticipated by the outline.

## Example

An open entry seeded by `structure-architect` at outline time:

```markdown
## OQ-003: Information selection and curation psychology

Source chapter: Chapter 3 (Your Curation Practice)
Outline item: EV-NEEDED: Research on cognitive patterns distinguishing deliberate
  curators from passive information consumers.
Question: Is there research on how setting explicit selection criteria affects
  information consumption behavior and the quality of learning outcomes?
Status: open
Date: 2026-07-17
```

The same entry after `research-librarian` resolves it:

```markdown
## OQ-003: Information selection and curation psychology

Source chapter: Chapter 3 (Your Curation Practice)
Outline item: EV-NEEDED: Research on cognitive patterns distinguishing deliberate
  curators from passive information consumers.
Question: Is there research on how setting explicit selection criteria affects
  information consumption behavior and the quality of learning outcomes?
Status: resolved
Resolved-by: EV-0012 (intentional-selection-sustainability), SRC-0007 (Johnson 2012)
Date: 2026-07-17
```

## Consumed by

- `structure-architect`: writer; seeds one entry per evidence-needed item (and per `[GAP]` marker) atomically with the outline write.
- `research-librarian`: reader and writer; reads the agenda at session start, marks entries resolved, and appends new entries surfaced during research.
- `research-pass` skill: reads the unresolved agenda for the scope at Step 3 to present it for author approval, and re-reads at Step 5 to count items whose `Status` is not `resolved` for the session summary.
- `outline-book` skill: triggers the atomic `structure-architect` append described above; the skill itself writes no ledger files.
