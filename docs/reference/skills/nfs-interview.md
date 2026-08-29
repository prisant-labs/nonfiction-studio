---
title: "nfs-interview skill reference"
description: "Reference for the intake-interview skill - the interview front door that produces a confirmed project brief"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "intake", "interview", "brief"]
---

# nfs-interview

The `nfs-interview` skill is the studio's interview front door. It conducts the adaptive intake interview, coordinates per-section DRAFT-block flushing to `context/brief.md` across sessions, and produces the confirmed project brief that every other skill and agent reads. It is a Phase 1 skill specified in S-06 3.2 (skills and invocation surface) and governed by D-16 (honest, resumable interview).

## Purpose

`nfs-interview` orchestrates the conversational intake interview for a book project. It delegates the actual interview to the `interviewer` agent, which works through the intake sections in order and flushes each confirmed section to `context/brief.md` as a DRAFT block before the next section begins. The skill's orchestration ensures resumability: if a session ends mid-interview, re-invoking the skill picks up from the last flushed block, not from the beginning.

The honest time expectation is 45-90 minutes. The first-session success criterion per D-16 (honest, resumable interview) is a confirmed `context/brief.md`, not a drafted chapter.

## Invocation

```
/nonfiction-studio:nfs-interview
```

No argument is required. The skill manages its own flow by reading the resumption state from `context/brief.md`.

Alternate entry points:
- Via the `nfs-start` skill: Path 1 (Start a new book) chains to this skill on completion of `nfs-new-book`
- Following the `nfs-new-book` closing prompt: that prompt names `/nonfiction-studio:nfs-interview` as the natural next step

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `context/brief.md` | Start of every invocation (Step 1) | Detect DRAFT blocks and determine whether this is a new or resumed intake |
| `context/style-profile.md` | After the interview completes (Step 6) | Determine whether to suggest `nfs-capture-voice` |

### Outputs

All outputs are written by the `interviewer` agent, not by the skill directly. The four committed bible files and the decisions-log entry are written by the agent only after the author explicitly confirms the written brief.

| Path | Written | Contents |
|---|---|---|
| `context/brief.md` | A DRAFT block per confirmed section during the interview; the confirmed brief after author sign-off | Running intake record, then the final project brief |
| `context/audience.md` | At commit | Primary reader persona, prior-knowledge baseline, desired change in the reader |
| `structure/thesis.md` | At commit | Draft controlling idea, promise to the reader, scope boundary |
| `structure/comps.md` | At commit | Seeded comparable titles with differentiation notes |
| `context/decisions.md` | At commit | One log entry: date, entry mode, number of sessions |

## Flow Summary

The skill runs six steps in order.

1. **Resumption check.** Reads `context/brief.md` for existing DRAFT blocks. If found, announces the resumption point and names the completed sections. If not, starts a new session.

2. **Delegate to the interviewer.** Spawns the `interviewer` agent (the `nfs-interview -> interviewer` chain edge per `agents/_chain-permitted.yaml`) with the current brief state as context. On chat, the brief content is loaded inline before spawning.

3. **Section-by-section DRAFT flushing.** The `interviewer` agent works through sections in order; each confirmed section is flushed to `context/brief.md` before the next begins per D-16 (honest, resumable interview). Section order and block grammar are the agent's contract, not the skill's.

4. **Post-sections review.** The `interviewer` presents the full draft brief for author review and edits.

5. **Finalize on confirmation.** On author confirmation, the `interviewer` resolves DRAFT blocks into the confirmed `context/brief.md` and writes the committed bible files.

6. **Conditional close.** Checks `context/style-profile.md`; suggests `nfs-capture-voice` when absent, `nfs-outline` when the brief is confirmed.

## Failure Behavior

If the session ends mid-interview, the DRAFT blocks flushed to `context/brief.md` allow exact resumption from the last completed section. Re-invoking the skill starts at Step 1, which reads those blocks and passes the resumption state to the `interviewer` agent. The agent then skips sections that were already confirmed and flushed.

If the resumption check in Step 1 fails due to a file system error, the skill halts and reports the error. Proceeding without the resumption check would risk re-asking sections the author already answered.

Missing `context/style-profile.md` is not an error: the conditional close at Step 6 detects its absence and surfaces the `nfs-capture-voice` suggestion.

## Worked Example

See [nfs-interview.example.md](./nfs-interview.example.md) for a condensed two-session transcript of an intake run for the sample book "The Quiet Network". Session 1 ends mid-interview after two confirmed sections; session 2 resumes from the flushed DRAFT blocks, completes the intake, and closes with the conditional next-step suggestions.
