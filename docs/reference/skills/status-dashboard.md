---
title: "status-dashboard skill reference"
description: "Reference for the status-dashboard skill - the read-only project overview that renders per-chapter status, word count, drift score, open claims, and gate verdict from progress.json and .studio/gate/; writes nothing"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "status", "dashboard", "progress", "overview", "gate"]
---

# status-dashboard

The `status-dashboard` skill renders a read-only per-chapter project overview from `.studio/progress.json` and `.studio/gate/`. It is a Phase 1 skill specified in S-06 3.9 (skills and invocation surface) and governed by D-06 (single-writer state discipline) and S-08 sections 3 and 11.

## Purpose

`status-dashboard` gives the author an at-a-glance view of their book's state: how far each chapter has progressed, how many words have been written, whether drift or coverage issues have been flagged by a gate run, and which chapters still need a gate run. The skill reads `.studio/progress.json` for per-chapter status, word count, and open claims; lists `.studio/gate/` for the newest dot-form gate report per chapter slug to supply drift score and gate verdict; and reads `.studio/config.json` for the drift threshold. It renders the result as a Markdown table and presents a next-actions list.

**Column sourcing.** Status, word count, and open claim count come from the `progress.json` chapters array (hook-maintained truth per TSK-050b (progress entry ownership)). Drift score and gate verdict come from the newest dot-form gate report per slug in `.studio/gate/` (filenames `<slug>.<YYYYMMDDTHHMMSSZ>.json`; newest identified by lexicographic sort of the timestamp suffix). A chapter with no gate report on record shows "-" in both the Drift and Gate cells. Whole-book `all.<YYYYMMDDTHHMMSSZ>.json` reports annotate the totals row only, not per-chapter cells. The `progress.last_gate` per-chapter field is reserved and unpopulated in v1 per TSK-051 (run-quality-gate skill); this skill never reads it.

**Status vocabulary.** The Status column displays the committed schema enum values verbatim: `empty`, `outlined`, `drafting`, `drafted`, `revised`, `gated`, `final`. No mapping or renaming is applied. `final` is a real terminal state: reaching it requires a dated human attestation entry in `context/decisions.md`, and editing a chapter's file after it reaches `final` automatically falls it back to `revised`, both enforced by `hooks/post-tool-batch.mjs` rather than by this skill. See [ns-status's ceremony section](../cli/ns-status.md#the-promotion-ceremony-and-automatic-demotion) for the full rule; this skill only ever displays whatever `status` value `progress.json` already carries.

**Highlight mechanism.** A row is highlighted when its newest gate report carries a `block` verdict OR when its drift score (parsed from the gate report's `stylometry` check detail) exceeds `thresholds.drift_score_max` from `.studio/config.json` (default 35 when the field is absent).

**The skill writes nothing.** No file writes, no `.studio/` mutations, no agent invocations. Grep-provable against the skill body.

**No agents invoked.** This skill has no chain edges.

## Invocation

```
/nonfiction-studio:status-dashboard
```

No argument is accepted or needed.

Alternate entry points:
- Via the `studio` dispatcher: routes here from Path 4 (Review quality and status) before offering `run-quality-gate`
- Verb alias: `/status` (the namespaced `/nonfiction-studio:status-dashboard` form also works)
- Author asks "how is my book going" or "show me the project status"

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `.studio/progress.json` | Step 1 (Bash probe and Read) | Required: chapter status, word count, open_claim_count, totals block |
| `.studio/config.json` | Step 3 (Read) | `thresholds.drift_score_max` for the highlight threshold; default 35 when absent |
| `.studio/gate/` | Step 2 (Bash listing, then Read of newest per-slug report) | Drift score and gate verdict per chapter; newest all-report for totals annotation |

### Outputs

The skill writes no files and performs no state mutations.

The rendered Markdown table appears in the conversation only.

## Flow Summary

The skill runs six steps.

1. **Progress.json presence and validity check (mandatory first tool call).** Uses a Bash probe (`test -f .studio/progress.json`) to detect presence (`HAS_PROGRESS`/`NO_PROGRESS`). On `NO_PROGRESS`, presents the not-initialized message and routes to `init-project`; halts without rendering a table. On `HAS_PROGRESS`, reads and validates the JSON: `version`, `chapters` array, `totals` object, and required per-chapter fields must all be present and correctly typed. Malformed or unreadable JSON presents the malformed-file message, routes to `doctor`, and halts. The skill never renders a partial dashboard; any parse failure is a complete halt. This is the deterministic-guard convention per S-06 1.1 (skill anatomy and discovery).

2. **Gate directory listing and per-slug report identification.** Uses Bash (`test -d .studio/gate && ls .studio/gate/`) to list the gate directory. Parses filenames to identify dot-form per-slug reports (`<slug>.<YYYYMMDDTHHMMSSZ>.json`) and whole-book reports (`all.<YYYYMMDDTHHMMSSZ>.json`). Ignores non-matching files (for example `last-gate.json`). For each chapter slug with at least one matching file, the newest report is selected by lexicographic sort of the timestamp suffix and read via the Read tool. Extracts the top-level `verdict` (Gate cell) and the numeric drift score from the `stylometry` check `detail` string (Drift cell). Chapters with no matching gate file receive "-" in both cells.

3. **Config read for drift threshold.** Reads `.studio/config.json` and extracts `thresholds.drift_score_max`. Defaults to 35 if the file or field is absent; notes the default in the footer.

4. **Render the dashboard table.** Builds the Markdown table with columns #, Title, Status, Words, Drift, Open Claims, Gate. Chapter rows come from `progress.json.chapters` in array order; the Status cell is the schema enum value verbatim. A totals row from `progress.json.totals` closes the table; if a whole-book all-report was found, its verdict annotates the totals row.

5. **Flag highlighted rows and add footer.** Evaluates each row: a `!` prefix is applied to the `#` cell when drift exceeds the threshold or when the gate verdict is `block`. States "No rows flagged" when neither condition is met. Adds a footer note with the threshold value and its source.

6. **Suggest next actions.** For chapters with Gate = "-": suggests `run-quality-gate`. For chapters with open claims greater than 0: suggests `fact-check-pass`. For drift-highlighted rows: suggests `revise-pass` then re-gate. For block-highlighted rows: suggests re-running `run-quality-gate` for check details, then the prescribed remediation. When all chapters are clean: states no immediate action and names the next un-started chapter.

## Column Reference

| Column | Source file | Source field | Value when no gate report |
|---|---|---|---|
| # | progress.json | slug numeric prefix | always present |
| Title | progress.json | `title` field or slug-derived | always present |
| Status | progress.json | `status` (schema enum) | always present |
| Words | progress.json | `word_count` | always present |
| Drift | `.studio/gate/<slug>.<ts>.json` | `stylometry` check `detail` (numeric parse) | - |
| Open Claims | progress.json | `open_claim_count` | always present |
| Gate | `.studio/gate/<slug>.<ts>.json` | top-level `verdict` | - |

## Status Vocabulary

The seven valid status values and their lifecycle position (from S-08 section 3 and the committed progress schema):

| Value | Lifecycle position |
|---|---|
| `empty` | Chapter slot created; no content yet |
| `outlined` | Chapter outline committed |
| `drafting` | Draft pass in progress |
| `drafted` | Draft complete; not yet gated |
| `revised` | Revision pass complete |
| `gated` | Gate run passed |
| `final` | Author sign-off complete |

## Highlight Conditions

A row is highlighted (leading `!` in the `#` cell) when either:

- The drift score parsed from the newest gate report's `stylometry` check detail is numeric AND exceeds `thresholds.drift_score_max` (default 35).
- The newest gate report's top-level `verdict` is `block`.

Chapters with no gate report cannot be highlighted on either condition. The footer note always states the threshold used and whether the config value or the default was applied.

## Progress.json and the Totals Row

The totals row comes exclusively from `progress.json.totals`, which the PostToolBatch hook recomputes on every write so the dashboard never sums the chapters array itself. The fields used are:

- `totals.word_count` - total word count across all chapters
- `totals.open_claim_count` - total open claims across all chapters
- `totals.chapters_final` - count of chapters at status `final`
- `totals.chapters_total` - total chapter count (used to form "N of M final"; omitted if absent)

If a whole-book `all.<ts>.json` gate report is present in `.studio/gate/`, the newest such report's `verdict` is appended to the totals row as `(whole-book gate: <verdict>)`.

## Surface Behavior

The dashboard renders identically on all three surfaces per D-14 (three-surface compatibility). All file reads use the Read and Bash tools, which are available on all surfaces. The output is a Markdown table presented in the conversation.

## Failure Behavior

**Missing `progress.json`.** Step 1 halts with the not-initialized message and routes to `/nonfiction-studio:init-project`. No table is rendered.

**Malformed or unreadable `progress.json`.** Step 1 halts with a description of the specific parse error or missing field and routes to `/nonfiction-studio:doctor`. Never renders a partial or incorrect dashboard; partial data is more misleading than a clear error.

**Missing or empty gate directory.** All Drift and Gate cells render as "-"; Step 6 suggests running the quality gate for every chapter.

**Missing or unreadable `.studio/config.json`.** Step 3 defaults to 35 and notes this in the Step 5 footer. The dashboard renders normally; this is not a halt condition.

## Worked Example

See [status-dashboard.example.md](./status-dashboard.example.md) for a condensed transcript of a `status-dashboard` run over the committed two-chapter sample book "The Quiet Network" (see `examples/sample-book/`). All table values in the example are cross-checked against the committed `examples/sample-book/.studio/progress.json`, `.studio/config.json`, and `.studio/gate/` files.
