---
title: "voice-capture agent reference"
description: "Reference for the voice-capture agent - builds the operational voice profile and sets the stylometric baseline"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "intake", "voice", "style-profile", "stylometry"]
---

# voice-capture

The `voice-capture` agent builds the author's operational voice profile and
calibrates the stylometric baseline. It is a Phase 1 Intake-pillar agent specified in
S-01 (intake and context agents) and governed by D-08 (hybrid voice scoring) and
ADR-0012 (voice verdict scope, Decision 3: capture calibrates, not just measures). It
works in tandem with `bin/ns-stylometry`: the engine resamples the corpus, computes,
and prints the vector plus the calibration ladder; the agent writes it into config.

## Purpose

The `voice-capture` agent converts author writing samples, or a confirmed bootstrap
passage plus additional generated passages when no samples exist, into two outputs
that must agree with each other: `context/style-profile.md` (the human-readable
voice contract every other agent reads for craft guidance, in the seven-section
grammar normative in `docs/formats/style-profile.md`) and the full calibrated
baseline - `stylometry.baseline.markers`, `marker_set_version`, `calibration`,
`captured`, and `sample_count` - in `.studio/config.json` (the numeric anchor the
gate uses to score drift, the calibration ladder that gives the verdict a null
distribution measured on this author's own voice, and the version stamp that lets
the drift scorer refuse a baseline captured under a different marker computation).
The numeric baseline is written as soon as calibration completes; the profile is
written only after the author confirms the draft. The agent does not evaluate
whether the captured voice is good; it observes, describes, and records.

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
  the three-passage generation and reaction loop, extended into a calibratable
  corpus.
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
to invoke `bin/ns-stylometry --calibrate` per the ADR-0005 (bin PATH on Windows)
resolution; no other Bash command is permitted, so both the capture timestamp and
the sample count the agent writes are stated directly rather than shelled out to.

## Inputs

The `voice-capture` agent reads only these paths.

| Path | When it is read | Why |
|---|---|---|
| `context/brief.md` | Start of every invocation | Extract section 6 voice notes: tone adjectives, POV, tense, formality register, emulate/avoid lists, and banned tics named during intake |
| Author writing samples (pasted or file path) | When the author supplies them | The primary source material for voice analysis and baseline computation |
| `context/samples/` | On re-invocation | Determine the next free `voice-sample-NN.md` number and fold prior samples into a re-calibration when augmenting |

## Outputs

The `voice-capture` agent writes only these paths. The numeric baseline is
written as soon as calibration completes; the profile is written only after the
author confirms the draft.

| Path | Written when | Contents |
|---|---|---|
| `context/samples/voice-sample-NN.md` | Before calibration runs | Every sample used to compute the baseline, persisted so `--calibrate` reads real files and the profile's `Exemplars` paths resolve |
| `context/style-profile.md` | After author confirmation | Full operational voice profile in the seven-section grammar (`docs/formats/style-profile.md`): Voice, Diction, Rhythm, Do, Do not, Exemplars, Baseline reference |
| `.studio/config.json` | As soon as calibration completes (before profile confirmation) | `stylometry.baseline`: `markers`, `marker_set_version`, and `calibration` verbatim from `bin/ns-stylometry --calibrate` stdout, plus the agent-supplied `captured` (RFC 3339 UTC) and `sample_count`, written via read-modify-write; no other config fields are touched |

The `Baseline reference` section of the profile points at
`.studio/config.json -> stylometry.baseline.markers` rather than duplicating the
vector values, and copies its `captured`/`sample_count` values from what was just
written to config - a single source of truth for both fields, since `bin/ns-doctor`
compares them by exact equality.

## The two paths

**Path A (writing samples available):** The agent reads `context/brief.md` section
6, accepts the samples the invoking skill already assessed against the roughly
2,200-word calibration floor, persists them under `context/samples/`, runs
`bin/ns-stylometry --calibrate` to compute the baseline vector and the five-rung
calibration ladder, writes the full baseline to config, drafts the profile, and
commits with `bootstrapped: false` after author confirmation.

**Path B (no samples available):** The agent generates three candidate passages
(250 to 350 words each) on the book's topic, each representing a different position
in the voice space suggested by intake preferences. The author reacts to each,
the agent revises toward the feedback, and the loop typically converges in two to
three iterations. Once the author confirms a target passage, the agent generates
additional passages in that confirmed voice until the corpus totals at least
2,400 words, presents them for one skim-confirm round, persists all of them, and
calibrates over the full generated corpus - a single 250-to-350-word passage can
never clear the calibration floor. Path A's write and commit steps apply, with
`bootstrapped: true` and a recommendation to replace the baseline when own prose
becomes available.

## Guardrails

- **Own-prose primacy.** Author writing samples are the authoritative source.
  Generated passages are a bootstrap, never a permanent substitute. A bootstrapped
  profile must surface a recommendation for the author to provide own prose.
- **No profile without a full calibrated baseline.** `bin/ns-stylometry
  --calibrate` must run and return `markers`, `marker_set_version`, and
  `calibration` before `context/style-profile.md` is committed. A profile without
  the full baseline leaves the gate unable to score drift.
- **Persist before calibrating.** Pasted text and generated passages are written
  to `context/samples/voice-sample-NN.md` before `--calibrate` runs, never handed
  to the engine directly - a sample the doctor cannot resolve as an Exemplars
  path is not a usable sample.
- **Emulation targets are reference only.** The agent may observe "your sample
  shares an opener pattern with Gawande"; it does not treat an admired author's
  passage as the baseline.
- **Distinguish author voice from narrator voice.** When the author's natural prose
  voice differs from the book's narrator voice (for example, a first-person
  memoirist who has chosen second-person present for the book), both are recorded
  in the profile. A `narrator-voice-note` bullet in `## Voice` is required in that
  case.
- **Regime disclosure relayed, never re-derived.** The engine's stderr carries
  two plain-language sentences naming the assigned regime (chapter-scale or
  book-scale verdicts) and why. The agent carries both verbatim into its
  completion report; it does not rephrase or recompute the regime call.
- **CLI via ADR-0005 (bin PATH on Windows).** The agent resolves the plugin
  root first (the variable hooks.json uses is not set in a live Bash shell),
  then invokes the engine as `node "<plugin-root>/bin/ns-stylometry"
  --calibrate=<paths>` via Bash; bare CLI invocation fails on Windows.

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
