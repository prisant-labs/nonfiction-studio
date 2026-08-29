---
name: nfs-capture-voice
user-invocable: true
argument-hint: ""
description: "Builds the author's stylometric voice baseline from writing samples, producing context/style-profile.md and the vector that bin/ns-stylometry uses for drift scoring per D-08 (hybrid voice scoring). When no samples are available, delegates to the voice-capture agent's three-candidate bootstrap path per D-16 (collaborative voice bootstrap). Use when the author says 'capture my voice,' 'does this sound like me,' or wants to 'match my writing style' before drafting begins."
when_to_use: "Use when the author says 'capture my voice', 'set my writing style', or 'I have samples to share'; accepts the capture-voice suggestion from intake-interview; re-invokes to refresh a stale baseline after a voice-change decision is logged in context/decisions.md; or reports context/style-profile.md missing. Do not invoke for unrelated queries or when the author has a current, confirmed style profile and no intent to update it."
chain:
  - voice-capture
---

This skill is the voice-capture front door. It orients the author to the profile's purpose, collects writing samples, assesses their word count, delegates all computation and file writes to the `voice-capture` agent, confirms the two output files via Read checks, and previews selected baseline marker values in plain language. The `voice-capture` agent performs all computation and all writes.

Skill inputs read:
- `context/style-profile.md` (checked at Step 1 to detect an existing profile; flat path)
- `context/brief.md` (genre and tone context; read at Step 3 and passed to the agent)

Skill chain edge: `nfs-capture-voice -> voice-capture` per `agents/_chain-permitted.yaml`.

## Step 1 - Existing-profile check and profile orientation (mandatory first tool call)

Use the Bash tool to run:
```
test -f context/style-profile.md && echo HAS_PROFILE || echo NO_PROFILE
```

Branch on the output:
- `HAS_PROFILE`: a voice profile already exists. Ask whether to replace the baseline entirely (re-capture from new samples) or augment the existing baseline by adding new samples. Wait for the author's choice before continuing.
- `NO_PROFILE`: continue to Step 2.

In both cases, state in plain terms what the voice profile does: it is the numeric baseline the drift scorer uses to detect when a chapter has moved away from the author's natural style. It is a description of how the author writes, not a prescriptive set of rules. Authors can edit the written do and do-not rules directly in `context/style-profile.md` at any time.

## Step 2 - Collect samples and assess word count (mandatory Bash tool call after submission)

Ask the author to paste two to five writing samples in their own prose voice, targeting a combined total of at least 1,000 words. Note these two points to the author:
- Own prose is the primary source. Passages from admired authors are accepted as reference observations only and are not used to compute the baseline.
- If the author has no writing samples of their own at all, they should say so now.

After the author responds, branch immediately:

**No samples submitted:** state that a bootstrapped baseline carries lower initial confidence than one derived from the author's own prose. Ask the author to confirm they want to proceed with the three-candidate bootstrap path. On confirmation, continue to Step 3 with the Path B signal; skip the word count assessment entirely.

**Samples submitted:** use the Bash tool to count the total words in the submitted text. Branch on the count:
- **Fewer than 500 words**: state the exact count returned by the tool. Request more samples before proceeding. Do not delegate to the agent. The author may paste additional text; re-count and re-assess.
- **500 to 999 words**: state the count and add this note: "A baseline computed from [N] words will work. Confidence in the computed markers improves with more samples; consider re-running capture-voice after writing a few chapters to strengthen the baseline." Continue to Step 3.
- **1,000 or more words**: continue to Step 3.

## Step 3 - Load brief context and delegate to the voice-capture agent

Use the Read tool on `context/brief.md` to load genre and tone context. If the file is missing, proceed without it and note to the agent that no brief is present.

Spawn the `voice-capture` agent via the `nfs-capture-voice -> voice-capture` chain edge, passing:
- All submitted samples (pasted text or the paths if already on disk), or the Path B instruction if no samples were provided
- The content of `context/brief.md` (or a note that it is absent)
- The word-count band from Step 2, or the Path B signal

The agent handles all computation and all file writes:
- `bin/ns-stylometry --measure` computes and prints the baseline vector, alongside a `marker_set_version` number; the agent reads both from stdout
- The agent writes `context/style-profile.md` with the full eleven-field profile
- The agent writes both `stylometry.baseline.markers` and `stylometry.baseline.marker_set_version` into `.studio/config.json` via read-modify-write semantics. A baseline saved without `marker_set_version` is one the drift scorer will refuse to score against.

This skill writes neither file. Do not instruct the agent to write `.studio/progress.json` or any other `.studio/` path beyond `config.json`.

## Step 4 - Confirm output files (two Read checks, mandatory tool calls)

After the agent completes, use the Read tool twice:

1. Read `context/style-profile.md`. If the file is absent or empty, report that the profile was not written. Note that no partial profile exists: the agent's no-profile-without-baseline guardrail ensures `context/style-profile.md` is not committed unless `bin/ns-stylometry --measure` ran and returned a vector. Ask the author to re-run from Step 2.

2. Read `.studio/config.json`. Confirm both `stylometry.baseline.markers` and `stylometry.baseline.marker_set_version` are present. If either is absent, report the missing or incomplete baseline and ask the author to re-run: a baseline with `markers` but no `marker_set_version` looks complete but will be rejected the first time anything scores against it.

Continue to Step 5 only when both checks pass.

## Step 5 - Preview the baseline

Using the marker values already present in the `.studio/config.json` read in Step 4, describe two or three markers in plain language. No additional engine run; no scoring of a single sentence.

State the specific numeric values and say what they characterize. Examples of the form to use:
- "Mean sentence length: 13.2 words. That places the prose at the shorter, more direct end of the trade non-fiction range."
- "Second-person rate: 3.4 per hundred words. Any chapter that drops significantly below this will flag in drift scoring."

Choose the markers that best represent this author's measured style. The goal is concrete evidence that the profile is grounded in the author's own prose.

## Step 6 - Close with suggestions

State that the voice baseline is in place. Offer optional next steps based on project state:
- If `context/brief.md` exists and is confirmed: suggest `nfs-outline` to build the chapter-by-chapter structure.
- If no brief exists: suggest `nfs-interview` to complete the project brief first.

Name the invocation paths:
- `/nonfiction-studio:nfs-outline`
- `/nonfiction-studio:nfs-interview`

Neither suggestion is mandatory or sequential.

---

## Failure behavior

**Insufficient samples.** If Step 2's word count falls below 500, the skill waits for more samples. The author may paste additional text; the skill re-counts and re-assesses without restarting. No agent call is made and no files are written until the threshold is met or the author confirms the bootstrap path.

**Mid-capture failure.** If the voice-capture agent exits without completing, no partial profile is written. The agent's no-profile-without-baseline guardrail ensures `context/style-profile.md` is not committed unless the numeric baseline is in place. The Read checks in Step 4 detect the missing or incomplete files and the skill reports the failure clearly. A clean re-run from Step 2 is always safe.

**Read check failure.** If either Read check in Step 4 fails after the agent completes, state which file is missing, confirm no partial state was written, and offer a clean restart. Do not present the situation as a partial success.
