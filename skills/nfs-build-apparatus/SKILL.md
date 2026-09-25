---
name: nfs-build-apparatus
user-invocable: true
argument-hint: ""
description: "Generates publisher-ready back matter from the evidence ledger in one Bash call: Chicago-style endnotes with real locators, a deduplicated bibliography, index-term candidates, and an honest needs-attention list, mapping bin/ns-notes's three exit codes to a clean pass, a findings list grouped by chapter, or a surfaced error never treated as a pass. Use when the author asks to generate endnotes, build a bibliography, prepare back matter for submission, or wants to see which ledger entries still need a locator or a source before publication."
when_to_use: "Use when the author types /nfs-build-apparatus, asks to generate or regenerate the bibliography or endnotes, wants to prepare back matter for a publisher or agent submission, or asks what in the ledger still needs a locator or source before the book can go out. Do not invoke for claim-coverage or quote-fidelity checks (use nfs-fact-check), for the deterministic quality gate (use nfs-check-chapter), or for editing chapter prose directly."
---

This skill fronts the read-only-over-the-ledger `bin/ns-notes` engine in a single Bash call and presents its verdict. `bin/ns-notes` never writes to `research/evidence-log.md`, `research/sources.md`, or `chapters/*.md` (OPP-D05, apparatus generator: read-then-emit only); it writes exactly four files under `production/` - `endnotes.md`, `bibliography.md`, `index-candidates.md`, and `apparatus-attention.md` - the author-facing directory that already holds `front-matter.md` and `back-matter.md`. `production/` is not `.studio/` machine state, so D-06 (single-writer state discipline) is not implicated. Regeneration is deterministic: running this skill twice over an unchanged ledger reproduces byte-identical files, so it is always safe to re-run.

**No agents invoked.** This is a deterministic-CLI-only skill. No chain edges exist.

Skill inputs read (by the engine via `--project=.`):
- `research/evidence-log.md` (EV entries: claim, source, locator, confidence, status)
- `research/sources.md` (SRC records: type, author, title, year, publisher, identifier, url, accessed)
- `chapters/*.md` (scanned for `[claim: EV-nnnn]` anchors)
- `hooks/lib/citation-styles/chicago.json` (the Chicago style, expressed as data)

Skill outputs written (by the engine, always attempted regardless of verdict):
- `production/endnotes.md`, `production/bibliography.md`, `production/index-candidates.md`, `production/apparatus-attention.md`

No skill chain edges exist for this skill.

---

## Step 1 - Resolve the plugin root

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
path checked within it (`<config-dir>/plugins/installed_plugins.json`). Do not invoke ns-notes. Ask
the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>` for Step 2.

**Shared plugin-root convention.** This resolver is the same command as `skills/nfs-new-book/SKILL.md` Step 4 and every other CLI-backed skill; `tests/checks/plugin-root-resolver.test.mjs` guards byte-for-byte parity across all eight.

---

## Step 2 - Single Bash invocation

Use the Bash tool to invoke `bin/ns-notes`. This is the ONE Bash call for this invocation.

```
node "<plugin-root>/bin/ns-notes" --project=. --json
```

Capture the exit code, stdout (JSON), and stderr. Proceed to Step 3.

---

## Step 3 - Present the result (exit-code mapping)

**Exit 0 - clean:**

Parse stdout as JSON. Present the clean pass:

> Apparatus verdict: PASS. `production/endnotes.md`, `production/bibliography.md`, `production/index-candidates.md`, and `production/apparatus-attention.md` were regenerated. [stdout JSON `totalNotes`] note(s) across [stdout JSON `chapters`] chapter(s), [stdout JSON `bibliographyCount`] bibliography entry(ies), [stdout JSON `indexCandidateCount`] index candidate(s). Nothing needs attention.

**Exit 1 - findings present:**

Parse stdout as JSON. Group the `findings` array by the `file` field (the chapter each finding belongs to). For each group, state the chapter, the count, and list each finding's `excerpt` (the EV or SRC ID) with its `detail` (what is missing). Close with:

> Apparatus verdict: [stdout JSON `findings.length`] item(s) need attention before the back matter is complete. `production/endnotes.md`, `production/bibliography.md`, and `production/index-candidates.md` were still regenerated; each affected citation is simply omitted from them until its ledger entry is fixed. See `production/apparatus-attention.md` for the full list. Fix the named gap in `research/evidence-log.md` or `research/sources.md`, then run `/nonfiction-studio:nfs-build-apparatus` again.

**Exit 2 - operational error:**

Surface the stderr content and halt. This exit is never treated as a pass.

> Apparatus error (exit 2): [first non-empty line of stderr, or "ns-notes exited with code 2 with no message on stderr" if stderr is empty]. The apparatus run did not complete; no `production/` files were written or updated by this invocation. Check that this is a valid project bible (`.studio/meta.json`, `research/evidence-log.md`, `research/sources.md`, and a `chapters/` directory must all be present). Run `/nonfiction-studio:nfs-doctor` to diagnose a broader structural problem.

---

## Failure behavior

**Plugin root cannot be resolved.** Step 1 halts before any Bash call to `ns-notes`. Report the config directory and the `installed_plugins.json` path attempted, and ask the author how to proceed.

**Exit 2 from `ns-notes`.** Step 3 surfaces the stderr and halts. Never treated as a pass, and never presented as if any `production/` file changed.

**Project root not found.** If `findBookRoot` cannot locate `.studio/meta.json` from the current directory, the CLI exits 2 with a `BibleError` message on stderr. Surface it: "Apparatus error: [BibleError message]. Ensure this skill is invoked from within a Nonfiction Studio project bible (`.studio/meta.json` must be present at or above the current directory)."

**Evidence log, sources registry, or chapters/ missing.** The CLI exits 2 naming the missing path on stderr. Surface it verbatim; do not guess at a fix.
