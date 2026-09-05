---
title: "nfs-new-book worked example"
description: "Condensed transcript of a nfs-new-book run - shows mode default, placeholder fills, and the re-run delta check"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "init", "example"]
---

# nfs-new-book - worked example

This is a condensed transcript of a complete `nfs-new-book` run. It shows the blank-scaffold path including the non-interactive mode default, the project-init.md copy, the placeholder fills in the state files, and a second run that triggers the re-init delta check.

---

## First run (blank scaffold, title provided as argument)

**Author:** `/nonfiction-studio:nfs-new-book The Quiet Ledger`

**Studio:**

> No mode argument supplied; defaulting to blank mode in non-interactive context.
>
> No existing book project found. Proceeding.
>
> Finding the plugin root... found at <repo-root>.
>
> Stamping flat bible tree from templates/book-scaffold/ and copying project-init template:

```
context/brief.md              created
context/audience.md           created
context/style-profile.md      created
context/decisions.md          created
context/project-init.md       created (blank template)
structure/thesis.md           created
structure/outline.md          created
structure/comps.md            created
chapters/.gitkeep             created
research/evidence-log.md      created
research/sources.md           created
research/open-questions.md    created
production/exports/.gitkeep   created
production/README.md          created
production/front-matter.md    created
production/back-matter.md     created
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

> Skipping the output style offer in this non-interactive session; no output style was set. Run `/nonfiction-studio:nfs-new-book` again from an interactive session to see the offer, or set a style directly with `/config`.
>
> Skipping the book-context skill generation in this non-interactive session; no skill was generated. Run `/nonfiction-studio:nfs-new-book` again from an interactive session to be asked.
>
> Book project "The Quiet Ledger" has been initialized. The bible tree and .studio/ state files are ready.
>
> The next step is nfs-interview. Invoke it with `/nonfiction-studio:nfs-interview` to conduct the structured intake interview and build your project brief. The interview typically takes 45-90 minutes and produces a confirmed context/brief.md.

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

**Author:** `/nonfiction-studio:nfs-new-book The Quiet Ledger`

**Studio:**

> Warning: This directory already contains a book project. Scanning for missing scaffold files...
>
> All 24 expected scaffold files are present. No files were written.
>
> Run /nonfiction-studio:nfs-interview to continue setting up your project.
>
> Skipping the output style offer in this non-interactive session; no output style was set. Run `/nonfiction-studio:nfs-new-book` again from an interactive session to see the offer, or set a style directly with `/config`.
>
> Skipping the book-context skill generation in this non-interactive session; no skill was generated. Run `/nonfiction-studio:nfs-new-book` again from an interactive session to be asked.

---

## Key assertions from this transcript

- The mode default ("blank") is stated explicitly in non-interactive context; no silent assumption.
- `context/project-init.md` is created as a copy of the blank template.
- All `{{BOOK_TITLE}}`, `{{DATETIME}}`, and `{{PLUGIN_VERSION}}` placeholders are replaced in state files; `{{DATE}}` is replaced with YYYY-MM-DD in prose files. None remain in any written file.
- `progress.json` has `"version": 2`, `"chapters": []`, and all zero counters.
- The second invocation runs a Bash scan and reports the result honestly. When all files are present it states so; when files are missing it lists exactly which ones.
- `.studio/` is at the bible root alongside `context/` and `chapters/`, not in a nested subdirectory.
- Both once-per-project offers (the output style offer and the book-context skill generation step) state plainly that they are skipped in a non-interactive session rather than guessing at consent; neither writes any file in that case, on either the first run or the re-init run.
