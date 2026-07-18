---
title: "init-project skill reference"
description: "Reference for the init-project skill - scaffold command for a new nonfiction book project"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "init", "scaffold", "setup"]
---

# init-project

Scaffolds the `book/` bible tree and creates `.studio/` state files for a new nonfiction book project. This is the first skill in the studio workflow; every other skill depends on the structure it creates.

## Purpose

`init-project` creates a complete project layout from the plugin's scaffold template. After it runs, the directory contains a full `book/` bible tree (context, structure, chapters, research, production) and a `.studio/` directory with the three required state files: `meta.json`, `config.json`, and `progress.json`. It also copies the selected project-init intake template to `book/context/project-init.md` for the `intake-interview` skill to consume.

## Invocation

```
/nonfiction-studio:init-project [book title] [guided|blank]
```

Both arguments are optional. If the book title is omitted, the skill asks before writing anything. If the mode is omitted and the session is interactive, the skill asks; in a non-interactive (headless) session the skill defaults to blank and states this.

Modes:
- `guided` - copies `templates/project-init.guided.md` to `book/context/project-init.md`; each question includes explanations and examples
- `blank` - copies `templates/project-init.blank.md`; questions only, no annotations (default in non-interactive contexts)

Alternate entry points:
- Via the `studio` skill: choose Path 1 ("Start a new book")
- Legacy verb: `/book-init` (deprecated; use the namespaced form)

## Inputs

| Input | Source | Required |
|---|---|---|
| Book title | Argument or interactive prompt | Yes |
| Mode | Argument (`guided` or `blank`), interactive prompt, or non-interactive default (blank) | No |
| Scaffold template | `templates/book-scaffold/` in the plugin root | Yes (auto-located) |
| Project-init template | `templates/project-init.guided.md` or `templates/project-init.blank.md` in the plugin root | Yes (auto-located) |
| Config defaults | `templates/config-defaults.json` in the plugin root | Yes (auto-located) |

## Outputs

### book/ tree (bible)

| Path | Contents |
|---|---|
| `book/context/brief.md` | Empty project brief; filled by `intake-interview` |
| `book/context/audience.md` | Audience persona fields; filled by `intake-interview` |
| `book/context/style-profile.md` | Voice baseline placeholder; filled by `capture-voice` |
| `book/context/decisions.md` | Decision log; appended by skills that record choices |
| `book/context/project-init.md` | Project-init intake template (guided or blank); consumed by `intake-interview` |
| `book/structure/thesis.md` | Controlling idea template; written by `outline-book` |
| `book/structure/outline.md` | Chapter outline; written by `outline-book` |
| `book/structure/comps.md` | Competitive titles tracker |
| `book/chapters/` | Empty chapter directory (`.gitkeep` only at init) |
| `book/research/evidence-log.md` | Claim ledger with example entry |
| `book/research/sources.md` | Source registry with example entry |
| `book/research/open-questions.md` | Open research questions log |
| `book/production/README.md` | Production workflow guide |
| `book/production/front-matter.md` | Front matter template |
| `book/production/back-matter.md` | Back matter template |
| `book/production/exports/` | Export output directory (`.gitkeep` at init) |

### .studio/ state files (machine state, not inside book/)

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

**Never overwrites.** If `book/` already exists, the skill runs a Bash scan of all 24 expected scaffold paths and reports the exact set of missing files. It then offers (or in headless mode, automatically proceeds) to re-stamp only those missing files. No existing file is ever read or replaced in a re-init run.

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

See [init-project.example.md](./init-project.example.md) for a condensed transcript of a full init run including the mode default, the placeholder fills, the project-init.md copy, and the re-run delta check.
