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
checked within it (`<config-dir>/plugins/installed_plugins.json`). Do not invoke ns-status. Ask
the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>` for Step 2.

**Shared plugin-root convention.** This resolver is the same command as `skills/nfs-new-book/SKILL.md` Step 4 and every other CLI-backed skill; `tests/checks/plugin-root-resolver.test.mjs` guards byte-for-byte parity across all eight.

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

**Plugin root cannot be resolved.** Step 1 halts before invoking `bin/ns-status`. Reports the config directory and the `installed_plugins.json` path attempted. No table is rendered.

**No book root found.** Step 3 halts on the "No book root found" stderr message with the not-initialized message and routes to `nfs-new-book`. No table is rendered.

**`.studio/progress.json` missing.** Step 3 halts on the ENOENT-shaped `Cannot read progress.json` stderr message with the not-initialized message and routes to `nfs-new-book`. No table is rendered.

**Any other `bin/ns-status` error (malformed `progress.json`, `config.json`, or `meta.json`; an internal argument error).** Step 3 halts with the stderr content verbatim and routes to `nfs-doctor`. Never renders a partial or incorrect dashboard.

**Missing or empty gate directory.** Not a halt condition: `bin/ns-status` itself returns `null` for `drift` and `gate` on every chapter with no matching report, which Step 3 renders as "-". Next actions suggests running the quality gate for every such chapter.

**Missing `.studio/config.json`.** Not a halt condition: `hooks/lib/bible.mjs` returns `config: null` when the file does not exist, and since ADR-0012 (voice verdict scope) retired `thresholds.drift_score_max`, `bin/ns-status`'s board computation does not read `config.json` for the threshold in any case - each chapter's Threshold cell comes from that SAME chapter's own newest gate report, independent of `config.json`.

**Unreadable (malformed) `.studio/config.json`.** This IS a halt condition, unlike the missing case above: `hooks/lib/bible.mjs` throws `BibleError` (`CONFIG_READ_ERROR`) when `config.json` exists but fails to parse, and `bin/ns-status` exits 2 - handled by the "Any other `bin/ns-status` error" case above, which routes to `nfs-doctor`.
