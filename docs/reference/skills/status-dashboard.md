---
title: "status-dashboard skill reference"
description: "Reference for the status-dashboard skill - the read-only project overview that fronts bin/ns-status in a single Bash call and renders the per-chapter status, word count, drift score, open claims, and gate verdict directly from its JSON output; writes nothing"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "status", "dashboard", "progress", "overview", "gate"]
---

# status-dashboard

The `status-dashboard` skill renders a read-only per-chapter project overview by fronting `bin/ns-status` in a single Bash call. It is a Phase 1 skill specified in S-06 3.9 (skills and invocation surface) and governed by D-06 (single-writer state discipline) and S-08 (schemas and file formats) sections 3 and 11.

## Purpose

`status-dashboard` gives the author an at-a-glance view of their book's state: how far each chapter has progressed, how many words have been written, whether drift or coverage issues have been flagged by a gate run, and which chapters still need a gate run. The skill resolves the plugin root, invokes `bin/ns-status --json`, and renders the result: every status value, word count, open-claim count, drift score, gate verdict, threshold value, and highlight decision in the rendered table is read directly from a field the CLI has already computed. The skill performs no arithmetic, parses no number out of prose, and compares nothing against a threshold itself.

**Column sourcing.** Every cell comes directly from `bin/ns-status`'s JSON output. The CLI itself reads `.studio/progress.json` for status, word count, and open claims (hook-maintained truth per TSK-050b (progress entry ownership)); lists `.studio/gate/` for the newest dot-form gate report per chapter slug to supply drift score and gate verdict (filenames `<slug>.<YYYYMMDDTHHMMSSZ>.json`; newest identified by lexicographic sort of the timestamp suffix); and reads `.studio/config.json` for the drift threshold. A chapter with no gate report on record shows "-" in both the Drift and Gate cells. Whole-book `all.<YYYYMMDDTHHMMSSZ>.json` reports annotate the totals row only, not per-chapter cells. The `progress.last_gate` and `progress.drift_score` per-chapter fields are never treated as authoritative; see the [ns-status CLI reference](../cli/ns-status.md) for the full derivation.

**Status vocabulary.** The Status column displays the committed schema enum values verbatim: `empty`, `outlined`, `drafting`, `drafted`, `revised`, `gated`, `final`. No mapping or renaming is applied. `final` is a real terminal state: reaching it requires a dated human attestation entry in `context/decisions.md`, and editing a chapter's file after it reaches `final` automatically falls it back to `revised`, both enforced by `hooks/post-tool-batch.mjs` rather than by this skill or by `bin/ns-status`. See [ns-status's ceremony section](../cli/ns-status.md#the-promotion-ceremony-and-automatic-demotion) for the full rule; this skill only ever displays whatever `status` value the CLI's JSON output already carries.

**Highlight mechanism.** A row is highlighted when `bin/ns-status`'s JSON marks its `highlighted` field `true` - the CLI's own determination that either the drift score exceeds `thresholds.drift_score_max` from `.studio/config.json`, or the newest gate report carries a `block` verdict. The skill reads that field directly; it never re-derives the comparison.

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
| `.studio/progress.json` | By `bin/ns-status`, via its Step 2 `--project=.` invocation | Chapter status, word count, open_claim_count, totals block |
| `.studio/config.json` | By `bin/ns-status`, via its Step 2 `--project=.` invocation | `thresholds.drift_score_max` for the highlight threshold; the CLI applies its own built-in default when absent |
| `.studio/gate/` | By `bin/ns-status`, via its Step 2 `--project=.` invocation | Drift score and gate verdict per chapter; newest all-report for the totals annotation |

The skill itself performs no file reads beyond the plugin-root lookup in Step 1; every project-state read happens inside `bin/ns-status`.

### Outputs

The skill writes no files and performs no state mutations.

The rendered Markdown table appears in the conversation only.

## Flow Summary

The skill runs three steps.

1. **Resolve the plugin root.** The same three-tier lookup every CLI-wrapper skill in this plugin uses: a primary lookup against `extraKnownMarketplaces['nonfiction-studio'].source.path` in `~/.claude/settings.json`, a `~/.claude/plugins/cache` search fallback, and a dev-mode fallback that checks for `bin/ns-status` in the current directory (the same routine as `skills/init-project/SKILL.md` Step 4). If all three lookups fail, the skill halts and names the settings.json and cache paths it attempted; `bin/ns-status` is never invoked.

2. **Single Bash invocation.** Runs exactly one Bash call: `node "<plugin-root>/bin/ns-status" --project=. --json`. Captures the exit code, stdout (JSON), and stderr. No directory listing, no separate Read calls, and no other CLI invocation happen anywhere in this skill.

3. **Present the result (exit-code mapping).** `bin/ns-status` has no findings-based exit code; a highlighted row is reported inside the board, not signaled through the exit code.
   - **Exit 0:** parses stdout as the board JSON and renders the table, totals row, and footer directly from its fields (see "Column Reference" below), then presents the next-actions list (see "Next Actions" below).
   - **Exit 2:** never renders a table. Routes on the stderr message: "No book root found" or an ENOENT-shaped "Cannot read progress.json" routes to `init-project`; any other message (a malformed `progress.json`, `config.json`, or `meta.json`, or an internal argument error) routes to `doctor`.

## Column Reference

| Column | JSON field | Value when absent |
|---|---|---|
| # | `chapters[].number`, prefixed `! ` when `chapters[].highlighted` is `true` | always present |
| Title | `chapters[].title` | always present |
| Status | `chapters[].status` (schema enum, verbatim) | always present |
| Words | `chapters[].wordCount` | always present |
| Drift | `chapters[].drift` | `-` when `null` |
| Open Claims | `chapters[].openClaimCount` | always present |
| Gate | `chapters[].gate` | `-` when `null` |

The totals row reads `totals.wordCount`, `totals.openClaimCount`, `totals.chaptersFinal`, and (when not `null`) `totals.chaptersTotal`; the top-level `wholeBookGate`, when not `null`, annotates the totals row. The footer reads `thresholds.driftScoreMax` and `thresholds.driftScoreMaxIsDefault` directly, and (when not `null`) `totals.chaptersRemaining`. See the [ns-status CLI reference](../cli/ns-status.md#json---json) for the full JSON shape.

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

## Next Actions

Presented after the table and footer, on exit 0 only:

- For each chapter whose `gate` field is `null`: suggest `/nonfiction-studio:run-quality-gate <slug>`.
- For each chapter whose `openClaimCount` is greater than 0: suggest `/nonfiction-studio:fact-check-pass <slug>`.
- For each chapter with `highlighted: true` and `gate` equal to `block`: suggest `/nonfiction-studio:run-quality-gate <slug>` to inspect the blocking check details.
- For each chapter with `highlighted: true` and `gate` not equal to `block`: note that `revise-pass` is Phase 2 scope and not available in v1; suggest `/nonfiction-studio:draft-chapter <slug>` to revise, then re-run `/nonfiction-studio:run-quality-gate <slug>`.
- If every chapter has a non-null `gate`, no chapter has open claims, and no chapter is highlighted: state that no immediate action is required and name the next un-started chapter (the first entry with `status` in `empty`, `outlined`, or `drafting`).

## Progress.json and the Totals Row

The totals row comes from `bin/ns-status`'s JSON `totals` object, which the CLI derives from `progress.json.totals` - the field the PostToolBatch hook recomputes on every write, so neither the CLI nor the skill sums the chapters array itself. The fields used are:

- `totals.wordCount` - total word count across all chapters
- `totals.openClaimCount` - total open claims across all chapters
- `totals.chaptersFinal` - count of chapters at status `final`
- `totals.chaptersTotal` and `totals.chaptersRemaining` - total chapter count and the remaining-to-final count (both `null` when `progress.json`'s totals carry no `chapters_total` field)

If a whole-book `all.<ts>.json` gate report is present in `.studio/gate/`, the JSON's top-level `wholeBookGate` carries its verdict, which the skill appends to the totals row as `(whole-book gate: <verdict>)`.

## Surface Behavior

The dashboard renders identically on all three surfaces per D-14 (three-surface compatibility). The Bash tool, used for plugin-root resolution and the single `bin/ns-status` invocation, is available on all surfaces. The output is a Markdown table presented in the conversation.

## Failure Behavior

**Plugin root cannot be resolved.** Step 1 halts before invoking `bin/ns-status`. Reports the settings.json path and cache path attempted. No table is rendered.

**No book root found.** Step 3 halts on the "No book root found" stderr message with the not-initialized message and routes to `/nonfiction-studio:init-project`. No table is rendered.

**`.studio/progress.json` missing.** Step 3 halts on the ENOENT-shaped `Cannot read progress.json` stderr message and routes to `/nonfiction-studio:init-project`. No table is rendered.

**Any other `bin/ns-status` error.** A malformed `progress.json`, `config.json`, or `meta.json`, or an internal argument error, all route to `/nonfiction-studio:doctor` with the stderr content verbatim. Never renders a partial or incorrect dashboard; partial data is more misleading than a clear error.

**Missing or empty gate directory.** Not a halt condition. `bin/ns-status` returns `null` for `drift` and `gate` on every chapter with no matching report; the skill renders "-" for both cells and Next Actions suggests running the quality gate for every such chapter.

**Missing or unreadable `.studio/config.json`.** Not a halt condition. `bin/ns-status` applies its own built-in default and reports `driftScoreMaxIsDefault: true`, which the footer states plainly.

## Worked Example

See [status-dashboard.example.md](./status-dashboard.example.md) for a condensed transcript of a `status-dashboard` run over the committed two-chapter sample book "The Quiet Network" (see `examples/sample-book/`). The example is grounded in a live `bin/ns-status --json` run against a scratch copy of the fixture, made outside the repository; every value in the rendered table is quoted verbatim from that run's JSON output, not hand-authored.
