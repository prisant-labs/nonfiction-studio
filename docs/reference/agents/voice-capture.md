---
title: "voice-capture agent reference"
description: "Reference for the voice-capture agent - builds the operational voice profile and sets the stylometric baseline"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "intake", "voice", "style-profile", "stylometry"]
---

# voice-capture

The `voice-capture` agent builds the author's operational voice profile and sets
the numeric stylometric baseline. It is a Phase 1 Intake-pillar agent specified in
S-01 (intake and context agents) and governed by D-08 (hybrid voice scoring). It
works in tandem with `bin/ns-stylometry`: the engine computes and prints the
vector; the agent writes it into config.

## Purpose

The `voice-capture` agent converts author writing samples, or a confirmed bootstrap
passage when no samples exist, into two outputs: `context/style-profile.md` (the
human-readable voice contract every other agent reads for craft guidance) and the
`stylometry.baseline.markers` object plus `stylometry.baseline.marker_set_version`
number in `.studio/config.json` (the numeric anchor the gate uses to score drift,
and the version stamp that lets the drift scorer refuse a baseline captured under
a different marker computation). Neither output is committed until the author
confirms the draft profile. The agent does not evaluate whether the captured voice
is good; it observes, describes, and records.

The `voice-capture` agent is typically the second agent to run after `interviewer`,
though it can run at any point when new samples arrive or a voice-change decision
is logged.

## Invocation triggers

Invoke the `voice-capture` agent when any of the following holds.

- `nfs-interview` has confirmed the project brief and the author provided writing
  samples in section 6 during intake.
- The author supplies new writing samples at any project stage and wants the profile
  and baseline updated.
- `context/style-profile.md` is absent, or the author has logged a voice-change
  decision in `context/decisions.md` indicating the existing profile no longer
  applies.
- The author has no writing samples and wants a bootstrapped profile built through
  the three-passage generation and reaction loop.
- The `nfs-start` dispatcher, per D-17 (guided front door), routes here when the
  author says "capture my voice," "set my writing style," or "I have samples to
  share."

## At a glance

The registry facts for this agent, from the CANON component registry, are fixed.

| Property | Value |
|---|---|
| Pillar | Intake |
| Phase | 1 |
| Model | `inherit` |
| Color | blue |
| Memory | none |
| Tools | Read, Write, Bash |

The `model: inherit` choice follows D-18 (in-plugin model routing): voice capture
is conversational and analytical work that runs well on the session model. The blue
color follows D-19 (colors by pillar), which assigns blue to the Intake pillar. The
agent declares no `memory` because the captured profile lives on disk in
`context/style-profile.md`, not in agent memory. Bash is the narrowest tool needed
to invoke `bin/ns-stylometry --measure` per the ADR-0005 (bin PATH on Windows)
resolution.

## Inputs

The `voice-capture` agent reads only these paths.

| Path | When it is read | Why |
|---|---|---|
| `context/brief.md` | Start of every invocation | Extract section 6 voice notes: tone adjectives, POV, tense, formality register, emulate/avoid lists, and banned tics named during intake |
| Author writing samples (pasted or file path) | When the author supplies them | The primary source material for voice analysis and baseline computation |

## Outputs

The `voice-capture` agent writes only these paths, and only after the author
confirms the draft profile.

| Path | Written when | Contents |
|---|---|---|
| `context/style-profile.md` | After author confirmation | Full operational voice profile per the S-08 section 9 schema, covering all eleven fields: tone, diction, rhythm, POV, tense, do list, do-not list, banned tics, exemplar passages, narrator voice note, and the bootstrapped flag |
| `.studio/config.json` | After the engine run (before profile confirmation) | The `stylometry.baseline.markers` object AND `stylometry.baseline.marker_set_version` number, both printed by `bin/ns-stylometry --measure`, written via read-modify-write; no other config fields are touched |

The numeric baseline in `.studio/config.json` is written when the engine runs
(Path A step 4 or Path B step 6). The profile in `context/style-profile.md` is
written after the author confirms. The `Baseline reference` section of the profile
points at `.studio/config.json -> stylometry.baseline.markers` rather than
duplicating the vector values.

## The two paths

**Path A (writing samples available):** The agent reads `context/brief.md` section
6, accepts up to three author writing passages (200 to 500 words each), analyzes
the marker set, runs `bin/ns-stylometry --measure` to compute the baseline vector,
drafts the profile, and commits with `bootstrapped: false` after author
confirmation.

**Path B (no samples available):** The agent generates three candidate passages
(250 to 350 words each) on the book's topic, each representing a different position
in the voice space suggested by intake preferences. The author reacts to each,
the agent revises toward the feedback, and the loop typically converges in two to
three iterations. Once the author confirms a target passage, Path A's measurement
and commit steps apply, with `bootstrapped: true` and a recommendation to replace
the baseline when own prose becomes available.

## Guardrails

- **Own-prose primacy.** Author writing samples are the authoritative source.
  Generated passages are a bootstrap, never a permanent substitute. A bootstrapped
  profile must surface a recommendation for the author to provide own prose.
- **No profile without a numeric baseline.** `bin/ns-stylometry --measure` must run
  and produce the eight-marker vector before `context/style-profile.md` is
  committed. A profile without the vector leaves the gate unable to score drift.
- **Emulation targets are reference only.** The agent may observe "your sample
  shares an opener pattern with Gawande"; it does not treat an admired author's
  passage as the baseline.
- **Distinguish author voice from narrator voice.** When the author's natural prose
  voice differs from the book's narrator voice (for example, a first-person
  memoirist who has chosen second-person present for the book), both are recorded
  in the profile. The `narrator_voice_note` field is required in that case.
- **CLI via ADR-0005 (bin PATH on Windows).** The agent resolves the plugin
  root first (the variable hooks.json uses is not set in a live Bash shell),
  then invokes the engine as `node "<plugin-root>/bin/ns-stylometry"
  --measure=<paths>` via Bash; bare CLI invocation fails on Windows.

Per A-02 (platform capability baseline), a plugin-shipped agent cannot declare
`hooks`, `permissionMode`, or `mcpServers` in frontmatter; the platform ignores
those fields. Every guardrail above is enforced in the agent's system prompt.

## Natural next step

After `context/style-profile.md` is committed, the `voice-capture` agent names the
available next steps as choices: build the outline with `structure-architect`,
begin drafting with `drafting-partner`, or sharpen the controlling idea with
`thesis-architect`. The profile and baseline are now in place and the gate can
score stylometric drift from the next chapter forward.

## Worked example

See [voice-capture.example.md](./voice-capture.example.md) for a condensed
transcript of a voice-capture session for the sample book "The Quiet Network,"
including the reading of section 6 brief notes, the CLI invocation, the draft
profile, and the confirm-before-commit step.
