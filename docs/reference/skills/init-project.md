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

`init-project` creates a complete project layout from the plugin's scaffold template. After it runs, the directory contains a full `book/` bible tree (context, structure, chapters, research, production) and a `.studio/` directory with the three required state files: `meta.json`, `config.json`, and `progress.json`.

## Invocation

```
/nonfiction-studio:init-project [book title]
```

The book title is optional. If omitted, the skill asks before writing anything.

Alternate entry points:
- Via the `studio` skill: choose Path 1 ("Start a new book")
- Legacy verb: `/book-init` (deprecated; use the namespaced form)

## Inputs

| Input | Source | Required |
|---|---|---|
| Book title | Argument or interactive prompt | Yes |
| Scaffold template | `templates/book-scaffold/` in the plugin root | Yes (auto-located) |
| Config defaults | `templates/config-defaults.json` in the plugin root | Yes (auto-located) |

## Outputs

### book/ tree (bible)

| Path | Contents |
|---|---|
| `book/context/brief.md` | Empty project brief; filled by `intake-interview` |
| `book/context/audience.md` | Audience persona fields; filled by `intake-interview` |
| `book/context/style-profile.md` | Voice baseline placeholder; filled by `capture-voice` |
| `book/context/decisions.md` | Decision log; appended by skills that record choices |
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

`meta.json` has three placeholders filled at init time:

| Placeholder | Filled with |
|---|---|
| `{{BOOK_TITLE}}` | The title from the argument or interactive prompt |
| `{{DATE}}` | Current UTC date-time in ISO 8601 format |
| `{{PLUGIN_VERSION}}` | The plugin version (`0.1.0` in this release) |

`progress.json` also has a `{{DATE}}` placeholder replaced with the same timestamp.

## Guardrails

**Never overwrites.** If `book/` already exists, the skill warns the author and offers to stamp only the files that are missing. No existing file is ever replaced.

**Surface-independent.** The skill reads template files and writes to the working directory using standard file tools. No hooks or subagents are needed; it works identically on CLI, Cowork, and Chat.

**Confirm before writing on Chat.** On the Chat surface, the skill confirms the intended working directory with the author before creating any files.

**Re-init is safe.** Running `init-project` a second time on an existing project will not corrupt it. The skill checks each file individually and skips any that already exist.

## Failure behavior

If the template files cannot be found: the skill halts and reports which template it could not locate, then asks the author to verify the plugin installation.

If a file write fails mid-scaffold: the skill logs the failure, lists which files were not created, and reports that the author can re-run safely.

## Natural next step

After init-project completes, invoke `intake-interview` (`/nonfiction-studio:intake-interview`) to conduct the structured intake interview and build `context/brief.md`. The interview takes 45-90 minutes and produces a confirmed project brief.

## Worked example

See [init-project.example.md](./init-project.example.md) for a condensed transcript of a full init run including the placeholder fills, the guided-vs-blank choice, and the re-run warning.
