---
name: nfs-doctor
user-invocable: true
argument-hint: "[mode: report | migrate | packs | install-statusline]"
description: "Fronts the read-only bin/ns-doctor engine in one Bash call per invocation: report (default) runs the full bible integrity check inventory (structure, schemas, EV/SRC grammar, orphan markers, cross-references, word-count coherence, config coercion, snapshot naming, style-profile structure, ai-use-log coverage) and maps exit 0 to a clean pass, exit 1 to findings grouped by check type with counts and routing hints, exit 2 to a surfaced error never treated as a pass; migrate diagnoses schema-version status without writing; packs confirms craft-pack validity; install-statusline (OPP-P03, studio HUD) writes the status line once, only after the author gives explicit consent; the fix mode is Phase 2+ scope, not available in v1. Use when the author says 'something is broken in my project,' 'my project structure looks wrong,' wants to run a diagnostic check separate from a status overview or a quality-gate run, or asks to see book status continuously in their status bar."
when_to_use: "Use when the author types /nfs-doctor, reports unexpected structural or schema errors from other skills, nfs-start routes here from Path 5 (Troubleshoot or get help), nfs-status-dashboard routes here on a malformed progress.json, or nfs-check-chapter exits 2 with an engine error. Do not invoke for normal project status overviews (use nfs-status-dashboard), quality-gate runs (use nfs-check-chapter), or new project setup (use nfs-new-book)."
---

This skill is the bible integrity front door per D-12 (versioned bible with a doctor) and S-06 3.11 (skills and invocation surface). It fronts `bin/ns-doctor` in a single Bash call per invocation, maps the exit code to a presented result, and groups findings by check type with routing hints. **`bin/ns-doctor` and its engine (`hooks/lib/doctor-engine.mjs`) are read-only without exception, in every mode**, proven by the grep in the engine's own header (D-12, versioned bible with a doctor). The `report`, `migrate`, and `packs` modes of this skill write nothing either. **The one exception is the `install-statusline` mode** (OPP-P03, studio HUD; ADR-0008, status HUD and CANON 3.5), which writes `~/.claude/settings.json`'s `statusLine` key, and only that file, and only after the author answers an explicit yes to a stated, one-time consent prompt; see "Mode `install-statusline`" below. The `.studio/logs/doctor-<ts>.json` write and other bible mutations described for a future `fix` mode remain unimplemented and are unrelated Phase 2 scope.

**The fix mode is not in v1.** The skill responds to a `fix` argument by stating that it is Phase 2+ scope and is not available. The Phase 2 contract (dry-run default, explicit `apply` argument required, fixable-issue list) is recorded in `docs/reference/skills/nfs-doctor.md` as the future contract. No files are written; no engine is invoked.

**No agents invoked.** This is a deterministic-CLI-only skill in the `report`, `migrate`, and `packs` modes. `install-statusline` invokes no agent either: it uses the Write or Edit tool directly against `~/.claude/settings.json`, the only file any mode of this skill ever writes. No chain edges exist in any mode.

Skill inputs read (by the engine via `--project=.`, in the `report`, `migrate`, and `packs` modes):
- `.studio/meta.json` (schema_version for schema-version check and migrate-mode comparison)
- `.studio/progress.json` (schema-validated against the committed progress.schema.json)
- `.studio/config.json` (shape check; config-coercion notice for `thesis_alignment.mode: block`)
- `.studio/snapshots/` directory listing (snapshot naming conformance)
- `research/evidence-log.md` (EV grammar check and orphan-marker cross-reference)
- `research/sources.md` (SRC grammar check and SRC cross-reference check)
- `chapters/*.md` (scanned for `[claim: EV-nnnn]` markers in the orphan-marker check)
- `context/style-profile.md` (style-profile structure and baseline-consistency check: seven required sections present and in order once populated, `Baseline reference` field completeness, agreement with `config.json`'s stylometry baseline, Exemplars path resolution; a pre-capture stub is a notice unless `config.json` already carries a baseline)
- `.studio/ai-use-log.jsonl` and the `chapters/*.md` file listing (ai-use-log coverage check: parsed tolerantly, a malformed non-blank line is a finding naming its line number; per chapter, a filesystem mtime newer than its newest covering record - or no covering record at all - is an "uncovered writing window" notice; the report always states the coverage fraction)

In `install-statusline` mode only, the skill itself (not the engine, and not via `--project=.`)
also reads, and conditionally writes, `~/.claude/settings.json` - a user-scope file outside any
book project. See "Mode `install-statusline`" below.

No skill chain edges exist for this skill, in any mode.

---

## Step 1 - Argument parsing (no tool call)

Parse the mode argument from the supplied tokens. The default mode when no argument is supplied is `report`. No tool call is needed in Step 1.

- **No argument:** mode is `report`. Continue to Step 2.
- **`report`:** mode is `report`. Continue to Step 2.
- **`migrate`:** mode is `migrate`. Continue to Step 2.
- **`packs`:** mode is `packs`. Continue to Step 2.
- **`install-statusline`:** mode is `install-statusline`. This mode does not invoke `bin/ns-doctor`
  at all. Skip Steps 2 through 4 below and go directly to "Mode `install-statusline`" (its own
  section, immediately after this Step 1).
- **`validate`:** The `validate` argument is subsumed into `report` in v1. The full check inventory already includes all schema validation. State the following and continue with mode `report`:

  > The `validate` argument is an alias for `report` in v1: the full check inventory (structure, schemas, EV/SRC grammar, orphan markers, cross-references, word-count coherence, config coercion, snapshot naming, style-profile structure, ai-use-log coverage) covers all schema validation. Running `report` now.

- **`fix`:** State the following and halt without making any tool calls:

  > The `fix` mode is Phase 2+ scope and is not available in v1. No changes have been made to any file. When `fix` arrives in Phase 2 its contract will be: dry-run default, explicit `apply` argument required to commit changes, fixable-issue list includes duplicate EV IDs, malformed JSONL log lines, and broken internal cross-references, and each change is logged to `.studio/logs/doctor-<ts>.json`. To diagnose issues without repairing them, run `/nonfiction-studio:nfs-doctor` (no argument) to run the full check inventory in report mode.

- **Any other token:** unrecognized mode. State the following and halt without making any tool calls:

  > Unrecognized mode `[token]`. Valid modes are `report` (default), `migrate`, `packs`, and `install-statusline`. The `fix` mode is Phase 2+ scope and is not available in v1. Run `/nonfiction-studio:nfs-doctor` with no argument to run the full check inventory.

---

## Mode `install-statusline` - consented main-statusline install (OPP-P03, studio HUD)

This mode does not invoke `bin/ns-doctor` and does not touch any book project file. It performs a
one-time, explicitly consented write of the main Claude Code status line into the author's OWN
`~/.claude/settings.json`, using the Write or Edit tool directly. This is the only file, and the
only code path in this entire plugin, that ever writes to the author's own Claude Code settings;
see ADR-0008 (status HUD), recorded at `docs/adr/ADR-0008-status-hud.md`, for why no other path
exists or should exist, and why a plugin cannot ship this itself.

### Step A - Resolve the plugin root

Use the same three-tier resolution as Step 2 below (settings.json lookup, plugins-cache search,
dev-mode fallback) to obtain `<plugin-root>`. If all three lookups fail, halt exactly as Step 2
describes: report the settings.json path and cache path attempted, write nothing, and ask the
author how to proceed.

### Step B - Read the author's existing settings

Use the Read tool on `$HOME/.claude/settings.json`. Three outcomes:

- **File does not exist.** Treat the existing settings as an empty object (`{}`). Continue to Step C.
- **File exists and parses as JSON.** Continue to Step C with the parsed object in hand.
- **File exists but does not parse as JSON.** Halt. State: "`~/.claude/settings.json` exists but
  is not valid JSON, so I cannot safely merge into it without risking the rest of your settings.
  Please fix or back up that file, then run `/nonfiction-studio:nfs-doctor install-statusline` again,
  or run the built-in `/statusline` command instead." Write nothing.

### Step C - State exactly what will be written, and ask

Compose the exact command string this mode proposes: `node "<plugin-root>/bin/ns-statusline"`,
using the plugin root resolved in Step A as a literal resolved path - NOT the `CLAUDE_PLUGIN_ROOT`
plugin-system placeholder, which has no meaning inside a user's own top-level
`~/.claude/settings.json` (that token interpolates only inside a plugin's own manifest files; see
ADR-0008).

- **If the parsed settings object from Step B already has a `statusLine` key:** state its current
  value verbatim, state the proposed new value verbatim, and ask: "Your
  `~/.claude/settings.json` already has a `statusLine` configured: `[existing value]`. Installing
  this plugin's status line would replace it with: `[proposed value]`. Shall I replace it?
  (yes/no)" This is the separate explicit confirmation ADR-0008 requires before overwriting an
  existing `statusLine`; nothing more is asked once this question is answered.
- **If no `statusLine` key exists yet:** ask: "I will add a `statusLine` entry to
  `~/.claude/settings.json` so Claude Code shows this book's active chapter, word count, open
  claims, drift, and gate state continuously in your status bar. The command will be:
  `[proposed value]`. Every other key already in your settings file is left untouched. May I
  write this? (yes/no)"

Wait for an explicit answer before continuing to Step D.

**Non-interactive (headless) context.** There is nobody present to answer the question above. Do
not proceed as though "yes" were implied: a top-level settings write is exactly the kind of
action that requires an explicit yes (OPP-P03's "exactly one consent prompt"), unlike some other
skills' low-risk non-interactive defaults (for example `nfs-new-book`'s idempotent re-stamp of
missing scaffold files). State: "Installing the status line needs an explicit yes from you, so it
is not available in a non-interactive session. Run the built-in `/statusline` command instead, or
run `/nonfiction-studio:nfs-doctor install-statusline` again from an interactive session." Write
nothing.

### Step D - On an explicit yes: write; on anything else: write nothing

**On an explicit "yes":** merge `{ "statusLine": { "type": "command", "command": "<the composed
command string>" } }` into the parsed settings object from Step B - a shallow merge at the top
level, so every other existing top-level key is preserved unchanged and only `statusLine` is set
or replaced. Use the Write tool to write the merged object back to `$HOME/.claude/settings.json`
as formatted JSON. Note for the author before writing: the Write tool will show its own
permission prompt for this file; that is the platform's ordinary behavior for any file write, not
something this skill suppresses or works around. After a successful write, report:
"`~/.claude/settings.json` has been updated. The status line takes effect in your next Claude
Code session, or immediately if you run `/statusline` afterward."

**On anything other than an explicit "yes"** (a "no", silence, an unrelated answer, or any halt
condition in Steps A-C above): write nothing. State: "No changes were made to
`~/.claude/settings.json`. You can install the status line yourself at any time by running the
built-in `/statusline` command and describing what to show, or by running
`/nonfiction-studio:nfs-doctor install-statusline` again."

---

## Step 2 - Resolve the plugin root

Use the Bash tool to run the resolver:
```
node -e "(function(){ var fs=require('fs'),path=require('path'),os=require('os'); function rj(p){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){return null;}} function has(p){try{return fs.existsSync(path.join(p,'bin','ns-stylometry'));}catch(e){return false;}} function ld(p){try{return fs.readdirSync(p,{withFileTypes:true}).filter(function(e){return e.isDirectory();}).map(function(e){return e.name;}).sort();}catch(e){return [];}} function cmp(a,b){var pa=String(a).split('.').map(function(n){return parseInt(n,10)||0;});var pb=String(b).split('.').map(function(n){return parseInt(n,10)||0;});for(var i=0;i<3;i++){var d=(pa[i]||0)-(pb[i]||0);if(d)return d;}return 0;} var cfg=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'); var ip=rj(path.join(cfg,'plugins','installed_plugins.json')); if(ip&&ip.plugins){ var best=null; var keys=Object.keys(ip.plugins).sort(); for(var i=0;i<keys.length;i++){ var key=keys[i]; if(key.indexOf('nonfiction-studio@')!==0)continue; var arr=Array.isArray(ip.plugins[key])?ip.plugins[key]:[]; for(var j=0;j<arr.length;j++){ var entry=arr[j]; var p=entry&&entry.installPath; if(!p||!has(p))continue; var v=(entry&&entry.version)||'0.0.0'; var scope=(entry&&entry.scope)||''; if(!best||cmp(v,best.v)>0||(cmp(v,best.v)===0&&best.scope!=='user'&&scope==='user')){best={root:p,v:v,scope:scope};} } } if(best){console.log(best.root);process.exit(0);} } var st=rj(path.join(cfg,'settings.json')); if(st&&st.extraKnownMarketplaces&&st.extraKnownMarketplaces['nonfiction-studio']){ var src=st.extraKnownMarketplaces['nonfiction-studio'].source; var sp=src&&src.path; if(sp&&has(sp)){console.log(sp);process.exit(0);} } var cacheRoot=path.join(cfg,'plugins','cache'); var bestC=null; var mps=ld(cacheRoot); for(var m=0;m<mps.length;m++){ var nsDir=path.join(cacheRoot,mps[m],'nonfiction-studio'); var vers=ld(nsDir); for(var k=0;k<vers.length;k++){ var root=path.join(nsDir,vers[k]); if(has(root)){ if(!bestC||cmp(vers[k],bestC.v)>0){bestC={root:root,v:vers[k]};} } } } if(bestC){console.log(bestC.root);process.exit(0);} for(var n=0;n<mps.length;n++){ if(mps[n].indexOf('nonfiction-studio')===0){ var lroot=path.join(cacheRoot,mps[n]); if(has(lroot)){console.log(lroot);process.exit(0);} } } if(has(process.cwd())){console.log(process.cwd());process.exit(0);} console.log('not-found'); })();"
```

The output is `<plugin-root>`, or the literal string `not-found`. The resolver checks, in
order: `installed_plugins.json` in the Claude config directory (a marketplace install,
verified by confirming `bin/ns-stylometry` exists under the candidate path; the newest
installed version wins when more than one is present), then a local self-marketplace entry
in `settings.json` (dev-workflow installs, same verification), then a scan of the plugins
cache (the versioned marketplace-cache layout and the legacy flat layout), then the current
working directory (dev-mode checkout). The Claude config directory is `$CLAUDE_CONFIG_DIR`
when that variable is set, otherwise `$HOME/.claude` (`%USERPROFILE%\.claude` on Windows).

If the output is `not-found`: halt immediately. Report the config directory used
(`$CLAUDE_CONFIG_DIR` if set, `$HOME/.claude` otherwise) and the `installed_plugins.json`
path checked within it (`<config-dir>/plugins/installed_plugins.json`). Do not invoke ns-doctor. Ask
the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>` for Step 3.

**Shared plugin-root convention.** This resolver is the same command as `skills/nfs-new-book/SKILL.md` Step 4 and every other CLI-backed skill; `tests/checks/plugin-root-resolver.test.mjs` guards byte-for-byte parity across all eight.

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
> Schema version: 2. Checks run: bible structure, progress.json schema, meta.json and config.json shape, EV grammar, SRC grammar, orphan claim markers, orphan SRC references, word-count coherence, config-coercion notice, snapshot naming, style-profile structure, ai-use-log coverage.
>
> The doctor wrote no files. All reads were against the committed bible tree.

If the JSON `notices` array is non-empty, present each notice after the verdict:

> Notice (informational, does not affect this verdict): [notice.message verbatim]

**Exit 1 - findings present:**

Parse stdout as JSON. Group findings by the prefix of the `type` field (the segment before the first `.`). For each group with at least one finding, state the count, list the specific entries (path, type, message), and append the routing hint below.

| Group prefix(es) | Display name | Routing hint |
|---|---|---|
| `structure` | Bible structure | One or more scaffold-mandated paths are absent. Suggested next step: re-run `/nonfiction-studio:nfs-new-book` to re-stamp missing paths (idempotent for existing content), or create the named path manually. |
| `schema`, `shape` | Schema and shape | A file does not match its required shape. Inspect the named file and field; correct the type, add the missing required field, or fix the invalid JSON. |
| `ev-grammar` | Evidence log grammar | An evidence entry is malformed. Edit `research/evidence-log.md` to correct the named entry (required fields, enum values for confidence and status, SRC ID format). |
| `src-grammar` | Sources grammar | A source entry is malformed. Edit `research/sources.md` to correct the named entry (type enum, retrieval-status enum). |
| `claim-marker` | Orphan claim markers | A chapter references a `[claim: EV-nnnn]` marker whose EV ID is absent from the evidence ledger. Suggested next step: run `/nonfiction-studio:nfs-fact-check <slug>` to reconcile chapter markers and ledger entries. |
| `src-ref` | Orphan SRC references | SRC IDs referenced in EV entries are absent from sources.md, OR SRC IDs defined in sources.md are referenced by no EV entry. Suggested next step: run `/nonfiction-studio:nfs-research` or `/nonfiction-studio:nfs-fact-check` to reconcile the cross-references. |
| `coherence` | Word-count coherence | A chapter's word count in progress.json does not match the file on disk. This typically self-resolves when the PostToolBatch hook runs on the next chapter write. If the mismatch persists, check whether a manual edit bypassed the hook. |
| `snapshot` | Snapshot naming | A file in `.studio/snapshots/` does not match the naming convention `<slug>.<YYYYMMDDTHHMMSSZ>.md`. Rename the file to conform. |
| `style-profile` | Style profile structure | `context/style-profile.md` is missing a required section, has sections out of order, is missing a `Baseline reference` field, disagrees with `config.json`'s stylometry baseline, has a broken `Exemplars` path, or is a stub alongside an already-captured baseline. Edit the named section, field, or path directly, or re-run `/nonfiction-studio:nfs-capture-voice` to resynchronize both files. |
| `ai-use-log` | AI use log | A line in `.studio/ai-use-log.jsonl` is not valid JSON. Edit or remove the named line (by line number); every other line is unaffected, since the file is append-only and each line is an independent record. |

Present the grouped findings in this order (any group with zero findings is omitted):

```
[Group display name]: N finding(s)
  [path] [[type]]: [message]
  ...
[Routing hint]
```

Close with the summary and re-run invitation:

> Doctor verdict: N total finding(s). Address the items above, then re-run `/nonfiction-studio:nfs-doctor` to confirm the bible is clean.

If `notices` is also non-empty, present them after the findings under the label "Notices (informational, do not affect this verdict)".

**Exit 2 - operational error:**

Surface the stderr content and halt. This exit is never treated as a pass.

> Doctor error (exit 2): [first non-empty line of stderr, or "engine exited with code 2 with no message on stderr" if stderr is empty]. The doctor run did not complete. Check that this is a valid project bible (`.studio/meta.json` and a `context/` directory must exist at the project root). If stdout also contains output, include it verbatim for diagnostic purposes.

If the stderr message contains "requires migration", also suggest:
> Run `/nonfiction-studio:nfs-doctor migrate` to get the explicit migration diagnosis before taking action.

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

**Exit 2 from `--report`.** Step 4 surfaces the stderr and halts. Never treated as a pass. If the error message mentions schema version mismatch, suggest running `/nonfiction-studio:nfs-doctor migrate` for the explicit migration diagnosis.

**Exit 2 from `--migrate`.** Expected output from the CLI when migration is genuinely required (an incompatible schema version); an already-current schema now exits 0 instead. Step 4 distinguishes the two cases and presents the appropriate message. It is not an unexpected error.

**Exit 2 from `--validate-packs`.** Unexpected in v1 (the packs mode exits 0 under all normal conditions). Surface the stderr and halt.

**Project root not found.** If `findBookRoot` cannot locate `.studio/meta.json` from the current directory, the CLI exits 2 with a `BibleError` message on stderr. Surface it: "Doctor error: [BibleError message]. Ensure this skill is invoked from within a Nonfiction Studio project bible (`.studio/meta.json` must be present at or above the current directory)."

**`install-statusline`: plugin root cannot be resolved.** Step A halts before any read or write, exactly as Step 2's own failure behavior below: report the settings.json path and cache path attempted, and ask the author how to proceed.

**`install-statusline`: existing `~/.claude/settings.json` is not valid JSON.** Step B halts before writing anything; the author is told to fix or back up the file first, or to use the built-in `/statusline` command instead.

**`install-statusline`: any answer other than an explicit yes (a "no", silence, an unrelated answer, or a non-interactive context with nobody to ask).** Step C or D writes nothing and states that `/statusline` and re-running `/nonfiction-studio:nfs-doctor install-statusline` both remain available.
