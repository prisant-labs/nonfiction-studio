---
title: "structure-architect agent reference"
description: "Reference for the structure-architect agent - translates a confirmed thesis into chapter-by-chapter architecture and writes structure/outline.md, structure/chapter-list.md, and research/open-questions.md appends"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "structure", "outline", "architecture"]
---

# structure-architect

The `structure-architect` agent translates a confirmed controlling idea into the
chapter architecture that every downstream agent reads. It is a Phase 1
Structure-pillar agent specified in S-02 (structure and argument agents) and
governed by D-13 (security posture).

## Purpose

The `structure-architect` reads the craft model the author chose at intake, maps
the argument spine from `structure/thesis.md` to chapters, assigns a promise,
payoff, and thesis link to each chapter, plans key beats and evidence needs,
tracks cross-chapter dependencies, and surfaces structural gaps before writing
anything to disk. On author confirmation it writes `structure/outline.md`, the
slug registry at `structure/chapter-list.md`, and appends each evidence-needed
item to `research/open-questions.md` in the same invocation. The agent does not
draft chapter prose; that belongs to `drafting-partner`.

The evidence-needed pipeline places `structure-architect` at the first two steps:
writing the items into chapter blocks and appending them to
`research/open-questions.md`. The remaining steps - resolving them to ledger
entries and anchoring chapter drafts with `[claim: EV-nnnn]` markers - belong to
`research-librarian` and `drafting-partner`, as specified in S-03 (agents: research
and evidence).

## Invocation triggers

Invoke the `structure-architect` when any of the following holds.

- `thesis-architect` has written and the author has confirmed
  `structure/thesis.md`. The `outline-book` skill triggers `structure-architect`
  to translate the argument spine into a chapter plan.
- `structure/thesis.md` is confirmed but `structure/outline.md` does not yet
  exist. The `outline-book` skill routes here directly.
- The outline needs revision as research findings come in and the chapter plan
  no longer matches available evidence.
- Developmental editing reveals structural problems - a missing transition
  chapter, a gap in argument-spine coverage, or a required chapter the brief
  cannot yet describe.

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

The `model: inherit` choice follows D-18 (in-plugin model routing): structural
architecture is high-stakes intellectual work that shapes every subsequent chapter
and benefits from session-model depth. The purple color follows D-19 (colors by
pillar), which assigns purple to the Structure pillar. The agent declares no
`memory`; all structural decisions live on disk in `structure/outline.md` and
`structure/chapter-list.md`, and no cross-session cache is needed.

## Inputs

The `structure-architect` reads only these paths.

| Path | When it is read | Why |
|---|---|---|
| `structure/thesis.md` | Start of every invocation | Extract the controlling idea, argument spine, and scope flags that anchor the chapter plan |
| `context/audience.md` | Start of every invocation | Calibrate chapter promises against the reader's background and expected takeaways |
| `research/open-questions.md` | Start of every invocation | Check existing entries to avoid duplicates when appending evidence-needed items |
| `templates/craft-models/<selected-model>.yaml` | Start of every invocation | Read the craft model shape selected at intake per D-21 (craft models as data); read-only |
| `structure/outline.md` | Re-invocation only | Read the existing outline to produce the revision diff before overwriting |

If `templates/craft-models/<selected-model>.yaml` is absent, the agent surfaces
the missing path and halts. This is the honest behavior during Phase 0 and Phase
1, when the craft-model YAML files land with a later templates task.

## Outputs

The `structure-architect` writes only these paths, and only after the author
confirms the proposed plan.

| Path | Written when | Contents |
|---|---|---|
| `structure/outline.md` | After author confirmation | Full chapter-by-chapter architecture per the outline format contract |
| `structure/chapter-list.md` | After author confirmation | Slug registry: chapter number, working title, slug, one-line promise |
| `research/open-questions.md` | Same invocation as the outline write | One appended entry per evidence-needed item from the outline |

## The outline.md format contract

Every chapter entry in `structure/outline.md` uses the following block exactly.
All six subsections are required. A chapter missing a thesis link is flagged to
the author as a scope-creep signal before the outline is written.

```markdown
## Chapter <N>: <Working Title>

**Promise:** <What the reader gains from this chapter - concrete outcome.>
**Payoff:** <How the chapter delivers on that promise - one to two sentences.>
**Thesis link:** <Which argument-spine claim this chapter advances, and how.>

### Key beats

1. <Beat: opening move or hook>
2. <Beat: main argument or narrative turn>
3. <Beat: evidence anchor, scene, or case study>
4. <Beat: closing transition or reader takeaway>

### Evidence needed

- [ ] EV-NEEDED: <Specific claim, statistic, case study, or example required>
- [ ] EV-NEEDED: <Another required item>

### Dependencies

- **Requires:** Chapter <M> (<reason - concept or term introduced there>)
- **Informs:** Chapter <P> (<reason - sets up that argument>)
```

The `EV-NEEDED` checkboxes are the handoff point from the outline to the
evidence pipeline. When `research-librarian` resolves an item, it promotes the
entry to a structured ledger entry in `research/evidence-log.md` per D-07 (claim
ledger), and the checkbox can be replaced with the ledger ID. The
`structure-architect` owns only the first two steps: writing the items into
chapter blocks and appending them to `research/open-questions.md`.

Gaps in the outline use a `[GAP]` marker in the chapter title and a gap
description in the promise field. The author sees the gap list before the outline
is written and decides whether to fill it, restructure, or accept the open item.
The agent does not resolve gaps autonomously.

## The chapter-list.md format contract

`structure/chapter-list.md` is the slug registry for the book. Every chapter is
one row. The slug must match the pattern `^[0-9]{2}-[a-z0-9-]+$` - a two-digit
ordinal, a hyphen, and a kebab-case title using only lowercase letters, digits,
and hyphens. This is the same pattern S-08 (schemas and file formats) section 3
requires in `progress.json`.

```markdown
# Chapter List

| # | Working title | Slug | Promise |
|---|---|---|---|
| 1 | <Working title> | 01-<kebab-title> | <One-line reader promise> |
```

The word-count and status columns present in some older bible fixtures are
deliberately absent. Word counts are owned by the `PostToolBatch` hook and
written atomically to `.studio/progress.json` per D-06 (single-writer state
discipline); duplicating them in the chapter list produces the drift the D-06
rule exists to prevent.

## Craft model consumption

D-21 (craft models as data) establishes that named non-fiction structures live in
`templates/craft-models/*.yaml` and are selected at intake by `interviewer`. The
`structure-architect` reads the YAML for the selected model and uses it to
determine chapter shape, the ratio of setup to argument to evidence, and pacing
conventions. The six supported models are:

| Model slug | Template file | Primary shape |
|---|---|---|
| `big-idea` | `big-idea.yaml` | Central premise stated early; each chapter adds evidence and extension |
| `how-to` | `how-to.yaml` | Step or skill sequence; chapters are procedural units |
| `narrative` | `narrative.yaml` | Reported story arc; scene, complication, resolution at chapter scale |
| `memoir` | `memoir.yaml` | First-person experience arc; thematic rather than purely chronological |
| `problem-solution` | `problem-solution.yaml` | Problem established in full before chapters build the solution |
| `framework` | `framework.yaml` | Named model introduced early; chapters demonstrate components and applications |

If no model was selected at intake or the config carries an unrecognized value,
the agent presents the six options with one-line descriptions and asks the author
to choose before proceeding. Silent defaulting to any model is not permitted.

## Guardrails

- **Promise-payoff-thesis-link required.** Every chapter entry must carry a
  promise, a payoff, and a thesis link. A chapter with no thesis link is a
  scope-creep signal and is flagged to the author before the outline is written.
- **Atomic same-invocation appends.** Evidence-needed items are appended to
  `research/open-questions.md` within the same invocation that writes the
  outline. They are never deferred to a follow-up session.
- **[GAP] markers, not invented content.** Structural gaps are surfaced with
  `[GAP]` markers. The agent does not invent placeholder content to fill them.
- **Revision diff before overwrite.** When re-invoked for revision, the agent
  diffs the new outline against the existing one and summarizes changes for the
  author before overwriting.
- **No chapter prose.** The agent does not draft chapter prose. Prose belongs to
  `drafting-partner`.
- **Halt on absent craft model.** When the craft model YAML is absent, the agent
  surfaces the missing file path and halts. Proceeding without the craft model
  would mean the chapter shape is underdetermined.

Per A-02 (platform capability baseline), a plugin-shipped agent cannot declare
`hooks`, `permissionMode`, or `mcpServers` in frontmatter; the platform ignores
those fields. Every guardrail above is enforced in the agent's system prompt.

## Natural next step

After `structure/outline.md` is written, the agent names the available next
steps: start the research pass to resolve evidence-needed items with
`research-librarian`, or begin drafting with `drafting-partner` on any chapter
whose Dependencies block carries no Requires entries. Chapters with no incoming
dependencies may be drafted independently; `drafting-partner` reads the
dependency block before drafting to know what prior context to assume.

## Worked example

See [structure-architect.example.md](./structure-architect.example.md) for a
condensed transcript of a structure session for the sample book "The Quiet
Network," showing the craft model check, gap surfacing, the confirm-write
sequence, and the outputs written: `structure/outline.md`,
`structure/chapter-list.md`, and the `research/open-questions.md` appends.
