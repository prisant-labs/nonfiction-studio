---
title: "init-project worked example"
description: "Condensed transcript of an init-project run - shows mode default, placeholder fills, and the re-run delta check"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "init", "example"]
---

# init-project - worked example

This is a condensed transcript of a complete `init-project` run. It shows the blank-scaffold path including the non-interactive mode default, the project-init.md copy, the placeholder fills in the state files, and a second run that triggers the re-init delta check.

---

## First run (blank scaffold, title provided as argument)

**Author:** `/nonfiction-studio:init-project The Quiet Ledger`

**Studio:**

> No mode argument supplied; defaulting to blank mode in non-interactive context.
>
> No existing book/ directory found. Proceeding.
>
> Finding the plugin root... found at <repo-root>.
>
> Stamping book/ tree from templates/book-scaffold/ and copying project-init template:

```
book/context/brief.md              created
book/context/audience.md           created
book/context/style-profile.md      created
book/context/decisions.md          created
book/context/project-init.md       created (blank template)
book/structure/thesis.md           created
book/structure/outline.md          created
book/structure/comps.md            created
book/chapters/.gitkeep             created
book/research/evidence-log.md      created
book/research/sources.md           created
book/research/open-questions.md    created
book/production/exports/.gitkeep   created
book/production/README.md          created
book/production/front-matter.md    created
book/production/back-matter.md     created
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

Note: `created` is an RFC 3339 UTC timestamp (`{{DATETIME}}`), not a calendar date. No `{{` placeholders remain.

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

## Second run on the same directory (re-init delta check)

**Author:** `/nonfiction-studio:init-project The Quiet Ledger`

**Studio:**

> Warning: A book/ directory already exists in this location. Scanning for missing scaffold files...
>
> All 24 expected scaffold files are present. No files were written.
>
> Run /nonfiction-studio:intake-interview to continue setting up your project.

---

## Key assertions from this transcript

- The mode default ("blank") is stated explicitly in non-interactive context; no silent assumption.
- `book/context/project-init.md` is created as a copy of the blank template.
- All `{{BOOK_TITLE}}`, `{{DATETIME}}`, and `{{PLUGIN_VERSION}}` placeholders are replaced in state files; `{{DATE}}` is replaced with YYYY-MM-DD in prose files. None remain in any written file.
- `progress.json` has `"version": 2`, `"chapters": []`, and all zero counters.
- The second invocation runs a Bash scan and reports the result honestly. When all files are present it states so; when files are missing it lists exactly which ones.
- `.studio/` is at the project root (same level as `book/`), not nested inside `book/`.
