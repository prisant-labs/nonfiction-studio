---
title: "line-editor worked example"
description: "Condensed transcript of a line-editor session over Chapter 1 of The Quiet Network - shows a clarity edit, a rhythm proposal, a meaning-change flag, a do-not-list flag, and claim marker immunity"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "drafting", "voice", "editing", "line-editing", "proposals", "example"]
---

# line-editor - worked example

This is a condensed transcript of a `line-editor` session for the sample book
"The Quiet Network" (see `examples/sample-book/`). It shows the style-profile
read, a sentence clarity edit, a rhythm proposal, a meaning-change flag,
a do-not-list flag, and the agent's behavior when a passage contains a
`[claim: EV-nnnn]` marker. It follows the contracts specified in S-04 (drafting
and voice agents).

A note section at the end identifies each key assertion from the transcript.

---

## Setup: what was already in place

Chapter 1 ("Listening Before Speaking") was drafted by `drafting-partner` in a
prior session. The chapter file `chapters/01-listening-before-speaking.md`
exists and contains five claim markers: `[claim: EV-0001]` through
`[claim: EV-0005]`. The author has accepted the chapter as structurally sound
and wants a sentence-level polish pass before running the quality gate.

`context/style-profile.md` is present and non-empty. The do-not list includes:
"start sentences with 'In today's world' or 'It is important to note'." The
rhythm guidance calls for mostly short sentences (under 20 words) with one
longer sentence per paragraph for variation.

---

## Session: line-edit pass over Chapter 1

**Author:** `/nonfiction-studio:draft-chapter chapter=01` (polish stage)

The `draft-chapter` skill routes to `line-editor` at the polish stage.

**line-editor:**

> **Step 1 - Read the style profile**
>
> Reading `context/style-profile.md`. Do-not list loaded: no sentences opening
> with "In today's world" or "It is important to note"; no em-dashes or
> en-dashes; no jargon without a gloss. Rhythm guidance: mostly short sentences
> (under 20 words), one longer sentence per paragraph for variation. Register:
> plainspoken, warm, second person for instruction, present tense for principles.
>
> **Step 2 - Read the chapter**
>
> Reading `chapters/01-listening-before-speaking.md`. Five claim markers found:
> EV-0001 (passive-consumption rate), EV-0002 (listen-speak ratio), EV-0003
> (peripheral participation), EV-0004 (network trust), EV-0005 (pln compounding).
> These markers are immune to any editing action. Surveying the full chapter
> before proposing changes.
>
> Four items noted for proposals: one pronoun chain that may generate ambiguity
> (sentence clarity); one passage with three consecutive sentences of nearly
> identical length (rhythm); one do-not-list flag; and one phrasing that,
> if changed for concision, would narrow the claim (meaning change required).

---

## Proposal 1 - Sentence clarity: pronoun chain

The original sentence in the second paragraph reads:

> "They post introductions before they know the room. They share opinions on
> debates they have not followed long."

The repeated third-person pronoun with no preceding referent until context
accumulates creates a slight parsing load on the reader.

**line-editor:**

```
PROPOSED REPLACEMENT

Original passage:
They post introductions before they know the room. They share opinions on
debates they have not followed long.

Proposed replacement:
Newcomers post introductions before they know the room. They share opinions on
debates they have not followed long.
```

Replacing the first "They" with "Newcomers" anchors the referent at the point of
entry rather than relying on the prior sentence's context. The second "They" then
carries cleanly.

---

## Proposal 2 - Rhythm: three consecutive short declaratives

The paragraph beginning "The better entry strategy is to listen" contains:

> "The better entry strategy is to listen. Not passive lurking, but structured,
> deliberate attention: reading before commenting, watching how conversations
> begin and end, noticing who defers to whom and why."

That paragraph is fine. The issue is two paragraphs later, where three
consecutive short declarative sentences flatten the cadence:

> "Sociologists use the phrase 'legitimate peripheral participation' to describe
> how newcomers learn a community's practices by observing from the edges before
> taking a central role. The phrase comes from research on craft apprentices and
> applies equally to someone entering a professional network for the first time.
> [claim: EV-0003]"

The two sentences are nearly the same length and use the same declarative
structure. The claim marker on EV-0003 belongs to the second sentence and is
not touched.

**line-editor:**

```
PROPOSED REPLACEMENT

Original passage:
Sociologists use the phrase "legitimate peripheral participation" to describe
how newcomers learn a community's practices by observing from the edges before
taking a central role. The phrase comes from research on craft apprentices and
applies equally to someone entering a professional network for the first time.
[claim: EV-0003]

Proposed replacement:
Sociologists use the phrase "legitimate peripheral participation" to describe
how newcomers learn by observing from the edges before taking a central role,
a pattern first documented in craft apprentices that applies equally to someone
entering a professional network for the first time. [claim: EV-0003]
```

The two sentences are merged and varied; the claim marker moves to the end of the
merged sentence where it grammatically belongs and is otherwise unaltered.

---

## Proposal 3 - Meaning change: qualifier introduced

The paragraph near the end reads:

> "Trust in professional networks builds through consistency of presence and
> quality of contribution, not through frequency of posting. [claim: EV-0004]"

The sentence states this as categorical. A plausible edit for concision would be
to add "often" or "typically" to soften the categorical claim. That softening
shifts the meaning from a general principle to a tendency, which changes the
epistemic standing of the sentence.

**line-editor:**

```
[MEANING CHANGE: adding "typically" weakens the categorical claim to a tendency, changing the epistemic standing of EV-0004]

PROPOSED REPLACEMENT

Original passage:
Trust in professional networks builds through consistency of presence and
quality of contribution, not through frequency of posting. [claim: EV-0004]

Proposed replacement:
Trust typically builds through consistency of presence and quality of
contribution, not through frequency of posting. [claim: EV-0004]
```

The claim marker EV-0004 (network trust) is present in both the original and the
proposed replacement, unchanged. The author decides whether the softened framing
is desirable; the meaning-change flag makes the stakes explicit.

---

## Do-not-list flag

The chapter opening reads:

> "Before you say anything, listen."

This sentence is clear and fits the profile's second-person register. No
proposal needed.

However, a hypothetical addition the author is drafting offline for the next
revision opens with: "It is important to note that most people join a new
professional community with something to prove."

That opening is on the do-not list. The `line-editor` flags it:

**line-editor:**

> **Do-not-list flag:**
>
> The draft addition for the opening of the second paragraph begins "It is
> important to note that." This phrase is on the do-not list in
> `context/style-profile.md`. The flag is informational; the choice may be
> intentional. If it is not intentional, a revision such as "Most people join
> a new professional community with something to prove" removes the
> throat-clearing opener.
>
> No PROPOSED REPLACEMENT block is issued. The author decides whether to act.

---

## Claim marker immunity: what the agent does not touch

The chapter contains this passage:

> "Most online learners spend more than 80 percent of their digital learning time
> consuming content without taking any action on it. [claim: EV-0001] That sounds
> like a waste, but it is only a waste if you are not paying attention."

The first sentence has a potential rhythm issue - "consuming content without
taking any action on it" is wordy. A concision edit would tighten it. However,
any trim of "without taking any action on it" to "without acting on it" is a
purely mechanical cleanup - no meaning shift - and the `[claim: EV-0001]` marker
is at the end of the sentence.

**line-editor:**

```
PROPOSED REPLACEMENT

Original passage:
Most online learners spend more than 80 percent of their digital learning time
consuming content without taking any action on it. [claim: EV-0001]

Proposed replacement:
Most online learners spend more than 80 percent of their digital learning time
consuming content without acting on it. [claim: EV-0001]
```

The `[claim: EV-0001]` marker appears in both passages, in the same position.
The agent does not remove it, move it, or rephrase the sentence in a way that
would detach it from its factual anchor. `bin/ns-claims` resolves the marker
to the same EV entry before and after the proposal.

---

## Chapter file state after the session

The existing `chapters/01-listening-before-speaking.md` is unchanged. All output
is in proposal blocks. The author accepts or rejects each block; the agent does
not apply changes to the chapter file directly.

The five claim markers - EV-0001 through EV-0005 - are present in the same
positions in which they were found. Where a proposal includes a passage that
contained a marker, the marker appears in the proposed replacement at the
same logical position.

---

## Key assertions from this transcript

- **Style profile read first.** The do-not list, rhythm guidance, and register
  rules were loaded before any passage was examined. The editing pass is
  calibrated to the profile, not to a generic standard.
- **Claim markers are immune.** EV-0001 (passive-consumption rate), EV-0003
  (peripheral participation), and EV-0004 (network trust) all appeared in edited
  passages. In every case the marker was preserved in the proposed replacement at
  the same position. The agent produced no output that would remove or move any
  marker.
- **Every edit is a proposal.** No changes were applied to the chapter file. All
  output is PROPOSED REPLACEMENT blocks the author accepts or rejects individually.
- **Meaning changes are flagged.** The proposal to add "typically" to the EV-0004
  (network trust) sentence was preceded by `[MEANING CHANGE: ...]` naming the
  specific epistemic shift. The author's decision is required before that change
  applies.
- **Do-not-list violations are flagged, not removed.** The "It is important to
  note" opener was flagged with an informational note. No PROPOSED REPLACEMENT
  block was issued; the choice may be intentional.
- **No structural critique.** All observations in this session are sentence-level.
  If the agent had noticed an argument sequencing issue, it would have noted it
  and deferred to `developmental-editor` without issuing an edit proposal.
- **No voice scoring.** The transcript contains no drift score, no qualitative
  register assessment, and no note about overall style adherence. Voice assessment
  belongs to `voice-guardian`.
- **House convention reused.** All proposals use the `drafting-partner`
  PROPOSED REPLACEMENT format. No third format was introduced.
