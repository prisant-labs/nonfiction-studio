---
name: nfs-new-book
user-invocable: true
argument-hint: "[book title] [guided|blank]"
description: "Scaffolds the flat bible tree (context/, structure/, chapters/, research/, production/) and creates the state folder's files for a new nonfiction book project. Use when an author starts a new book or follows the studio Path 1 prompt."
when_to_use: "Use when the author explicitly wants to initialize, start, or set up a new book project, says 'create a new book', or is routed here from the studio dispatcher Path 1 prompt. Do not invoke for authors with an existing book project layout (a state folder or context/brief.md) unless they explicitly ask to re-initialize only the missing pieces. Do not invoke in a folder that already holds the author's own writing, or in a book that was adopted in place; Step 1 stops in both and names nfs-adopt, which brings existing writing in."
---

This skill scaffolds a new nonfiction book project. It is surface-independent: no hooks or subagents are needed.

Skill inputs read:
- `templates/book-scaffold/` (scaffold tree)
- `templates/project-init.guided.md` (guided setup template)
- `templates/project-init.blank.md` (blank setup template)
- `templates/config-defaults.json` (config defaults)
- `.claude-plugin/plugin.json` (plugin version, read at Step 6, never hardcoded)
- `.claude/nonfiction-studio.local.md` (Step 7's own gate check and outcome record; the project's optional studio settings file)
- `templates/nonfiction-studio.local.example.md` (Step 7 stamp source when the studio settings file does not yet exist)
- `.claude/settings.local.json` (Step 7, read before a consented merge-write of the `outputStyle` key)
- `.claude/skills/book-context/SKILL.md` (Step 7a's own gate check: does the generated skill already exist)
- `context/brief.md`, `context/style-profile.md`, `structure/outline.md` (Step 7a content-assembly sources)
- `bin/ns-claims` (Step 7a, invoked via the Bash tool for the open-claims count)

Elements this skill needs: none

## Locate the state folder

This book keeps its machine-managed records in one state folder at the book root. The book root is the folder that holds `nonfiction-studio.json`, or else the folder that holds `context/` and `chapters/`. In this skill, `<state-dir>` stands for the state folder's name, and `<chapters-dir>` stands for the name of the folder that holds the chapters. Resolve both once, before any step below.

1. Use the Read tool on `nonfiction-studio.json` at the book root. This Read is the skill's first tool call. If the file does not exist, `<state-dir>` is `_nonfiction-studio` and `<chapters-dir>` is `chapters`; continue at item 4.
2. If the file exists, it must hold a JSON object with a `state_dir` key, a `chapters_dir` key, or both. Each value must be a string that matches `^[A-Za-z0-9._-]{1,64}$`, and neither may be `.` or `..`. The `state_dir` value may not be `context`, `structure`, `research`, `chapters`, `production`, `.git` or `.claude`. The `chapters_dir` value may not be `context`, `structure`, `research`, `production`, `.git`, `.claude` or the state folder's name. On Windows, compare these names without regard to case. The state folder must exist at the book root and hold `meta.json`, and a folder that `chapters_dir` names must exist at the book root. When every condition holds, `<state-dir>` is the `state_dir` value, or `_nonfiction-studio` when that key is absent, and `<chapters-dir>` is the `chapters_dir` value, or `chapters` when that key is absent.
3. If the file exists but any condition in item 2 fails, stop. Tell the author which condition failed, write nothing, and name `/nonfiction-studio:nfs-doctor` as the fix. Never fall back to `_nonfiction-studio`.
4. If the file does not exist and `_nonfiction-studio/meta.json` does not exist either, list the folders at the book root, hidden folders included. If one of them holds both `meta.json` and `progress.json`, stop. Name that folder, write nothing, and name `/nonfiction-studio:nfs-doctor` as the fix. Never create a second state folder beside it.
5. Use the Read tool on `<state-dir>/meta.json`. If it has an `adoption` object, the book is an adopted one, and an element counts as adopted only when its entry under `adoption.elements` is exactly `"adopted"`. A book without the object has adopted all five elements: `chapters`, `style`, `brief`, `structure` and `claims`.
6. The line `Elements this skill needs:` above names the elements this skill cannot run without. If any of them is not adopted, stop before your first write. Name the element, write nothing, and name `/nonfiction-studio:nfs-adopt <element>` as the way to adopt it. For `claims`, say instead that adopting claims is not available yet.
7. Treat the files of every other element that is not adopted as absent. Never read, create or edit them, even when a file of that name exists, because in an adopted book such a file is the author's own. The `style` files are `context/style-profile.md` and the voice baseline in `<state-dir>/config.json`. The `brief` files are `context/brief.md`, `context/audience.md` and `context/decisions.md`. The `structure` files are those under `structure/`, plus `research/open-questions.md`. The `claims` files are `research/evidence-log.md`, `research/sources.md` and `research/packets/`.

Before you run a command or open a path below, replace `<state-dir>` and `<chapters-dir>` with the resolved names. When this skill dispatches an agent, name both resolved folders in the dispatch brief, because agents never resolve them themselves.

---

## Step 1 - Run the existence check (first tool call after the state folder is located)

**If the stanza found an `adoption` object in `<state-dir>/meta.json`, stop before this check.** The book was adopted in place, so its own files are its record, and this skill never stamps a bible beside them. Write nothing, and output:

> This book was adopted in place, so its own files stay its record, and starting a new book here would set up plugin files beside them. Nothing was written. To take on another part of the bible, such as the brief or the outline, run /nonfiction-studio:nfs-adopt with that element. To start a new book, run this skill in an empty folder.

Use the Bash tool to run:
```
for d in */ .*/; do d="${d%/}"; case "$d" in .|..|'*'|'.*'|<state-dir>) continue;; esac; [ -f "$d/meta.json" ] && [ -f "$d/progress.json" ] && echo "UNPOINTED: $d"; done
if [ -d <state-dir> ] || [ -f context/brief.md ]; then echo REINIT; else find . -mindepth 1 -name '.*' -prune -o -type f \( -iname '*.md' -o -iname '*.markdown' \) ! -path ./README.md -print | head -n 3 | sed 's/^/WRITING: /'; echo NEWINIT; fi
```

The first line checks for a second state folder: any other folder at the book root, hidden folders included, that holds both `meta.json` and `progress.json`. **If any line starts with `UNPOINTED:`, stop.** Write nothing, and output:

> This book already keeps its records in [each folder named on an `UNPOINTED:` line], not in `<state-dir>/`. Starting a new book here would split those records across two folders, so nothing was written. Run /nonfiction-studio:nfs-doctor to rename the folder or to record its name in `nonfiction-studio.json`.

When no book project is found, the second line also looks for existing writing, per ADR-0016 (adopting an existing book). A `WRITING:` line names a Markdown file outside hidden folders and files (names beginning with a dot, such as `.git/`, `.claude/` or `.github/`), other than a top-level `README.md`; the search prints at most three. It never runs for a book project, so a book's own chapters never trigger it. **If any line starts with `WRITING:`, stop.** Write nothing, and output:

> This folder already holds writing, for example [each path named on a `WRITING:` line], and it has no Nonfiction Studio project. Starting a new book here would set up an empty project beside that writing, so nothing was written. To bring this writing in as it is, run /nonfiction-studio:nfs-adopt: it plans the adoption first and changes none of your files. To start a new book, run this skill again in an empty folder.

Otherwise the last line of the output is exactly one of two values:
- `REINIT` - this directory already contains a book project
- `NEWINIT` - no book project found yet

### Step 1a - If the output is REINIT

Use the Bash tool to enumerate every expected scaffold path against what is present on disk:

```bash
for f in \
  context/brief.md context/audience.md context/style-profile.md \
  context/decisions.md context/project-init.md \
  structure/thesis.md structure/outline.md structure/comps.md \
  chapters/.gitkeep \
  research/evidence-log.md research/sources.md research/open-questions.md \
  production/exports/.gitkeep production/README.md \
  production/front-matter.md production/back-matter.md \
  <state-dir>/meta.json <state-dir>/config.json <state-dir>/progress.json \
  <state-dir>/progress.schema.json <state-dir>/ai-use-log.jsonl \
  <state-dir>/snapshots/.gitkeep <state-dir>/gate/.gitkeep <state-dir>/logs/.gitkeep \
  <state-dir>/README.md; do
  [ -e "$f" ] || printf "MISSING: %s\n" "$f"
done
printf "SCAN_DONE\n"
```

**If the output is only `SCAN_DONE` (no MISSING lines):** Output this verbatim. Do not stamp, read, or write any bible or `<state-dir>/` file in this branch:

> Warning: This directory already contains a book project. All 25 expected scaffold files are present. No bible or `<state-dir>/` files were written. Run /nonfiction-studio:nfs-interview to continue setting up your project.

Then run the output style offer (Step 7) followed by the book-context skill generation step (Step 7a); this REINIT run stops after Step 7a. This is the one reachable path for a legitimate re-offer against a fully-scaffolded existing project: Step 7 self-gates on an already-recorded `output_style` value and on non-interactive context, and Step 7a self-gates on the generated skill file's existence, so either adds a write here only when its own outcome has never been recorded for this project and the author actually consents or declines in this interaction.

**If the output contains one or more `MISSING:` lines:** The lines name the paths not yet on disk. Report the exact delta:

> Warning: This directory already contains a book project. The following scaffold files are missing: [list each MISSING path from the tool output, one per line]. Re-stamping only the missing files.

Then:
- **Non-interactive context (headless -p session):** State "Proceeding automatically in non-interactive context." Then resolve the plugin root (Step 4, plugin root resolution), stamp the missing files (Step 5, scaffold stamping), and fill state placeholders (Step 6, state files) below, but write ONLY the paths that appeared in the MISSING list. Do not read or write any other file. For `context/project-init.md` if it is in the missing list, use blank mode. After writing, report which files were stamped, then run the output style offer (Step 7 - its own non-interactive branch applies here, since this whole branch is non-interactive) followed by the book-context skill generation step (Step 7a - also non-interactive here, so it skips the same way), and STOP.
- **Interactive context:** Ask "May I stamp only these missing files? (yes/no)" and wait for author confirmation before writing anything. On confirmation, resolve the plugin root (Step 4, plugin root resolution), confirm the working directory if Step 4b applies, stamp the missing files (Step 5, scaffold stamping), and fill state placeholders (Step 6, state files), writing ONLY the missing paths. After writing, report which files were stamped, then run the output style offer (Step 7 - this is the reachable path for a legitimate re-offer on a REINIT run whose earlier offer outcome was never recorded) followed by the book-context skill generation step (Step 7a - the same reachable-path logic applies to it), and STOP.

**Note on <state-dir>/meta.json:** If <state-dir>/meta.json is in the missing list, first acquire the book title (from the argument, or by asking the author; in non-interactive contexts reuse the title recorded in context/brief.md if present, otherwise report that the title is required) before filling its placeholders.

### Step 1b - If the output is NEWINIT

Continue with Steps 2-8 below.

---

## Step 2 - Resolve the book title

Use the title provided in the author's message. If no title is present in the message, ask: "What is the title of this book?"

## Step 3 - Resolve the mode

Check whether the author's message contains the word "guided" or "blank".

- If "guided" is present: use guided mode. Template source: `PLUGIN_ROOT/templates/project-init.guided.md`.
- If "blank" is present: use blank mode. Template source: `PLUGIN_ROOT/templates/project-init.blank.md`.
- If neither is present AND this is an interactive session: ask "Guided setup (walkthrough with explanations) or blank (fast scaffold with no explanations)?" and wait for the answer.
- If neither is present AND this is a non-interactive session (headless -p): use blank mode and state: "No mode argument supplied; defaulting to blank mode in non-interactive context."

## Step 4 - Find the plugin root

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
checked within it (`<config-dir>/plugins/installed_plugins.json`). Do not write any
files. Ask the author how to proceed (verify plugin installation or provide the path
manually).

Once PLUGIN_ROOT is resolved (the resolver's output), verify it is correct:
```
test -f "PLUGIN_ROOT/templates/book-scaffold/context/brief.md" && echo OK || echo TEMPLATE_NOT_FOUND
```

If the output is `TEMPLATE_NOT_FOUND`: halt. Report the exact path that was not readable and ask the author to verify the plugin installation. Do not write any files.

**Shared plugin-root convention.** This resolver is the same command as every other
CLI-backed skill (`skills/nfs-build-apparatus/SKILL.md` Step 1 and the rest);
`tests/checks/plugin-root-resolver.test.mjs` guards byte-for-byte parity across every skill that carries it.

### Step 4b - Confirm the working directory (uncertain surface only)

This is the S-06 chat safeguard: on chat, no hooks or `bin/` are available and the author has less visibility into where files land than on CLI or Cowork, where the terminal or workspace already makes the working directory unambiguous. Skip this step silently and continue to Step 5 when either applies:

- PLUGIN_ROOT above did not resolve to the current working directory (the normal
  installed-plugin path on CLI and Cowork - via `installed_plugins.json`, `settings.json`, or
  a cache scan), and the working directory is not otherwise in doubt.
- This is a non-interactive session (headless `-p`): there is no author present to answer, so proceed the same as the rest of this skill does in non-interactive mode.

Otherwise, confirm before writing. This covers both signals named in the S-06 requirement:
PLUGIN_ROOT resolved to the current working directory itself (the resolver's dev-mode tier,
meaning no `installed_plugins.json` entry, `settings.json` self-marketplace entry, or cache
match was found, and hooks and `bin/` are typically unavailable in that same session); or the
working directory is not otherwise confirmed by any completed tool call. State the absolute
directory about to receive the new book tree (PLUGIN_ROOT, if it equals the working directory,
or the result of running `pwd` via the Bash tool if that path is not yet known) and ask: "This
will create the new book project in `<path>`. Shall I proceed? (yes/no)" Wait for an explicit
"yes" before continuing to Step 5. Any other answer, or inability to confirm a path at all,
halts here; no files are written.

## Step 5 - Stamp the flat bible tree

For each mapping below: use the Read tool on the source path, then the Write tool for the destination (relative to the current working directory).

Token substitutions for prose files:
- Replace `{{DATE}}` with today's date in YYYY-MM-DD format (calendar date, not timestamp).

**context/**
- `PLUGIN_ROOT/templates/book-scaffold/context/brief.md` -> `context/brief.md`
- `PLUGIN_ROOT/templates/book-scaffold/context/audience.md` -> `context/audience.md`
- `PLUGIN_ROOT/templates/book-scaffold/context/style-profile.md` -> `context/style-profile.md`
- `PLUGIN_ROOT/templates/book-scaffold/context/decisions.md` -> `context/decisions.md`
- Template from Step 3 (`project-init.guided.md` or `project-init.blank.md`) -> `context/project-init.md` (write verbatim; no token substitution)

**structure/**
- `PLUGIN_ROOT/templates/book-scaffold/structure/thesis.md` -> `structure/thesis.md`
- `PLUGIN_ROOT/templates/book-scaffold/structure/outline.md` -> `structure/outline.md`
- `PLUGIN_ROOT/templates/book-scaffold/structure/comps.md` -> `structure/comps.md`

**chapters/**
- Write an empty file to `chapters/.gitkeep`

**research/**
- `PLUGIN_ROOT/templates/book-scaffold/research/evidence-log.md` -> `research/evidence-log.md` (replace `{{DATE}}` with YYYY-MM-DD)
- `PLUGIN_ROOT/templates/book-scaffold/research/sources.md` -> `research/sources.md`
- `PLUGIN_ROOT/templates/book-scaffold/research/open-questions.md` -> `research/open-questions.md`

**production/**
- Write an empty file to `production/exports/.gitkeep`
- `PLUGIN_ROOT/templates/book-scaffold/production/README.md` -> `production/README.md`
- `PLUGIN_ROOT/templates/book-scaffold/production/front-matter.md` -> `production/front-matter.md`
- `PLUGIN_ROOT/templates/book-scaffold/production/back-matter.md` -> `production/back-matter.md`

On any Read or Write error: stop immediately. Name the exact path that failed and the operation attempted (Read or Write). Do not stamp any additional files.

## Step 6 - Write <state-dir>/ state files

Create `<state-dir>/` at the bible root alongside `context/` and `chapters/`.

Token substitutions for state files:
- Replace `{{DATETIME}}` with the current UTC date-time in RFC 3339 format (example: `2026-07-18T14:22:07Z`). This is a full timestamp, not a calendar date.
- Replace `{{BOOK_TITLE}}` with the title from Step 2.
- Replace `{{PLUGIN_VERSION}}` with the `version` field read from `PLUGIN_ROOT/.claude-plugin/plugin.json` (PLUGIN_ROOT was already resolved in Step 4). Read the file and use its current value; never write a version number from memory or from an earlier run.

**`<state-dir>/meta.json`** - write with all placeholders filled:
```json
{
  "schema_version": "2",
  "created": "<RFC 3339 UTC timestamp>",
  "plugin_version_at_creation": "<version field read from PLUGIN_ROOT/.claude-plugin/plugin.json>",
  "book_title": "<title from Step 2>"
}
```
Note: `created` uses `{{DATETIME}}` (RFC 3339 UTC), not `{{DATE}}` (YYYY-MM-DD). Do not write a calendar date here.

**`<state-dir>/config.json`**: read `PLUGIN_ROOT/templates/config-defaults.json`, write verbatim.

**`<state-dir>/progress.json`**:
```json
{
  "version": 2,
  "updated": "<RFC 3339 UTC timestamp>",
  "chapters": [],
  "totals": {
    "word_count": 0,
    "open_claim_count": 0,
    "chapters_final": 0,
    "chapters_total": 0
  }
}
```
Note: `updated` uses `{{DATETIME}}` (RFC 3339 UTC), not `{{DATE}}` (YYYY-MM-DD).

**`<state-dir>/progress.schema.json`**: read `PLUGIN_ROOT/templates/book-scaffold/_nonfiction-studio/progress.schema.json`, write verbatim.

**`<state-dir>/ai-use-log.jsonl`**: write as an empty file.

**`<state-dir>/README.md`**: read `PLUGIN_ROOT/templates/book-scaffold/_nonfiction-studio/README.md`, write verbatim. It tells anyone who opens the folder what it holds, that it belongs in version control, and how to rename it.

**Empty directory sentinels** (write empty files):
- `<state-dir>/snapshots/.gitkeep`
- `<state-dir>/gate/.gitkeep`
- `<state-dir>/logs/.gitkeep`

On any Read or Write error: stop immediately. Name the exact path that failed and the operation attempted. Do not write any additional state files.

## Step 7 - Output style offer (once per project)

Nonfiction Studio ships two optional output styles as plugin components: `manuscript` (prose-first drafting responses - no unrequested bullet summaries, no code fences around manuscript prose, quoted passages instead of diffs for line edits, claim-marker discipline preserved throughout) and `review` (terse, verdict-first, tabular responses for gate and status work). This offer presents them once per project. It never activates a style without an explicit answer, and it never re-asks once an outcome has actually been recorded.

**Where this step returns.** Step 7 is reachable two ways: from Step 6 below, on a fresh NEWINIT run, and from Step 1a above, on a REINIT run (both the SCAN_DONE sub-branch and the MISSING-files sub-branch). Every branch below ends with "Continue to Step 7a" - unconditionally, regardless of which origin reached this step. Step 7a (book-context skill generation) is where the NEWINIT-versus-REINIT distinction is actually decided: it continues to Step 8's closing report only on the NEWINIT origin, and stops on the REINIT origin, since Step 8's "Book project has been initialized" report must never print for a REINIT run (no fresh initialization happened) and Step 1a's own warning has already reported that invocation's outcome.

**Non-interactive context (headless `-p` session).** There is nobody present to answer a three-way choice, and a style is never activated by assumption. State: "Skipping the output style offer in this non-interactive session; no output style was set. Run `/nonfiction-studio:nfs-new-book` again from an interactive session to see the offer, or set a style directly with `/config`." Do not read or write any file for this step. Continue to Step 7a.

**Gate check (chat and interactive CLI/Cowork alike - both branches below share this precondition).** Use the Bash tool to check whether the studio settings file already exists:
```
test -f .claude/nonfiction-studio.local.md && echo HAS_SETTINGS || echo NO_SETTINGS
```
- `HAS_SETTINGS`: use the Read tool on `.claude/nonfiction-studio.local.md` and parse its YAML frontmatter (the same fenced-block shape `hooks/lib/settings.mjs` reads; this step never assumes the file is well-formed). If an `output_style` key is present with any value (`manuscript`, `review`, or `declined`), the offer has already run for this project on ANY surface: state that fact, naming the recorded value, make no further reads or writes for this step, and continue to Step 7a - this is what makes the offer fire once per project regardless of which surface later runs `nfs-new-book` again. If the frontmatter fails to parse (malformed YAML, or no fenced block at all), treat this the same as no `output_style` key set - continue below - but skip the Edit-tool path in "Recording the outcome" below when the moment comes; instead name the parse problem to the author and ask before touching the file at all.
- `NO_SETTINGS`, or `HAS_SETTINGS` with no `output_style` key set: no outcome is recorded yet for this project. Continue to the surface-specific branch below.

**Chat surface.** Chat has no reliable path to activate a project-scoped `outputStyle` setting the way CLI and Cowork do (the same working-directory concern Step 4b already guards against for chat), so this offer never attempts the `.claude/settings.local.json` write on chat. State: "Nonfiction Studio ships two optional output styles, `manuscript` and `review`. On chat, activate one yourself with `/config` (Output Styles) rather than through this offer. I will record `output_style: declined` in `.claude/nonfiction-studio.local.md` so this offer does not repeat, since no style was actually activated." Then follow the "Recording the outcome" procedure below with `output_style: declined` - this is the one branch where a decline is recorded without the author having been asked to choose. Continue to Step 7a.

**Interactive CLI or Cowork session.** Present the offer, stating exactly what each answer does before asking - byte-parallel to the doctor's `install-statusline` consent language (`skills/nfs-doctor/SKILL.md`, "state exactly what will be written, and ask"):

> Nonfiction Studio ships two optional output styles:
> - `manuscript` - prose-first drafting responses: no unrequested bullet summaries, no code fences around manuscript prose, quoted passages instead of diffs for line edits, claim-marker discipline preserved throughout.
> - `review` - terse, verdict-first, tabular responses for gate and status work.
>
> Activating one changes how Claude's replies are shaped in this project; it changes nothing else on disk. Saying yes to one writes `{"outputStyle": "nonfiction-studio:Manuscript"}` (or `{"outputStyle": "nonfiction-studio:Review"}`) into `.claude/settings.local.json` - created if absent, merged preserving every other key if present. Saying no records `output_style: declined` in `.claude/nonfiction-studio.local.md` instead, so this offer does not repeat.
>
> Would you like to activate `manuscript`, `review`, or no thanks? (You can always change this later with `/config`.)

Wait for an explicit answer: `manuscript`, `review`, or a decline (a "no," "no thanks," "neither," or any similarly explicit refusal). Any other reply is not an answer - ask again rather than guessing.

**On `manuscript` or `review` (consent):**

Compose the exact namespaced value from the plugin manifest name and the chosen style's frontmatter `name` - `nonfiction-studio:Manuscript` or `nonfiction-studio:Review` - per the platform's plugin output-style activation contract: a bare style name (the frontmatter `name` alone, or the filename) silently fails to activate with no error, and only the namespaced `plugin-name:<frontmatter name>` form works.

Use the Read tool on `.claude/settings.local.json`:
- **Does not exist:** treat the existing object as `{}`.
- **Exists and parses as JSON:** hold the parsed object.
- **Exists but does not parse as JSON:** halt this step. State: "`.claude/settings.local.json` exists but is not valid JSON, so I cannot safely merge into it without risking the rest of your settings. Please fix or back up that file and re-run `/nonfiction-studio:nfs-new-book`, or activate the style yourself with `/config`." Write nothing for either file - since no outcome was actually recorded, the offer remains open for a later run. Continue to Step 7a.

On a parseable object: merge `{"outputStyle": "<the namespaced value>"}` at the top level - a shallow merge, so every other existing key is preserved unchanged. Use the Write tool to write the merged object back to `.claude/settings.local.json` as formatted JSON. Note for the author before writing: the Write tool shows its own permission prompt for this file, same as any file write; this skill does not suppress or work around it, and a denial there is a real refusal (see "an author refuses a file write" in Failure behavior below).

Then follow the "Recording the outcome" procedure below with `output_style: manuscript` or `output_style: review`, matching the activated style. After both writes succeed, report: "`.claude/settings.local.json` now activates the `<style>` output style (`nonfiction-studio:<Name>`). It takes effect at the start of your next Claude Code session." Continue to Step 7a.

**On decline:** follow the "Recording the outcome" procedure below with `output_style: declined`. Continue to Step 7a.

**Recording the outcome (studio settings file).** This procedure writes exactly one thing - the `output_style` key in `.claude/nonfiction-studio.local.md` - never anything else in that file, and never touches the body content below its frontmatter fence.

- `HAS_SETTINGS` (the file already exists, confirmed with no `output_style` key set, above): use the Edit tool to add `output_style: <value>` to the existing YAML frontmatter block, leaving every other key and the body untouched.
- `NO_SETTINGS` (the file does not exist): if PLUGIN_ROOT was not already resolved earlier in this run (this is the case on the SCAN_DONE sub-branch of Step 1a, which reaches Step 7 without ever running Step 4), perform Step 4's plugin-root resolution now. Use the Read tool on `PLUGIN_ROOT/templates/nonfiction-studio.local.example.md`, then use the Write tool to create `.claude/nonfiction-studio.local.md` from ONLY the template's fenced YAML frontmatter block (the opening `---` line through the closing `---` line, inclusive) with the `output_style` example line uncommented and set to `<value>`; every other commented-out example key is left exactly as the template ships it. Stop at the closing `---` fence - write nothing after it. The template's `## House notes` section and its example bullets below that fence are illustrative prose for an author to write for themselves, not standing instructions to stamp into every project by default; `hooks/session-start.mjs` emits the house-notes pointer whenever the body is non-empty, so copying that section here would silently arm it with boilerplate the author never wrote. This file creation was already disclosed, in the same interaction, by whichever branch above led here (the chat redirect message, or the "Saying no records..." / "Saying yes to one writes..." sentences of the interactive offer) - no separate prompt is asked here.

The Write or Edit tool's own permission prompt still applies to this write, same as any file write. If it is denied, no outcome is recorded: state plainly that no output style outcome was recorded, and that this offer will run again the next time `/nonfiction-studio:nfs-new-book` runs against this project.

## Step 7a - Book-context skill generation (once per project)

This step writes an opt-out-able, project-committed `book-context` skill: a small quick-reference (thesis, top style rules, chapter map, open-claims count) generated from the project bible, so a future session can orient without re-reading the whole bible by hand. It writes into the AUTHOR's project tree (`.claude/skills/book-context/SKILL.md`, relative to the current working directory), never into this plugin's own installation. It never activates without an explicit yes, and it never re-offers once the file actually exists.

**Where this step returns.** Step 7a is reachable two ways, immediately after Step 7 concludes: on a fresh NEWINIT run (Step 7 was itself reached from Step 6), and on a REINIT run (Step 7 was itself reached from Step 1a, either the SCAN_DONE sub-branch or the MISSING-files sub-branch). Every branch below ends with "Continue to Step 8" - that instruction applies ONLY on the NEWINIT origin. On the REINIT origin, STOP here instead, whichever branch below concluded: Step 1a's own warning already reported this invocation's outcome, and Step 8's "Book project has been initialized" report must never print for a REINIT run, since no fresh initialization happened.

**Gate check (once per project).** Use the Bash tool to check whether the generated skill already exists:
```
test -f .claude/skills/book-context/SKILL.md && echo HAS_SKILL || echo NO_SKILL
```
- `HAS_SKILL`: a book-context skill already exists for this project. State that fact, naming the path. Make no further reads or writes for this step. Continue per the origin rule above.
- `NO_SKILL`: continue to the surface-specific branch below.

**Non-interactive context (headless `-p` session).** There is nobody present to consent, and committing content into the project tree is never done by assumption. State: "Skipping the book-context skill generation in this non-interactive session; no skill was generated. Run `/nonfiction-studio:nfs-new-book` again from an interactive session to be asked." Do not read or write any file for this step. Continue per the origin rule above.

**Interactive context.** Ask the consent question, stating plainly what a yes commits and when it becomes usable:

> Generate a book-context skill? It commits thesis and style content into your project tree, at `.claude/skills/book-context/SKILL.md`. It becomes usable starting your next Claude Code session, not this one - a skill file written during a session is not available until the session restarts or resumes, a Claude Code platform behavior. (yes/no)

Wait for an explicit `yes` or `no`. Any other reply is not an answer - ask again rather than guessing.

**On `no` (decline):** state "No book-context skill was generated. Nothing was written to `.claude/skills/`." Write nothing. Continue per the origin rule above.

**On `yes` (consent):** assemble the four items below, each citing the source path it was read from, then write the skill file.

1. **Book title.** On the NEWINIT origin, use the title resolved in Step 2. On the REINIT origin (Step 2 never ran), read `book_title` from `<state-dir>/meta.json`; if that file is unreadable or the field is absent, ask the author for the title.
2. **Thesis one-liner.** Use the Read tool on `context/brief.md`. Extract the first non-empty, non-heading, non-comment line under the `## 2. Thesis` heading (the same extraction rule `hooks/lib/orientation.mjs` uses for the SessionStart orientation block). If the heading is missing, the section is empty, or it holds only a `<!-- DRAFT: 2 - thesis -->` placeholder comment, write "Not yet recorded - run `nfs-interview`." Cite the source as `context/brief.md`.
3. **Top style rules.** Use the Read tool on `context/style-profile.md`. Extract up to three bullet lines (`- `) from the `## Do` and `## Do not` sections, in document order (the same rule `hooks/lib/orientation.mjs` uses). If none are found (an unfilled style profile), write "Not yet captured - run `nfs-capture-voice`." Cite the source as `context/style-profile.md`.
4. **Chapter map.** Use the Read tool on `structure/outline.md`. Extract every `### Chapter N: Title` heading line, in document order. If none are found, write "Not yet outlined - run `nfs-outline`." Cite the source as `structure/outline.md`.
5. **Open-claims count.** PLUGIN_ROOT is needed here too; resolve it now if it was not already resolved earlier in this run, the same fallback Step 7's "Recording the outcome" procedure uses. Then use the Bash tool to run `node "PLUGIN_ROOT/bin/ns-claims" --all --json`. Read `totalMarkers` and `resolvedCount` from the JSON; the open-claims count is `totalMarkers - resolvedCount`. Exit 0 (full coverage) and exit 1 (some markers unresolved) both carry valid data - read the JSON either way, do not treat exit 1 as a failure. Only exit 2 (no evidence log, no chapters directory, or an argument error) is a real failure: in that case write "Open claims: not yet countable (no evidence log or chapters yet)." Cite the source as `bin/ns-claims`.

Write the skill file with the Write tool:

`.claude/skills/book-context/SKILL.md`:
```
---
name: book-context
user-invocable: true
description: "Quick-reference for '<book title>': thesis, style rules, chapter map, and open-claims count, assembled from the project bible."
---

# Book context: <book title>

Generated once, on <today's date, YYYY-MM-DD>, from the project bible. It does not update automatically as the bible changes; delete this file and re-run `/nonfiction-studio:nfs-new-book` to regenerate it.

## Thesis
<thesis one-liner, or the not-yet-recorded note>
Source: `context/brief.md`

## Style rules
<up to three bullet lines, or the not-yet-captured note>
Source: `context/style-profile.md`

## Chapter map
<chapter heading list, or the not-yet-outlined note>
Source: `structure/outline.md`

## Open claims
<count, or the not-yet-countable note>
Source: `bin/ns-claims`
```

After writing, report: "`.claude/skills/book-context/SKILL.md` has been generated. It becomes usable starting your next Claude Code session, not this one." Continue per the origin rule above.

**Failure behavior (Step 7a).** On any Read or Write error while assembling or writing the skill file, stop immediately, name the exact path and operation that failed, and do not write a partial skill file. A denied Write-tool permission prompt is the same as a decline: no outcome is recorded, and a later `nfs-new-book` run against this project finds the file still absent and legitimately re-offers.

## Step 8 - Report success

List all files created. Output:

> Book project '{title}' has been initialized. The bible tree and <state-dir>/ state files are ready.

Then name the state folder and how to rename it, substituting the resolved name:

> Nonfiction Studio keeps this book's records in `<state-dir>/`. Commit that folder with the book. To give it a different name, run `/nonfiction-studio:nfs-doctor move-state <name>`.

Then: "The next step is nfs-interview. Invoke it with `/nonfiction-studio:nfs-interview` to conduct the structured intake interview and build your project brief. The interview typically takes 45-90 minutes and produces a confirmed context/brief.md."

---

## Failure behavior

- **Plugin root unresolved.** If the Step 4 resolver prints `not-found`, halt before writing any file. Report the config directory and the `installed_plugins.json` path attempted. Ask the author how to proceed (verify plugin installation or provide the path manually).
- **Working directory not confirmed (Step 4b).** If the author does not answer yes, or no path can be confirmed at all, halt before Step 5. No files are written.
- **Read or write error.** On any file operation failure, stop immediately. Name the exact path and operation that failed. Never continue stamping remaining files after a failure.
- **Missing template.** If a template file is not readable after PLUGIN_ROOT is confirmed, halt. Name the exact template path and ask the author to verify the plugin installation.
- **Output style offer: `.claude/settings.local.json` is not valid JSON (Step 7).** Halt that step only; write nothing. The offer's outcome is not recorded, so it remains open for a later run. Continue to Step 7a regardless.
- **Output style offer: an author refuses a file write (Step 7).** Whether the refusal is a declined conversational answer or a denied Write/Edit tool permission prompt, no `output_style` outcome is recorded in that case. A later `/nonfiction-studio:nfs-new-book` run against this project - including a REINIT run - finds no recorded value and legitimately re-offers the styles.
