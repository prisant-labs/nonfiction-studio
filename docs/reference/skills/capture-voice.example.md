---
title: "capture-voice worked example"
description: "Single-session transcript of a capture-voice run for The Quiet Network - shows sample submission, word-count assessment, delegation to the voice-capture agent, Read-check confirmations, and the marker-value preview"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "voice", "stylometry", "example"]
---

# capture-voice - worked example

This is a condensed transcript of a `capture-voice` run for the sample book "The Quiet Network" (see `examples/sample-book/`). The author submits three writing samples that total over 1,000 words. The skill assesses the word count, delegates to the `voice-capture` agent, confirms both output files via Read checks, and previews two marker values from the baseline. The committed `context/style-profile.md` and `stylometry.baseline.markers` block in `examples/sample-book/.studio/config.json` are the live outcome of this run. The example follows the flow specified in S-06 3.3 (skills and invocation surface) and the writer-role alignment adjudicated in TSK-046 (capture-voice skill).

For the no-samples bootstrap path (when an author has no writing samples of their own), see `agents/voice-capture.md` Path B. That path is run by the `voice-capture` agent and is not reproduced here.

---

## Session: samples submitted, baseline captured, profile confirmed

**Author:** `/nonfiction-studio:capture-voice`

**Studio (Step 1 - Existing-profile check):**

The skill uses the Bash tool:
```
test -f context/style-profile.md && echo HAS_PROFILE || echo NO_PROFILE
```
Output: `NO_PROFILE`

No existing profile. The skill continues to Step 2 and states:

> The voice profile is the numeric baseline the drift scorer uses to detect when a chapter has moved away from your natural style. It is a description of how you write, not a rule sheet. You can edit the written do and do-not rules directly in `context/style-profile.md` at any time.

**Studio (Step 2 - Collect samples):**

> To build the baseline, paste two to five samples of your own prose, targeting a combined total of at least 1,000 words. Passages from authors you admire are welcome as reference notes, but they are not used to compute the baseline. If you have no writing samples of your own at all, say so and the skill will offer an alternative path.

**Author:**

> Here are three samples from my writing:
>
> **Sample 1** (from a blog post on professional learning):
>
> You probably already know how you learn best. You just have not said so out loud.
>
> Think about the last time a concept clicked. Not when you read about it, but when it actually made sense. You were likely doing something: explaining it to a colleague, trying to apply it, or reading a second source that described the same idea from a different angle. The click happened because of the doing, not just the reading.
>
> Most of us were taught to learn passively. We took notes, we highlighted, we re-read. None of these strategies survive contact with a follow-up test a week later. Research on learning consistently shows that retrieval practice, generating an answer from memory rather than recognizing it on a page, outperforms re-reading by a factor of two or more.
>
> The same principle applies to professional learning. Reading a newsletter is fine. Writing down one thing you would do differently as a result is learning. The action is small. The difference in retention is not.
>
> Start there: one sentence, once a week. That is a learning habit you can build on.
>
> **Sample 2** (draft of chapter 1, "Listening Before Speaking"):
>
> Before you say anything, listen.
>
> Most people join a new professional community with something to prove. They post introductions before they know the room. They share opinions on debates they have not followed long. They wonder why no one engages, not realizing the network already has its own rhythms, its own references, and its own unspoken rules.
>
> The instinct to broadcast is understandable. Social platforms reward posting. Visibility feels like participation. But in a learning network, visibility without credibility produces nothing except the embarrassment of being wrong in public.
>
> The better entry strategy is to listen. Not passive lurking, but structured, deliberate attention: reading before commenting, watching how conversations begin and end, noticing who defers to whom and why.
>
> Trust in professional networks builds through consistency of presence and quality of contribution, not through frequency of posting. The person who comments once a month with genuine insight earns more credibility than the person who posts every day with borrowed takes.
>
> Spend your first month as a learner, not a contributor.
>
> **Sample 3** (draft of chapter 2, "Finding Your Network"):
>
> The phrase "personal learning network" can sound like a vague ambition. In practice, it is a specific list of people, publications, and communities that you return to with intention.
>
> Most professionals already have something like this. There is the colleague they email when they are stuck, the newsletter they actually read, the podcast they listen to on Monday mornings. The goal of this chapter is to make that list deliberate.
>
> Start instead with a question: what do I most want to understand in the next twelve months? The question could be a technical skill, or how a particular industry works, or how to communicate more clearly with a specific audience.
>
> Once you have the question, look for the people already answering it. Not just talking about it, but demonstrating it in their work. The distinction matters. Commentators are easy to find. Practitioners who share their reasoning are rarer and more valuable.

**Studio (Step 2 continued - Word-count assessment):**

The skill uses the Bash tool to count the total words in the submitted text:
```
printf '%s\n' "<submitted-samples>" | wc -w
```
Output: `1247`

1,247 words meets the 1,000-word threshold. No caution is needed.

**Studio (Step 3 - Load brief context and delegate):**

The skill uses the Read tool on `context/brief.md` and loads the confirmed project brief for "The Quiet Network" (genre: practical non-fiction; voice section: plainspoken, warm, practical; second person for instruction; first person for occasional anecdote).

The `voice-capture` agent is spawned via the `capture-voice -> voice-capture` chain edge with:
- The three submitted samples
- The content of `context/brief.md`
- Word-count band: 1,000-or-more (full confidence)

**Voice-capture agent (summary of actions):**

The agent reads `context/brief.md` section 6, analyzes the three samples against the D-08 (hybrid voice scoring) marker set, resolves the plugin root, and runs the stylometry engine:
```
node "<plugin-root>/bin/ns-stylometry" --measure=<sample-paths>
```

The engine prints the eight-marker vector to stdout. The agent reads the output:
```json
{
  "markers": {
    "function_word_rate": 0.4717,
    "contraction_rate": 0.0299,
    "first_person_rate": 0.2268,
    "second_person_rate": 3.4014,
    "type_token_ratio": 0.4558,
    "avg_word_length": 5.2041,
    "avg_sentence_length": 13.1642,
    "punctuation_rate": 13.0090
  }
}
```

The agent drafts the eleven-field profile in `context/style-profile.md` and presents it for author review. The author confirms. The agent writes:

1. `context/style-profile.md` (the confirmed eleven-field profile, `bootstrapped: false`)
2. `.studio/config.json` (the `stylometry.baseline.markers` block written via read-modify-write; no other config fields are touched)

**Studio (Step 4 - Confirm output files):**

The skill uses the Read tool on `context/style-profile.md`. The file is present with all eleven fields populated and `bootstrapped: false`.

The skill uses the Read tool on `.studio/config.json`. The `stylometry.baseline.markers` key is present with all eight markers.

Both checks pass. The skill continues to Step 5.

**Studio (Step 5 - Preview the baseline):**

Using the marker values already in the `.studio/config.json` read in Step 4:

> Two markers from the baseline:
>
> **Mean sentence length: 13.2 words.** That places your prose at the shorter, more direct end of the trade non-fiction range. The drift scorer will flag chapters where the average rises significantly above this.
>
> **Second-person rate: 3.4 per hundred words.** Your "you" address is a defining feature of this voice. Chapters that drop well below this rate will read as more distant than your baseline register.

**Studio (Step 6 - Close):**

> The voice baseline is in place. `context/style-profile.md` holds the eleven-field profile you can edit directly, and `config.json` holds the numeric vector the gate scorer reads.
>
> Two optional next steps:
>
> 1. Run `outline-book` to produce the chapter-by-chapter structure: `/nonfiction-studio:outline-book`
> 2. If the project brief has not been completed yet, run `intake-interview` first: `/nonfiction-studio:intake-interview`

---

## Key assertions from this transcript

- **Existing-profile check is a tool call.** The Bash call on `context/style-profile.md` determines whether an existing profile is present before any other work begins.
- **Word-count check is a tool call.** The Bash count of submitted words (1,247 in this run) determines the processing band; no prose estimate is made.
- **The agent writes both files; the skill writes neither.** `context/style-profile.md` and the `stylometry.baseline.markers` block in `config.json` are written by the `voice-capture` agent only after the author confirms the draft profile.
- **No `.studio/progress.json` write.** The captured signal is the presence of `context/style-profile.md` on disk per D-06 (single-writer state discipline); no secondary status field is set.
- **Confirmation before commit.** Neither output file is written until the author explicitly confirms the draft profile in the agent session.
- **Read checks are mandatory.** The skill reads both files after the agent completes. Only when both pass does the skill continue to the preview.
- **Preview uses already-read values.** The two marker values quoted in Step 5 come from the `.studio/config.json` read in Step 4. No additional engine run occurs.
- **Bootstrap path is not duplicated here.** For the no-samples path, see `agents/voice-capture.md` Path B.
