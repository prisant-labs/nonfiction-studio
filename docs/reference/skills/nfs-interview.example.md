---
title: "nfs-interview worked example"
description: "Two-session transcript of an intake-interview run for The Quiet Network - shows resumption detection, delegation to the interviewer agent, DRAFT flushing, and the conditional close"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "intake", "interview", "example"]
---

# nfs-interview - worked example

This is a condensed two-session transcript of an `nfs-interview` run for the sample book "The Quiet Network" (see `examples/sample-book/`). Session 1 ends mid-interview after two confirmed sections are flushed to disk. Session 2 detects the flushed DRAFT blocks, resumes at the next uncompleted section, completes the intake, and closes with conditional next-step suggestions. The example follows the flow specified in S-06 3.2 (intake-interview) and honors D-16 (honest, resumable interview).

---

## Session 1: new intake, two sections confirmed, session ends mid-interview

**Author:** `/nonfiction-studio:nfs-interview`

**Studio (Step 1 - Resumption check):**

The skill uses the Read tool on `context/brief.md`. No DRAFT blocks are found. This is a new session with no prior state to skip.

**Studio (Step 2 - Delegate to the interviewer agent):**

The `interviewer` agent is spawned with an empty brief state.

**Interviewer:**

> No DRAFT blocks found in `context/brief.md`. Starting a new intake.
>
> This interview configures the studio for a specific book. It typically takes 45 to 90 minutes, and pausing after any section is fine. On re-entry the interview resumes exactly where this session ends. The goal of this session is a confirmed `context/brief.md`, not a drafted chapter.
>
> Starting with the project basics. What is the working title, and what shelf does this book sit on?

**Author:** "Working title is 'The Quiet Network.' Subtitle something like 'A Practical Guide to Building Your Personal Learning Network.' It is a practical how-to for knowledge workers."

The interviewer confirms section 1 and flushes a DRAFT block to `context/brief.md` before asking section 2:

```
<!-- DRAFT section-1 completed 2026-07-18 -->
Working title: The Quiet Network
Subtitle: A Practical Guide to Building Your Personal Learning Network
Genre: Practical non-fiction / how-to
Shelf: business and productivity; professional development
<!-- END DRAFT section-1 -->
```

**Interviewer:**

> Noted. On to the thesis - the controlling idea that the book asserts. What is the one claim a reader should be able to state after finishing this book?

**Author:** "Building a personal learning network is a deliberate practice, not just collecting follows and subscriptions, and professionals who treat it as a system compound their expertise faster than those who do not."

The interviewer reflects the assertion back, confirms the author intends it as the thesis (not a topic statement), and flushes a second DRAFT block:

```
<!-- DRAFT section-2 completed 2026-07-18 -->
Controlling idea: Building a personal learning network is a deliberate, ongoing
practice - not a passive accumulation of follows and subscriptions - and
professionals who treat it as a system compound their expertise faster than those
who do not.
Promise: By the end, the reader can build and maintain a learning network that
grows expertise systematically and keeps them current.
What this book is NOT: not about audience growth, personal branding, or social
media performance.
<!-- END DRAFT section-2 -->
```

The session ends here. Sections 1 and 2 are flushed to `context/brief.md` on disk. The remaining sections have not yet begun.

---

## Session 2: resumed intake, remaining sections, confirmed brief, conditional close

**Author:** `/nonfiction-studio:nfs-interview`

**Studio (Step 1 - Resumption check):**

The skill uses the Read tool on `context/brief.md` and finds DRAFT blocks for sections 1 and 2. Announcing resumption: sections 1 (project basics) and 2 (thesis) are captured. Completed sections will be skipped; the interview resumes at section 3.

**Studio (Step 2 - Delegate to the interviewer agent):**

The `interviewer` agent is spawned with the two captured sections loaded as context.

**Interviewer:**

> Resuming. Sections 1 (project basics) and 2 (thesis) are already captured. Picking up at section 3 (audience).
>
> Who is this book for, and what does that person already know going in?

**Author:** "Knowledge workers and self-directed professionals who want to stay current in fast-changing fields. They know how to use the internet but have not thought deliberately about their learning network as a system."

The interviewer confirms section 3 and flushes a DRAFT block. The interview continues through the remaining sections. During the voice and tone section, the author pastes a short blog excerpt. The interviewer accepts it and notes it in the DRAFT block rather than analyzing it inline:

```
<!-- DRAFT section-6 completed 2026-07-18 -->
Tone: plainspoken, warm, practical
POV and tense: second person for instruction; first person for occasional anecdote; present tense
Register: trade non-fiction, pitched at an informed friend rather than a lecturer
Writing sample: one short blog excerpt provided. FLAGGED FOR voice-capture; not analyzed here.
<!-- END DRAFT section-6 -->
```

After all sections are confirmed and flushed, the interviewer presents the full draft brief as a single structured summary across all sections and reads it back.

**Interviewer:**

> Here is the full brief. Does this accurately capture the book and the intent behind it? Edit anything that is off.

**Author:** "That is right. Confirm."

**Studio (Step 5 - Finalize on confirmation):**

The `interviewer` agent resolves the DRAFT blocks and writes the confirmed brief and the committed bible files:

```
context/brief.md        confirmed (DRAFT blocks replaced by the confirmed brief)
context/audience.md      written
structure/thesis.md      written
structure/comps.md       written
context/decisions.md     one entry appended
```

**Studio (Step 6 - Conditional close):**

The skill runs the Bash tool:
```
test -f context/style-profile.md && echo HAS_PROFILE || echo NO_PROFILE
```

Output: `NO_PROFILE`

**Studio:**

> The brief is confirmed. Two optional next steps:
>
> 1. Run `nfs-capture-voice` to build the stylometric voice baseline. The writing sample from the voice section is flagged and ready for analysis.
> 2. Run `nfs-outline` to produce the chapter-by-chapter structure.
>
> Neither is required before the other; both can be deferred.
>
> Invoke with `/nonfiction-studio:nfs-capture-voice` or `/nonfiction-studio:nfs-outline`.

---

## Key assertions from this transcript

- **Resumption check detects flushed blocks.** In session 2, the Read on `context/brief.md` finds DRAFT blocks for sections 1 and 2. The skill announces the resumption point before spawning the agent.
- **Honest time expectation stated first.** The opening turn in session 1 states the 45-to-90-minute range and the confirmed-brief goal before any question is asked.
- **Completed sections are skipped.** The agent reports sections 1 and 2 as captured and resumes at section 3 rather than re-asking them.
- **Block grammar is the agent's contract.** The skill does not specify DRAFT block delimiters or section tags; what appears in `context/brief.md` is the agent's output, not the skill's specification.
- **Writing sample flagged, not analyzed.** The sample from the voice section is noted in the DRAFT block and flagged for `voice-capture`; the interviewer does not analyze it inline.
- **Confirm before commit.** No committed bible file is written until the author explicitly confirms the written brief.
- **Conditional close is a tool call.** The Bash call on `context/style-profile.md` determines whether the voice suggestion appears; it does not rely on a prose inference.
- **Suggestions are optional.** The closing message names `nfs-capture-voice` and `nfs-outline` as choices, not a required next step.
