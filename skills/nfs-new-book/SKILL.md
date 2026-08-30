---
name: nfs-new-book
user-invocable: true
argument-hint: "[book title] [guided|blank]"
description: "Scaffolds the flat bible tree (context/, structure/, chapters/, research/, production/) and creates .studio/ state files for a new nonfiction book project. Use when an author starts a new book or follows the studio Path 1 prompt."
when_to_use: "Use when the author explicitly wants to initialize, start, or set up a new book project, says 'create a new book', or is routed here from the studio dispatcher Path 1 prompt. Do not invoke for authors with an existing book project layout (.studio/ or context/brief.md) unless they explicitly ask to re-initialize only the missing pieces."
---

This skill scaffolds a new nonfiction book project. It is surface-independent: no hooks or subagents are needed.

Skill inputs read:
- `templates/book-scaffold/` (scaffold tree)
- `templates/project-init.guided.md` (guided setup template)
- `templates/project-init.blank.md` (blank setup template)
- `templates/config-defaults.json` (config defaults)
- `.claude-plugin/plugin.json` (plugin version, read at Step 6, never hardcoded)

## Step 1 - Run the existence check (mandatory first tool call)

Use the Bash tool to run:
```
if [ -d .studio ] || [ -f context/brief.md ]; then echo REINIT; else echo NEWINIT; fi
```

The output will be exactly one of two values:
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
  .studio/meta.json .studio/config.json .studio/progress.json \
  .studio/progress.schema.json .studio/ai-use-log.jsonl \
  .studio/snapshots/.gitkeep .studio/gate/.gitkeep .studio/logs/.gitkeep; do
  [ -e "$f" ] || printf "MISSING: %s\n" "$f"
done
printf "SCAN_DONE\n"
```

**If the output is only `SCAN_DONE` (no MISSING lines):** Output this verbatim and STOP. Do not write any files or continue to any further step:

> Warning: This directory already contains a book project. All 24 expected scaffold files are present. No files were written. Run /nonfiction-studio:nfs-interview to continue setting up your project.

**If the output contains one or more `MISSING:` lines:** The lines name the paths not yet on disk. Report the exact delta:

> Warning: This directory already contains a book project. The following scaffold files are missing: [list each MISSING path from the tool output, one per line]. Re-stamping only the missing files.

Then:
- **Non-interactive context (headless -p session):** State "Proceeding automatically in non-interactive context." Then resolve the plugin root (Step 4, plugin root resolution), stamp the missing files (Step 5, scaffold stamping), and fill state placeholders (Step 6, state files) below, but write ONLY the paths that appeared in the MISSING list. Do not read or write any other file. For `context/project-init.md` if it is in the missing list, use blank mode. After writing, report which files were stamped and STOP.
- **Interactive context:** Ask "May I stamp only these missing files? (yes/no)" and wait for author confirmation before writing anything. On confirmation, resolve the plugin root (Step 4, plugin root resolution), confirm the working directory if Step 4b applies, stamp the missing files (Step 5, scaffold stamping), and fill state placeholders (Step 6, state files), writing ONLY the missing paths. After writing, report which files were stamped and STOP.

**Note on .studio/meta.json:** If .studio/meta.json is in the missing list, first acquire the book title (from the argument, or by asking the author; in non-interactive contexts reuse the title recorded in context/brief.md if present, otherwise report that the title is required) before filling its placeholders.

### Step 1b - If the output is NEWINIT

Continue with Steps 2-7 below.

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

Use the Bash tool to run the primary lookup:
```
node -e "const s=require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8');const m=JSON.parse(s).extraKnownMarketplaces;const ns=m&&m['nonfiction-studio'];console.log(ns&&ns.source&&ns.source.path||'not-found')"
```

The output is PLUGIN_ROOT. If it prints `not-found`, run the platform cache fallback:
```
find "$HOME/.claude/plugins/cache" -maxdepth 3 -type d -name "nonfiction-studio*" 2>/dev/null | head -1
```

If that also returns nothing, run the dev-mode fallback (current working repo checkout):
```
test -d templates/book-scaffold && pwd || echo not-found
```

If all three lookups fail: halt immediately. Report the settings.json path attempted (`$HOME/.claude/settings.json`) and the cache path attempted (`$HOME/.claude/plugins/cache`). Do not write any files. Ask the author how to proceed (verify plugin installation or provide the path manually).

Once PLUGIN_ROOT is resolved, verify it is correct:
```
test -f "PLUGIN_ROOT/templates/book-scaffold/context/brief.md" && echo OK || echo TEMPLATE_NOT_FOUND
```

If the output is `TEMPLATE_NOT_FOUND`: halt. Report the exact path that was not readable and ask the author to verify the plugin installation. Do not write any files.

### Step 4b - Confirm the working directory (uncertain surface only)

This is the S-06 chat safeguard: on chat, no hooks or `bin/` are available and the author has less visibility into where files land than on CLI or Cowork, where the terminal or workspace already makes the working directory unambiguous. Skip this step silently and continue to Step 5 when either applies:

- PLUGIN_ROOT above resolved via the primary settings.json lookup or the platform cache fallback (the normal installed-plugin path on CLI and Cowork), and the working directory is not otherwise in doubt.
- This is a non-interactive session (headless `-p`): there is no author present to answer, so proceed the same as the rest of this skill does in non-interactive mode.

Otherwise, confirm before writing. This covers both signals named in the S-06 requirement: PLUGIN_ROOT resolved only via the dev-mode fallback (the third lookup, `test -d templates/book-scaffold && pwd`), which means no settings.json entry or plugins cache match was found and hooks and `bin/` are typically unavailable in that same session; or the working directory is not otherwise confirmed by any completed tool call. State the absolute directory about to receive the new book tree (the path the dev-mode fallback already returned, or the result of running `pwd` via the Bash tool if that path is not yet known) and ask: "This will create the new book project in `<path>`. Shall I proceed? (yes/no)" Wait for an explicit "yes" before continuing to Step 5. Any other answer, or inability to confirm a path at all, halts here; no files are written.

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

## Step 6 - Write .studio/ state files

Create `.studio/` at the bible root alongside `context/` and `chapters/`.

Token substitutions for state files:
- Replace `{{DATETIME}}` with the current UTC date-time in RFC 3339 format (example: `2026-07-18T14:22:07Z`). This is a full timestamp, not a calendar date.
- Replace `{{BOOK_TITLE}}` with the title from Step 2.
- Replace `{{PLUGIN_VERSION}}` with the `version` field read from `PLUGIN_ROOT/.claude-plugin/plugin.json` (PLUGIN_ROOT was already resolved in Step 4). Read the file and use its current value; never write a version number from memory or from an earlier run.

**`.studio/meta.json`** - write with all placeholders filled:
```json
{
  "schema_version": "2",
  "created": "<RFC 3339 UTC timestamp>",
  "plugin_version_at_creation": "<version field read from PLUGIN_ROOT/.claude-plugin/plugin.json>",
  "book_title": "<title from Step 2>"
}
```
Note: `created` uses `{{DATETIME}}` (RFC 3339 UTC), not `{{DATE}}` (YYYY-MM-DD). Do not write a calendar date here.

**`.studio/config.json`**: read `PLUGIN_ROOT/templates/config-defaults.json`, write verbatim.

**`.studio/progress.json`**:
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

**`.studio/progress.schema.json`**: read `PLUGIN_ROOT/templates/book-scaffold/.studio/progress.schema.json`, write verbatim.

**`.studio/ai-use-log.jsonl`**: write as an empty file.

**Empty directory sentinels** (write empty files):
- `.studio/snapshots/.gitkeep`
- `.studio/gate/.gitkeep`
- `.studio/logs/.gitkeep`

On any Read or Write error: stop immediately. Name the exact path that failed and the operation attempted. Do not write any additional state files.

## Step 7 - Report success

List all files created. Output:

> Book project '{title}' has been initialized. The bible tree and .studio/ state files are ready.

Then: "The next step is intake-interview. Invoke it with `/nonfiction-studio:nfs-interview` to conduct the structured intake interview and build your project brief. The interview typically takes 45-90 minutes and produces a confirmed context/brief.md."

---

## Failure behavior

- **Plugin root unresolved.** If all three lookups in Step 4 fail, halt before writing any file. Report the settings.json path attempted and the cache path attempted. Ask the author how to proceed (verify plugin installation or provide the path manually).
- **Working directory not confirmed (Step 4b).** If the author does not answer yes, or no path can be confirmed at all, halt before Step 5. No files are written.
- **Read or write error.** On any file operation failure, stop immediately. Name the exact path and operation that failed. Never continue stamping remaining files after a failure.
- **Missing template.** If a template file is not readable after PLUGIN_ROOT is confirmed, halt. Name the exact template path and ask the author to verify the plugin installation.
