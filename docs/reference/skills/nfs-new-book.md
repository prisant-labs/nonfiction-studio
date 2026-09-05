---
title: "nfs-new-book skill reference"
description: "Reference for the nfs-new-book skill - scaffold command for a new nonfiction book project"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "init", "scaffold", "setup"]
---

# nfs-new-book

Scaffolds the flat bible tree (context/, structure/, chapters/, research/, production/) and creates `.studio/` state files for a new nonfiction book project. This is the first skill in the studio workflow; every other skill depends on the structure it creates.

## Purpose

`nfs-new-book` creates a complete project layout from the plugin's scaffold template. After it runs, the directory contains a flat bible tree (context/, structure/, chapters/, research/, production/) and a `.studio/` directory alongside them with the three required state files: `meta.json`, `config.json`, and `progress.json`. It also copies the selected project-init intake template to `context/project-init.md` for the `nfs-interview` skill to consume.

## Invocation

```
/nonfiction-studio:nfs-new-book [book title] [guided|blank]
```

Both arguments are optional. If the book title is omitted, the skill asks before writing anything. If the mode is omitted and the session is interactive, the skill asks; in a non-interactive (headless) session the skill defaults to blank and states this.

Modes:
- `guided` - copies `templates/project-init.guided.md` to `context/project-init.md`; each question includes explanations and examples
- `blank` - copies `templates/project-init.blank.md`; questions only, no annotations (default in non-interactive contexts)

Alternate entry points:
- Via the `nfs-start` skill: choose Path 1 ("Start a new book")

## Inputs

| Input | Source | Required |
|---|---|---|
| Book title | Argument or interactive prompt | Yes |
| Mode | Argument (`guided` or `blank`), interactive prompt, or non-interactive default (blank) | No |
| Scaffold template | `templates/book-scaffold/` in the plugin root | Yes (auto-located) |
| Project-init template | `templates/project-init.guided.md` or `templates/project-init.blank.md` in the plugin root | Yes (auto-located) |
| Config defaults | `templates/config-defaults.json` in the plugin root | Yes (auto-located) |
| Output style answer (`manuscript`, `review`, or decline) | Interactive prompt, once per project | No (skipped in non-interactive contexts and on chat's activation path; see "Output style offer" below) |
| Studio settings file (existing `output_style` value, if any) | `.claude/nonfiction-studio.local.md`, checked before the offer | No |
| Studio settings example template | `templates/nonfiction-studio.local.example.md` in the plugin root, used to stamp the settings file when absent | Yes, only if the offer needs to create the settings file |
| Book-context generation consent (yes/no) | Interactive prompt, once per project | No (skipped in non-interactive contexts) |
| Book-context skill file (existence check) | `.claude/skills/book-context/SKILL.md`, checked before the offer | No |
| Bible content for book-context assembly | `context/brief.md` (thesis), `context/style-profile.md` (style rules), `structure/outline.md` (chapter map) | No (graceful "not yet recorded" notes when empty) |
| Open-claims count | `bin/ns-claims --all --json` in the plugin root | No (graceful "not yet countable" note if it cannot run) |

## Outputs

### Bible tree (flat layout)

The flat bible tree is at the project root. The plugin's scaffold and all engines use this layout. (Note: `bible.mjs` also detects a nested `book/` subdirectory that itself contains `.studio/`, `context/`, and `chapters/` as a compatibility path for authors who nest; the plugin's own scaffold is always flat.)

| Path | Contents |
|---|---|
| `context/brief.md` | Empty project brief; filled by `nfs-interview` |
| `context/audience.md` | Audience persona fields; filled by `nfs-interview` |
| `context/style-profile.md` | Voice baseline placeholder; filled by `nfs-capture-voice` |
| `context/decisions.md` | Decision log; appended by skills that record choices |
| `context/project-init.md` | Project-init intake template (guided or blank); consumed by `nfs-interview` |
| `structure/thesis.md` | Controlling idea template; written by `nfs-outline` |
| `structure/outline.md` | Chapter outline; written by `nfs-outline` |
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

### Output style records (offer outcome only, not always written)

| File | Written when | Contents |
|---|---|---|
| `.claude/settings.local.json` | The offer's answer is `manuscript` or `review` | Merge-written `outputStyle` key (namespaced, e.g. `nonfiction-studio:Manuscript`); every other existing key is preserved |
| `.claude/nonfiction-studio.local.md` | Any answer that is actually recorded (consent or decline) | `output_style` key set to `manuscript`, `review`, or `declined`; created from `templates/nonfiction-studio.local.example.md` if it did not already exist |

### Book-context skill (generated only on consent, once per project)

| File | Written when | Contents |
|---|---|---|
| `.claude/skills/book-context/SKILL.md` | The author consents in an interactive session and the file does not already exist | A project-committed, user-invocable skill assembling the thesis one-liner (`context/brief.md`), the top style rules (`context/style-profile.md`), the chapter map (`structure/outline.md`), and the open-claims count (`bin/ns-claims`), each naming its source path |

This file is committed into the author's project tree, not the plugin installation. See "Book-context skill generation" below.

## Placeholder fills

Two token formats are used. The format depends on the file type.

| Placeholder | Format | Used in |
|---|---|---|
| `{{DATE}}` | YYYY-MM-DD (calendar date) | Prose files (example: `evidence-log.md`) |
| `{{DATETIME}}` | RFC 3339 UTC (example: `2026-07-18T14:22:07Z`) | State files: `meta.json` (`created`), `progress.json` (`updated`) |
| `{{BOOK_TITLE}}` | Title string | `meta.json` (`book_title`) |
| `{{PLUGIN_VERSION}}` | Semver string (`0.1.0`) | `meta.json` (`plugin_version_at_creation`) |

No `{{` placeholder tokens remain in any written file after init completes.

## Output style offer

After the bible tree and `.studio/` state files are stamped, `nfs-new-book` offers the two output styles Nonfiction Studio ships - `manuscript` and `review` - once per project. This runs on every invocation shape: a fresh NEWINIT, a REINIT that re-stamps missing scaffold files, and even a REINIT against a project that is already fully scaffolded - the last of these is the reachable path for a legitimate re-offer on a project whose earlier offer outcome was never actually recorded. See [Output styles](../output-styles.md) for what each style changes.

**Fires once.** Before offering, the skill checks the project's studio settings file, `.claude/nonfiction-studio.local.md`, for an existing `output_style` value (`manuscript`, `review`, or `declined`). If one is already recorded, the offer is skipped silently for that project - it does not re-ask on a later run.

**On consent.** The skill states exactly what will be written - the namespaced `outputStyle` value (`nonfiction-studio:Manuscript` or `nonfiction-studio:Review`) into `.claude/settings.local.json`, created or merged while preserving every other key already there - before asking, the same consent shape as the `nfs-doctor` skill's `install-statusline` mode. On an explicit choice, it performs that merge-write, then records the outcome in the studio settings file.

**On decline.** The skill records `output_style: declined` in `.claude/nonfiction-studio.local.md`, stamping that file from `templates/nonfiction-studio.local.example.md` with only the `output_style` key set if the file does not already exist. This file creation is disclosed in the same offer message, before it happens - never a separate, later prompt.

**Refusing any file write leaves the offer open.** Whether the refusal is a declined conversational answer or a denied Write/Edit tool permission prompt on the underlying file operation, no outcome is recorded when a write does not go through. A later `nfs-new-book` run against the same project - including a REINIT run that re-stamps missing scaffold files - finds no recorded value and legitimately re-offers the styles.

**Non-interactive sessions skip the offer entirely** and state that they are doing so, rather than guessing at consent for a settings write.

**Chat has no settings-write path for `outputStyle`.** On the chat surface, the skill states the `/config` command as the way to activate a style yourself, then records `output_style: declined` (disclosed in that same message) since no style was actually activated through this flow.

## Book-context skill generation

Immediately after the output style offer, `nfs-new-book` offers to generate a project-committed `book-context` skill: a quick-reference assembled from the project bible - the thesis one-liner (`context/brief.md`), up to three top style rules (`context/style-profile.md`), the chapter map (`structure/outline.md`), and the open-claims count (`bin/ns-claims`), each naming the source it was read from. It runs on the same invocation shapes as the output style offer (a fresh NEWINIT and both REINIT sub-branches), never activates without an explicit yes, and never repeats once the file exists.

**Fires once.** Before offering, the skill checks whether `.claude/skills/book-context/SKILL.md` already exists. If it does, the offer is skipped silently for that project - it does not re-ask on a later run. **On REINIT, the offer repeats only if the file is absent.**

**Consent is never assumed.** The offer states plainly what a yes commits - project-tree content, at a named path - before asking, and states that the generated skill becomes usable starting the author's next Claude Code session, not the current one: a skill file written during a session is not available to the Skill tool until that session restarts or resumes, a confirmed Claude Code platform behavior. Resuming the current session (rather than starting a fresh one) re-runs the same startup sequence and is a working way to make it live sooner. Declining generates nothing.

**Non-interactive sessions skip the offer entirely** and state that they are doing so; defaulting to yes is never done, since committing content into the project tree needs actual consent.

**Refusing any file write leaves the offer open.** Whether the refusal is a declined conversational answer or a denied Write-tool permission prompt, no skill file is written. A later `nfs-new-book` run against the same project finds the file still absent and legitimately re-offers.

**Content degrades gracefully, never blocks.** On a fresh project the bible is mostly empty (the thesis and style profile are unfilled placeholders immediately after scaffolding, and the outline has no chapters yet). Each of the four assembled items notes plainly when its source has nothing to report yet (for example, "Not yet recorded - run `nfs-interview`") rather than failing the whole step.

## Guardrails

**Never overwrites.** If a book project layout already exists (.studio/ or context/brief.md found), the skill runs a Bash scan of all 24 expected scaffold paths and reports the exact set of missing files. It then offers (or in headless mode, automatically proceeds) to re-stamp only those missing files. No existing file is ever read or replaced in a re-init run.

**Surface-independent.** The skill reads template files and writes to the working directory using standard file tools. No hooks or subagents are needed; it works identically on CLI, Cowork, and Chat.

**Confirm before writing on Chat.** On the Chat surface, the skill confirms the intended working directory with the author before creating any files.

**Re-init is safe.** Running `nfs-new-book` a second time on an existing project will not corrupt it. The skill checks each file individually and stamps only the missing ones.

## Failure behavior

**Plugin root unresolved.** If all resolution attempts fail (settings.json lookup, platform cache search, dev-mode fallback), the skill halts before writing any file. It reports both locations it tried and asks the author how to proceed.

**Read or write error.** On any file operation failure the skill stops immediately, names the exact path and operation that failed, and does not continue writing remaining files.

**Missing template.** If a template file is not readable after the plugin root is confirmed, the skill halts and names the exact template path, then asks the author to verify the plugin installation.

**Output style offer: `.claude/settings.local.json` is not valid JSON.** The skill halts the offer step only, writing nothing; the outcome is not recorded, so the offer remains open for a later run. Scaffolding itself has already completed by this point and is not affected.

**Output style offer: a file write is refused.** No `output_style` outcome is recorded, whether the refusal is a declined conversational answer or a denied Write/Edit tool permission prompt. A later run - including a REINIT run - finds no recorded value and legitimately re-offers the styles.

**Book-context generation: a read or write error.** The skill stops immediately, names the exact path and operation that failed, and does not write a partial skill file.

**Book-context generation: a file write is refused.** No skill file is written, whether the refusal is a declined conversational answer or a denied Write-tool permission prompt. A later run against the same project finds the file still absent and legitimately re-offers.

## Natural next step

After nfs-new-book completes, invoke `nfs-interview` (`/nonfiction-studio:nfs-interview`) to conduct the structured intake interview and build `context/brief.md`. The interview takes 45-90 minutes and produces a confirmed project brief.

## Worked example

See [nfs-new-book.example.md](./nfs-new-book.example.md) for a condensed transcript of a full init run including the mode default, the placeholder fills, the project-init.md copy, and the re-run delta check.
