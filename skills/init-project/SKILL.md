---
name: init-project
user-invocable: true
argument-hint: "[book title]"
description: "Scaffolds the book/ bible tree and creates .studio/ state files for a new nonfiction book project. Use when an author starts a new book or follows the studio Path 1 prompt."
when_to_use: "Use when the author explicitly wants to initialize, start, or set up a new book project, says 'create a new book', types the legacy /book-init verb, or is routed here from the studio dispatcher Path 1 prompt. Do not invoke for authors with an existing book/ directory unless they explicitly ask to re-initialize only the missing pieces."
---

This skill scaffolds a new nonfiction book project. It is surface-independent: no hooks or subagents are needed.

## Step 1 - Run the existence check (mandatory first tool call)

Use the Bash tool to run:
```
test -d book && echo REINIT || echo NEWINIT
```

The output will be exactly one of two values:
- `REINIT` - a book/ directory already exists
- `NEWINIT` - no book/ directory exists yet

## If the output is REINIT

Output this message verbatim and then STOP. Do not write any files or continue to any other steps:

> Warning: A book/ directory already exists in this location. Re-running init-project will not overwrite any existing files. All scaffold files are already present. No files were written. Run /nonfiction-studio:intake-interview to continue setting up your project.

## If the output is NEWINIT

Continue with Steps 2-6 below.

---

## Step 2 - Resolve the book title

Use the title provided in the author's message. If no title is present, ask: "What is the title of this book?"

## Step 3 - Find the plugin root

Use the Bash tool to run:
```
node -e "const s=require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8');const m=JSON.parse(s).extraKnownMarketplaces;const ns=m&&m['nonfiction-studio'];console.log(ns&&ns.source&&ns.source.path||'not-found')"
```

The output is PLUGIN_ROOT. If it prints `not-found`, use the Bash fallback:
```
find "$HOME" -maxdepth 6 -name 'book-scaffold' -type d 2>/dev/null | head -1 | sed 's|/templates/book-scaffold||'
```

Verify: confirm `PLUGIN_ROOT/templates/book-scaffold/context/brief.md` is readable.

## Step 4 - Stamp the book/ tree

For each mapping below: use the Read tool on the source, then the Write tool for the destination (relative to the current working directory). Replace `{{DATE}}` with today's date in YYYY-MM-DD format.

**context/**
- `PLUGIN_ROOT/templates/book-scaffold/context/brief.md` -> `book/context/brief.md`
- `PLUGIN_ROOT/templates/book-scaffold/context/audience.md` -> `book/context/audience.md`
- `PLUGIN_ROOT/templates/book-scaffold/context/style-profile.md` -> `book/context/style-profile.md`
- `PLUGIN_ROOT/templates/book-scaffold/context/decisions.md` -> `book/context/decisions.md`

**structure/**
- `PLUGIN_ROOT/templates/book-scaffold/structure/thesis.md` -> `book/structure/thesis.md`
- `PLUGIN_ROOT/templates/book-scaffold/structure/outline.md` -> `book/structure/outline.md`
- `PLUGIN_ROOT/templates/book-scaffold/structure/comps.md` -> `book/structure/comps.md`

**chapters/**
- Write an empty file to `book/chapters/.gitkeep`

**research/**
- `PLUGIN_ROOT/templates/book-scaffold/research/evidence-log.md` -> `book/research/evidence-log.md` (replace `{{DATE}}`)
- `PLUGIN_ROOT/templates/book-scaffold/research/sources.md` -> `book/research/sources.md`
- `PLUGIN_ROOT/templates/book-scaffold/research/open-questions.md` -> `book/research/open-questions.md`

**production/**
- Write an empty file to `book/production/exports/.gitkeep`
- `PLUGIN_ROOT/templates/book-scaffold/production/README.md` -> `book/production/README.md`
- `PLUGIN_ROOT/templates/book-scaffold/production/front-matter.md` -> `book/production/front-matter.md`
- `PLUGIN_ROOT/templates/book-scaffold/production/back-matter.md` -> `book/production/back-matter.md`

## Step 5 - Write .studio/ state files

Create `.studio/` at the project root (same level as `book/`, not inside it).

**`.studio/meta.json`** - write with all placeholders filled:
```json
{
  "schema_version": "2",
  "created": "<current UTC date-time in ISO 8601>",
  "plugin_version_at_creation": "0.1.0",
  "book_title": "<title from Step 2>"
}
```

**`.studio/config.json`**: read `PLUGIN_ROOT/templates/config-defaults.json`, write verbatim.

**`.studio/progress.json`**:
```json
{
  "version": 2,
  "updated": "<current UTC date-time in ISO 8601>",
  "chapters": [],
  "totals": {
    "word_count": 0,
    "open_claim_count": 0,
    "chapters_final": 0,
    "chapters_total": 0
  }
}
```

**`.studio/progress.schema.json`**: read `PLUGIN_ROOT/templates/book-scaffold/.studio/progress.schema.json`, write verbatim.

**`.studio/ai-use-log.jsonl`**: write as an empty file.

**Empty directory sentinels** (write empty files):
- `.studio/snapshots/.gitkeep`
- `.studio/gate/.gitkeep`
- `.studio/logs/.gitkeep`

## Step 6 - Report success

List the files created. Output:

> Book project '{title}' has been initialized. The book/ tree and .studio/ state files are ready.

Then: "The next step is intake-interview. Invoke it with `/nonfiction-studio:intake-interview` to conduct the structured intake interview and build your project brief. The interview typically takes 45-90 minutes and produces a confirmed context/brief.md."
