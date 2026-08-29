---
title: "thesis-architect agent reference"
description: "Reference for the thesis-architect agent - disciplines the controlling idea and writes structure/thesis.md before the outline is drawn"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "structure", "thesis", "argument"]
---

# thesis-architect

The `thesis-architect` agent sharpens the controlling idea for a specific book
before any outline work begins. It is a Phase 1 Structure-pillar agent specified
in S-02 (structure and argument agents) and governed by D-13 (security posture).

## Purpose

The `thesis-architect` reads the confirmed brief and any draft thesis seeded by
`interviewer`, opens a focused dialogue to produce a single falsifiable claim,
builds the argument spine of subsidiary claims the thesis requires, surfaces scope
flags when the brief contains ambitions that exceed the controlling idea or a
single volume, and writes `structure/thesis.md` only after the author confirms the
complete structure. It reads the file back from disk before closing. Its single
write target is `structure/thesis.md`; outline work belongs to
`structure-architect`.

The thesis quality rubric from Q-01 (testing and evals) section 6 evaluates
`structure/thesis.md` against three criteria - specific claim, arguable, and
scoped to trade nonfiction - and writes its results to an advisory block in the
gate report as a warn-only signal per D-03 (layered Stop gate). That rubric has no
effect on the gate exit code. The `thesis-architect` claims no gate role and does
not represent its output as blocking any session.

## Invocation triggers

Invoke the `thesis-architect` when any of the following holds.

- `interviewer` has confirmed the project brief and seeded a draft
  `structure/thesis.md`; invoke to sharpen the controlling idea before the outline
  is drawn.
- The `nfs-outline` skill routes here because `structure/thesis.md` is missing or
  contains only the interviewer's unreviewed stub; the skill checks for a non-empty,
  confirmed thesis before invoking `structure-architect`.
- The thesis shifts after chapter drafting has begun and the author needs to
  re-examine the controlling idea; see Guardrails for the re-invocation warning
  protocol.

## At a glance

The registry facts for this agent, from the CANON component registry, are fixed.

| Property | Value |
|---|---|
| Pillar | Structure |
| Phase | 1 |
| Model | `inherit` |
| Color | purple |
| Memory | none |
| Tools | Read, Write |

The `model: inherit` choice follows D-18 (in-plugin model routing): thesis
sharpening is high-stakes intellectual architecture - shaping the controlling idea
for every subsequent choice in the book - and benefits from session-model depth.
The purple color follows D-19 (colors by pillar), which assigns purple to the
Structure pillar. The agent declares no `memory` because the thesis lives on disk
in `structure/thesis.md`; no cross-session cache is needed.

## Inputs

The `thesis-architect` reads only these paths.

| Path | When it is read | Why |
|---|---|---|
| `context/brief.md` | Start of every invocation | Extract the confirmed scope, the draft thesis, and the stated scope boundaries |
| `context/audience.md` | Start of every invocation | Calibrate the promise to the reader against the intended audience |
| `structure/comps.md` | When present; skipped gracefully when absent | Sharpen the differentiation claim in the argument spine and the "What this book is NOT" section |

## Outputs

The `thesis-architect` writes only this path, and only after the author confirms
the complete structure.

| Path | Written when | Contents |
|---|---|---|
| `structure/thesis.md` | After author confirmation | All five sections: the controlling idea, promise to the reader, argument spine, exclusions, and scope flags |

## The thesis.md format contract

Every `structure/thesis.md` produced by `thesis-architect` follows this exact
structure. All five sections are required. The Scope flags section is present even
when empty.

```markdown
# Thesis

<One sentence. Subject, verb, specific claim. No hedging.>

## Promise to the reader

<What changes for the reader after finishing this book. One to two sentences, concrete.>

## Argument spine

1. <First major claim that must be true for the thesis to hold>
2. <Second major claim>
3. <Continue as needed; typical range three to six claims>

## What this book is NOT

- Not <excluded scope item>
- Not <another excluded item>

## Scope flags

<Empty unless the agent detected scope creep during the session.
Each flag names the creeping element and recommends a disposition:
cut, defer to sequel, or reconceive the thesis to accommodate it.>
```

Each scope flag names the creeping element, explains why it conflicts with the
controlling idea, and records the author's chosen disposition (cut, defer to
sequel, or reconceive). Scope flags are never silently resolved.

## Guardrails

- **Falsifiability rule.** The agent refuses to write a thesis that is a topic
  statement rather than a specific, falsifiable claim. The opposite of the
  controlling idea must be arguable. Patterns like "this book explores X" are
  reflected back and the author is asked for the assertion the book makes.
- **No silent scope resolution.** Every scope flag is surfaced before writing. The
  author decides the disposition of each flagged element. Flags are written to the
  Scope flags section and never silently dropped.
- **Confirm before write.** No content reaches `structure/thesis.md` until the
  author explicitly confirms the complete structure: thesis, promise, argument
  spine, exclusions, and scope flags.
- **Read back after write.** The completed file is read from disk and presented to
  the author before the session closes. This step is not optional.
- **Outline boundary.** The agent does not draft outline content. Chapter structure
  and evidence planning belong to `structure-architect`.
- **Re-invocation warning.** When invoked after chapter drafting has begun, the
  agent warns the author that a thesis change may invalidate existing chapter
  promises and requests explicit confirmation before overwriting.
- **Advisory rubric posture.** The thesis quality rubric from Q-01 (testing and
  evals) section 6 is warn-only per D-03 (layered Stop gate). This agent does not
  gate or score its own output.

Per A-02 (platform capability baseline), a plugin-shipped agent cannot declare
`hooks`, `permissionMode`, or `mcpServers` in frontmatter; the platform ignores
those fields. Every guardrail above is enforced in the agent's system prompt.

## Natural next step

After `structure/thesis.md` is confirmed, the `thesis-architect` names the
available next step: build the chapter architecture with `structure-architect`.
The controlling idea is now locked, the argument spine is documented, and the
outline can proceed from a firm foundation.

## Worked example

See [thesis-architect.example.md](./thesis-architect.example.md) for a condensed
transcript of a thesis-sharpening session for the sample book "The Quiet Network,"
showing the falsifiability check, the argument spine build, a scope flag
disposition, the confirm-write-read-back sequence, and the handoff to
`structure-architect`.
