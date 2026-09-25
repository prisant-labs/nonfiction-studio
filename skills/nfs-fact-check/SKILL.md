---
name: nfs-fact-check
user-invocable: true
argument-hint: "<chapter: slug or number>"
description: "Runs the adversarial verification pass on a drafted chapter: an engine-backed marker inventory via bin/ns-claims, then the fact-checker agent's authoritative five-step pass that advances EV entry statuses, updates chapter markers, and writes the per-chapter fact-check report. Reports three counts (verified, unresolved, source-unverifiable) from the agent's report and names the report path. Writes no progress.json - the PostToolBatch hook owns the open-claims total. Use when the author says 'check my facts' or 'verify my claims,' wanting claim-level verification rather than the full pass-or-block verdict that nfs-check-chapter produces."
when_to_use: "Use when the author finishes drafting and wants claims verified, nfs-check-chapter reports unresolved claims, or nfs-start routes here from Path 3 (Research and verify). Do not invoke when no chapter argument is supplied (the skill halts if the chapter file is absent), or for unrelated queries."
chain:
  - fact-checker
---

This skill is the verification front door. It resolves the chapter argument, runs an engine-backed marker inventory via `bin/ns-claims`, states the web gate status, delegates the authoritative verification pass to the `fact-checker` agent, confirms agent writes via Read checks, and formats the three counts from the agent's per-chapter report. The `fact-checker` agent is the sole writer of chapter markers and EV status transitions; the skill orchestrates, confirms, and reports. The skill writes no `.studio/progress.json` - the open-claims total is maintained by the PostToolBatch hook per D-06 (single-writer state discipline).

**Writer alignment.** `fact-checker` writes all claim markers in `chapters/<slug>.md` (inserting `[UNVERIFIED]` or `[SOURCE-UNVERIFIABLE]` adjacent to unresolved markers and removing stale tags on re-checks that advance to `verified`; the `[claim: EV-nnnn]` marker is never removed) and all EV status transitions in `research/evidence-log.md`. The skill confirms both files via Read checks after the agent pass. It never eyeballs markers itself: the ns-claims engine is the deterministic inventory source.

**Re-run idempotency.** Re-runs are safe because the agent's writes are status-field updates and tag insert-or-remove operations against current state, and its cache skips known-good claims per D-09 (learning checker agents). A session interrupted after partial agent writes leaves the chapter and ledger in a consistent intermediate state; re-running picks up from current state without duplicating changes.

Skill inputs read:
- `structure/chapter-list.md` (slug registry; probed at Step 1 to resolve the chapter argument)
- `chapters/<slug>.md` (target chapter; file-existence probed at Step 1, confirmed via Read after agent pass)
- `research/evidence-log.md` (evidence ledger; passed to fact-checker, confirmed via Read after agent pass)
- `research/sources.md` (source registry; passed to fact-checker for the session-start changed-flag scan and online pass)
- `.studio/config.json` (web gate check at Step 4)
- `.claude/agent-memory/nonfiction-studio-fact-checker/` (verified-claims cache; read by fact-checker at session start per D-09)

Skill chain edge: `nfs-fact-check -> fact-checker` per `agents/_chain-permitted.yaml`.

---

## Step 1 - Chapter argument resolution and file probe (mandatory first tool call)

Use the Bash tool to check whether the chapter-list registry is present:
```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```

If `HAS_REGISTRY`: use the Read tool on `structure/chapter-list.md` to resolve the supplied argument to the canonical slug.
- **Slug match** (for example `02-finding-your-network`): locate the row whose slug column matches exactly. Carry the slug forward.
- **Number match** (for example `2` or `02`): locate the row whose chapter number matches. Carry the slug forward.
- **No match:** halt with a clear error. State: "Chapter `[supplied value]` was not found in the chapter registry. Check `structure/chapter-list.md` for the valid slugs." List the available slugs.

If `NO_REGISTRY`: use the supplied argument directly as the slug candidate.

After resolving the slug, use the Bash tool:
```
test -f chapters/<slug>.md && echo HAS_CHAPTER || echo NO_CHAPTER
```

The output is a binary token:
- `NO_CHAPTER`: halt immediately. State: "Chapter file `chapters/<slug>.md` was not found. Produce the chapter with `/nonfiction-studio:nfs-draft <slug>` before running the verification pass."
- `HAS_CHAPTER`: continue to Step 2.

A chapter argument is required. Do not proceed without a resolved slug pointing to an existing chapter file.

Once the slug is resolved, take the ai-use-log.jsonl count snapshot described in Step 6's Compliance append section for `chapters/<slug>.md` and `research/evidence-log.md`, before this flow's first write.

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
checked within it (`<config-dir>/plugins/installed_plugins.json`). Do not invoke ns-claims. Ask
the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>` for Step 3.

**Shared plugin-root convention.** This resolver is the same command as `skills/nfs-new-book/SKILL.md` Step 4 and every other CLI-backed skill; `tests/checks/plugin-root-resolver.test.mjs` guards byte-for-byte parity across all eight.

---

## Step 3 - Engine-backed marker inventory

Use the Bash tool to run the deterministic marker inventory:
```
node "<plugin-root>/bin/ns-claims" --chapter=<slug> --json
```

Parse the JSON output for the pre-count fields:
- `totalMarkers`: total claim markers (`[claim: EV-nnnn]` and `[UNVERIFIED]`) in the chapter
- `resolvedCount`: markers whose referenced EV entry is at `verified` or `interpretation`
- `coveragePct`: current coverage percentage

Present this pre-count to the author before delegation:

> Chapter `<slug>` pre-count: `<totalMarkers>` claim markers, `<resolvedCount>` resolved, coverage `<coveragePct>%`.

If `bin/ns-claims` exits with a non-zero code (evidence log missing, chapter unreadable, or BibleError), report the exact error message from stderr and halt. Do not proceed to delegation with a failed or incomplete inventory.

The ns-claims count is the deterministic pre-count the skill presents. The `fact-checker` agent performs the authoritative five-step verification pass per its contract; the agent's assessment is the operative one.

---

## Step 4 - Web gate check and delegate to fact-checker

Use the Read tool on `.studio/config.json` to check whether `research.web_enabled` is exactly the boolean `true`. State the gate status before spawning the agent:

- **Gate open** (`research.web_enabled: true`, running on CLI or Cowork): "Online pass enabled. The agent will attempt DOI and URL resolution for SRC records referenced by the chapter's EV entries."
- **Gate closed** (field absent, `false`, or any other value): "Online pass is not enabled for this project (`research.web_enabled` is not `true` in `.studio/config.json`). To enable it, add `\"research\": { \"web_enabled\": true }` to `.studio/config.json`. For claims that remain unresolved, source text can be pasted; the agent analyzes pasted content with the same quote-and-attribute discipline per D-13 (security posture)."
- **On chat** (even when gate is open): "Note: WebSearch and WebFetch may not be available on the chat surface. Paste source content for any claims the agent cannot resolve from the evidence ledger alone."

Spawn `fact-checker` via the `nfs-fact-check -> fact-checker` chain edge, passing:
- The chapter slug and file path (`chapters/<slug>.md`)
- The ns-claims pre-count from Step 3 (total markers, resolved, coverage)
- The web gate status from the config read
- Any pasted source content provided by the author

The `fact-checker` agent runs its authoritative five-step pass per its contract:
1. Session-start cache protocol: reads `research/sources.md` for `changed: true` flags, invalidates affected cache entries, loads the verified-claims cache from `.claude/agent-memory/nonfiction-studio-fact-checker/` per D-09 (learning checker agents)
2. Resolves all `[claim: EV-nnnn]` markers against `research/evidence-log.md`
3. Updates EV entry statuses (`verified`, `unverified`, `interpretation`, or `source-unverifiable`)
4. Inserts `[UNVERIFIED]` adjacent to unverified markers in `chapters/<slug>.md`; removes stale `[UNVERIFIED]` or `[SOURCE-UNVERIFIABLE]` tags when an entry advances to `verified` on a re-check; never removes the original `[claim: EV-nnnn]` marker
5. Runs the optional online DOI/URL pass when `research.web_enabled` is exactly the boolean `true`; inserts `[SOURCE-UNVERIFIABLE]` paired with the existing `[claim: EV-nnnn]` for online-pass failures; reports the gate as closed and the path to enable it when the gate is off

The agent writes `.studio/fact-check-reports/<NN>-report.md` at the end of every pass, including passes where all entries are verified.

The skill writes no chapter files, no ledger files, and no `.studio/` machine state.

---

## Step 5 - Confirm agent writes via Read checks

After the agent completes its pass, use the Read tool to confirm:
- `chapters/<slug>.md` is present and non-empty
- `research/evidence-log.md` is readable
- `.studio/fact-check-reports/<NN>-report.md` exists (the report the agent writes at the end of every pass)

If any file is missing, report the gap, name the last successful step, and offer to re-run from Step 4. Idempotency is guaranteed by the agent's cache-skip semantics and status-field update model: re-running starts from current state and repeats only the work not yet reflected on disk.

---

## Step 6 - Compliance append and report three counts from the agent's per-chapter report

### Compliance append (verify-then-append)

This flow's writes may already be logged automatically by a hook on this surface; this skill never assumes which surfaces do or do not fire that hook, and it never assumes the flow is running on any particular surface. Before this flow's first write, read `.studio/ai-use-log.jsonl` and count how many records currently target each file this flow is about to write (the file's path appearing in that record's `targets` array). Hold that starting count per file. After this flow's writes complete, re-read `.studio/ai-use-log.jsonl` and count the records targeting each of those files again. For each file: if the count increased between the two reads, a hook already appended a record for this write on this surface, and this skill appends nothing further for that file. If the count did not increase, append the flow's record or records for that file to `.studio/ai-use-log.jsonl`, per the record template below, using the six-field shape in `docs/formats/ai-use-log.md` (S-08 section 5): `ts`, `agent`, `surface`, `scope`, `targets`, `summary` - with `surface` set honestly to the surface this flow is actually running on. A record already sitting in the log before this flow started, from an earlier session, does not by itself suppress the append; only a count increase observed between this flow's own two reads does. This skill never appends twice for the same write.

**Record template for this flow.** Up to two records, one per file the `fact-checker` agent touched and that needed the append (per the count-delta check above):

For the chapter marker edits:
```json
{"ts":"<RFC 3339 UTC>","agent":"fact-checker","surface":"<actual surface>","scope":"assisted","targets":["chapters/<slug>.md"],"summary":"Updated claim markers in <slug> per the verification pass."}
```

For the evidence-ledger status transitions:
```json
{"ts":"<RFC 3339 UTC>","agent":"fact-checker","surface":"<actual surface>","scope":"mechanical","targets":["research/evidence-log.md"],"summary":"Advanced EV entry statuses for <slug> per the verification pass."}
```

`surface` is `claude-code`, `cowork`, or `chat` per `docs/formats/ai-use-log.md` - whichever this flow is actually running on. On CLI and Cowork the PostToolBatch hook normally covers `chapters/<slug>.md` already (it watches Edit calls into `chapters/`), so the count-delta check above typically finds no append needed for that file there; `research/evidence-log.md` is outside the hook's watch on every surface, so this skill's own append is typically the only record for that file.

Format and present the three counts from the agent's per-chapter report at `.studio/fact-check-reports/<NN>-report.md`:

- **Verified:** EV entries advanced to `verified` or `interpretation` in this pass (including cache hits, which required no network call)
- **Unresolved:** entries remaining at `unverified` or `pending` after the pass (open claims)
- **Source-unverifiable:** entries tagged `source-unverifiable` by the online pass

Name the report path explicitly:

> Fact-check report: `.studio/fact-check-reports/<NN>-report.md`

Note: the per-chapter `open_claim_count` in `.studio/progress.json` is maintained by the PostToolBatch hook, not by this skill. The hook updates the open-claims total when the agent writes chapter files. The three counts above are conversation-level reporting only.

Suggest next steps based on the counts:
- Unresolved or source-unverifiable entries remain: run `/nonfiction-studio:nfs-research <slug>` to add source material, or paste source content and re-run `/nonfiction-studio:nfs-fact-check <slug>`.
- Coverage is 100% and no open claims remain: run the quality gate: `/nonfiction-studio:nfs-check-chapter <slug>`.

On the chat surface, state that the Stop hook gate does not fire automatically: "On chat the Stop hook gate does not fire automatically. Run `/nonfiction-studio:nfs-check-chapter <slug>` explicitly when all claims are resolved."

---

## Failure behavior

**Chapter file missing.** The Step 1 Bash probe halts on `NO_CHAPTER`. The halt message names the chapter file path and routes to `nfs-draft`. No state is written by a halted Step 1.

**Chapter argument not matched.** Step 1 halts with the supplied value, the registry file name (`structure/chapter-list.md`), and the list of valid slugs when the registry is present but the argument matches no row. No state is written.

**ns-claims failure.** If `bin/ns-claims` exits non-zero (evidence log absent, chapter unreadable, BibleError), the exact stderr message is reported and the skill halts at Step 3. Do not proceed to agent delegation with a failed inventory. The most common cause is a missing `research/evidence-log.md`; run `/nonfiction-studio:nfs-research` to create it.

**Agent incomplete or report missing.** If the Step 5 Read checks find the chapter file or report absent after the agent ran, report the gap and offer to re-run from Step 4. The re-run is safe: the agent's cache marks known-good entries and skips their re-verification; the agent's status-field writes and marker operations are idempotent against current state.

**Gate closed, unresolved claims remain.** When the online pass is disabled and offline verification leaves entries unresolved, the skill reports the count and suggests either enabling the gate or providing pasted source text. The chapter is in a valid intermediate state; the Stop gate blocks release only in blocking mode, and in Phase 1 the gate is warn-only by default.
