---
name: doctor
user-invocable: true
argument-hint: "[mode: report | migrate | packs]"
description: "Fronts the read-only bin/ns-doctor engine in one Bash call per invocation: report (default) runs the full bible integrity check inventory (structure, schemas, EV/SRC grammar, orphan markers, cross-references, word-count coherence, config coercion, snapshot naming) and maps exit 0 to a clean pass, exit 1 to findings grouped by check type with counts and routing hints, exit 2 to a surfaced error never treated as a pass; migrate diagnoses schema-version status without writing; packs confirms craft-pack validity; the fix mode is Phase 2+ scope and is not available in v1. Use when the author says 'something is broken in my project,' 'my project structure looks wrong,' or wants to run a diagnostic check separate from a status overview or a quality-gate run."
when_to_use: "Use when the author types /doctor, reports unexpected structural or schema errors from other skills, studio routes here from Path 5 (Troubleshoot or get help), status-dashboard routes here on a malformed progress.json, or run-quality-gate exits 2 with an engine error. Do not invoke for normal project status overviews (use status-dashboard), quality-gate runs (use run-quality-gate), or new project setup (use init-project)."
---

This skill is the bible integrity front door per D-12 (versioned bible with a doctor) and S-06 3.11 (skills and invocation surface). It fronts `bin/ns-doctor` in a single Bash call per invocation, maps the exit code to a presented result, and groups findings by check type with routing hints. The doctor engine and this skill are both read-only in v1: no file is written in any mode per the READ-ONLY COVENANT proven at TSK-028 (ns-doctor engine). The `.studio/logs/doctor-<ts>.json` write and bible mutations arrive with the `fix` mode in Phase 2.

**The fix mode is not in v1.** The skill responds to a `fix` argument by stating that it is Phase 2+ scope and is not available. The Phase 2 contract (dry-run default, explicit `apply` argument required, fixable-issue list) is recorded in `docs/reference/skills/doctor.md` as the future contract. No files are written; no engine is invoked.

**No agents invoked.** This is a deterministic-CLI-only skill. No chain edges exist.

Skill inputs read (by the engine via `--project=.`):
- `.studio/meta.json` (schema_version for schema-version check and migrate-mode comparison)
- `.studio/progress.json` (schema-validated against the committed progress.schema.json)
- `.studio/config.json` (shape check; config-coercion notice for `thesis_alignment.mode: block`)
- `.studio/snapshots/` directory listing (snapshot naming conformance)
- `research/evidence-log.md` (EV grammar check and orphan-marker cross-reference)
- `research/sources.md` (SRC grammar check and SRC cross-reference check)
- `chapters/*.md` (scanned for `[claim: EV-nnnn]` markers in the orphan-marker check)

No skill chain edges exist for this skill.

---

## Step 1 - Argument parsing (no tool call)

Parse the mode argument from the supplied tokens. The default mode when no argument is supplied is `report`. No tool call is needed in Step 1.

- **No argument:** mode is `report`. Continue to Step 2.
- **`report`:** mode is `report`. Continue to Step 2.
- **`migrate`:** mode is `migrate`. Continue to Step 2.
- **`packs`:** mode is `packs`. Continue to Step 2.
- **`validate`:** The `validate` argument is subsumed into `report` in v1. The full check inventory already includes all schema validation. State the following and continue with mode `report`:

  > The `validate` argument is an alias for `report` in v1: the full check inventory (structure, schemas, EV/SRC grammar, orphan markers, cross-references, word-count coherence, config coercion, snapshot naming) covers all schema validation. Running `report` now.

- **`fix`:** State the following and halt without making any tool calls:

  > The `fix` mode is Phase 2+ scope and is not available in v1. No changes have been made to any file. When `fix` arrives in Phase 2 its contract will be: dry-run default, explicit `apply` argument required to commit changes, fixable-issue list includes duplicate EV IDs, malformed JSONL log lines, and broken internal cross-references, and each change is logged to `.studio/logs/doctor-<ts>.json`. To diagnose issues without repairing them, run `/nonfiction-studio:doctor` (no argument) to run the full check inventory in report mode.

- **Any other token:** unrecognized mode. State the following and halt without making any tool calls:

  > Unrecognized mode `[token]`. Valid modes are `report` (default), `migrate`, and `packs`. The `fix` mode is Phase 2+ scope and is not available in v1. Run `/nonfiction-studio:doctor` with no argument to run the full check inventory.

---

## Step 2 - Resolve the plugin root

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
test -f bin/ns-doctor && pwd || echo not-found
```

If all three lookups fail: halt immediately. Report the settings.json path attempted (`$HOME/.claude/settings.json`) and the cache path attempted (`$HOME/.claude/plugins/cache`). Do not invoke ns-doctor. Ask the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>` for Step 3.

**Shared plugin-root convention.** This three-tier resolution (settings.json lookup, plugins-cache search, dev-mode fallback) is the same routine as `skills/init-project/SKILL.md` Step 4; a future wave extracts it to a shared reference.

---

## Step 3 - Single Bash invocation (one call per mode)

Use the Bash tool to invoke `bin/ns-doctor`. This is the ONE Bash call for this invocation. No individual sub-CLI calls (ns-claims, ns-stylometry, ns-scrub) are made by the skill; the doctor engine composes its checks internally via `runChecks`.

**Mode `report` (full check inventory):**

```
node "<plugin-root>/bin/ns-doctor" --project=. --report --json
```

**Mode `migrate` (schema-version diagnosis; never writes):**

```
node "<plugin-root>/bin/ns-doctor" --project=. --migrate --json
```

**Mode `packs` (craft-pack validity check):**

```
node "<plugin-root>/bin/ns-doctor" --project=. --validate-packs --json
```

Capture the exit code, stdout (JSON), and stderr. Proceed to Step 4.

---

## Step 4 - Present the result (exit-code mapping)

### Report mode exit codes

**Exit 0 - no findings:**

Parse stdout as JSON. Present the clean pass:

> Doctor verdict: PASS. Bible integrity check complete; no issues found.
>
> Schema version: 2. Checks run: bible structure, progress.json schema, meta.json and config.json shape, EV grammar, SRC grammar, orphan claim markers, orphan SRC references, word-count coherence, config-coercion notice, snapshot naming.
>
> The doctor wrote no files. All reads were against the committed bible tree.

If the JSON `notices` array is non-empty, present each notice after the verdict:

> Notice (informational, does not affect this verdict): [notice.message verbatim]

**Exit 1 - findings present:**

Parse stdout as JSON. Group findings by the prefix of the `type` field (the segment before the first `.`). For each group with at least one finding, state the count, list the specific entries (path, type, message), and append the routing hint below.

| Group prefix(es) | Display name | Routing hint |
|---|---|---|
| `structure` | Bible structure | One or more scaffold-mandated paths are absent. Suggested next step: re-run `/nonfiction-studio:init-project` to re-stamp missing paths (idempotent for existing content), or create the named path manually. |
| `schema`, `shape` | Schema and shape | A file does not match its required shape. Inspect the named file and field; correct the type, add the missing required field, or fix the invalid JSON. |
| `ev-grammar` | Evidence log grammar | An evidence entry is malformed. Edit `research/evidence-log.md` to correct the named entry (required fields, enum values for confidence and status, SRC ID format). |
| `src-grammar` | Sources grammar | A source entry is malformed. Edit `research/sources.md` to correct the named entry (type enum, retrieval-status enum). |
| `claim-marker` | Orphan claim markers | A chapter references a `[claim: EV-nnnn]` marker whose EV ID is absent from the evidence ledger. Suggested next step: run `/nonfiction-studio:fact-check-pass <slug>` to reconcile chapter markers and ledger entries. |
| `src-ref` | Orphan SRC references | SRC IDs referenced in EV entries are absent from sources.md, OR SRC IDs defined in sources.md are referenced by no EV entry. Suggested next step: run `/nonfiction-studio:research-pass` or `/nonfiction-studio:fact-check-pass` to reconcile the cross-references. |
| `coherence` | Word-count coherence | A chapter's word count in progress.json does not match the file on disk. This typically self-resolves when the PostToolBatch hook runs on the next chapter write. If the mismatch persists, check whether a manual edit bypassed the hook. |
| `snapshot` | Snapshot naming | A file in `.studio/snapshots/` does not match the naming convention `<slug>.<YYYYMMDDTHHMMSSZ>.md`. Rename the file to conform. |

Present the grouped findings in this order (any group with zero findings is omitted):

```
[Group display name]: N finding(s)
  [path] [[type]]: [message]
  ...
[Routing hint]
```

Close with the summary and re-run invitation:

> Doctor verdict: N total finding(s). Address the items above, then re-run `/nonfiction-studio:doctor` to confirm the bible is clean.

If `notices` is also non-empty, present them after the findings under the label "Notices (informational, do not affect this verdict)".

**Exit 2 - operational error:**

Surface the stderr content and halt. This exit is never treated as a pass.

> Doctor error (exit 2): [first non-empty line of stderr, or "engine exited with code 2 with no message on stderr" if stderr is empty]. The doctor run did not complete. Check that this is a valid project bible (`.studio/meta.json` and a `context/` directory must exist at the project root). If stdout also contains output, include it verbatim for diagnostic purposes.

If the stderr message contains "requires migration", also suggest:
> Run `/nonfiction-studio:doctor migrate` to get the explicit migration diagnosis before taking action.

### Migrate mode

`--migrate` exits 0 when the schema is already current and 2 only when migration is genuinely required (an incompatible version). Distinguish the two cases by the exit code, then by examining stdout and stderr:

**Current schema, nothing to migrate** - exit 0; stdout parses as JSON with `"status": "current"`:

> Doctor migrate verdict: Schema version is current. No migration is needed. [stdout JSON `message` field verbatim.] No files were written. Migrations arrive with the first schema change per Q-04 (release, versioning, and compatibility); the snapshot-before-migrate and restore-on-failure contract activates at that time.

**Migration required** - exit 2; stderr contains content (stdout is empty or not JSON):

> Doctor migrate verdict: Migration required. [stderr content verbatim.] No migration has been applied; migrations from older schema versions are not yet defined in v1. The snapshot-before-migrate and restore-on-failure contract activates when real migrations arrive per Q-04 (release, versioning, and compatibility). No files were written. Verify the `schema_version` field in `.studio/meta.json`; the supported major is `2`.

### Packs mode

`--validate-packs` exits 0 in v1 regardless of whether a packs directory is found. Parse stdout as JSON and present the `message` field:

> Doctor packs verdict: [stdout JSON `message` field verbatim.] No files were written. Craft-model packs arrive in Phase 2 per D-21.

---

## Failure behavior

**`fix` argument supplied.** Step 1 halts with the Phase 2 decline message. No tool calls, no file reads, no engine invocation.

**Unrecognized mode argument.** Step 1 halts with the unrecognized-mode message. No tool calls, no file reads.

**Exit 2 from `--report`.** Step 4 surfaces the stderr and halts. Never treated as a pass. If the error message mentions schema version mismatch, suggest running `/nonfiction-studio:doctor migrate` for the explicit migration diagnosis.

**Exit 2 from `--migrate`.** Expected output from the CLI when migration is genuinely required (an incompatible schema version); an already-current schema now exits 0 instead. Step 4 distinguishes the two cases and presents the appropriate message. It is not an unexpected error.

**Exit 2 from `--validate-packs`.** Unexpected in v1 (the packs mode exits 0 under all normal conditions). Surface the stderr and halt.

**Project root not found.** If `findBookRoot` cannot locate `.studio/meta.json` from the current directory, the CLI exits 2 with a `BibleError` message on stderr. Surface it: "Doctor error: [BibleError message]. Ensure this skill is invoked from within a Nonfiction Studio project bible (`.studio/meta.json` must be present at or above the current directory)."
