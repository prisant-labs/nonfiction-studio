---
title: "nfs-capture-voice skill reference"
description: "Reference for the nfs-capture-voice skill - the voice-capture front door that builds the author's stylometric baseline and previews marker values"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "voice", "stylometry", "profile"]
---

# nfs-capture-voice

The `nfs-capture-voice` skill is the studio's voice-capture front door. It collects writing samples from the author, assesses their word count against the calibration floor, discloses the calibration cost before delegating, delegates all computation and file writes to the `voice-capture` agent, confirms the output files exist via Read checks, relays the agent's regime disclosure, and previews selected baseline marker values in plain language. It is a Phase 1 skill specified in S-06 3.3 (skills and invocation surface) and governed by D-08 (hybrid voice scoring), D-16 (collaborative voice bootstrap), and ADR-0012 (voice verdict scope).

## Purpose

`nfs-capture-voice` builds and calibrates the author's stylometric voice baseline: the numeric anchor the drift scorer uses to detect when a drafted chapter has moved away from the author's natural style, plus the five-rung noise-scale ladder that gives the verdict a null distribution measured on this author's own voice. The baseline is stored in two places that must agree: `context/style-profile.md` (the seven-section human-readable profile the author can edit directly, per `docs/formats/style-profile.md`) and `.studio/config.json` (`stylometry.baseline`: `markers`, `marker_set_version`, `calibration`, `captured`, and `sample_count`).

The skill handles three entry conditions:

- **2,200 or more words submitted**: proceed to delegation; through roughly 3,000 words and beyond, a note that confidence improves with more sample text.
- **Under 2,200 words submitted**: state the exact count, explain that the calibrated baseline needs at least 2,200 words of usable prose, and request more before any computation runs.
- **No samples at all**: offer the three-candidate bootstrap path, which the `voice-capture` agent runs and extends into a calibratable corpus (Path B of the agent's contract) per D-16 (collaborative voice bootstrap).

## Invocation

```
/nonfiction-studio:nfs-capture-voice
```

No argument is required. The skill walks the author through sample submission.

Alternate entry points:
- Via `nfs-interview` Step 6: that skill suggests `nfs-capture-voice` when `context/style-profile.md` is absent after the brief is confirmed
- Via the `nfs-start` dispatcher: routes here when the author says "capture my voice", "set my writing style", or "I have samples to share"
- Re-invocation: when the author wants to refresh a stale baseline or a voice-change decision is logged in `context/decisions.md`

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `context/style-profile.md` | Start of every invocation (Step 1) | Detect an existing profile and offer re-capture or augmentation |
| `context/brief.md` | Before delegation (Step 3) | Genre and tone context passed to the `voice-capture` agent |

### Outputs

All outputs are written by the `voice-capture` agent, not by the skill directly. The numeric baseline is written as soon as calibration completes; the profile is written only after the agent confirms the author approved the draft.

| Path | Written | Contents |
|---|---|---|
| `context/samples/voice-sample-NN.md` | Before calibration runs | Every sample used to compute the baseline, persisted first so `--calibrate` reads real files |
| `context/style-profile.md` | After author confirmation in agent session | Seven-section voice profile per `docs/formats/style-profile.md`: Voice, Diction, Rhythm, Do, Do not, Exemplars, Baseline reference |
| `.studio/config.json` | As soon as calibration completes | `stylometry.baseline`: `markers`, `marker_set_version`, and `calibration` verbatim from `bin/ns-stylometry --calibrate`, plus the agent-supplied `captured` and `sample_count` |

The skill writes no `.studio/` state and no `context/samples/` files itself - both are written by the agent. The captured signal is the presence of a non-empty `context/style-profile.md` on disk; no secondary status field is needed per D-06 (single-writer state discipline).

## Flow Summary

The skill runs six steps in order.

1. **Existing-profile check.** Uses a Bash tool call to detect whether `context/style-profile.md` exists. If so, offers re-capture or augmentation. States the profile's purpose in plain terms in both branches.

2. **Sample collection and word-count assessment.** Asks the author to paste samples. If no samples are provided, offers the bootstrap path and delegates to the agent with a Path B signal. If samples are submitted, uses a Bash tool call to count the total words and branches: under 2,200 words states the exact count, explains the calibration floor in one sentence, and requests more; 2,200 or more proceeds, with a confidence-improves-with-more note continuing through roughly 3,000 words and beyond.

3. **Delegate to the voice-capture agent.** Reads `context/brief.md`, states the one-sentence calibration cost disclosure, then spawns the `voice-capture` agent (the `nfs-capture-voice -> voice-capture` chain edge) with the samples, the brief content, and the word count. The agent persists the samples under `context/samples/`, runs `bin/ns-stylometry --calibrate`, reads `markers`, `marker_set_version`, and `calibration` from stdout plus the two regime-disclosure sentences from stderr, writes `context/style-profile.md`, and writes the full baseline into `.studio/config.json`.

4. **Confirm output files and relay the regime disclosure.** Uses the Read tool on `context/style-profile.md` and `.studio/config.json` to confirm both files are present and contain the expected content, including `calibration`, `captured`, and `sample_count`. Halts and reports clearly if any is missing. Once both checks pass, relays the agent's two regime-disclosure sentences to the author verbatim - never re-derived.

5. **Preview the baseline.** Quotes two or three marker values from the `.studio/config.json` already read in Step 4, in plain language. No additional engine run.

6. **Close with suggestions.** Offers `nfs-outline` or `nfs-interview` as optional next steps based on project state.

## Failure Behavior

If Step 2's word count is under 2,200, the skill waits for more samples. The author may paste additional text; the skill re-counts and re-assesses without restarting. No agent call is made until the threshold is met or the author confirms the bootstrap path.

If the `voice-capture` agent exits without completing, no partial profile is written. The agent's no-profile-without-baseline guardrail ensures `context/style-profile.md` is not committed unless `bin/ns-stylometry --calibrate` ran and returned the full baseline. The Read checks in Step 4 detect the missing or incomplete files and the skill reports clearly. A clean re-run from Step 2 is always safe.

Missing `context/brief.md` is not a blocking error: the skill notes the absence to the agent and continues. The agent will produce a profile from the samples alone without the brief's genre context.

## Worked Example

See [nfs-capture-voice.example.md](./nfs-capture-voice.example.md) for a condensed transcript of a `nfs-capture-voice` run for the sample book "The Quiet Network". The example covers four submitted samples totaling over 3,600 words, the calibration cost disclosure, delegation to the `voice-capture` agent, the two Read-check confirmations, the regime-disclosure relay, and the marker-value preview. The committed `context/style-profile.md` and `.studio/config.json` in `examples/sample-book/` are the live outcome of an equivalent run. For the no-samples bootstrap path, see `agents/voice-capture.md` Path B.
