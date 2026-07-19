---
title: "line-editor agent reference"
description: "Reference for the line-editor agent - the sentence-level polish agent that applies clarity, grammar, and rhythm proposals to structurally sound chapters without touching claim markers"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "drafting", "voice", "editing", "line-editing", "proposals"]
---

# line-editor

The `line-editor` agent is the sentence-level polish agent for the Drafting
and Voice pillar. It receives a chapter that is structurally sound and applies
clarity, grammar, and rhythm edits as proposals - never silent overwrites. It
is a Phase 1 Drafting-pillar agent specified in S-04 (drafting and voice agents)
and governed by D-13 (security posture), D-18 (in-plugin model routing), and
D-19 (colors by pillar).

## Purpose

The `line-editor` converts a structurally accepted chapter into polished prose
at the sentence level. It does not touch the chapter's argument, evidence, or
structure. Every change it proposes is discrete and reversible: the author
accepts or rejects each PROPOSED REPLACEMENT block individually.

The agent reads the do-not list in `context/style-profile.md` before it
edits anything. Items on the do-not list are not removed; they are flagged
because they may be intentional stylistic choices. Claim markers, `[UNVERIFIED]`
tags, and `[SOURCE-UNVERIFIABLE]` tags are immune to editing - the agent is
forbidden from touching them. This immunity is the binding counterpart to the
promise `drafting-partner` makes in its reference page: claim markers survive
the line-editor pass per the S-04 (drafting and voice agents) cross-agent
contract, so anchoring done at draft time is never lost downstream.

The `line-editor` does not critique structure (that role belongs to
`developmental-editor`, which arrives in Phase 2) and does not score voice
adherence (that role belongs to `voice-guardian`).

## Invocation triggers

Invoke `line-editor` when any of the following holds.

- A chapter is structurally accepted by the author and ready for sentence-level
  polish. In Phase 1, the author's acceptance is the clearance; the
  `draft-chapter` skill routes here at the polish stage.
- In Phase 2, `developmental-editor` has completed its critique and any
  structural revisions are settled. The `revise-pass` skill enforces this
  ordering: `developmental-editor` critique before line editing, because line
  edits can be invalidated by structural revision.
- The author requests a direct line-edit pass on a specific chapter outside a
  skill-managed flow.

## At a glance

Registry facts for this agent, from the CANON component registry, are fixed.

| Property | Value |
|---|---|
| Pillar | Drafting and Voice |
| Phase | 1 |
| Model | `sonnet` |
| Color | orange |
| Memory | none |
| Tools | Read, Write |

The `model: sonnet` declaration follows D-18 (in-plugin model routing): the
CANON registry assigns `sonnet` as an explicit override for `line-editor`.
Sentence-level editing requires judgment about clarity and rhythm, which warrants
the sonnet tier. The orange color follows D-19 (colors by pillar), which assigns
orange to the Drafting and Voice pillar. No `memory` is declared because the
style profile is on disk in `context/` and no cross-session cache is needed for
the editing role.

## Inputs

The `line-editor` reads only these paths.

| Path | When it is read | Why |
|---|---|---|
| `context/style-profile.md` | Start of every invocation | Loads the do-not list, rhythm guidance, register description, and diction rules that govern the editing pass |
| `chapters/NN-*.md` | Start of every invocation | The chapter to be edited; read in full before any proposal is formulated |

## Outputs

The `line-editor` writes only to `chapters/`.

| Path | Written when | Contents |
|---|---|---|
| `chapters/NN-*.md` | During the editing pass | PROPOSED REPLACEMENT blocks for each sentence or passage that warrants change; no silent overwrite of existing content |

## The three edit families

The line-editor applies edits in three families only. Changes outside these
families are out of scope.

**Sentence clarity.** Resolves ambiguity, misplaced modifiers, and tangled
pronoun chains. The goal is a sentence the reader parses correctly on the first
read without backtracking.

**Grammar and consistency.** Corrects grammatical errors and inconsistencies
in spelling, capitalization, and term usage per the style profile. Spelling
follows the style profile's conventions; where the profile is silent, American
English is the default.

**Rhythm.** Restructures monotonous sentence patterns. The style profile for
the sample book calls for mostly short sentences (under 20 words) with one
longer sentence per paragraph for variation. A run of similarly lengthed
declaratives that produces a flat cadence is a rhythm issue the agent addresses
by proposing restructuring.

## Proposal-block convention

The line-editor reuses the `drafting-partner` PROPOSED REPLACEMENT convention.
The author sees one house format for all edit proposals across the drafting
pipeline.

**Standard edit:**

```
PROPOSED REPLACEMENT

Original passage:
[quoted original text]

Proposed replacement:
[revised text]
```

**Meaning-altering edit:**

```
[MEANING CHANGE: <reason the meaning shifts>]

PROPOSED REPLACEMENT

Original passage:
[quoted original text]

Proposed replacement:
[revised text]
```

Each block is discrete. The author accepts or rejects each one individually.
The agent does not produce free-form rewrites, inline annotations, or a
mixed format; all output is in proposal blocks.

## Meaning changes

Any change that alters meaning - even by a single word - receives a
`[MEANING CHANGE: <reason>]` marker immediately before the PROPOSED REPLACEMENT
block. The marker names the specific shift: for example,
`[MEANING CHANGE: "often" weakens the categorical claim to a tendency]`. The
proposed replacement is present for the author's consideration, but accepting it
is the author's decision, not the agent's.

The `[MEANING CHANGE]` marker applies to changes that reframe a claim, introduce
a qualifier, remove emphasis, or shift the implication of a sentence. Purely
mechanical changes - correcting a grammatical error that does not affect the
claim, removing a doubled word - do not require the marker.

## Claim marker immunity

The following tags are immune to any editing action:

- `[claim: EV-nnnn]` - the claim anchor placed by `drafting-partner`
- `[UNVERIFIED]` - the unresolved sourcing placeholder placed by `drafting-partner`
  or `fact-checker`
- `[SOURCE-UNVERIFIABLE]` - the online-pass failure tag placed by `fact-checker`

The line-editor never removes, moves, or rewrites any of these tags. They are
the domain of `fact-checker` and `drafting-partner` per the S-04 (drafting and
voice agents) cross-agent contract. A marker present in a chapter before the
line-editor pass is present in the same position after it; `bin/ns-claims`
coverage output is unaffected.

## The do-not list

Before editing, the agent reads the do-not list in `context/style-profile.md`.
Items on this list are never edited away. If the chapter contains a passage that
violates a do-not-list item, the agent flags it with a note that the item appears
and may be intentional. The flag is informational only; the author decides whether
to address it.

Example: the sample-book style profile lists "start sentences with 'In today's
world' or 'It is important to note'" on the do-not list. If a sentence in the
chapter opens with "It is important to note that," the line-editor flags it
rather than proposing removal.

## Role boundaries

**Structural critique.** Observations about argument sequencing, chapter scope,
or thesis alignment are out of scope. The line-editor notes any such observation
and explicitly defers it to `developmental-editor`, named as the Phase 2 agent
for structural work.

**Voice scoring.** The line-editor does not produce a voice-drift score, a
qualitative style-adherence assessment, or a note about overall register
consistency. Voice assessment belongs to `voice-guardian`, which runs after the
line-editor pass and interprets the deterministic output of `bin/ns-stylometry`.

## Guardrails

- **Every edit is a proposal.** The agent never silently overwrites a chapter.
  All changes are PROPOSED REPLACEMENT blocks the author accepts or rejects.
- **Claim markers are immune.** The tags `[claim: EV-nnnn]`, `[UNVERIFIED]`, and
  `[SOURCE-UNVERIFIABLE]` are never removed, moved, or altered. Any marker
  present before the pass is present after it.
- **Do-not-list items are flagged, not removed.** The style profile's do-not list
  is read before editing. Violations are flagged as potentially intentional; the
  agent does not propose removing them.
- **Meaning changes are marked.** Every change that shifts meaning receives
  `[MEANING CHANGE: <reason>]` before the proposal block and is left for the
  author's decision.
- **No structural critique.** Structural issues are noted and deferred to
  `developmental-editor`. The line-editor does not issue critique that belongs
  to the structural phase.
- **No voice scoring.** Voice-drift assessment is `voice-guardian`'s role. The
  line-editor produces no score, drift note, or qualitative style evaluation.

Per A-02 (platform capability baseline), a plugin-shipped agent cannot declare
`hooks`, `permissionMode`, or `mcpServers` in frontmatter; the platform ignores
those fields. Every guardrail above is enforced in the agent's system prompt.

## Natural next step

After a `line-editor` session, the natural next step is `voice-guardian` (Phase 2),
which interprets the deterministic output of `bin/ns-stylometry` and provides
qualitative notes on any drift markers the run raised. In Phase 1, where
`voice-guardian` is not yet in the pipeline, the quality gate is the next stop:
invoke `run-quality-gate` or `fact-check-pass` to confirm claim coverage and
gate clearance. If the author accepts meaning-change proposals and wants to
confirm that claim markers remain intact after the edits land, running
`bin/ns-claims` on the revised chapter is a fast verification.

## Worked example

See [line-editor.example.md](./line-editor.example.md) for a condensed transcript
of a `line-editor` session over Chapter 1 of the sample book "The Quiet Network,"
showing a clarity edit, a rhythm proposal, a meaning-change flag, a do-not-list
flag, and the agent's behavior when a passage contains a claim marker.
