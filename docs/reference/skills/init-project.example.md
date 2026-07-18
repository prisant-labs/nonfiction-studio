---
title: "init-project worked example"
description: "Condensed transcript of an init-project run - shows placeholder fills and the re-run warning"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "init", "example"]
---

# init-project - worked example

This is a condensed transcript of a complete `init-project` run. It shows the blank-scaffold path, the placeholder fills in the state files, and a second run that triggers the re-init warning.

---

## First run (blank scaffold, title provided as argument)

**Author:** `/nonfiction-studio:init-project The Quiet Ledger`

**Studio:**

> Initializing a new book project for "The Quiet Ledger" (blank scaffold mode).
>
> No existing book/ directory found. Proceeding.
>
> Finding the plugin root... found at <repo-root>.
>
> Stamping book/ tree from templates/book-scaffold/:

```
book/context/brief.md          created
book/context/audience.md       created
book/context/style-profile.md  created
book/context/decisions.md      created
book/structure/thesis.md       created
book/structure/outline.md      created
book/structure/comps.md        created
book/chapters/.gitkeep         created
book/research/evidence-log.md  created
book/research/sources.md       created
book/research/open-questions.md created
book/production/exports/.gitkeep created
book/production/README.md      created
book/production/front-matter.md created
book/production/back-matter.md  created
```

> Writing .studio/ state files:

```
.studio/meta.json              created
.studio/config.json            created
.studio/progress.json          created
.studio/progress.schema.json   created
.studio/ai-use-log.jsonl       created (empty)
.studio/snapshots/.gitkeep     created
.studio/gate/.gitkeep          created
.studio/logs/.gitkeep          created
```

> Book project "The Quiet Ledger" has been initialized. The book/ tree and .studio/ state files are ready.
>
> The next step is intake-interview. Invoke it with `/nonfiction-studio:intake-interview` to conduct the structured intake interview and build your project brief. The interview typically takes 45-90 minutes and produces a confirmed context/brief.md.

---

## Resulting state file contents

### .studio/meta.json (all placeholders filled)

```json
{
  "schema_version": "2",
  "created": "2026-07-18T14:22:07Z",
  "plugin_version_at_creation": "0.1.0",
  "book_title": "The Quiet Ledger"
}
```

Note: no `{{` placeholders remain.

### .studio/progress.json (empty chapter list, zero counters)

```json
{
  "version": 2,
  "updated": "2026-07-18T14:22:07Z",
  "chapters": [],
  "totals": {
    "word_count": 0,
    "open_claim_count": 0,
    "chapters_final": 0,
    "chapters_total": 0
  }
}
```

---

## Second run on the same directory (re-init warning path)

**Author:** `/nonfiction-studio:init-project The Quiet Ledger`

**Studio:**

> Warning: A book/ directory already exists here. Re-running init-project will only add missing pieces; it will not overwrite existing files.
>
> Checking for missing scaffold files...
>
> All expected files are present. No missing pieces to stamp.
>
> No files were written. Your existing project is unchanged.
>
> If you intended to start a new project in a different directory, navigate there first and invoke init-project again.

---

## Key assertions from this transcript

- All `{{BOOK_TITLE}}`, `{{DATE}}`, and `{{PLUGIN_VERSION}}` placeholders are replaced; none remain in any written file.
- `progress.json` has `"version": 2`, `"chapters": []`, and all zero counters.
- The second invocation does not modify any existing file. The author's project is safe.
- `.studio/` is at the project root (same level as `book/`), not nested inside `book/`.
