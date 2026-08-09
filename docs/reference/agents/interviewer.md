---
title: "interviewer agent reference"
description: "Reference for the interviewer agent - the intake front door that scaffolds the bible and confirms the project brief"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "intake", "interview", "brief"]
---

# interviewer

The `interviewer` is the studio's front door. It runs the project intake
interview and writes the first bible files that configure the studio for a
specific book. It is a Phase 1 Intake-pillar agent specified in S-01 (intake and
context agents) and governed by D-16 (honest, resumable interview).

## Purpose

The `interviewer` gathers an author's intent for a book and turns it into the
project bible that every other agent reads. It scaffolds the book tree, walks the
author through ten intake sections, records each confirmed section to
`context/brief.md` as a resumable DRAFT block, and commits the bible files only
after the author confirms a single written brief. The first-session goal is a
confirmed brief, not a drafted chapter. Drafting, outlining, and writing-sample
analysis are out of scope: those belong to `drafting-partner`,
`structure-architect`, and `voice-capture`.

## Invocation triggers

Invoke the `interviewer` when any of the following holds.

- A new book project is starting and no `context/brief.md` exists yet.
- `context/brief.md` exists but carries incomplete DRAFT blocks from a prior
  interrupted session, so intake needs to resume.
- The author wants to revisit intake answers mid-project, such as a scope change,
  a title pivot, or a thesis revision.
- The author supplies a filled `project-init.guided.md` or `project-init.blank.md`
  template and wants only the gaps filled and the brief confirmed.
- The `studio` dispatcher, per D-17 (guided front door), routes the author here
  after they choose to start a new book or resume intake.

## At a glance

The registry facts for this agent, from the CANON component registry, are fixed.

| Property | Value |
|---|---|
| Pillar | Intake |
| Phase | 1 |
| Model | `inherit` |
| Color | blue |
| Memory | none |
| Tools | Read, Write |

The `model: inherit` choice follows D-18 (in-plugin model routing): intake is
conversational work that runs well on the session model. The blue color follows
D-19 (colors by pillar), which assigns blue to the Intake pillar. The agent
declares no `memory`, because it holds no cross-session cache; resumability comes
from the DRAFT blocks on disk, not from agent memory.

## Inputs

The `interviewer` reads only these paths.

| Path | When it is read | Why |
|---|---|---|
| `context/brief.md` | Start of every invocation | Detect DRAFT blocks and decide whether this is a new or resumed intake |
| `project-init.guided.md` or `project-init.blank.md` | When the author supplies a filled template | Parse answered fields and identify gaps to ask about |

## Outputs

The `interviewer` writes only these bible paths, and the four committed files plus
the log entry are written only at the commit step, after the author confirms the
written brief.

| Path | Written | Contents |
|---|---|---|
| `context/brief.md` | A DRAFT block per confirmed section; the final brief at commit | The running intake record, then the confirmed project brief |
| `context/audience.md` | At commit | Primary reader persona, prior-knowledge baseline, desired change in the reader |
| `structure/thesis.md` | At commit | Draft controlling idea, promise to the reader, scope boundary ("what this book is not") |
| `structure/comps.md` | At commit | Seeded comparable titles with differentiation notes |
| `context/decisions.md` | At commit | One log entry: date, entry mode (template or conversational), number of sessions |

DRAFT blocks use the delimiters `<!-- DRAFT section-N completed YYYY-MM-DD -->`
and `<!-- END DRAFT section-N -->`, the schema assumed by S-01 (intake and context
agents) pending ratification in S-08 (schemas and file formats).

## Guardrails

- **Scaffold before interviewing.** The book tree is created (by the
  `init-project` skill) before the first question, so the author sees real
  structure appear, per D-16 (honest, resumable interview).
- **Flush every confirmed section.** A DRAFT block reaches `context/brief.md`
  before the next section's questions are asked. Earlier DRAFT blocks are never
  overwritten by later ones. This is what makes intake resumable across sessions.
- **State an honest time expectation.** The opening turn states, unprompted, that
  the interview typically takes 45 to 90 minutes and can pause after any section.
- **Never fabricate a thin answer.** A topic offered in place of a thesis is
  reflected back as a topic, and the author is asked for the assertion the book
  makes. Plausible-sounding filler is never written in.
- **Ask adaptively.** Questions the author already answered are not re-asked; the
  agent tracks covered ground within the session.
- **Confirm before commit.** No final content lands in `context/brief.md`,
  `context/audience.md`, `structure/thesis.md`, or `structure/comps.md` until the
  author explicitly confirms the written brief. DRAFT blocks may exist before that.
- **Hand off writing samples.** Samples pasted during the voice section are flagged
  for `voice-capture` and not analyzed inline.

Per A-02 (platform capability baseline), a plugin-shipped agent cannot declare
`hooks`, `permissionMode`, or `mcpServers` in frontmatter; the platform ignores
those fields. Every guardrail above is therefore enforced in the agent's system
prompt.

## Natural next step

After the bible files are committed, the `interviewer` names the next steps as
choices, not a mandated pipeline: sharpen the controlling idea with
`thesis-architect`, build the outline with `structure-architect`, or run
`voice-capture` when the author has provided writing samples.

## Worked example

See [interviewer.example.md](./interviewer.example.md) for a condensed transcript
of a full intake for the sample book "The Quiet Network", including the
scaffold-first step, a DRAFT flush, a cross-session resume, and the
confirm-before-commit step.
