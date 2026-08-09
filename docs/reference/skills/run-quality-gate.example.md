---
title: "run-quality-gate worked example"
description: "Condensed transcript of a run-quality-gate session over a temp clone of the committed Chapter 2 of The Quiet Network - shows the baseline pre-check, the degraded four-check pass, the single ns-gate Bash call, exit-code mapping, and the presented warn-free pass verdict"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "gate", "quality", "deterministic", "claims", "scrub", "example"]
---

# run-quality-gate - worked example

This is a condensed transcript of a `run-quality-gate` session over Chapter 2 (Finding Your Network, slug `02-finding-your-network`) of the sample book "The Quiet Network" (see `examples/sample-book/`). The example follows the flow specified in S-06 3.8 (skills and invocation surface) and the adjudications recorded in TSK-051 (run-quality-gate skill).

**Session provenance note.** This example is grounded in a live gate run executed 2026-07-19 over a temp clone of the committed `examples/sample-book/` baseline at `<temp-dir>`. The run was performed by removing `context/style-profile.md` from the temp clone before invoking the gate, so the skill's baseline pre-check triggers the degraded four-check subset (`claims,scrub,continuity-quick,coherence`). The gate was invoked as `node bin/ns-gate --chapter=02-finding-your-network --check=claims,scrub,continuity-quick,coherence --json`; it exited 0 with verdict `pass`. The JSON output is quoted verbatim. The committed sample-book fixture is never modified by a gate run; the report was written to the temp-clone's `.studio/gate/` directory (not to the committed fixture).

Any scenario showing a `block` verdict or exit 1 is explicitly synthetic and does not reflect the committed fixture or the live run output.

---

## Setup: what was already in place

`chapters/02-finding-your-network.md` is the committed Chapter 2 fixture. It carries 5 claim markers (EV-0006 through EV-0010), all referencing EV entries whose `status` is `verified` in `research/evidence-log.md`. The `.studio/config.json` contains `stylometry.baseline.markers`, but `context/style-profile.md` was absent from the temp clone (removed before the run to demonstrate the baseline pre-check path).

`.studio/progress.json` shows Chapter 2 with `status: drafted` and `last_gate: null` (no prior gate run for this chapter in the fixture).

---

## Session: Chapter 2 gate run, baseline absent, four-check subset

**Author:** `/nonfiction-studio:run-quality-gate 02-finding-your-network`

**Studio (Step 1 - Argument parsing and deep argument check):**

Argument tokens: `["02-finding-your-network"]`. No `deep` token is present. Chapter token: `02-finding-your-network`. Continue to Step 2.

**Studio (Step 2 - Chapter resolution):**

A chapter argument was supplied. The skill uses the Bash tool:

```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```

Output: `HAS_REGISTRY`

The skill uses the Read tool on `structure/chapter-list.md`. The argument `02-finding-your-network` matches the slug in row 2:

```
| 2 | 02-finding-your-network | Finding Your Network | drafted | 462 |
```

Chapter resolved: number 2, working title "Finding Your Network", slug `02-finding-your-network`.

The skill uses the Bash tool:

```
test -f chapters/02-finding-your-network.md && echo HAS_CHAPTER || echo NO_CHAPTER
```

Output: `HAS_CHAPTER`

Chapter file confirmed present. Continue to Step 3.

**Studio (Step 3 - Voice baseline pre-check):**

The skill uses the Bash tool:

```
test -f context/style-profile.md && echo HAS_PROFILE || echo NO_PROFILE
```

Output: `NO_PROFILE`

**Studio:**

> Voice drift check skipped: `context/style-profile.md` was not found. The gate will run claim coverage, prompt scrub, continuity, and state coherence checks only. Capture your voice baseline with `/nonfiction-studio:capture-voice` to enable voice drift detection.

Check subset set to `claims,scrub,continuity-quick,coherence`. Continue to Step 4.

**Studio (Step 4 - Gate invocation):**

The skill uses the Bash tool (this is the single ns-gate call; no individual CLI invocations are made):

```
node bin/ns-gate --chapter=02-finding-your-network --check=claims,scrub,continuity-quick,coherence --json
```

**Gate stdout (verbatim, exit code 0):**

```json
{
  "version": 2,
  "chapter": "02-finding-your-network",
  "ts": "2026-07-19T08:27:18Z",
  "verdict": "pass",
  "checks": [
    {
      "check": "claim_coverage",
      "verdict": "pass",
      "detail": "claim coverage 100%; no open markers",
      "evidence": [],
      "next": null
    },
    {
      "check": "prompt_scrub",
      "verdict": "pass",
      "detail": "no agent scaffolding or prompt residue found",
      "evidence": [],
      "next": null
    },
    {
      "check": "continuity",
      "verdict": "pass",
      "detail": "no name consistency issues found",
      "evidence": [],
      "next": null
    },
    {
      "check": "state_coherence",
      "verdict": "pass",
      "detail": "word-count coherence pass; no mismatch between chapters and progress.json",
      "evidence": [],
      "next": null
    },
    {
      "check": "session_write_flag",
      "verdict": "skip",
      "detail": "no chapter writes detected in this session; gate.no-write",
      "evidence": [],
      "next": null
    }
  ]
}
```

Gate exit code: 0. Parse stdout as JSON report. Top-level `verdict: pass`.

**Studio:**

> Gate verdict: PASS for `chapters/02-finding-your-network.md`.
>
> | Check | Verdict | Detail |
> |---|---|---|
> | claim_coverage | pass | claim coverage 100%; no open markers |
> | prompt_scrub | pass | no agent scaffolding or prompt residue found |
> | continuity | pass | no name consistency issues found |
> | state_coherence | pass | word-count coherence pass; no mismatch between chapters and progress.json |
> | session_write_flag | skip | no chapter writes detected in this session |
>
> Note: voice drift (stylometry) was skipped because `context/style-profile.md` was not found. Run `/nonfiction-studio:capture-voice` to establish a baseline and enable drift detection.
>
> This verdict is the deterministic layer only. On CLI and Cowork the Stop hook additionally runs a thesis-alignment judgment prompt (warn-only); that layer is not part of this skill invocation and does not exist in v1 on chat.
>
> Gate report written to `.studio/gate/02-finding-your-network.<ts>.json` by ns-gate.
>
> Chapter 2 is clear on the four checked dimensions. Suggested next steps:
> - Run `/nonfiction-studio:capture-voice` to establish a voice baseline, then re-run the full gate.
> - Continue to the next chapter: `/nonfiction-studio:draft-chapter 03-your-curation-practice` (or the next slug from `structure/chapter-list.md`).

---

## Key assertions from this transcript

- **Step 1 argument check is prose-only.** No tool call is needed to detect the `deep` token or extract the chapter token from the argument. The skill branches without accessing the file system.

- **Chapter file probe is a tool call.** The Bash call on `chapters/02-finding-your-network.md` produces the `HAS_CHAPTER`/`NO_CHAPTER` token before any other work proceeds. No prose inference substitutes for the tool result.

- **Baseline pre-check is a tool call.** The Bash call on `context/style-profile.md` produces `NO_PROFILE`, which deterministically selects the degraded check subset. The skill does not infer whether a baseline exists from conversation context.

- **ONE Bash call invokes the gate.** The skill issues a single Bash call to `node bin/ns-gate --chapter=02-finding-your-network --check=claims,scrub,continuity-quick,coherence --json`. No individual calls to `bin/ns-claims`, `bin/ns-stylometry`, or `bin/ns-scrub` are made by the skill; the orchestrator composes them internally.

- **Exit 0 maps to a presented verdict, never silent.** The skill parsed stdout as JSON, identified `verdict: pass`, and presented the full per-check table plus the voice-drift-skipped note. A pass verdict is never silently swallowed; the author always sees the result.

- **The verdict is stated as deterministic-only.** The skill's output explicitly names that thesis-alignment judgment (warn-only, CLI and Cowork only) is not part of this invocation. On chat in v1 no judgment layer exists.

- **The skill writes no `.studio/` state.** Only `bin/ns-gate` wrote a file (the gate report at `.studio/gate/02-finding-your-network.<ts>.json` inside the temp clone). No `progress.json` write occurred; the `last_gate` per-chapter field is reserved and unpopulated in v1.

- **Gate runs write reports; never run against committed fixtures.** The run was performed over a temp clone at `<temp-dir>`, not against `examples/sample-book/` in place. The committed fixture is never touched by a gate run.

- **Voice drift warning is non-halting.** The absence of `context/style-profile.md` did not stop the gate run; it changed the check subset and added a warning. The four remaining checks all passed.

---

## Synthetic illustration: what a warn verdict looks like

The following is explicitly a synthetic illustration and does NOT reflect the committed sample-book fixture. It shows what Step 4 would report if the full gate (including stylometry) were run and the voice drift check fired a warn:

> Gate verdict: WARN for `chapters/02-finding-your-network.md`. The gate ran without a blocking condition (exit 0). Voice drift is warn-only by default; coverage and scrub issues block only when blocking mode is explicitly enabled.
>
> | Check | Verdict | Detail | Next action |
> |---|---|---|---|
> | claim_coverage | pass | claim coverage 100%; no open markers | - |
> | stylometry | warn | drift score 222.38 exceeds threshold 35; stylometry.drift-threshold | Review the flagged markers against the voice baseline and revise the drifted chapter. |
> | prompt_scrub | pass | no agent scaffolding or prompt residue found | - |
> | continuity | pass | no name consistency issues found | - |
> | state_coherence | pass | word-count coherence pass | - |
> | session_write_flag | skip | no chapter writes detected in this session | - |
>
> To address the stylometry warn: revise the chapter with `/nonfiction-studio:revise-pass 02-finding-your-network`, then re-run the quality gate. To opt stylometry into blocking mode once the baseline is calibrated, set `gate.checks.stylometry.mode` to `block` in `.studio/config.json`.

The drift score of 222.38 in this synthetic illustration is consistent with a verified fresh run: `node bin/ns-gate --project=. --chapter=02-finding-your-network --json` over a clean clone of the committed sample book yields exactly this score, because a single chapter's marker vector naturally deviates from the book-aggregate baseline. The committed Chapter 2 is a teaching fixture; the high drift score reflects the fact that the sample-book baseline was set for illustrative purposes, not for a calibrated voice capture. The primary provenance-honest example above (four-check pass with baseline absent) is the grounded transcript.

---

## Synthetic illustration: what a block verdict looks like

The following is explicitly synthetic. It shows what Step 4 would report on exit 1 if a chapter had uncovered claim markers:

> Gate verdict: BLOCK for `chapters/03-your-curation-practice.md`. The chapter cannot proceed until the blocking conditions below are resolved.
>
> **Blocking checks:**
>
> | Check | Detail | Evidence | Next action |
> |---|---|---|---|
> | claim_coverage | 2 open claim(s); claim_coverage.unresolved | chapters/03-your-curation-practice.md#L44, chapters/03-your-curation-practice.md#L61 | Add a `[claim: EV-nnnn]` marker or tag the sentence `[UNVERIFIED]` to resolve each open claim. |
>
> Run `/nonfiction-studio:fact-check-pass 03-your-curation-practice` to resolve open claims, then re-run the quality gate.

This synthetic block transcript shows the exit-1 path and the per-check `evidence` and `next` fields from the S-08 section 11 report shape. No claim-coverage block exists in the committed sample-book fixture.
