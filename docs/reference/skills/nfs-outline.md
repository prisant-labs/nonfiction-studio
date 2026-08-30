---
title: "nfs-outline skill reference"
description: "Reference for the nfs-outline skill - the outline front door that confirms the brief, invokes thesis-architect and structure-architect, and locks the chapter registry"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "outline", "thesis", "structure", "chapter-list"]
---

# nfs-outline

The `nfs-outline` skill is the studio's outline front door. It confirms the project brief via a deterministic Bash probe, optionally invokes `thesis-architect` to produce or sharpen the controlling idea, delegates chapter architecture to `structure-architect`, presents the draft outline for author review, and confirms the written structure files via Read checks. It is a Phase 1 skill specified in S-06 3.4 (skills and invocation surface) and governed by D-06 (single-writer state discipline), D-13 (security posture), and D-21 (craft models as data).

## Purpose

`nfs-outline` bridges the confirmed project brief and the chapter-by-chapter architecture. It produces three structure files that every downstream skill and agent depends on:

- `structure/thesis.md` - the controlling idea, argument spine, promise to the reader, exclusions, and scope flags (written by `thesis-architect` when absent)
- `structure/outline.md` - the chapter-by-chapter architecture: promise, payoff, thesis link, key beats, evidence needs, and dependencies per chapter (written by `structure-architect`)
- `structure/chapter-list.md` - the slug registry: the authoritative identifier list for drafting, fact-checking, and the quality gate (written by `structure-architect`)

The skill writes no `.studio/` state. Chapter progress entries come into existence when the PostToolBatch hook observes the first write of each chapter file per D-06 (single-writer state discipline). The slug registry in `structure/chapter-list.md` is the locked chapter list on author acceptance; no secondary state entry is needed.

## Invocation

```
/nonfiction-studio:nfs-outline [scope]
```

The scope argument controls which phases run:

| Scope | What runs | When to use |
|---|---|---|
| `full` (default) | Brief probe, thesis flow, structure-architect, review, acceptance | Starting the outline from scratch or rebuilding the full structure |
| `thesis` | Brief probe and thesis flow only | Producing or revising the thesis without building the outline yet |
| `chapters` | Brief probe, thesis guard, structure-architect, review, acceptance | Building the outline when a confirmed thesis already exists |

Alternate entry points:
- Via `nfs-interview` Step 6: that skill suggests `nfs-outline` after the brief is confirmed
- Via `nfs-capture-voice` Step 6: that skill suggests `nfs-outline` when a confirmed brief exists
- Via the `nfs-start` dispatcher: routes here from Path 2 when no chapter list exists

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `context/brief.md` | Step 1 (Bash probe) | Confirm the brief exists and contains no DRAFT-block markers |
| `structure/thesis.md` | Step 2 (Read check) | Determine whether `thesis-architect` must be invoked; pass confirmed thesis to `structure-architect` |
| `research/evidence-log.md` | Step 3 (Read, if present) | Evidence entries passed to `structure-architect` for evidence hooks in the outline |

### Outputs

All structure files are written by the agents, not by the skill directly. No file is written until the author confirms the proposed content.

| Path | Written by | Contents |
|---|---|---|
| `structure/thesis.md` | `thesis-architect` (when absent) | Thesis sentence, promise to the reader, argument spine, exclusions, scope flags |
| `structure/outline.md` | `structure-architect` | Chapter-by-chapter architecture: promise, payoff, thesis link, key beats, evidence needs, dependencies |
| `structure/chapter-list.md` | `structure-architect` | Slug registry: chapter number, working title, slug, one-line promise |
| `research/open-questions.md` | `structure-architect` (appends) | Evidence-needed items, one entry per outline evidence gap |

The skill writes no `.studio/` state. Craft-model selection belongs to `structure-architect`; the skill does not present model options.

## Flow Summary

The skill runs five steps. The scope argument determines which steps execute.

1. **Confirmed-brief probe.** Uses a Bash tool call to test whether `context/brief.md` exists and contains no DRAFT-block markers. The output is a binary token: `UNCONFIRMED` halts immediately and routes to `nfs-interview`; `CONFIRMED` continues. This is the deterministic-guard convention per S-06 1.1 (skill anatomy and discovery).

2. **Thesis check (full and thesis scopes) / Thesis guard (chapters scope).** For `full` and `thesis` scopes: reads `structure/thesis.md`. If absent or empty, invokes `thesis-architect`. If present, presents it to the author with an option to revise. Applies the two-revision-pass cap: after two author rejections, halts and directs the author to edit `structure/thesis.md` manually. For `thesis` scope, closes after the thesis is confirmed with the outline suggested as next step. For `chapters` scope: reads `structure/thesis.md` and halts with a clear message if absent.

3. **Invoke structure-architect (full and chapters scopes).** Reads `research/evidence-log.md` if present. Spawns `structure-architect` (the `nfs-outline -> structure-architect` chain edge) with the brief, thesis, and evidence context. The agent writes `structure/outline.md`, `structure/chapter-list.md`, and appends to `research/open-questions.md` in one invocation. Craft-model questions belong to the agent.

4. **Review and amendments (full and chapters scopes).** Presents the outline to the author. If the author requests amendments, re-invokes `structure-architect` with the change notes and the existing outline as context; the agent's revision-diff-and-summarize guardrail governs the re-invocation. The skill never edits structure files directly.

5. **Confirm outputs and close (full and chapters scopes).** Uses the Read tool on `structure/outline.md` and `structure/chapter-list.md` to confirm both files are present and non-empty. States that `structure/chapter-list.md` is the locked chapter registry. Suggests `nfs-research` or `nfs-draft` as next steps; suggests `nfs-capture-voice` if no voice baseline exists yet.

## Failure Behavior

The brief probe at Step 1 is deterministic. On `UNCONFIRMED`, the skill halts regardless of scope and routes to `nfs-interview`. No context inference substitutes for the tool call.

The two-revision-pass cap at Step 2 prevents an unproductive thesis loop. After two rejected revisions, the author edits `structure/thesis.md` directly and re-invokes. The last thesis-architect output remains in the file as a starting point.

The `chapters` scope thesis guard prevents structure-architect from running without a confirmed controlling idea. The error message names the missing file and the command to produce it.

If the Read checks at Step 5 find a missing or empty output file, the skill reports the gap and offers a restart from Step 3. No partial state is declared accepted.

All amendment routing goes back to `structure-architect`. The skill never writes or patches structure files; that boundary prevents the write-conflict class that D-06 (single-writer state discipline) exists to prevent.

## Worked Example

See [nfs-outline.example.md](./nfs-outline.example.md) for a condensed transcript of an `nfs-outline` run for the sample book "The Quiet Network" (see `examples/sample-book/`). The example shows a `full`-scope run where the thesis already exists: the confirmed-brief probe returns `CONFIRMED`, the thesis check finds `structure/thesis.md`, the author accepts the existing thesis, `structure-architect` is invoked to build the six-chapter architecture, the author accepts the plan, and the skill confirms both output files via Read checks. The committed `structure/outline.md` and `structure/chapter-list.md` in `examples/sample-book/` are the live outcome of this run.
