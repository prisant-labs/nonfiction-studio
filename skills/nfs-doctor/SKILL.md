---
name: nfs-doctor
user-invocable: true
argument-hint: "[mode: report | migrate | move-state <name> | packs | install-statusline]"
description: "Fronts the read-only bin/ns-doctor engine: report (default) runs the full bible integrity check inventory (structure, schemas, EV/SRC grammar, orphan markers, cross-references, word-count coherence, config coercion, snapshot naming, style-profile structure, ai-use-log coverage) and maps exit 0 to a pass, exit 1 to grouped findings with routing hints, exit 2 to an error never treated as a pass; migrate fixes a legacy or unpointed state folder after an explicit yes, else diagnoses the schema version without writing; move-state <name> renames the state folder after an explicit yes; packs confirms craft-pack validity; install-statusline (OPP-P03, studio HUD) writes the status line once, after explicit consent; fix is Phase 2+ scope. Use when the author says 'something is broken in my project' or 'my project structure looks wrong', wants a diagnostic check separate from status or a gate run, wants to rename the state folder, or asks to see book status in their status bar."
when_to_use: "Use when the author types /nfs-doctor, reports unexpected structural or schema errors from other skills, another skill or the session start reports an unpointed state folder or a bad nonfiction-studio.json, the author wants to rename the book's state folder, nfs-start routes here from Path 5 (Troubleshoot or get help), nfs-status-dashboard routes here on a malformed progress.json, or nfs-check-chapter exits 2 with an engine error. Do not invoke for normal project status overviews (use nfs-status-dashboard), quality-gate runs (use nfs-check-chapter), or new project setup (use nfs-new-book)."
---

This skill is the bible integrity front door per D-12 (versioned bible with a doctor) and S-06 3.11 (skills and invocation surface). It fronts `bin/ns-doctor`, maps the exit code to a presented result, and groups findings by check type with routing hints. **`bin/ns-doctor` and its engine (`hooks/lib/doctor-engine.mjs`) are read-only without exception, in every mode**, proven by the grep in the engine's own header (D-12, versioned bible with a doctor). The `report` and `packs` modes of this skill write nothing either. **Three modes write, each only after the author answers an explicit yes to a stated proposal:**

- `install-statusline` (OPP-P03, studio HUD; ADR-0008, status HUD and CANON 3.5) writes `~/.claude/settings.json`'s `statusLine` key, and only that file; see "Mode `install-statusline`" below.
- `migrate` and `move-state <name>` (ADR-0015, state folder name) write the book's state-folder pointer `nonfiction-studio.json` (or delete it), rename the state folder, and add the folder's `README.md`; see "Move routine" below. Without a state-folder problem to fix, `migrate` writes nothing and only diagnoses the schema version.

The `logs/doctor-<ts>.json` write in the state folder and other bible mutations described for a future `fix` mode remain unimplemented and are unrelated Phase 2 scope.

**The state folder.** A book keeps its machine-managed records in one state folder at the book root. Its default name is `_nonfiction-studio/`. A book that uses another name records it in `nonfiction-studio.json` at the book root, as `{"state_dir": "<name>"}`. Books created before ADR-0015 use the legacy name `.studio/` with no pointer, which the engine reports as an unpointed state folder. This skill does not carry the "Locate the state folder" section that other skills carry, because that section stops on exactly the states this skill repairs.

**The fix mode is not in v1.** The skill responds to a `fix` argument by stating that it is Phase 2+ scope and is not available. The Phase 2 contract (dry-run default, explicit `apply` argument required, fixable-issue list) is recorded in `docs/reference/skills/nfs-doctor.md` as the future contract. No files are written; no engine is invoked.

**No agents invoked.** This is a deterministic-CLI-only skill in the `report`, `migrate`, `move-state`, and `packs` modes. `install-statusline` invokes no agent either: it uses the Write or Edit tool directly against `~/.claude/settings.json`. The move routine uses the Write tool and the Bash tool directly. No chain edges exist in any mode.

Skill inputs read (by the engine via `--project=.`, in the `report`, `migrate`, `move-state`, and `packs` modes):
- `nonfiction-studio.json` at the book root, when present (the state folder's name)
- the state folder's `meta.json` (schema_version for schema-version check and migrate-mode comparison)
- the state folder's `progress.json` (schema-validated against the committed progress.schema.json)
- the state folder's `config.json` (shape check; config-coercion notice for `thesis_alignment.mode: block`)
- the state folder's `snapshots/` directory listing (snapshot naming conformance)
- `research/evidence-log.md` (EV grammar check and orphan-marker cross-reference)
- `research/sources.md` (SRC grammar check and SRC cross-reference check)
- `chapters/*.md` (scanned for `[claim: EV-nnnn]` markers in the orphan-marker check)
- `context/style-profile.md` (style-profile structure and baseline-consistency check: seven required sections present and in order once populated, `Baseline reference` field completeness, agreement with `config.json`'s stylometry baseline, Exemplars path resolution; a pre-capture stub is a notice unless `config.json` already carries a baseline)
- the state folder's `ai-use-log.jsonl` and the `chapters/*.md` file listing (ai-use-log coverage check: parsed tolerantly, a malformed non-blank line is a finding naming its line number; per chapter, a filesystem mtime newer than its newest covering record - or no covering record at all - is an "uncovered writing window" notice; the report always states the coverage fraction)

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
- **`move-state <name>`:** mode is `move-state`, and `<name>` is the target folder name. If no name follows, state "Name the folder to move the state folder to, for example `/nonfiction-studio:nfs-doctor move-state book-records`." and halt without making any tool calls. Otherwise continue to Step 2.
- **`packs`:** mode is `packs`. Continue to Step 2.
- **`install-statusline`:** mode is `install-statusline`. This mode does not invoke `bin/ns-doctor`
  at all. Skip Steps 2 through 4 below and go directly to "Mode `install-statusline`" (its own
  section, immediately after this Step 1).
- **`validate`:** The `validate` argument is subsumed into `report` in v1. The full check inventory already includes all schema validation. State the following and continue with mode `report`:

  > The `validate` argument is an alias for `report` in v1: the full check inventory (structure, schemas, EV/SRC grammar, orphan markers, cross-references, word-count coherence, config coercion, snapshot naming, style-profile structure, ai-use-log coverage) covers all schema validation. Running `report` now.

- **`fix`:** State the following and halt without making any tool calls:

  > The `fix` mode is Phase 2+ scope and is not available in v1. No changes have been made to any file. When `fix` arrives in Phase 2 its contract will be: dry-run default, explicit `apply` argument required to commit changes, fixable-issue list includes duplicate EV IDs, malformed JSONL log lines, and broken internal cross-references, and each change is logged to `logs/doctor-<ts>.json` in the state folder. To diagnose issues without repairing them, run `/nonfiction-studio:nfs-doctor` (no argument) to run the full check inventory in report mode.

- **Any other token:** unrecognized mode. State the following and halt without making any tool calls:

  > Unrecognized mode `[token]`. Valid modes are `report` (default), `migrate`, `move-state <name>`, `packs`, and `install-statusline`. The `fix` mode is Phase 2+ scope and is not available in v1. Run `/nonfiction-studio:nfs-doctor` with no argument to run the full check inventory.

---

## Mode `install-statusline` - consented main-statusline install (OPP-P03, studio HUD)

This mode does not invoke `bin/ns-doctor` and does not touch any book project file. It performs a
one-time, explicitly consented write of the main Claude Code status line into the author's OWN
`~/.claude/settings.json`, using the Write or Edit tool directly. This is the only file, and the
only code path in this entire plugin, that ever writes to the author's own Claude Code settings;
see ADR-0008 (status HUD), recorded at `docs/adr/ADR-0008-status-hud.md`, for why no other path
exists or should exist, and why a plugin cannot ship this itself.

### Step A - Resolve the plugin root

Use the same resolver as Step 2 below to obtain `<plugin-root>`. If it prints `not-found`, halt
exactly as Step 2 describes: report the config directory and the `installed_plugins.json` path
attempted, write nothing, and ask the author how to proceed.

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
ADR-0008). This path is versioned (for example `.../nonfiction-studio/0.1.1/bin/ns-statusline`):
after a future `/plugin update`, once Claude Code removes the old version's folder, the status
line silently breaks until this mode is run again. Re-run `/nonfiction-studio:nfs-doctor
install-statusline` after updating the plugin to refresh it.

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
node -e "(function(){ var fs=require('fs'),path=require('path'),os=require('os'); function rj(p){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){return null;}} function has(p){try{return fs.existsSync(path.join(p,'bin','ns-stylometry'));}catch(e){return false;}} function ld(p){try{return fs.readdirSync(p,{withFileTypes:true}).filter(function(e){return e.isDirectory();}).map(function(e){return e.name;}).sort();}catch(e){return [];}} function cmp(a,b){var pa=String(a).split('.').map(function(n){return parseInt(n,10)||0;});var pb=String(b).split('.').map(function(n){return parseInt(n,10)||0;});for(var i=0;i<3;i++){var d=(pa[i]||0)-(pb[i]||0);if(d)return d;}return 0;} function norm(x){var s=path.resolve(x);return process.platform==='win32'?s.toLowerCase():s;} function inProj(pp){if(pp==null||pp==='')return true;var a=norm(pp);var c=norm(process.cwd());return c===a||c.indexOf(a+path.sep)===0;} var cfg=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'); var ip=rj(path.join(cfg,'plugins','installed_plugins.json')); if(ip!=null&&ip.plugins){ var best=null; var keys=Object.keys(ip.plugins).sort(); for(var i=0;i<keys.length;i++){ var key=keys[i]; if(key.indexOf('nonfiction-studio@')!==0)continue; var arr=Array.isArray(ip.plugins[key])?ip.plugins[key]:[]; for(var j=0;j<arr.length;j++){ var entry=arr[j]; var p=entry&&entry.installPath; if(p==null||has(p)===false)continue; var scope=(entry&&entry.scope)||''; if((scope==='project'||scope==='local')&&inProj(entry&&entry.projectPath)===false)continue; var v=(entry&&entry.version)||'0.0.0'; var better=best===null||cmp(v,best.v)>0||(cmp(v,best.v)===0&&best.scope!=='user'&&scope==='user'); if(better){best={root:p,v:v,scope:scope};} } } if(best!==null){console.log(best.root);process.exit(0);} } var st=rj(path.join(cfg,'settings.json')); if(st!=null&&st.extraKnownMarketplaces&&st.extraKnownMarketplaces['nonfiction-studio']){ var src=st.extraKnownMarketplaces['nonfiction-studio'].source; var sp=src&&src.path; if(sp&&has(sp)){console.log(sp);process.exit(0);} } var cacheRoot=path.join(cfg,'plugins','cache'); var bestC=null; var mps=ld(cacheRoot); for(var m=0;m<mps.length;m++){ var nsDir=path.join(cacheRoot,mps[m],'nonfiction-studio'); var vers=ld(nsDir); for(var k=0;k<vers.length;k++){ var root=path.join(nsDir,vers[k]); if(has(root)){ if(bestC===null||cmp(vers[k],bestC.v)>0){bestC={root:root,v:vers[k]};} } } } if(bestC!==null){console.log(bestC.root);process.exit(0);} for(var n=0;n<mps.length;n++){ if(mps[n].indexOf('nonfiction-studio')===0){ var lroot=path.join(cacheRoot,mps[n]); if(has(lroot)){console.log(lroot);process.exit(0);} } } if(has(process.cwd())){console.log(process.cwd());process.exit(0);} console.error(cfg); console.log('not-found'); })();"
```

The output is `<plugin-root>` on stdout, or the literal string `not-found`. The resolver
checks, in order: `installed_plugins.json` in the Claude config directory (`$CLAUDE_CONFIG_DIR`
when that variable is set, otherwise `$HOME/.claude` - `%USERPROFILE%\.claude` on Windows) - a
marketplace install, verified by confirming `bin/ns-stylometry` exists under the candidate
path; a project- or local-scope entry is skipped unless the current working directory is its
own `projectPath` or a descendant of it, so another project's install can never shadow this
one; the newest installed version wins among what remains when more than one is present - then
a local self-marketplace entry in `settings.json` (dev-workflow installs, same verification),
then a scan of the plugins cache (the versioned marketplace-cache layout and the legacy flat
layout), then the current working directory (dev-mode checkout).

If the output is `not-found`: halt immediately. On this path, the resolver also printed the
config directory it checked on stderr; report that value (do not re-derive
`$CLAUDE_CONFIG_DIR` versus `$HOME/.claude` yourself) and the `installed_plugins.json` path
checked within it (`<config-dir>/plugins/installed_plugins.json`). Do not invoke ns-doctor. Ask
the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>` for Step 3.

**Shared plugin-root convention.** This resolver is the same command as `skills/nfs-new-book/SKILL.md` Step 4 and every other CLI-backed skill; `tests/checks/plugin-root-resolver.test.mjs` guards byte-for-byte parity across all eight.

---

## Step 3 - Single Bash invocation (one call per mode)

Use the Bash tool to invoke `bin/ns-doctor`. This is the ONE engine call for this invocation; only the move routine below adds Bash calls of its own, and its last step re-runs this report. No individual sub-CLI calls (ns-claims, ns-stylometry, ns-scrub) are made by the skill; the doctor engine composes its checks internally via `runChecks`.

**Mode `report` (full check inventory), and mode `move-state` (confirms that the book resolves before a move):**

```
node "<plugin-root>/bin/ns-doctor" --project=. --report --json
```

**Mode `migrate` (state-folder check, then schema-version diagnosis; writes only through the move routine):**

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
| `snapshot` | Snapshot naming | A file in the state folder's `snapshots/` does not match the naming convention `<slug>.<YYYYMMDDTHHMMSSZ>.md`. Rename the file to conform. |
| `style-profile` | Style profile structure | `context/style-profile.md` is missing a required section, has sections out of order, is missing a `Baseline reference` field, disagrees with `config.json`'s stylometry baseline, has a broken `Exemplars` path, or is a stub alongside an already-captured baseline. Edit the named section, field, or path directly, or re-run `/nonfiction-studio:nfs-capture-voice` to resynchronize both files. |
| `ai-use-log` | AI use log | A line in the state folder's `ai-use-log.jsonl` is not valid JSON. Edit or remove the named line (by line number); every other line is unaffected, since the file is append-only and each line is an independent record. |

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

**Exit 2 - the state folder cannot be resolved:**

If stdout parses as JSON and its `status` is `state-folder-unpointed` or `state-pointer-invalid`, the checks could not run because the engine cannot tell where this book's records are. This is never treated as a pass. Present each finding (path, type, message), then:

- **`state-folder-unpointed`:** "This book's records are in a folder the plugin does not expect, such as the legacy `.studio/`. Run `/nonfiction-studio:nfs-doctor migrate` to rename that folder to `_nonfiction-studio/`, or to keep its name by recording it in `nonfiction-studio.json`."
- **`state-pointer-invalid`:** "`nonfiction-studio.json` at the book root names a state folder the plugin cannot use, so writes in this book are paused until it is repaired. Edit it to name the folder that holds `meta.json`, or remove it when the records are in `_nonfiction-studio/`. Then re-run `/nonfiction-studio:nfs-doctor`."

In `move-state` mode, present the same result and halt: a move needs a book that resolves.

**Exit 2 - operational error:**

Any other exit 2. Surface the stderr content and halt. This exit is never treated as a pass.

> Doctor error (exit 2): [first non-empty line of stderr, or "engine exited with code 2 with no message on stderr" if stderr is empty]. The doctor run did not complete. Check that this is a valid project bible (the state folder's `meta.json` and a `context/` directory must exist at the project root). If stdout also contains output, include it verbatim for diagnostic purposes.

If the stderr message contains "requires migration", also suggest:
> Run `/nonfiction-studio:nfs-doctor migrate` to get the explicit migration diagnosis before taking action.

### Migrate mode

**State folder first.** If `--migrate` exits 2 and stdout parses as JSON with `status` `state-folder-unpointed`, this book's records sit in a folder the plugin does not expect. Each `state.unpointed-folder` finding's `path` names one such folder (for example `.studio/`).

- **More than one folder is named.** Never choose between them. List every folder, state that only one of them can be this book's state folder, and ask the author to move the others out of the book root by hand. Write nothing and halt.
- **Exactly one folder is named.** Call it `<from>`, without its trailing slash. Offer two choices, and wait for the author to pick one:
  1. "Rename `<from>/` to `_nonfiction-studio/`, the default name. No `nonfiction-studio.json` is needed afterwards."
  2. "Keep the name `<from>/`, and record it in `nonfiction-studio.json` at the book root. Nothing is renamed." Offer this choice only when `<from>` passes the name rule in the move routine's step 0; otherwise state why it cannot be kept.

  Run the move routine below with `<to>` set to `_nonfiction-studio` for choice 1, or to `<from>` for choice 2. Any answer other than a choice writes nothing.

If `--migrate` exits 2 with `status` `state-pointer-invalid`, present it as Step 4's exit-2 state-folder branch describes, and write nothing. The pointer names a folder that the author or an interrupted move chose, so only the author can say which folder is right.

**Schema version.** Otherwise, `--migrate` exits 0 when the schema is already current and 2 only when migration is genuinely required (an incompatible version). Distinguish the two cases by the exit code, then by examining stdout and stderr:

**Current schema, nothing to migrate** - exit 0; stdout parses as JSON with `"status": "current"`:

> Doctor migrate verdict: Schema version is current. No migration is needed. [stdout JSON `message` field verbatim.] No files were written. Migrations arrive with the first schema change per Q-04 (release, versioning, and compatibility); the snapshot-before-migrate and restore-on-failure contract activates at that time.

**Migration required** - exit 2; stderr contains content (stdout is empty or not JSON):

> Doctor migrate verdict: Migration required. [stderr content verbatim.] No migration has been applied; migrations from older schema versions are not yet defined in v1. The snapshot-before-migrate and restore-on-failure contract activates when real migrations arrive per Q-04 (release, versioning, and compatibility). No files were written. Verify the `schema_version` field in the state folder's `meta.json`; the supported major is `2`.

### Packs mode

`--validate-packs` exits 0 in v1 regardless of whether a packs directory is found. Parse stdout as JSON and present the `message` field:

> Doctor packs verdict: [stdout JSON `message` field verbatim.] No files were written. Craft-model packs arrive in Phase 2 per D-21.

### Move-state mode

A move needs a book that resolves. If the `--report` run exits 2, present it as the exit-2 branches above describe and halt. On exit 0 or exit 1, findings do not block a move; mention their count and continue.

Find the current folder name, `<from>`: use the Read tool on `nonfiction-studio.json` at the book root. If the file does not exist, `<from>` is `_nonfiction-studio`; otherwise it is the file's `state_dir` value. The report run has already confirmed that this folder resolves.

If `<to>`, the name from Step 1, equals `<from>`, state "The state folder is already named `<from>/`. Nothing to move." and halt. Otherwise run the move routine below.

---

## Move routine (modes `migrate` and `move-state`)

This routine moves the book's state folder from `<from>` to `<to>`, or, when the two are equal, records the current name in the pointer without moving anything. It follows ADR-0015 (state folder name) and the mid-book update promise in MIGRATION.md: the author sees every change before it happens, and no book content is destroyed. Run each step in order and stop at the first failure.

0. **Check the preconditions.** The current directory must be the book root: it holds `context/` and `chapters/`. If it does not, ask the author to start the session at the book root, write nothing, and halt. `<to>` must match `^[A-Za-z0-9._-]{1,64}$`, must not be `.` or `..`, and must not be `context`, `structure`, `research`, `chapters`, `production`, `.git` or `.claude` (on Windows, compare without regard to case). If it fails, state which rule it breaks, write nothing, and halt.
1. **Ask.** State the whole proposal, then ask "May I make these changes? (yes/no)":
   - the folder change: "rename `<from>/` to `<to>/`", or "no rename" when the two are equal;
   - the pointer change: "delete `nonfiction-studio.json`" when `<to>` is `_nonfiction-studio` and the file exists, "no pointer change" when `<to>` is `_nonfiction-studio` and it does not, and otherwise "write `nonfiction-studio.json` with `{"state_dir": "<to>"}`";
   - "add `<to>/README.md`, which explains the folder" when that file does not exist yet;
   - "In a git working tree, the rename uses `git mv`, so every file keeps its history."

   Wait for an explicit yes. Anything else writes nothing: state "No changes were made." and halt. In a non-interactive (headless) context nobody can answer, so state "Moving the state folder needs an explicit yes from you, so it is not available in a non-interactive session." and write nothing.
2. **Refuse to merge.** When `<to>` differs from `<from>`, use the Bash tool to run `test -e "<to>" && echo EXISTS || echo FREE`. On `EXISTS`, state that `<to>` already exists at the book root, name both folders, explain that two state folders are never merged, write nothing, and halt.
3. **Change the pointer.** First note the pointer's current content, or that it is absent, so the move can be undone. When `<to>` is `_nonfiction-studio`, delete the pointer if it exists, with the Bash tool: `rm -f nonfiction-studio.json`. Otherwise use the Write tool to write `nonfiction-studio.json` at the book root with exactly this content and a trailing newline: `{"state_dir": "<to>"}`.
4. **Rename the folder.** Skip this step when `<to>` equals `<from>`. Otherwise use the Bash tool to run:

   ```
   if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && [ -n "$(git ls-files -- "<from>" | head -n 1)" ]; then git mv -- "<from>" "<to>"; else mv -- "<from>" "<to>"; fi
   ```

   If the command fails, the pointer from step 3 no longer matches the folder. Writes in the book stay paused until the two agree, and no record is lost. State what happened, then give both ways forward: finish the move by renaming `<from>/` to `<to>/`, or undo it by restoring `nonfiction-studio.json` to the content noted in step 3 (or deleting it, if it was absent). Halt.
5. **Add the README.** If `<to>/README.md` does not exist, use the Read tool on `<plugin-root>/templates/book-scaffold/_nonfiction-studio/README.md`, and write its content verbatim to `<to>/README.md` with the Write tool.
6. **Confirm.** Re-run `node "<plugin-root>/bin/ns-doctor" --project=. --report --json` and present the result as Step 4's report mode describes. Then, inside a git working tree, run `git check-ignore -q -- nonfiction-studio.json && echo POINTER_IGNORED; git check-ignore -q -- "<to>/meta.json" && echo FOLDER_IGNORED` with the Bash tool. On `POINTER_IGNORED`, warn: "`.gitignore` excludes `nonfiction-studio.json`. Commit it anyway, or remove the ignore rule: a clone without the pointer cannot find this book's records." On `FOLDER_IGNORED`, warn: "`.gitignore` excludes `<to>/`. Commit it with the book, because it holds the AI-use log." Finally, remind the author to commit the moved folder and any pointer change.

---

## Failure behavior

**`fix` argument supplied.** Step 1 halts with the Phase 2 decline message. No tool calls, no file reads, no engine invocation.

**Unrecognized mode argument.** Step 1 halts with the unrecognized-mode message. No tool calls, no file reads.

**Exit 2 from `--report`.** Step 4 surfaces the stderr and halts. Never treated as a pass. If the error message mentions schema version mismatch, suggest running `/nonfiction-studio:nfs-doctor migrate` for the explicit migration diagnosis.

**Exit 2 from `--migrate`.** Expected output from the CLI when migration is genuinely required (an incompatible schema version); an already-current schema now exits 0 instead. Step 4 distinguishes the two cases and presents the appropriate message. It is not an unexpected error.

**Exit 2 from `--validate-packs`.** Unexpected in v1 (the packs mode exits 0 under all normal conditions). Surface the stderr and halt.

**Project root not found.** If `findBookRoot` cannot locate the state folder's `meta.json` from the current directory, the CLI exits 2 with a `BibleError` message on stderr. Surface it: "Doctor error: [BibleError message]. Ensure this skill is invoked from within a Nonfiction Studio project bible (the state folder's `meta.json` must be present at or above the current directory)."

**Unpointed state folder or bad pointer.** The CLI exits 2 with a JSON report on stdout whose `status` names the problem. Step 4 presents it and routes to `migrate`, or to a hand repair of `nonfiction-studio.json`. It is never treated as a pass.

**`migrate` or `move-state`: no explicit yes, an invalid target name, a target that already exists, or a non-interactive context.** The move routine writes nothing and says why.

**`migrate` or `move-state`: the rename fails after the pointer changed.** Step 4 of the move routine reports the mismatch and gives both the way to finish the move and the way to undo it. Writes stay paused until the pointer and the folder agree, and no record is lost.

**`install-statusline`: plugin root cannot be resolved.** Step A halts before any read or write, exactly as Step 2's own failure behavior below: report the config directory and the `installed_plugins.json` path attempted, and ask the author how to proceed.

**`install-statusline`: existing `~/.claude/settings.json` is not valid JSON.** Step B halts before writing anything; the author is told to fix or back up the file first, or to use the built-in `/statusline` command instead.

**`install-statusline`: any answer other than an explicit yes (a "no", silence, an unrelated answer, or a non-interactive context with nobody to ask).** Step C or D writes nothing and states that `/statusline` and re-running `/nonfiction-studio:nfs-doctor install-statusline` both remain available.
