---
title: "nfs-capture-voice skill reference"
description: "Reference for the nfs-capture-voice skill - the voice-capture front door that builds the author's stylometric baseline and previews marker values"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "voice", "stylometry", "profile"]
---

# nfs-capture-voice

The `nfs-capture-voice` skill is the studio's voice-capture front door. It collects writing samples from the author, assesses their word count, delegates all computation and file writes to the `voice-capture` agent, confirms the two output files exist via Read checks, and previews selected baseline marker values in plain language. It is a Phase 1 skill specified in S-06 3.3 (skills and invocation surface) and governed by D-08 (hybrid voice scoring) and D-16 (collaborative voice bootstrap).

## Purpose

`nfs-capture-voice` builds the author's stylometric voice baseline: the numeric anchor the drift scorer uses to detect when a drafted chapter has moved away from the author's natural style. The baseline is stored in two places: `context/style-profile.md` (the eleven-field human-readable profile the author can edit directly) and `.studio/config.json` (the `stylometry.baseline.markers` block the CLI tools read, alongside `stylometry.baseline.marker_set_version`, which the drift scorer checks before trusting the markers).

The skill handles three entry conditions:

- **1,000 or more words submitted**: proceed directly to delegation.
- **500 to 999 words submitted**: proceed with a stated caution that confidence improves with more samples.
- **Fewer than 500 words submitted**: request more before any computation runs.
- **No samples at all**: offer the three-candidate bootstrap path, which the `voice-capture` agent runs (Path B of the agent's contract) per D-16 (collaborative voice bootstrap).

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

All outputs are written by the `voice-capture` agent, not by the skill directly. Neither file is written until the agent confirms the author approved the draft profile.

| Path | Written | Contents |
|---|---|---|
| `context/style-profile.md` | After author confirmation in agent session | Eleven-field voice profile: tone, diction, rhythm, POV, tense, do list, do-not list, banned tics, exemplar passages, narrator voice note, bootstrapped flag |
| `.studio/config.json` | Alongside the profile | `stylometry.baseline.markers` block AND `stylometry.baseline.marker_set_version` number, both printed by `bin/ns-stylometry --measure` |

The skill writes no `.studio/` state. The captured signal is the presence of a non-empty `context/style-profile.md` on disk; no secondary status field is needed per D-06 (single-writer state discipline).

## Flow Summary

The skill runs six steps in order.

1. **Existing-profile check.** Uses a Bash tool call to detect whether `context/style-profile.md` exists. If so, offers re-capture or augmentation. States the profile's purpose in plain terms in both branches.

2. **Sample collection and word-count assessment.** Asks the author to paste samples. If no samples are provided, offers the bootstrap path and delegates to the agent with a Path B signal. If samples are submitted, uses a Bash tool call to count the total words and branches: fewer than 500 requests more; 500 to 999 proceeds with a stated caution; 1,000 or more proceeds without a caution.

3. **Delegate to the voice-capture agent.** Reads `context/brief.md`, then spawns the `voice-capture` agent (the `nfs-capture-voice -> voice-capture` chain edge) with the samples, the brief content, and the word-count band. The agent runs `bin/ns-stylometry --measure`, reads the vector and the `marker_set_version` number from stdout, writes `context/style-profile.md`, and writes the baseline markers and marker_set_version into `.studio/config.json`.

4. **Confirm output files.** Uses the Read tool on `context/style-profile.md` and `.studio/config.json` to confirm both files are present and contain the expected content. Halts and reports clearly if either is missing.

5. **Preview the baseline.** Quotes two or three marker values from the `.studio/config.json` already read in Step 4, in plain language. No additional engine run.

6. **Close with suggestions.** Offers `nfs-outline` or `nfs-interview` as optional next steps based on project state.

## Failure Behavior

If Step 2's word count is below 500, the skill waits for more samples. The author may paste additional text; the skill re-counts and re-assesses without restarting. No agent call is made until the threshold is met or the author confirms the bootstrap path.

If the `voice-capture` agent exits without completing, no partial profile is written. The agent's no-profile-without-baseline guardrail ensures `context/style-profile.md` is not committed unless `bin/ns-stylometry --measure` ran and returned a complete vector. The Read checks in Step 4 detect the missing or incomplete files and the skill reports clearly. A clean re-run from Step 2 is always safe.

Missing `context/brief.md` is not a blocking error: the skill notes the absence to the agent and continues. The agent will produce a profile from the samples alone without the brief's genre context.

## Worked Example

See [nfs-capture-voice.example.md](./nfs-capture-voice.example.md) for a condensed transcript of a `nfs-capture-voice` run for the sample book "The Quiet Network". The example covers three submitted samples totaling over 1,000 words, delegation to the `voice-capture` agent, the two Read-check confirmations, and the marker-value preview. The committed `context/style-profile.md` and `.studio/config.json` in `examples/sample-book/` are the live outcome of this run. For the no-samples bootstrap path, see `agents/voice-capture.md` Path B.
