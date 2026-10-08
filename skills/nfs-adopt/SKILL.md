---
name: nfs-adopt
user-invocable: true
argument-hint: "[element: style | brief | structure]"
description: "Adopts an existing book in place, without changing any of the author's files: plans with bin/ns-doctor --adopt-plan, shows what it will add and what works at once, and on an explicit yes writes the state folder, its README, and a pointer naming the book's own chapters folder. With an element argument, takes on one more part of the bible (style, brief or structure) and hands off to the skill that creates it. Use when an author brings a book that already exists, or when the session start, nfs-start or nfs-new-book says the folder already holds writing."
when_to_use: "Use when the author wants to bring an existing manuscript into Nonfiction Studio, says 'adopt this book' or 'use my existing chapters', or is routed here by the session start, nfs-start, or nfs-new-book's existing-writing stop. Use with an element argument to adopt style, brief or structure in a book that is already adopted. Do not invoke to start a new book in an empty folder (use nfs-new-book) or to repair a state folder or pointer (use nfs-doctor)."
metadata:
  version: "0.1.0"
  updated: 2026-10-04
---

This skill adopts an existing book in place, per ADR-0016 (adopting an existing book). The author's files stay canonical and untouched: the skill adds the plugin's state folder beside them and a pointer that names the folder holding the chapters, and it records which parts of the bible the book has taken on. The bible has five elements: `chapters` (always adopted at adoption), `style`, `brief`, `structure` and `claims`. Adopting `claims` is not available in this release.

**What it writes, and only on an explicit yes.** In adopt mode: the state folder `_nonfiction-studio/` with its README and state files, and the pointer `nonfiction-studio.json` at the book root. In element mode: the `adoption` record in the state folder's `meta.json`, before it hands off to the skill that creates the element. It never moves, renames, edits or deletes an author file, and it never reads an author file as evidence or as a source.

**No agents invoked.** The plan comes from the read-only `bin/ns-doctor --adopt-plan` engine; the skill writes the state files itself with the Write tool. In element mode it hands off to `nfs-capture-voice`, `nfs-interview` or `nfs-outline`, which run their own flows.

Skill inputs read:
- the plan printed by `bin/ns-doctor --adopt-plan --json` (read-only; it never writes)
- `PLUGIN_ROOT/templates/config-defaults.json`, `PLUGIN_ROOT/templates/book-scaffold/_nonfiction-studio/README.md` and `PLUGIN_ROOT/templates/book-scaffold/_nonfiction-studio/progress.schema.json` (adopt mode)
- `PLUGIN_ROOT/.claude-plugin/plugin.json` (the plugin version recorded in `meta.json`)
- the state folder's `meta.json` (element mode)

---

## Step 1 - Argument parsing (no tool call)

- No argument: **adopt mode** (Steps 2 to 7).
- `style`, `brief` or `structure`: **element mode** (Steps 2, 3, then 8 to 10).
- `claims`: stop. Say that adopting claims is not available in this release, because the plugin does not yet convert a book's own claim system; the book's own ledger stays its record, and claim coverage, fact-checking, the apparatus and agent drafting stay unavailable until it can be adopted.
- `chapters`: say that the chapters folder is adopted at adoption itself, and run adopt mode if the book is not adopted yet.
- Anything else: name the valid arguments and stop.

---

## Step 2 - Resolve the plugin root

Use the Bash tool to run the resolver:
```
node -e "(function(){ var fs=require('fs'),path=require('path'),os=require('os'); function rj(p){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){return null;}} function has(p){try{return fs.existsSync(path.join(p,'bin','ns-stylometry'));}catch(e){return false;}} function ld(p){try{return fs.readdirSync(p,{withFileTypes:true}).filter(function(e){return e.isDirectory();}).map(function(e){return e.name;}).sort();}catch(e){return [];}} function cmp(a,b){var pa=String(a).split('.').map(function(n){return parseInt(n,10)||0;});var pb=String(b).split('.').map(function(n){return parseInt(n,10)||0;});for(var i=0;i<3;i++){var d=(pa[i]||0)-(pb[i]||0);if(d)return d;}return 0;} function norm(x){var s=path.resolve(x);return process.platform==='win32'?s.toLowerCase():s;} function inProj(pp){if(pp==null||pp==='')return true;var a=norm(pp);var c=norm(process.cwd());return c===a||c.indexOf(a+path.sep)===0;} var cfg=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'); var ip=rj(path.join(cfg,'plugins','installed_plugins.json')); if(ip!=null&&ip.plugins){ var best=null; var keys=Object.keys(ip.plugins).sort(); for(var i=0;i<keys.length;i++){ var key=keys[i]; if(key.indexOf('nonfiction-studio@')!==0)continue; var arr=Array.isArray(ip.plugins[key])?ip.plugins[key]:[]; for(var j=0;j<arr.length;j++){ var entry=arr[j]; var p=entry&&entry.installPath; if(p==null||has(p)===false)continue; var scope=(entry&&entry.scope)||''; if((scope==='project'||scope==='local')&&inProj(entry&&entry.projectPath)===false)continue; var v=(entry&&entry.version)||'0.0.0'; var better=best===null||cmp(v,best.v)>0||(cmp(v,best.v)===0&&best.scope!=='user'&&scope==='user'); if(better){best={root:p,v:v,scope:scope};} } } if(best!==null){console.log(best.root);process.exit(0);} } var st=rj(path.join(cfg,'settings.json')); if(st!=null&&st.extraKnownMarketplaces&&st.extraKnownMarketplaces['nonfiction-studio']){ var src=st.extraKnownMarketplaces['nonfiction-studio'].source; var sp=src&&src.path; if(sp&&has(sp)){console.log(sp);process.exit(0);} } var cacheRoot=path.join(cfg,'plugins','cache'); var bestC=null; var mps=ld(cacheRoot); for(var m=0;m<mps.length;m++){ var nsDir=path.join(cacheRoot,mps[m],'nonfiction-studio'); var vers=ld(nsDir); for(var k=0;k<vers.length;k++){ var root=path.join(nsDir,vers[k]); if(has(root)){ if(bestC===null||cmp(vers[k],bestC.v)>0){bestC={root:root,v:vers[k]};} } } } if(bestC!==null){console.log(bestC.root);process.exit(0);} for(var n=0;n<mps.length;n++){ if(mps[n].indexOf('nonfiction-studio')===0){ var lroot=path.join(cacheRoot,mps[n]); if(has(lroot)){console.log(lroot);process.exit(0);} } } if(has(process.cwd())){console.log(process.cwd());process.exit(0);} console.error(cfg); console.log('not-found'); })();"
```

The output is `<plugin-root>` on stdout, or the literal string `not-found`. If the output is `not-found`: halt immediately. On this path, the resolver also printed the config directory it checked on stderr; report that value and the `installed_plugins.json` path checked within it (`<config-dir>/plugins/installed_plugins.json`). Do not invoke ns-doctor and do not write any file. Ask the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>`; the steps below also call it PLUGIN_ROOT.

**Shared plugin-root convention.** This resolver is the same command as `skills/nfs-new-book/SKILL.md` Step 4 and every other CLI-backed skill; `tests/checks/plugin-root-resolver.test.mjs` guards byte-for-byte parity across every skill that carries it.

---

## Step 3 - Plan (read-only)

Use the Bash tool to run, in the folder the author wants to adopt (the current directory):

```
node "<plugin-root>/bin/ns-doctor" --project=. --adopt-plan --json
```

Exit 2 means the plan could not be made: show the first line of stderr verbatim and stop, writing nothing. Exit 0 prints one JSON object. Its fields are documented on the ns-doctor reference page; the ones this skill uses are:

- `book`: null when this folder is not a book; otherwise `{ "root", "adopted" }`.
- `pointer`: null when there is no `nonfiction-studio.json`; otherwise `{ "valid", "state_dir", "chapters_dir", "reason" }`.
- `state_folders`: folders that already hold a state folder's `meta.json` and `progress.json`.
- `chapters_candidates`: folders at the book root that hold Markdown files directly, most files first; `chapters_folder` is the one the `chapters` list describes.
- `chapters`: one entry per chapter, `{ "file", "slug", "title", "words", "words_whole_file" }`. `words` is counted on prose, cut at the proposed boundary; `words_whole_file` counts the whole file.
- `prose_boundary`: null, or the proposed boundary heading `{ "heading", "files_with_heading", "markdown_files" }`.
- `shared_folders`: bible folders (`context/`, `structure/`, `research/`, `production/`) that already hold the author's own files, with a count.
- `ledger_candidates`: files whose names suggest a claim ledger of the author's own.
- `title_candidate`: the first heading of the top-level `README.md`, or null.
- `git`: null when the folder is not in a git working tree; otherwise `{ "work_tree", "uncommitted" }`.

In element mode, continue at Step 8.

---

## Step 4 - Decide whether adoption applies (adopt mode)

Stop, writing nothing, in each of these cases:

- `book` is not null and `book.adopted` is true: the book is already adopted. Say so, and name `/nonfiction-studio:nfs-adopt style`, `/nonfiction-studio:nfs-adopt brief` and `/nonfiction-studio:nfs-adopt structure` as the way to take on more of the bible.
- `book` is not null and `book.adopted` is false: this is a book the plugin created, so every element is already in place. Name `/nonfiction-studio:nfs-start` instead.
- `pointer` is not null and `pointer.valid` is false, or `state_folders` is not empty: the folder holds plugin records that do not resolve. Show `pointer.reason` or the folder names, and name `/nonfiction-studio:nfs-doctor` as the fix.
- `chapters_candidates` is empty: no folder at the book root holds Markdown files directly. Say that adoption needs the chapters to sit as Markdown files directly in one folder, and that the skill moves no files, so the author arranges the folder and runs this skill again.

---

## Step 5 - Show the plan, writing nothing (adopt mode)

Present the plan in plain language, in this order:

1. **The chapters folder.** Name `chapters_folder` and list each chapter with its title and `words`. If `chapters_candidates` holds other folders, name them too, and say that the author can choose one of them instead.
2. **The prose boundary.** When `prose_boundary` is not null, say that `heading` ends `files_with_heading` of the `markdown_files` chapter files, and that everything from that heading to the end of a file would be treated as working material rather than prose: it is never counted, scored or scanned. Say that word counts above use it, and give the whole-file total from `words_whole_file` for comparison.
3. **What will be added.** The state folder `_nonfiction-studio/`, holding a README that explains it, `meta.json` with the adoption record, `config.json`, `progress.json` with each chapter at status `drafting`, `progress.schema.json`, an empty `ai-use-log.jsonl`, and empty `gate/`, `logs/` and `snapshots/` folders; and `nonfiction-studio.json` at the book root, naming the chapters folder. **None of the author's files will change.**
4. **What works at once.** Word counts in `progress.json`; the AI-use log for chapter writes; a snapshot before each chapter edit; the status board (`nfs-status-dashboard`) and the status line; the doctor; the orientation block at session start; and the quality gate's `prompt_scrub`, `continuity`, `state_coherence`, `session_write_flag` and `overlap` checks. Say plainly that `overlap` has no source material to compare against until claims can be adopted, and reports that.
5. **What stays unadopted, and what adopting each takes.**
   - `style`: `/nonfiction-studio:nfs-adopt style` runs the voice capture flow and turns on the gate's `stylometry` check. A baseline captured from the author's own chapters is a capture, not a ghostwriting detector: the drift check cannot tell ghostwritten prose from the author's own at chapter scale.
   - `brief`: `/nonfiction-studio:nfs-adopt brief` runs the intake interview and creates the brief, audience and decision log.
   - `structure`: `/nonfiction-studio:nfs-adopt structure` runs the outline flow and creates the thesis, outline and chapter list. It comes after `brief`.
   - `claims`: not adoptable in this release, so claim coverage, quote fidelity, fact-checking, the apparatus and drafting with the plugin's agents are unavailable.
6. **Shared folders.** For each entry in `shared_folders`, say that the folder already holds the author's own files, that the plugin will create its own files there only later, after a separate yes, and that its agents may write only those files, never the author's.
7. **The author's own ledger.** If `ledger_candidates` is not empty, name the files and say that they stay the book's record: the plugin neither reads nor converts them.
8. **Uncommitted work.** If `git` is not null and `git.uncommitted` is above zero, recommend committing that work first, so that the adoption is one reviewable change.

---

## Step 6 - Ask (adopt mode)

**Non-interactive context (headless `-p` session).** Nobody is present to confirm, and adoption is never assumed. Write nothing, say that the adoption was planned but not performed, and stop.

Otherwise, settle three answers:

- **The title.** Propose `title_candidate` when it is not null, and ask for the book's title.
- **The chapters folder.** Propose `chapters_folder`. If the author picks another folder from `chapters_candidates`, re-run Step 3 with `--chapters-dir=<that folder>` added, and show Step 5 again for it.
- **The prose boundary**, when one is proposed: ask whether to use it.

Then ask: "Shall I adopt this book as planned? Only an explicit yes writes anything." An explicit yes continues to Step 7. Any other answer writes nothing: say so, and stop.

---

## Step 7 - Write, then report (adopt mode)

Write in this order with the Write tool. The pointer comes last, because it is what makes the folder a book: if any write fails, stop at once, name the path and the operation, and say that deleting `_nonfiction-studio/` removes everything written so far.

1. `_nonfiction-studio/README.md`: read `PLUGIN_ROOT/templates/book-scaffold/_nonfiction-studio/README.md` and write it verbatim.
2. `_nonfiction-studio/meta.json`, with `created` the current UTC date-time in RFC 3339 form, `date` today's date as `YYYY-MM-DD`, `plugin_version_at_creation` the `version` field read from `PLUGIN_ROOT/.claude-plugin/plugin.json` (never a version from memory), and one `shared_folders` entry per plan entry, each with `"consented": null`:
   ```json
   {
     "schema_version": "2",
     "created": "<RFC 3339 UTC date-time>",
     "plugin_version_at_creation": "<version from plugin.json>",
     "book_title": "<the confirmed title>",
     "adoption": {
       "date": "<YYYY-MM-DD>",
       "elements": {
         "chapters": "adopted",
         "style": "not-adopted",
         "brief": "not-adopted",
         "structure": "not-adopted",
         "claims": "not-adopted"
       },
       "shared_folders": [{ "folder": "<name>", "consented": null }]
     }
   }
   ```
3. `_nonfiction-studio/config.json`: read `PLUGIN_ROOT/templates/config-defaults.json`. When the author confirmed the prose boundary, add `"prose": { "ends_at_heading": "<heading>" }` at the top level; otherwise write it verbatim.
4. `_nonfiction-studio/progress.json`: `"version": 2`, `"updated"` the current UTC date-time, and one entry per plan chapter, in plan order: `{ "slug", "title", "status": "drafting", "word_count", "open_claim_count": 0 }`. `word_count` is the chapter's `words` when the author confirmed the boundary, and `words_whole_file` otherwise, so that the doctor's word-count check agrees with it. `totals` holds the sum of the word counts, `"open_claim_count": 0`, `"chapters_final": 0`, and `chapters_total` the number of chapters.
5. `_nonfiction-studio/progress.schema.json`: read `PLUGIN_ROOT/templates/book-scaffold/_nonfiction-studio/progress.schema.json` and write it verbatim.
6. `_nonfiction-studio/ai-use-log.jsonl`, `_nonfiction-studio/gate/.gitkeep`, `_nonfiction-studio/logs/.gitkeep` and `_nonfiction-studio/snapshots/.gitkeep`: empty files.
7. `nonfiction-studio.json` at the book root: `{ "chapters_dir": "<the confirmed chapters folder>" }`.

Then run the doctor's report:

```
node "<plugin-root>/bin/ns-doctor" --project=. --report --json
```

Expect no findings, and one `element-not-adopted` notice for each of `style`, `brief`, `structure` and `claims`. Show any finding verbatim.

Close with three things:

- **How to undo.** Delete `_nonfiction-studio/` and `nonfiction-studio.json`; no other file was written. In a git working tree, `git status` shows exactly those two additions.
- **What to run next.** `/nonfiction-studio:nfs-status-dashboard` for the board, `/nonfiction-studio:nfs-check-chapter` for the gate on a chapter, and `/nonfiction-studio:nfs-adopt style`, `brief` or `structure` to take on more of the bible.
- **What is not available yet**: anything that needs `claims`.

---

## Step 8 - Check the element (element mode)

Stop, writing nothing, unless `book` is not null and `book.adopted` is true. When `book` is null, say that the folder is not adopted yet and name `/nonfiction-studio:nfs-adopt` without an argument; when the book was created by the plugin, say that every element is already in place.

The state folder is `pointer.state_dir` when the plan names one, and `_nonfiction-studio` otherwise. Use the Read tool on its `meta.json`.

- If `adoption.elements.<element>` is already `"adopted"`, say so and name the skill that maintains it (`nfs-capture-voice` for style, `nfs-interview` for brief, `nfs-outline` for structure). Stop.
- For `structure`: if `adoption.elements.brief` is not `"adopted"`, stop and name `/nonfiction-studio:nfs-adopt brief` first, because the outline starts from a confirmed brief.

---

## Step 9 - Show what adopting the element creates, then ask (element mode)

| Element | The plugin files it creates | The flow that creates them |
|---|---|---|
| `style` | `context/style-profile.md` and the voice baseline in the state folder's `config.json` | `nfs-capture-voice` |
| `brief` | `context/brief.md`, `context/audience.md`, `context/decisions.md` | `nfs-interview` |
| `structure` | `structure/thesis.md`, `structure/outline.md`, `structure/chapter-list.md`, `structure/comps.md`, `research/open-questions.md` | `nfs-outline` |

State which files the flow will create, and what starts working: `stylometry` in the gate for `style` (a capture from the author's own chapters, not a ghostwriting detector); the chapter-list registry and outlining for `structure`.

**Shared folders: one informed yes per folder.** For each file above whose folder is listed in `adoption.shared_folders` with `"consented": null`, say which file the flow will create there and why, and that the author's own files in that folder will not be touched. The author's yes to adopt the element is that folder's yes; record it in Step 10. A no writes nothing: name what could not be done, and stop.

**Non-interactive context (headless `-p` session).** Write nothing, say that the element was not adopted, and stop.

Otherwise ask: "Shall I adopt `<element>` and start `<flow>`? Only an explicit yes writes anything." Any other answer writes nothing.

---

## Step 10 - Record, then hand off (element mode)

On an explicit yes, use the Edit tool on the state folder's `meta.json`: set `adoption.elements.<element>` to `"adopted"`, and set `consented` to today's date (`YYYY-MM-DD`) for each shared folder the author consented to in Step 9. Edit nothing else.

Then proceed with the flow: `/nonfiction-studio:nfs-capture-voice` for style (suggest the author's own chapters as the writing samples), `/nonfiction-studio:nfs-interview` for brief, or `/nonfiction-studio:nfs-outline` for structure. The element counts as adopted from now on, so the flow runs, and until it finishes, the doctor reports the element's missing files as findings.

**How to undo.** Set the element back to `"not-adopted"` in `meta.json`, and delete the files the flow created; the author's own files were never touched.
