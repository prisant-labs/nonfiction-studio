---
name: nfs-interview
user-invocable: true
argument-hint: ""
description: "Conducts the adaptive intake interview to produce a confirmed context/brief.md. The first-session success criterion is a confirmed brief, not a drafted chapter. The interview typically takes 45-90 minutes per D-16 (honest, resumable interview). Use when the author says 'interview me about my book,' wants to 'start my author interview,' or says 'continue my interview' after an earlier session."
when_to_use: "Use when the author says 'set up my book' or 'continue my interview', or follows init-project's closing prompt. Do not invoke for authors who already have a confirmed context/brief.md and are not resuming an interrupted intake, or for unrelated queries."
chain:
  - interviewer
---

This skill is the interview front door. It checks for an interrupted intake, delegates the conversational interview to the `interviewer` agent, oversees the per-section DRAFT flush to `context/brief.md`, presents the draft brief for review, and closes with conditional next-step suggestions.

**Honest time expectation.** This interview typically takes 45-90 minutes. The first-session success criterion per D-16 (honest, resumable interview) is a confirmed `context/brief.md`, not a drafted chapter. State this before any other work begins.

Skill inputs read:
- `context/brief.md` (existing DRAFT blocks for resumption; flat path per TSK-044b (init-project layout reconciliation))
- `context/style-profile.md` (checked at Step 6 to determine the conditional close; not read earlier)

## Step 1 - Resumption check (mandatory first tool call)

Use the Read tool on `context/brief.md`.

- If DRAFT blocks with section tags are present: announce the resumption point, name the sections already captured, and state that those sections will be skipped. Pass the captured-section list to Step 2 as context for the agent.
- If the file does not exist or contains no DRAFT blocks: proceed as a new session with no prior state to skip.

## Step 2 - Delegate to the interviewer agent

Spawn the `interviewer` agent, passing the current brief state as context. The chain edge for this delegation is `nfs-interview -> interviewer` per `agents/_chain-permitted.yaml` (TSK-044 (chain contract, Phase 1)).

**On chat:** before spawning, load the content of `context/brief.md` inline into the spawn context. This surface-compensation step per S-06 3.2 (intake-interview, surface notes) ensures the agent has the DRAFT-block state available even when its own Read call may not succeed on the chat surface.

## Step 3 - Section-by-section DRAFT flushing (interviewer's contract)

The `interviewer` agent owns the section order and block grammar. The expectation per D-16 (honest, resumable interview): the agent works through sections in order, and each completed section is flushed as a DRAFT block to `context/brief.md` before the next section begins. Progress is always visible because each flush reaches disk before the conversation continues.

Do not re-specify the DRAFT block delimiters, section names, or section count in this skill. The agent's contract governs those.

## Step 4 - Post-sections review

After all sections are complete, the `interviewer` agent presents the full draft brief to the author for review and edits. The author may request corrections to any section before confirming.

## Step 5 - Finalize on confirmation

On author confirmation, the `interviewer` agent resolves the DRAFT blocks into the confirmed `context/brief.md` and writes the committed bible files. No final bible file is written before the author confirms the written brief.

## Step 6 - Conditional close

Use the Bash tool to run:
```
test -f context/style-profile.md && echo HAS_PROFILE || echo NO_PROFILE
```

Branch on the output:
- `NO_PROFILE`: suggest running `nfs-capture-voice` to build the author's stylometric voice baseline. Note that any writing samples shared during the interview have been flagged for `voice-capture`.
- `HAS_PROFILE`: skip the voice suggestion; a style profile is already in place.

After the style-profile check, if `context/brief.md` is confirmed: suggest running `nfs-outline` to produce the chapter-by-chapter structure.

Both suggestions are optional next steps; do not present them as mandatory or sequential.

---

## Failure behavior

If the session ends mid-interview, the DRAFT blocks flushed to `context/brief.md` allow exact resumption. On re-invocation, Step 1's Read on `context/brief.md` detects the completed sections and announces the resumption point; the `interviewer` agent receives that state and skips the completed sections. No progress is lost as long as sections were flushed to disk before the session ended.

If Step 1's Read on `context/brief.md` fails (for example, a file system error or permission issue), report the error and halt. Do not proceed without the resumption check: the author may have prior progress that would be re-asked.
