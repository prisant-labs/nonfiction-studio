---
name: status-dashboard
user-invocable: true
argument-hint: ""
description: "Renders a read-only per-chapter status dashboard from .studio/progress.json (status, word count, open claims per entry) and the newest dot-form gate reports in .studio/gate/ (drift score, gate verdict per slug); highlights rows where drift exceeds thresholds.drift_score_max or where the newest gate report carries a block verdict; writes nothing; routes to init-project when progress.json is absent and to doctor when progress.json is malformed. Use when the author asks 'where am I on the book,' wants to 'check my progress,' or needs a quick status check before starting a session."
when_to_use: "Use when the author types the /status verb alias, asks how their book is going, or wants a project overview before starting a session. Do not invoke to run the quality gate (use run-quality-gate), diagnose project structure problems (use doctor), start a new project (use init-project), or for unrelated queries."
---

This skill is the read-only project status dashboard. It reads `.studio/progress.json` for per-chapter status, word count, and open claims; lists `.studio/gate/` for the newest dot-form gate report per chapter slug to supply drift score and gate verdict; reads `.studio/config.json` for the drift threshold; and renders the result as a Markdown table. Highlighted rows carry a block gate verdict or a drift score above the configured threshold. The skill writes nothing to any file or `.studio/` path.

**Status vocabulary.** Chapter status values are the committed schema enum verbatim: `empty`, `outlined`, `drafting`, `drafted`, `revised`, `gated`, `final`. These are the values defined in `templates/book-scaffold/.studio/progress.schema.json` and S-08 section 3. No mapping or display transformation is applied. `final` is a real chapter's terminal state, not merely the highest ordinal: reaching it requires a dated human attestation entry in `context/decisions.md`, and editing a chapter's file after it reaches `final` automatically falls it back to `revised` - both enforced by `hooks/post-tool-batch.mjs`, never by this skill. See the [ns-status CLI reference](../../docs/reference/cli/ns-status.md#the-promotion-ceremony-and-automatic-demotion) for the full ceremony; this skill only ever displays whatever `status` value `progress.json` already carries.

**Column sourcing.** Status, word count, and open claim count come exclusively from the `progress.json` chapters array (hook-maintained truth per TSK-050b (progress entry ownership)). Drift score and gate verdict come from the newest dot-form gate report per slug under `.studio/gate/` (filenames matching `<slug>.<YYYYMMDDTHHMMSSZ>.json`; the newest report per slug is identified by lexicographic sort of the timestamp suffix). A chapter with no gate report on record shows "-" in both the Drift and Gate cells. Whole-book `all.<YYYYMMDDTHHMMSSZ>.json` reports feed a totals-row annotation only, not per-chapter cells. The `progress.last_gate` per-chapter field is reserved and unpopulated in v1 per TSK-051 (run-quality-gate skill); the skill never reads it.

**Read-only covenant.** This skill writes nothing. No file writes, no `.studio/` mutations, no agent invocations. Grep-provable against the skill body.

**No agents invoked.** No chain edges exist for this skill.

Skill inputs read:
- `.studio/progress.json` (chapter status, word count, open_claim_count; totals block; required)
- `.studio/config.json` (thresholds.drift_score_max for highlight threshold; default 35 when absent)
- `.studio/gate/` directory listing (filenames via Bash; then Read of newest dot-form report per slug for drift and verdict; newest all-report for totals annotation)

No skill chain edges exist for this skill.

---

## Step 1 - Progress.json presence and validity check (mandatory first tool call)

Use the Bash tool to check whether the progress file is present:

```
test -f .studio/progress.json && echo HAS_PROGRESS || echo NO_PROGRESS
```

**NO_PROGRESS:** state the following and halt. Do not render any table.

> Project not initialized. `.studio/progress.json` was not found. Run `/nonfiction-studio:init-project` to scaffold the project and create the progress file.

**HAS_PROGRESS:** use the Read tool on `.studio/progress.json`. Parse the JSON and confirm the top-level object contains: `version` (integer equal to 2), `chapters` (array), and `totals` (object containing at least `word_count`, `open_claim_count`, and `chapters_final`). Each entry in `chapters` must contain `slug`, `status`, `word_count`, and `open_claim_count`. If the file is unreadable or any required field is absent or has the wrong type, state the following and halt. Never render a partial or incorrect dashboard.

> `.studio/progress.json` is malformed or unreadable: [state the specific parse error or missing field]. Run `/nonfiction-studio:doctor` to diagnose and repair the project state file.

On a valid parse, carry the `chapters` array and `totals` object forward to Step 2.

---

## Step 2 - Gate directory listing and per-slug report identification

Use the Bash tool to list the gate directory:

```
test -d .studio/gate && ls .studio/gate/ 2>/dev/null || echo NO_GATE_DIR
```

If the output is `NO_GATE_DIR` or the listing returns no filenames, there are no gate reports on record. All Drift and Gate cells in the table render as "-". Proceed to Step 3.

Otherwise, parse the filenames. Two patterns are significant:

- **Per-chapter dot-form reports:** `<slug>.<YYYYMMDDTHHMMSSZ>.json` where `<slug>` matches a chapter slug from `progress.json`. Example: `01-listening-before-speaking.20260718T090000Z.json`.
- **Whole-book reports:** `all.<YYYYMMDDTHHMMSSZ>.json`. These feed the totals-row annotation only, not per-chapter cells.

Ignore any file that does not match either pattern (for example `last-gate.json`).

For each chapter slug that appears in the listing, identify the newest per-slug report: among all matching filenames for that slug, sort lexicographically by the timestamp suffix and take the last one. Use the Read tool to load the newest report for each slug that has one. From each loaded report, extract:

- **Top-level `verdict`** (`pass`, `warn`, `block`, or `skip`): this becomes the Gate cell value.
- **Drift score from the `stylometry` check entry:** find the entry with `"check": "stylometry"` and parse the numeric value embedded in its `detail` string. Example: `"drift_score 38 exceeds threshold 35"` yields `38`; `"drift_score 0 is within threshold 35"` yields `0`. If the stylometry entry is absent or its verdict is `skip`, the Drift cell is "-".

For the whole-book annotation: among all `all.<ts>.json` files, identify the newest by lexicographic sort and use its top-level `verdict` as the totals-row annotation.

---

## Step 3 - Config read for drift threshold

Use the Read tool on `.studio/config.json`. Read the value at `thresholds.drift_score_max`. If the file is absent, unreadable, or the field is not present, use the default value `35` and record that the default was applied for the footer note in Step 5.

---

## Step 4 - Render the dashboard table

Build a Markdown table with these columns in this order:

| # | Title | Status | Words | Drift | Open Claims | Gate |
|---|---|---|---|---|---|---|

For each entry in `progress.json.chapters` (in array order):

- **#** - the two-digit numeric prefix from the slug (for example `01` from `01-listening-before-speaking`)
- **Title** - the `title` field if present in the progress entry; otherwise derive from the slug: drop the numeric prefix and replace hyphens with spaces (for example `listening before speaking` from `01-listening-before-speaking`)
- **Status** - the `status` field verbatim (one of `empty`, `outlined`, `drafting`, `drafted`, `revised`, `gated`, `final`)
- **Words** - the `word_count` field
- **Drift** - the numeric drift score parsed in Step 2; "-" if no gate report exists for this slug or if stylometry was skipped
- **Open Claims** - the `open_claim_count` field
- **Gate** - the top-level `verdict` from the newest gate report; "-" if no gate report exists for this slug

Rows that require a highlight per Step 5 receive a `!` prefix in the `#` cell. State the highlight mechanism used in the footer below the table.

After the chapter rows, add a totals row:
- Words: `totals.word_count`
- Open Claims: `totals.open_claim_count`
- Chapters final: `totals.chapters_final` of `totals.chapters_total` (omit the "of" clause if `chapters_total` is absent)
- If a whole-book all-report was identified in Step 2, append: `(whole-book gate: <verdict>)`

---

## Step 5 - Flag highlighted rows and add footer

Evaluate each chapter row against these two conditions:

1. **Drift above threshold:** the Drift value is a number AND it exceeds the `thresholds.drift_score_max` value from Step 3.
2. **Block verdict:** the Gate value is `block`.

A row satisfying either condition receives the `!` prefix in the `#` cell (applied in the rendered table from Step 4). If no rows satisfy either condition, state "No rows flagged" after the table.

Add a footer note:

> Drift threshold: `thresholds.drift_score_max` = `<value>` (from `.studio/config.json`[; default 35 applied - field was absent] ).

Omit the bracketed clause when the field was actually present.

---

## Step 6 - Suggest next actions

Present a next-actions list:

- For each chapter whose Gate cell is "-" (no gate report on record): suggest `/nonfiction-studio:run-quality-gate <slug>`.
- For each chapter where `open_claim_count` is greater than 0: suggest `/nonfiction-studio:fact-check-pass <slug>`.
- For each highlighted row where drift exceeds the threshold: note that a dedicated revision pass (`revise-pass`) is a Phase 2 skill and is not available in v1; suggest `/nonfiction-studio:draft-chapter <slug>` to revise the chapter directly, then re-run `/nonfiction-studio:run-quality-gate <slug>` to confirm the drift score has improved.
- For each highlighted row where the gate verdict is `block`: name the chapter and suggest `/nonfiction-studio:run-quality-gate <slug>` to inspect the blocking check details, then follow the remediation the gate report prescribes.

If all chapters have gate reports, zero open claims, and no highlighted rows, state that no immediate action is required and name the next un-started chapter from the array (first entry with status `empty`, `outlined`, or `drafting`).

---

## Failure behavior

**Missing `progress.json`.** Step 1 halts on `NO_PROGRESS` with the not-initialized message and routes to `init-project`. No table is rendered.

**Malformed or unreadable `progress.json`.** Step 1 halts on a parse error or missing required field with the malformed-file message and routes to `doctor`. Never renders a partial or incorrect dashboard.

**Missing or empty gate directory.** Step 2 produces no matching filenames. All Drift and Gate cells render as "-"; Step 6 suggests running the quality gate for every chapter.

**Missing or unreadable `.studio/config.json`.** Step 3 defaults to 35 and notes the default in the Step 5 footer. Not a halt condition; the dashboard renders normally.
