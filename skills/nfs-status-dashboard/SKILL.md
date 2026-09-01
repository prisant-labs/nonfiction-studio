---
name: nfs-status-dashboard
user-invocable: true
argument-hint: ""
description: "Fronts the read-only bin/ns-status engine in a single Bash call: renders the per-chapter status board (status, word count, open claims, drift statistic, gate verdict) and whole-book totals directly from its JSON output, marking each row the CLI itself flags as highlighted (a drift statistic above that same row's own calibrated threshold, or a block gate verdict); writes nothing; routes to nfs-new-book when no book root or progress.json is found, and to nfs-doctor on any other engine error. Use when the author asks 'where am I on the book,' wants to 'check my progress,' or needs a quick status check before starting a session."
when_to_use: "Use when the author asks how their book is going, or wants a project overview before starting a session. Do not invoke to run the quality gate (use nfs-check-chapter), diagnose project structure problems (use nfs-doctor), start a new project (use nfs-new-book), or for unrelated queries."
---

This skill is the read-only project status dashboard. It fronts `bin/ns-status` in a single Bash call, parses its JSON output, and renders the per-chapter board and whole-book totals directly from that output. The skill performs no arithmetic and parses no number out of prose: every status value, word count, open-claim count, drift statistic, gate verdict, threshold value, and highlight decision in the rendered table is read directly from a field `bin/ns-status` has already computed. The skill writes nothing to any file or `.studio/` path.

**Status vocabulary.** Chapter status values are the committed schema enum verbatim: `empty`, `outlined`, `drafting`, `drafted`, `revised`, `gated`, `final`. These are the values defined in `templates/book-scaffold/.studio/progress.schema.json` and S-08 (schemas and file formats) section 3. No mapping or display transformation is applied. `final` is a real chapter's terminal state, not merely the highest ordinal: reaching it requires a dated human attestation entry in `context/decisions.md`, and editing a chapter's file after it reaches `final` automatically falls it back to `revised` - both enforced by `hooks/post-tool-batch.mjs`, never by this skill. See the [ns-status CLI reference](../../docs/reference/cli/ns-status.md#the-promotion-ceremony-and-automatic-demotion) for the full ceremony; this skill only ever displays whatever `status` value `bin/ns-status`'s JSON output already carries.

**Column sourcing.** Every cell in the table, and the totals row, comes directly from `bin/ns-status`'s JSON output. The CLI itself reads `.studio/progress.json` and the newest dot-form gate report per chapter slug under `.studio/gate/`, and has already resolved which row counts as highlighted and what that row's own threshold is; `.studio/config.json` is loaded only as part of book-root discovery (a malformed one still halts the CLI), and its content, including `stylometry.baseline` and its calibration ladder, is never consulted by the board computation - each row's threshold comes entirely from that SAME chapter's own newest gate report. See the [ns-status CLI reference](../../docs/reference/cli/ns-status.md) for exactly how each field is derived, including which report file counts as newest and why `progress.json`'s per-chapter `last_gate` and `drift_score` fields are never treated as authoritative.

**Read-only covenant.** This skill writes nothing. No file writes, no `.studio/` mutations, no agent invocations. Grep-provable against the skill body.

**No agents invoked.** No chain edges exist for this skill.

Skill inputs read (by `bin/ns-status` via `--project=.`):
- `.studio/progress.json` (chapter status, word count, open_claim_count; totals block; required)
- `.studio/config.json` is loaded only as part of book-root discovery (a malformed one still halts the CLI with exit 2); its content is never consulted by the board computation - the per-chapter drift threshold is per-report, read from each chapter's own newest gate report, not from config - see the [ns-status CLI reference](../../docs/reference/cli/ns-status.md)
- `.studio/gate/` directory listing, then the newest report per chapter slug (drift statistic and gate verdict per chapter; newest whole-book report for the totals annotation)

No skill chain edges exist for this skill.

---

## Step 1 - Resolve the plugin root

Use the Bash tool to run the primary lookup:
```
node -e "const s=require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8');const m=JSON.parse(s).extraKnownMarketplaces;const ns=m&&m['nonfiction-studio'];console.log(ns&&ns.source&&ns.source.path||'not-found')"
```

The output is the plugin root. If it prints `not-found`, run the platform cache fallback:
```
find "$HOME/.claude/plugins/cache" -maxdepth 3 -type d -name "nonfiction-studio*" 2>/dev/null | head -1
```

If that also returns nothing, run the dev-mode fallback:
```
test -f bin/ns-status && pwd || echo not-found
```

If all three lookups fail: halt immediately. Report the settings.json path attempted (`$HOME/.claude/settings.json`) and the cache path attempted (`$HOME/.claude/plugins/cache`). Do not invoke ns-status. Ask the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>` for Step 2.

**Shared plugin-root convention.** This three-tier resolution (settings.json lookup, plugins-cache search, dev-mode fallback) is the same routine as `skills/nfs-new-book/SKILL.md` Step 4.

---

## Step 2 - Single Bash invocation

Use the Bash tool to invoke `bin/ns-status`. This is the ONE Bash call for this invocation.

```
node "<plugin-root>/bin/ns-status" --project=. --json
```

Capture the exit code, stdout (JSON), and stderr. Proceed to Step 3.

---

## Step 3 - Present the result (exit-code mapping)

`bin/ns-status` has no findings-based exit code: a highlighted row is reported inside the board, not signaled through the exit code. There are exactly two outcomes to handle.

### Exit 0 - render the dashboard

Parse stdout as the board JSON. Build a Markdown table with columns `#`, `Title`, `Status`, `Words`, `Drift`, `Threshold`, `Open Claims`, `Gate`. For each entry in the JSON's `chapters` array, in array order, render one row:

- **#** - the entry's `number` field; when the entry's `highlighted` field is `true`, prefix the cell with `! `.
- **Title** - the entry's `title` field.
- **Status** - the entry's `status` field, verbatim (see "Status vocabulary" above).
- **Words** - the entry's `wordCount` field.
- **Drift** - the entry's `drift` field; render `-` when it is `null`.
- **Threshold** - the entry's `threshold` field (that SAME chapter's own newest gate report resolved this from its calibration ladder; ADR-0012, voice verdict scope); render `-` when it is `null`.
- **Open Claims** - the entry's `openClaimCount` field.
- **Gate** - the entry's `gate` field; render `-` when it is `null`.

Add a totals row from the JSON's `totals` object: Words = `totals.wordCount`, Open Claims = `totals.openClaimCount`, and a "Chapters final" cell reading `totals.chaptersFinal` followed by `of <totals.chaptersTotal> final` when `chaptersTotal` is not `null`, or just `<totals.chaptersFinal> final` when it is. When the JSON's top-level `wholeBookGate` is not `null`, append `(whole-book gate: <wholeBookGate>)` to the totals row.

Below the table, there is no board-wide drift-threshold footer line: each row already carries its own Threshold cell (there is no longer a single config-sourced number to state once - ADR-0012 (voice verdict scope) retired `thresholds.drift_score_max`). When `totals.chaptersRemaining` is not `null`, add a line: "`<totals.chaptersRemaining>` chapter(s) remaining to final."

If no entry in `chapters` has `highlighted: true`, state "No rows flagged." after the footer. Otherwise, state that rows are marked with a leading `!` because `bin/ns-status` flagged them (drift above that same row's own calibrated threshold, or a block gate verdict).

**Next actions.** After the table and footer, present a next-actions list:

- For each chapter whose `gate` field is `null` (no gate report on record): suggest `/nonfiction-studio:nfs-check-chapter <slug>`.
- For each chapter whose `openClaimCount` is greater than 0: suggest `/nonfiction-studio:nfs-fact-check <slug>`.
- For each chapter with `highlighted: true` and `gate` equal to `block`: name the chapter and suggest `/nonfiction-studio:nfs-check-chapter <slug>` to inspect the blocking check details, then follow the remediation the gate report prescribes.
- For each chapter with `highlighted: true` and `gate` not equal to `block`: the highlight reflects a drift statistic `bin/ns-status` has already flagged as above that same chapter's own report threshold. Note that a dedicated revision pass (`revise-pass`) is a Phase 2 skill and is not available in v1; suggest `/nonfiction-studio:nfs-draft <slug>` to revise the chapter directly, then re-run `/nonfiction-studio:nfs-check-chapter <slug>` to confirm the drift statistic has improved.
- If any chapter has a non-null `gate` paired with a null `drift`: that chapter's latest gate report ran, but its stylometry check did not. `bin/ns-status` reports this by omission rather than a field of its own (most commonly a baseline captured before `marker_set_version` existed, or under an earlier engine version, which the gate treats as a skipped check rather than a passing one). Name every chapter matching this pairing, state plainly that voice drift is not being checked for it even though the gate otherwise reads `pass`, and suggest `/nonfiction-studio:nfs-capture-voice` to recapture the baseline, then re-run `/nonfiction-studio:nfs-check-chapter <slug>` for each named chapter.
- If every chapter has a non-null `gate`, no chapter has `openClaimCount` greater than 0, no chapter has `highlighted: true`, and no chapter pairs a non-null `gate` with a null `drift`: state that no immediate action is required and name the next un-started chapter from the `chapters` array (the first entry whose `status` is `empty`, `outlined`, or `drafting`).

### Exit 2 - error

`bin/ns-status` writes nothing regardless of the error; never render a partial or incorrect dashboard on exit 2.

- If stderr contains "No book root found": state the following and halt.

  > Project not initialized. No book root was found from the current directory. Run `/nonfiction-studio:nfs-new-book` to scaffold the project and create the progress file.

- Else if stderr contains "Cannot read progress.json" together with either "ENOENT" or "no such file": state the following and halt.

  > `.studio/progress.json` was not found. Run `/nonfiction-studio:nfs-new-book` to scaffold the project and create the progress file.

- Otherwise (any other exit 2 - a malformed `progress.json`, `config.json`, or `meta.json`, or an internal argument error): state the following and halt.

  > `bin/ns-status` reported an error: [stderr content verbatim]. Run `/nonfiction-studio:nfs-doctor` to diagnose and repair the project state.

---

## Failure behavior

**Plugin root cannot be resolved.** Step 1 halts before invoking `bin/ns-status`. Reports the settings.json path and cache path attempted. No table is rendered.

**No book root found.** Step 3 halts on the "No book root found" stderr message with the not-initialized message and routes to `nfs-new-book`. No table is rendered.

**`.studio/progress.json` missing.** Step 3 halts on the ENOENT-shaped `Cannot read progress.json` stderr message with the not-initialized message and routes to `nfs-new-book`. No table is rendered.

**Any other `bin/ns-status` error (malformed `progress.json`, `config.json`, or `meta.json`; an internal argument error).** Step 3 halts with the stderr content verbatim and routes to `nfs-doctor`. Never renders a partial or incorrect dashboard.

**Missing or empty gate directory.** Not a halt condition: `bin/ns-status` itself returns `null` for `drift` and `gate` on every chapter with no matching report, which Step 3 renders as "-". Next actions suggests running the quality gate for every such chapter.

**Missing `.studio/config.json`.** Not a halt condition: `hooks/lib/bible.mjs` returns `config: null` when the file does not exist, and since ADR-0012 (voice verdict scope) retired `thresholds.drift_score_max`, `bin/ns-status`'s board computation does not read `config.json` for the threshold in any case - each chapter's Threshold cell comes from that SAME chapter's own newest gate report, independent of `config.json`.

**Unreadable (malformed) `.studio/config.json`.** This IS a halt condition, unlike the missing case above: `hooks/lib/bible.mjs` throws `BibleError` (`CONFIG_READ_ERROR`) when `config.json` exists but fails to parse, and `bin/ns-status` exits 2 - handled by the "Any other `bin/ns-status` error" case above, which routes to `nfs-doctor`.
