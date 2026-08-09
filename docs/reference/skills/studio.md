---
title: "studio skill reference"
description: "Reference for the studio skill - the guided front door dispatcher that presents five numbered paths and routes to the matching Phase 1 skill without requiring the author to know skill names"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "studio", "dispatcher", "front-door", "routing", "getting-started"]
---

# studio

The `studio` skill is the guided front door and dispatcher for the Nonfiction Studio plugin per D-17 (guided front door). It reads project state, presents five numbered paths, confirms the author's choice, and routes to the matching Phase 1 skill. It is a Phase 1 skill specified in S-06 3.10 (skills and invocation surface).

## Purpose

`studio` removes the need for authors to know skill names. At the start of any session, the author can type `/nonfiction-studio:studio` and receive a numbered menu that routes to the right skill for their current project state. On chat and Cowork, `studio` is the recommended entry point because it loads context before routing per D-17 (guided front door). On CLI, experienced authors skip it and invoke skills directly by name.

**The dispatcher routes to skills only.** Per the TSK-044 (chain contract, Phase 1) reconciliation, `studio` has no chain edges in `agents/_chain-permitted.yaml`. The five paths route to Phase 1 skills; those skills invoke agents as their own contracts specify. Path 5's general-questions half answers directly from inline-loaded bible context without invoking any skill.

**The skill writes nothing.** No file writes, no `.studio/` mutations. All output is produced by the target skill.

**No agents invoked directly.** This skill has no chain edges.

## Invocation

```
/nonfiction-studio:studio
```

No argument is accepted or needed.

Alternate entry points:
- SessionStart empty-state message (CLI/Cowork): directs the author here when no project is found
- Author starts a chat session without a clear intent
- Author asks "what do I do next" or "where do I start"

## The Five Paths

| Path | When to use | Target skill(s) |
|---|---|---|
| 1 - Start a new book | No active project, or starting fresh | `init-project`, then `intake-interview` |
| 2 - Continue writing | Active project, chapter to start or continue | `outline-book` (no registry) or `draft-chapter` |
| 3 - Research and verify | Gathering sources or checking claims | `research-pass` or `fact-check-pass` |
| 4 - Review quality and status | Project overview or gate run needed | `status-dashboard`, then `run-quality-gate` |
| 5 - Troubleshoot or get help | Structural problem or general question | `doctor` or inline answer from bible context |

## Inputs and Outputs

### Inputs

| Path | File read | Why |
|---|---|---|
| Step 1 (all paths) | `.studio/progress.json` | Project-exists probe (Bash) and chapter state inspection |
| Step 2 (all paths) | `.studio/meta.json` | Book title for greeting |
| Path 2 | `structure/chapter-list.md` | Chapter registry; read after the registry probe confirms it exists |
| Path 5 general | `context/brief.md`, `context/style-profile.md`, `structure/thesis.md`, `structure/outline.md` | Inline context for direct answers; loaded as applicable |

### Outputs

The skill writes no files and performs no state mutations. All outputs are produced by the target skill.

## Flow Summary

The skill runs five steps.

1. **Progress file probe (mandatory first tool call).** Uses a Bash probe (`test -f .studio/progress.json`) to detect whether a project exists (`HAS_PROGRESS`/`NO_PROGRESS`). On `NO_PROGRESS`, presents Path 1 as the only option and proceeds to the confirm-before-handoff. This is the deterministic-guard convention per S-06 1.1 (skill anatomy and discovery).

2. **Parse progress.json and read book title.** On `HAS_PROGRESS`, reads `.studio/progress.json`. If the file is present but malformed or unreadable, routes directly to Path 5 naming `doctor`. On a valid parse, reads `.studio/meta.json` for `book_title`; falls back to "your book" if absent.

3. **Greet and present five paths.** Greets the author by book title and presents all five paths as numbered choices with one-line descriptions. Waits for the author's choice.

4. **Route based on choice.** Implements each path:
   - Path 1: confirms, then proceeds with `init-project`; chains to `intake-interview` on completion.
   - Path 2: runs the chapter-list registry probe; routes to `outline-book` on `NO_REGISTRY`; on `HAS_REGISTRY` inspects the progress layer and chapter-list registry for the next chapter to work on, then routes to `draft-chapter`.
   - Path 3: asks whether to gather research or verify claims; routes to `research-pass` or `fact-check-pass`.
   - Path 4: proceeds with `status-dashboard`; offers `run-quality-gate` for chapters flagged by the dashboard.
   - Path 5: asks whether it is a structural problem (routes to `doctor`) or a general question (answers inline from bible context).

5. **Confirm before handoff.** Before transitioning to any target skill, confirms the author is ready. On cancellation, returns to the path menu.

## Path 2: Chapter State Inspection

Path 2 uses two deterministic probes and reads two sources.

**Registry probe:**
```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```
`NO_REGISTRY` routes to `outline-book`. `HAS_REGISTRY` proceeds to the chapter state inspection.

**Chapter state inspection (using the committed status enum):**

The inspection reads `.studio/progress.json` (the alive progress layer) and `structure/chapter-list.md` (the full chapter registry). The committed status enum values are `empty`, `outlined`, `drafting`, `drafted`, `revised`, `gated`, `final` per S-08 section 3.

Priority order:
1. First chapter in `progress.json` with status `drafting` (in-progress work) - offered with `draft-chapter <slug>`.
2. If none, first chapter in `structure/chapter-list.md` with status `empty` or `outlined` (not yet started) - offered with `draft-chapter <slug>`.
3. If all chapters are at `drafted` or beyond, the book is fully drafted. `run-quality-gate` is offered for ungated chapters. `revise-pass` is a Phase 2 skill and is not available in v1.

## Path 5: Structural Problems vs. General Questions

Path 5 handles two distinct situations:

**Structural or schema problems** (corrupted progress, orphaned claim IDs, broken cross-references): the `doctor` skill runs `bin/ns-doctor` to diagnose and repair. `doctor` is a Phase 1 skill that arrives with TSK-054 (doctor skill). In v1 it is referenced by name and invoked as `/nonfiction-studio:doctor`.

**General questions about the studio, project, or workflow**: answered directly from bible files loaded inline via the Read tool. No skill or agent is invoked. The Read tool loads `context/brief.md`, `context/style-profile.md`, `structure/thesis.md`, and `structure/outline.md` as applicable before answering.

## Confirm-Before-Handoff

Before transitioning to any target skill, `studio` confirms with the author:

> Ready to proceed with `[skill name]`[and argument if any]. Confirm?

This applies to chat and Cowork sessions. CLI authors who invoke skills directly by name bypass the dispatcher and never see this prompt.

## Status Vocabulary

Path 2 chapter inspection uses the committed status enum from S-08 section 3 verbatim:

| Value | Lifecycle position |
|---|---|
| `empty` | Chapter slot created; no content yet |
| `outlined` | Chapter outline committed |
| `drafting` | Draft pass in progress |
| `drafted` | Draft complete; not yet gated |
| `revised` | Revision pass complete (Phase 2) |
| `gated` | Gate run passed |
| `final` | Author sign-off complete |

`revise-pass` is listed as a Phase 2 path in the S-06 3.10 flowchart but is not offered as a live route in v1.

## Surface Behavior

`studio` is the primary entry point for chat and Cowork because it loads context before routing per D-17 (guided front door). On CLI, experienced authors skip it and invoke skills directly by name. The SessionStart orientation message on CLI and Cowork points new authors to `studio` when no project is found.

## Failure Behavior

**Missing `progress.json` (no project).** Step 1 detects `NO_PROGRESS` and presents Path 1 as the only option. No other paths are offered.

**Malformed or unreadable `progress.json`.** Step 2 detects the parse failure and routes directly to Path 5, naming `doctor`. Never proceeds silently with stale or missing context.

**Missing `meta.json` or absent `book_title`.** Uses "your book" as the fallback greeting label; not a halt condition.

**No chapter-list registry (Path 2).** Routes to `outline-book` with an explanation. Does not infer chapters from any other source.

**All chapters fully drafted in v1 (Path 2).** Offers `run-quality-gate` for ungated chapters. States that `revise-pass` is Phase 2 and is not available.

**Missing bible files (Path 5 general question).** States which files are absent and answers from whatever context is available. Names the skill that produces each missing file.

## Worked Example

See [studio.example.md](./studio.example.md) for a condensed transcript of a `studio` Path 2 session over the committed two-chapter sample book "The Quiet Network" (see `examples/sample-book/`). The example is grounded in the committed progress.json, meta.json, and chapter-list.md fixtures.
