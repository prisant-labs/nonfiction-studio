---
name: nfs-capture-voice
user-invocable: true
argument-hint: ""
description: "Builds and calibrates the author's stylometric voice baseline from writing samples, producing context/style-profile.md and the calibrated marker vector that bin/ns-stylometry uses for drift scoring per D-08 (hybrid voice scoring). When no samples are available, delegates to the voice-capture agent's three-candidate bootstrap path per D-16 (collaborative voice bootstrap). Use when the author says 'capture my voice,' 'does this sound like me,' or wants to 'match my writing style' before drafting begins."
when_to_use: "Use when the author says 'capture my voice', 'set my writing style', or 'I have samples to share'; accepts the nfs-capture-voice suggestion from nfs-interview; re-invokes to refresh a stale baseline after a voice-change decision is logged in context/decisions.md; or reports context/style-profile.md missing. Do not invoke for unrelated queries or when the author has a current, confirmed style profile and no intent to update it."
chain:
  - voice-capture
---

This skill is the voice-capture front door. It orients the author to the profile's purpose, collects writing samples, assesses their word count against the calibration floor, discloses the calibration cost before delegating, delegates all computation and file writes to the `voice-capture` agent, confirms the output files via Read checks, relays the agent's regime disclosure, and previews selected baseline marker values in plain language. The `voice-capture` agent performs all computation and all writes.

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

Before this flow's first write (Step 3's delegation), take the ai-use-log.jsonl count snapshot described in Step 6's Compliance append section for `context/style-profile.md` and `.studio/config.json`.

## Step 2 - Collect samples and assess word count (mandatory Bash tool call after submission)

Ask the author to paste two to five writing samples in their own prose voice, targeting a combined total of at least 2,200 words. Note these three points to the author:
- Own prose is the primary source. Passages from admired authors are accepted as reference observations only and are not used to compute the baseline.
- The calibrated baseline needs at least 2,200 words of usable prose to measure natural same-voice variation with any confidence; that is a floor the calibration step enforces, not a stylistic preference.
- If the author has no writing samples of their own at all, they should say so now.
- If some samples represent clearly different kinds of writing (a personal anecdote, a how-to passage, a reflective aside), mentioning which is which is entirely optional and does not affect the word-count assessment below. It only matters later, in Step 3, if it turns out there is enough of each kind for optional register-level diagnostics.

After the author responds, branch immediately:

**No samples submitted:** state that a bootstrapped baseline carries lower initial confidence than one derived from the author's own prose. Ask the author to confirm they want to proceed with the three-candidate bootstrap path. On confirmation, continue to Step 3 with the Path B signal; skip the word count assessment entirely.

**Samples submitted:** use the Bash tool to count the total words in the submitted text. Branch on the count:
- **Under 2,200 words**: state the exact count returned by the tool. Explain, in one plain sentence, that the calibrated baseline needs at least 2,200 words of usable prose to measure natural same-voice variation. Request more samples before proceeding. Do not delegate to the agent. The author may paste additional text; re-count and re-assess on each addition.
- **2,200 words or more, under roughly 3,000**: state the count and continue to Step 3, adding this note: "Confidence in the calibrated baseline improves with more sample text; consider re-running capture-voice after writing a few chapters to strengthen it further."
- **Roughly 3,000 words or more**: state the count and continue to Step 3. The count alone is sufficient and no additional note is needed.

## Step 3 - Load brief context and delegate to the voice-capture agent

Use the Read tool on `context/brief.md` to load genre and tone context. If the file is missing, proceed without it and note to the agent that no brief is present.

Before delegating, state one sentence of cost disclosure: calibration resamples the corpus a large, fixed number of times to measure natural same-voice variation, and this takes real time - seconds to roughly a minute, proportional to corpus size.

**Register bucketing eligibility (silent unless eligible).** If the author labeled two or more sample groups while submitting in Step 2, use the Bash tool to count words in each labeled group separately. When two or more groups each reach at least 300 words, note this as an eligible register-bucketing addendum to forward to the agent. When fewer than two groups qualify - including when the author gave no labels at all - say nothing about register bucketing; continue exactly as if it had never come up. This is never a blocker: the addendum, when eligible, rides along with the delegation below and never changes what happens in the rest of this step.

Spawn the `voice-capture` agent via the `nfs-capture-voice -> voice-capture` chain edge, passing:
- All submitted samples (pasted text or the paths if already on disk), or the Path B instruction if no samples were provided
- The content of `context/brief.md` (or a note that it is absent)
- The word count from Step 2, or the Path B signal
- The eligible register-label groupings identified above, when they qualify (a name plus its member samples per group); omitted entirely, with no question asked, when they do not qualify

The agent handles all computation and all file writes:
- The agent persists every sample used for calibration to `context/samples/voice-sample-NN.md` before calibrating, so the profile's `Exemplars` paths resolve
- `bin/ns-stylometry --calibrate` computes and prints the eight-marker vector, `marker_set_version`, and the five-rung calibration ladder (ADR-0012, voice verdict scope); the agent reads all of it from stdout, plus two plain-language regime-disclosure sentences from stderr
- The agent writes `context/style-profile.md` in the seven-section grammar (`docs/formats/style-profile.md`)
- The agent writes the full baseline - `markers`, `marker_set_version`, `calibration`, `captured`, `sample_count`, and `method` - into `.studio/config.json` `stylometry.baseline` via read-modify-write semantics. A baseline missing any of `marker_set_version`, `calibration`, `captured`, or `sample_count` is one the drift scorer or the doctor will reject or flag.
- When eligible register groupings were forwarded, the agent additionally measures each group and writes `stylometry.registers` as an optional addendum, strictly after the baseline write above succeeds. This never gates, delays, or replaces the baseline or profile writes; its absence changes nothing else in this skill's flow.

This skill writes neither file. Do not instruct the agent to write `.studio/progress.json` or any other `.studio/` path beyond `config.json` and `context/samples/`.

## Step 4 - Confirm output files and relay the regime disclosure (two Read checks, mandatory tool calls)

After the agent completes, use the Read tool twice:

1. Read `context/style-profile.md`. If the file is absent or empty, report that the profile was not written. Note that no partial profile exists: the agent's no-profile-without-baseline guardrail ensures `context/style-profile.md` is not committed unless `bin/ns-stylometry --calibrate` ran and returned the full baseline. Ask the author to re-run from Step 2.

2. Read `.studio/config.json`. Confirm `stylometry.baseline.markers`, `stylometry.baseline.marker_set_version`, `stylometry.baseline.calibration`, `stylometry.baseline.captured`, and `stylometry.baseline.sample_count` are all present. If any is absent, report the missing or incomplete baseline and ask the author to re-run: a baseline missing `calibration` or either of the two agent-supplied fields looks complete at a glance but will be rejected or flagged the first time anything scores against it or the doctor checks it.

Once both checks pass, relay the two regime-disclosure sentences the agent reported (which regime the baseline supports - chapter-scale or book-scale verdicts - and why) to the author VERBATIM. This skill never re-derives the regime call from the calibration numbers; it only relays what the engine's own stderr disclosure said, as carried forward by the agent's completion report.

Continue to Step 5 only when both Read checks pass.

## Step 5 - Preview the baseline

Using the marker values already present in the `.studio/config.json` read in Step 4, describe two or three markers in plain language. No additional engine run; no scoring of a single sentence.

State the specific numeric values and say what they characterize. Examples of the form to use:
- "Mean sentence length: 13.2 words. That places the prose at the shorter, more direct end of the trade non-fiction range."
- "Second-person rate: 3.4 per hundred words. Any chapter that drops significantly below this will flag in drift scoring."

Choose the markers that best represent this author's measured style. The goal is concrete evidence that the profile is grounded in the author's own prose.

## Step 6 - Compliance append and close with suggestions

### Compliance append (verify-then-append)

This flow's writes may already be logged automatically by a hook on this surface; this skill never assumes which surfaces do or do not fire that hook, and it never assumes the flow is running on any particular surface. Before this flow's first write, read `.studio/ai-use-log.jsonl` and count how many records currently target each file this flow is about to write (the file's path appearing in that record's `targets` array). Hold that starting count per file. After this flow's writes complete, re-read `.studio/ai-use-log.jsonl` and count the records targeting each of those files again. For each file: if the count increased between the two reads, a hook already appended a record for this write on this surface, and this skill appends nothing further for that file. If the count did not increase, append the flow's record or records for that file to `.studio/ai-use-log.jsonl`, per the record template below, using the six-field shape in `docs/formats/ai-use-log.md` (S-08 section 5): `ts`, `agent`, `surface`, `scope`, `targets`, `summary` - with `surface` set honestly to the surface this flow is actually running on. A record already sitting in the log before this flow started, from an earlier session, does not by itself suppress the append; only a count increase observed between this flow's own two reads does. This skill never appends twice for the same write.

**Record template for this flow.** One record covering both files the `voice-capture` agent wrote (per the count-delta check above):

```json
{"ts":"<RFC 3339 UTC>","agent":"voice-capture","surface":"<actual surface>","scope":"mechanical","targets":["context/style-profile.md",".studio/config.json"],"summary":"Captured the author's stylometric voice baseline into the style profile and config.json."}
```

`surface` is `claude-code`, `cowork`, or `chat` per `docs/formats/ai-use-log.md` - whichever this flow is actually running on. Neither `context/style-profile.md` nor `.studio/config.json` is watched by the PostToolBatch hook (it watches only `chapters/`), so the count-delta check above finds no prior coverage on any surface and this skill appends the record every time.

State that the voice baseline is in place. If the agent reported writing any `stylometry.registers` buckets, name them here in one plain sentence (for example, "anecdotal and instructional register vectors were also captured, for diagnostic `--by-register` comparisons only - they carry no blocking verdict"). If register bucketing did not run, say nothing about it: this is a silent skip, not a reported gap.

Offer optional next steps based on project state:
- If `context/brief.md` exists and is confirmed: suggest `nfs-outline` to build the chapter-by-chapter structure.
- If no brief exists: suggest `nfs-interview` to complete the project brief first.

Name the invocation paths:
- `/nonfiction-studio:nfs-outline`
- `/nonfiction-studio:nfs-interview`

Neither suggestion is mandatory or sequential.

---

## Failure behavior

**Insufficient samples.** If Step 2's word count falls under 2,200, the skill waits for more samples. The author may paste additional text; the skill re-counts and re-assesses without restarting. No agent call is made and no files are written until the threshold is met or the author confirms the bootstrap path.

**Mid-capture failure.** If the voice-capture agent exits without completing, no partial profile is written. The agent's no-profile-without-baseline guardrail ensures `context/style-profile.md` is not committed unless the numeric baseline is in place. The Read checks in Step 4 detect the missing or incomplete files and the skill reports the failure clearly. A clean re-run from Step 2 is always safe.

**Read check failure.** If either Read check in Step 4 fails after the agent completes, state which file is missing, confirm no partial state was written, and offer a clean restart. Do not present the situation as a partial success.

**Register bucketing never affects baseline success or failure.** It is an optional addendum the agent attempts only after the baseline write has already succeeded (see Step 3). Whether it ran, was skipped, or produced fewer buckets than forwarded has no bearing on Step 4's two mandatory Read checks or on whether this skill reports the capture as successful.
