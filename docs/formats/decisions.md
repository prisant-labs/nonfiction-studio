# Decision Log Format

**Purpose.** This is the normative grammar for `context/decisions.md`, the append-only editorial and attestation trail defined in S-08 (schemas and file formats) section 12 and D-10 (compliance layer). The `SubagentStop` hook writes editorial outcome entries; the `publish-readiness` skill (Phase 2, not yet shipped) writes human-final-pass attestation entries; the `disclosure-report` skill (Phase 2, not yet shipped) and the export path read the file. Every field name, value constraint, and structural rule below is authoritative. A parser author must be able to implement a conformant reader without consulting any other document.

## Entry structure

Each entry is a Markdown heading followed by a bullet list. The heading pattern is:

```
### YYYY-MM-DD - <label>
```

The date on the heading is the calendar date the entry was written. The label is a short phrase identifying the decision or attestation. Entries are never edited after they land.

Each entry body is a Markdown bullet list with the following fields:

| Field | Type | Required | Allowed values and notes |
|---|---|---|---|
| `actor` | string | required | Either `author` or a roster slug identifying who made the decision |
| `decision` | string | required | One plain sentence stating what was decided or attested |
| `rationale` | string | required | One plain sentence explaining the reason |
| `links` | string | optional | Comma-separated list of bible-relative paths and reference IDs relevant to the decision; may be left blank |

## Ordering and placement rules

- `context/decisions.md` is append-only. New entries are always added at the end of the file.
- Entries are never edited or deleted after they land.
- The heading date is the calendar date the entry was written, not the date of the event being recorded.
- The `SubagentStop` hook appends one entry per editorial outcome it records.
- The `publish-readiness` skill (Phase 2, not yet shipped) appends one entry per human-final-pass attestation per D-10 (compliance layer).
- `bin/ns-doctor` validates field presence and reports entries missing required fields.

## Example

A human-final-pass attestation written by the `publish-readiness` skill (Phase 2, not yet shipped):

```markdown
### 2026-07-17 - human final pass attestation, chapter 03
- actor: author
- decision: Chapter 03 approved for gate after a full manual read.
- rationale: Stylometry warned on drift but the technical section reads correctly for the audience.
- links: .studio/gate/03-the-signal.20260717T154022Z.json, EV-0031 (survey figure)
```

An editorial outcome written by the `SubagentStop` hook:

```markdown
### 2026-07-17 - outline approved, chapter 04
- actor: developmental-editor
- decision: Outline accepted with minor structural adjustments.
- rationale: Chapter flow matches the thesis arc established in chapter 01.
- links: structure/04-the-archive.md
```

## Consumed by

- `SubagentStop` hook: appends editorial outcome entries when a named agent completes a drafting or editorial turn.
- `publish-readiness` skill (Phase 2, not yet shipped): appends the human-final-pass attestation entry required by D-10 (compliance layer) before clearing the publish gate; part of the TSK-045 era compliance flow.
- `disclosure-report` skill (Phase 2, not yet shipped): reads the decision log to include editorial decisions and attestations in the AI disclosure report; part of the TSK-045 era compliance flow.
- `intake-interview` flow: the structured author interview that seeds the initial voice profile; any decision entries from this flow are the earliest entries in the log.
- Export path: reads the log to include the attestation trail in the exported manuscript package.
