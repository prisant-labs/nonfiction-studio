---
title: "nfs-new-book skill reference"
description: "Reference for the init-project skill - scaffold command for a new nonfiction book project"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "init", "scaffold", "setup"]
---

# nfs-new-book

Scaffolds the flat bible tree (context/, structure/, chapters/, research/, production/) and creates `.studio/` state files for a new nonfiction book project. This is the first skill in the studio workflow; every other skill depends on the structure it creates.

## Purpose

`init-project` creates a complete project layout from the plugin's scaffold template. After it runs, the directory contains a flat bible tree (context/, structure/, chapters/, research/, production/) and a `.studio/` directory alongside them with the three required state files: `meta.json`, `config.json`, and `progress.json`. It also copies the selected project-init intake template to `context/project-init.md` for the `intake-interview` skill to consume.

## Invocation

```
/nonfiction-studio:init-project [book title] [guided|blank]
```

Both arguments are optional. If the book title is omitted, the skill asks before writing anything. If the mode is omitted and the session is interactive, the skill asks; in a non-interactive (headless) session the skill defaults to blank and states this.

Modes:
- `guided` - copies `templates/project-init.guided.md` to `context/project-init.md`; each question includes explanations and examples
- `blank` - copies `templates/project-init.blank.md`; questions only, no annotations (default in non-interactive contexts)

Alternate entry points:
- Via the `studio` skill: choose Path 1 ("Start a new book")
- Verb alias: `/book-init` (the namespaced `/nonfiction-studio:init-project` form also works)

## Inputs

| Input | Source | Required |
|---|---|---|
| Book title | Argument or interactive prompt | Yes |
| Mode | Argument (`guided` or `blank`), interactive prompt, or non-interactive default (blank) | No |
| Scaffold template | `templates/book-scaffold/` in the plugin root | Yes (auto-located) |
| Project-init template | `templates/project-init.guided.md` or `templates/project-init.blank.md` in the plugin root | Yes (auto-located) |
| Config defaults | `templates/config-defaults.json` in the plugin root | Yes (auto-located) |

## Outputs

### Bible tree (flat layout)

The flat bible tree is at the project root. The plugin's scaffold and all engines use this layout. (Note: `bible.mjs` also detects a nested `book/` subdirectory that itself contains `.studio/`, `context/`, and `chapters/` as a compatibility path for authors who nest; the plugin's own scaffold is always flat.)

| Path | Contents |
|---|---|
| `context/brief.md` | Empty project brief; filled by `intake-interview` |
| `context/audience.md` | Audience persona fields; filled by `intake-interview` |
| `context/style-profile.md` | Voice baseline placeholder; filled by `capture-voice` |
| `context/decisions.md` | Decision log; appended by skills that record choices |
| `context/project-init.md` | Project-init intake template (guided or blank); consumed by `intake-interview` |
| `structure/thesis.md` | Controlling idea template; written by `outline-book` |
| `structure/outline.md` | Chapter outline; written by `outline-book` |
| `structure/comps.md` | Competitive titles tracker |
| `chapters/` | Empty chapter directory (`.gitkeep` only at init) |
| `research/evidence-log.md` | Claim ledger with example entry |
| `research/sources.md` | Source registry with example entry |
| `research/open-questions.md` | Open research questions log |
| `production/README.md` | Production workflow guide |
| `production/front-matter.md` | Front matter template |
| `production/back-matter.md` | Back matter template |
| `production/exports/` | Export output directory (`.gitkeep` at init) |

### .studio/ state files (machine state, alongside the bible tree)

| File | Contents |
|---|---|
| `.studio/meta.json` | Schema version, creation timestamp, book title |
| `.studio/config.json` | Gate thresholds and model routing defaults |
| `.studio/progress.json` | Chapter list (empty) and zero counters |
| `.studio/progress.schema.json` | JSON Schema for progress.json validation |
| `.studio/ai-use-log.jsonl` | AI-use log (empty at init; appended during drafting) |
| `.studio/snapshots/` | Snapshot directory (empty at init) |
| `.studio/gate/` | Gate reports directory (empty at init) |
| `.studio/logs/` | Diagnostic logs directory (empty at init) |

## Placeholder fills

Two token formats are used. The format depends on the file type.

| Placeholder | Format | Used in |
|---|---|---|
| `{{DATE}}` | YYYY-MM-DD (calendar date) | Prose files (example: `evidence-log.md`) |
| `{{DATETIME}}` | RFC 3339 UTC (example: `2026-07-18T14:22:07Z`) | State files: `meta.json` (`created`), `progress.json` (`updated`) |
| `{{BOOK_TITLE}}` | Title string | `meta.json` (`book_title`) |
| `{{PLUGIN_VERSION}}` | Semver string (`0.1.0`) | `meta.json` (`plugin_version_at_creation`) |

No `{{` placeholder tokens remain in any written file after init completes.

## Guardrails

**Never overwrites.** If a book project layout already exists (.studio/ or context/brief.md found), the skill runs a Bash scan of all 24 expected scaffold paths and reports the exact set of missing files. It then offers (or in headless mode, automatically proceeds) to re-stamp only those missing files. No existing file is ever read or replaced in a re-init run.

**Surface-independent.** The skill reads template files and writes to the working directory using standard file tools. No hooks or subagents are needed; it works identically on CLI, Cowork, and Chat.

**Confirm before writing on Chat.** On the Chat surface, the skill confirms the intended working directory with the author before creating any files.

**Re-init is safe.** Running `init-project` a second time on an existing project will not corrupt it. The skill checks each file individually and stamps only the missing ones.

## Failure behavior

**Plugin root unresolved.** If all resolution attempts fail (settings.json lookup, platform cache search, dev-mode fallback), the skill halts before writing any file. It reports both locations it tried and asks the author how to proceed.

**Read or write error.** On any file operation failure the skill stops immediately, names the exact path and operation that failed, and does not continue writing remaining files.

**Missing template.** If a template file is not readable after the plugin root is confirmed, the skill halts and names the exact template path, then asks the author to verify the plugin installation.

## Natural next step

After init-project completes, invoke `intake-interview` (`/nonfiction-studio:intake-interview`) to conduct the structured intake interview and build `context/brief.md`. The interview takes 45-90 minutes and produces a confirmed project brief.

## Worked example

See [nfs-new-book.example.md](./nfs-new-book.example.md) for a condensed transcript of a full init run including the mode default, the placeholder fills, the project-init.md copy, and the re-run delta check.
