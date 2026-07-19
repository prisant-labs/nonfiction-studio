---
title: "interviewer worked example"
description: "Condensed transcript of an intake interview for The Quiet Network - shows scaffold-first, DRAFT flush, cross-session resume, and confirm-before-commit"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "intake", "example"]
---

# interviewer - worked example

This is a condensed transcript of a full intake interview conducted by the
`interviewer` agent for the sample book "The Quiet Network" (see
`examples/sample-book/`). It shows the scaffold-first step, the DRAFT-block flush
after a confirmed section, a pause and cross-session resume, and the
confirm-before-commit step. It follows the flow specified in S-01 (intake and
context agents) and honors D-16 (honest, resumable interview).

---

## Session 1: start, opening turn, sections 1 and 2

**Author:** `/nonfiction-studio:intake-interview`

**Interviewer:**

> No `context/brief.md` was found, so this is a new intake. First, the book tree
> needs to exist, so I am running `init-project` to scaffold it.
>
> The `book/` tree and `.studio/` state files are in place.
>
> Welcome. This interview configures the studio for your specific book. It
> typically takes 45 to 90 minutes, and you can pause after any section and resume
> exactly where we left off. The goal today is a confirmed brief, not a drafted
> chapter.
>
> Let's start with the basics. What is your working title, and do you have any
> subtitle ideas? What shelf does the book sit on?

**Author:** "The Quiet Network. Subtitle something like 'A Practical Guide to
Building Your Personal Learning Network.' It is a practical how-to for knowledge
workers."

The interviewer reflects the answer back, then moves to the thesis. It asks for
the one-sentence controlling idea (going deeper here, because thesis is a
high-impact section). After two exchanges the author lands on the assertion.

**Author:** "Building a personal learning network is a deliberate practice, not
just collecting follows, and people who treat it as a system get better faster."

The interviewer confirms sections 1 and 2, then flushes a DRAFT block to
`context/brief.md` before asking the next section's questions:

```
<!-- DRAFT section-1 completed 2026-07-18 -->
Working title: The Quiet Network
Subtitle: A Practical Guide to Building Your Personal Learning Network
Genre: Practical non-fiction / how-to
Pitch: This book helps knowledge workers convert what they read into durable
expertise by treating their personal learning network as a deliberate system.
<!-- END DRAFT section-1 -->

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

The author works through sections 3 through 6. During section 6 (tone and voice)
the author pastes a short blog excerpt. The interviewer accepts it, notes it in the
DRAFT block, and flags it for `voice-capture` rather than analyzing it inline:

```
<!-- DRAFT section-6 completed 2026-07-18 -->
Tone: plainspoken, warm, practical.
POV and tense: second person for instruction; first person for occasional
anecdote; present tense.
Register: trade non-fiction, pitched at an informed friend rather than a lecturer.
Writing sample: one 380-word blog excerpt provided. FLAGGED FOR voice-capture; not
analyzed here.
<!-- END DRAFT section-6 -->
```

The author pauses after section 6.

---

## Session 2: resume, remaining sections, confirm, commit

**Author:** `/nonfiction-studio:intake-interview`

**Interviewer:**

> I read `context/brief.md` and found DRAFT blocks for sections 1 through 6, so
> this is a resumed intake. I have your basics, thesis, audience, comps, scope, and
> voice notes. Picking up at section 7 (research and evidence posture).

The interviewer completes sections 7 through 10, flushing a DRAFT block after each.
It then presents one structured written brief covering all ten sections in plain
prose and reads it back:

> Here is the full brief. Does this accurately capture your book and your intent?
> Edit anything that is off.

The author corrects a single point in section 3:

**Author:** "Audience is right, but narrow it. The primary reader is a knowledge
worker or self-directed professional who wants to stay current, not a general
reader."

The interviewer revises section 3 and re-reads the affected part. The author
confirms. Only now does the interviewer write the committed bible files:

```
context/brief.md        committed (DRAFT blocks replaced by the confirmed brief)
context/audience.md      written
structure/thesis.md      written
structure/comps.md       written
context/decisions.md     one entry appended
```

The `context/decisions.md` entry records the completion:

```
### 2026-07-18 - intake complete
- actor: interviewer
- decision: Project brief confirmed for "The Quiet Network."
- rationale: Intake completed over 2 sessions, conversational entry mode.
- links: context/brief.md
```

**Interviewer:**

> Your brief is locked. Want to sharpen the controlling idea with
> `thesis-architect`, sketch the outline with `structure-architect`, or run
> `voice-capture` on the writing sample you shared?

---

## Key assertions from this transcript

- **Scaffold first.** `init-project` runs and the `book/` tree appears before the
  first interview question, per D-16 (honest, resumable interview).
- **Honest time expectation.** The opening turn states the 45-to-90-minute range,
  unprompted.
- **DRAFT flush per section.** A DRAFT block with a section tag and ISO date is
  written to `context/brief.md` after each confirmed section, and earlier blocks
  are not overwritten by later ones.
- **Resume skips captured sections.** In session 2 the agent reports sections 1
  through 6 as captured and begins at section 7 rather than re-asking.
- **Writing samples handed off.** The section-6 sample is flagged for
  `voice-capture` and is not analyzed by the interviewer.
- **Confirm before commit.** No final content lands in `context/brief.md`,
  `context/audience.md`, `structure/thesis.md`, or `structure/comps.md` until the
  author confirms the written brief; the single section-3 correction is applied
  before the commit.
- **Handoffs are choices.** After commit, `thesis-architect`,
  `structure-architect`, and `voice-capture` are named as options, not a mandated
  pipeline.
