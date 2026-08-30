# Decision Log Format

**Purpose.** This is the normative grammar for `context/decisions.md`, the append-only editorial and attestation trail defined in S-08 (schemas and file formats) section 12 and D-10 (compliance layer). The `SubagentStop` hook (Phase 2, not yet shipped) will write editorial outcome entries once built; the `publish-readiness` skill (Phase 2, not yet shipped) writes human-final-pass attestation entries; the `disclosure-report` skill (Phase 2, not yet shipped) and the export path read the file. Every field name, value constraint, and structural rule below is authoritative. A parser author must be able to implement a conformant reader without consulting any other document.

**Shipped consumer: the chapter promotion ceremony.** `hooks/post-tool-batch.mjs` (`.studio/progress.json`'s sole writer) now reads and parses this file on every relevant write to decide whether a chapter may hold the terminal `final` status. A human-final-pass attestation entry, in the shape shown below, is what makes a chapter eligible; see "Promotion attestation shape" below for the exact rule and [`ns-status`'s ceremony section](../reference/cli/ns-status.md#the-promotion-ceremony-and-automatic-demotion) for the full lifecycle. This is a real, shipped reader - not a Phase 2 placeholder - even though the `publish-readiness` skill that will eventually WRITE these entries is still Phase 2; until that skill ships, a human writes the attestation entry directly.

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
- The `SubagentStop` hook (Phase 2, not yet shipped) will append one entry per editorial outcome it records, once built.
- The `publish-readiness` skill (Phase 2, not yet shipped) appends one entry per human-final-pass attestation per D-10 (compliance layer).
- `hooks/lib/status-engine.mjs`'s `validateDecisionEntry` (called from `hooks/post-tool-batch.mjs`) validates field presence and reports entries missing a required field; this is the shipped validator for this grammar. `bin/ns-doctor` does not currently validate this file - an earlier version of this document overclaimed that it did.

## Promotion attestation shape

Reaching the `final` chapter status - the terminal state on the schema's `status` enum (`templates/book-scaffold/.studio/progress.schema.json`); some planning prose calls this same state "locked," but no separate enum value exists for it - requires a promotion attestation entry meeting all of the following, checked by `hooks/lib/status-engine.mjs`'s `isEligibleForFinal`:

- `actor` is the literal string `author`, exactly - not a roster slug. A roster-slug entry (for example `actor: fact-checker`) records an agent's editorial judgment, not the human final-pass sign-off `final` represents, and never confers eligibility on its own.
- `actor`, `decision`, and `rationale` are all present and non-empty (the ordinary required-field rule above).
- `links` names the chapter's slug - as a `chapters/<slug>.md` path, a `.studio/gate/<slug>.<timestamp>.json` gate-report path, or the bare slug - so the entry can be matched back to the chapter it attests.

`hooks/post-tool-batch.mjs` checks this on every relevant write and enforces it in both directions: a chapter set to `final` with no matching entry is reverted before the write ever surfaces to a reader, and a chapter whose file is edited AFTER reaching `final` is demoted regardless of whether a matching entry still exists - editing invalidates the prior attestation, because this grammar carries no content fingerprint to tell "reverted to the exact attested text" apart from "coincidentally identical." Promotion itself is always a human editing `.studio/progress.json` directly; no hook, skill, or CLI in this project ever assigns `final` on a chapter's behalf. Consequently, the attestation entry must be written in a batch that does NOT also write the chapter's own file - a batch that does both is demoted by the edit half before the promotion can stand.

## Example

A human-final-pass attestation written by the `publish-readiness` skill (Phase 2, not yet shipped):

```markdown
### 2026-07-17 - human final pass attestation, chapter 03
- actor: author
- decision: Chapter 03 approved for gate after a full manual read.
- rationale: Stylometry warned on drift but the technical section reads correctly for the audience.
- links: .studio/gate/03-the-signal.20260717T154022Z.json, EV-0031 (survey figure)
```

An editorial outcome that will be written by the `SubagentStop` hook (Phase 2, not yet shipped):

```markdown
### 2026-07-17 - outline approved, chapter 04
- actor: developmental-editor
- decision: Outline accepted with minor structural adjustments.
- rationale: Chapter flow matches the thesis arc established in chapter 01.
- links: structure/04-the-archive.md
```

## Consumed by

- `hooks/post-tool-batch.mjs` (shipped): reads and parses this file on every relevant write to decide chapter promotion and automatic demotion; see "Promotion attestation shape" above. The one parser and eligibility predicate it uses live in `hooks/lib/status-engine.mjs` (`parseDecisionsLog`, `validateDecisionEntry`, `isEligibleForFinal`), shared so the hook and the deterministic chapter board cannot drift on what "eligible" means.
- `SubagentStop` hook (Phase 2, not yet shipped): will append editorial outcome entries when a named agent completes a drafting or editorial turn, once built.
- `publish-readiness` skill (Phase 2, not yet shipped): appends the human-final-pass attestation entry required by D-10 (compliance layer) before clearing the publish gate; part of the TSK-045 era compliance flow.
- `disclosure-report` skill (Phase 2, not yet shipped): reads the decision log to include editorial decisions and attestations in the AI disclosure report; part of the TSK-045 era compliance flow.
- `nfs-interview` flow: the structured author interview that seeds the initial voice profile; any decision entries from this flow are the earliest entries in the log.
- Export path: reads the log to include the attestation trail in the exported manuscript package.
