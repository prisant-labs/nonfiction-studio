---
title: "nfs-capture-voice worked example"
description: "Single-session transcript of a nfs-capture-voice run for The Quiet Network - shows sample submission, word-count assessment, the calibration cost disclosure, delegation to the voice-capture agent, Read-check confirmations, the regime-disclosure relay, and the marker-value preview"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "voice", "stylometry", "example"]
---

# nfs-capture-voice - worked example

This is a condensed transcript of a `nfs-capture-voice` run for the sample book "The Quiet Network" (see `examples/sample-book/`). The author submits five writing samples that total over 2,200 words - the calibration floor `bin/ns-stylometry --calibrate` enforces. The skill assesses the word count, discloses the calibration cost, delegates to the `voice-capture` agent, confirms the output files via Read checks, relays the agent's regime disclosure, and previews two marker values from the baseline. The committed `context/style-profile.md` and `stylometry.baseline` block in `examples/sample-book/.studio/config.json` are the live outcome of an equivalent run. The example follows the flow specified in S-06 3.3 (skills and invocation surface), the writer-role alignment adjudicated in TSK-046 (capture-voice skill), and ADR-0012 (voice verdict scope, Decision 3).

For the no-samples bootstrap path (when an author has no writing samples of their own), see `agents/voice-capture.md` Path B. That path is run by the `voice-capture` agent and is not reproduced here.

---

## Session: samples submitted, baseline captured, profile confirmed

**Author:** `/nonfiction-studio:nfs-capture-voice`

**Studio (Step 1 - Existing-profile check):**

The skill uses the Bash tool:
```
test -f context/style-profile.md && echo HAS_PROFILE || echo NO_PROFILE
```
Output: `NO_PROFILE`

No existing profile. The skill continues to Step 2 and states:

> The voice profile is the numeric baseline the drift scorer uses to detect when a chapter has moved away from your natural style. It is a description of how you write, not a rule sheet. You can edit the written do and do-not rules directly in `context/style-profile.md` at any time.

**Studio (Step 2 - Collect samples):**

> To build the baseline, paste two to five samples of your own prose, targeting a combined total of at least 2,200 words - the calibrated baseline needs at least that much usable prose to measure natural same-voice variation with any confidence. Passages from authors you admire are welcome as reference notes, but they are not used to compute the baseline. If you have no writing samples of your own at all, say so and the skill will offer an alternative path.

**Author:**

> Here are five samples from my writing:
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
>
> **Sample 4** (draft of chapter 3, "Habits That Survive a Bad Week"):
>
> You will not keep a habit you have to remember to do. You will keep one that is attached to something you already do every day.
>
> Pick an anchor: the first coffee of the morning, the commute, the walk to lunch. Attach the new habit to that anchor, not to a block of empty time on a calendar you do not actually have. An empty calendar block is a plan. An anchor is a trigger.
>
> I learned this the hard way. For two years I tried to build a weekly reading habit by blocking Friday afternoons. Fridays are the first thing that gets taken when the week runs long, and mine ran long almost every week. The habit died a slow death, one skipped Friday at a time, and I did not even notice it was gone until a colleague asked what I had been reading lately and I had no answer.
>
> What worked instead was smaller and less impressive: five minutes with a highlighter during the same cup of coffee I was already making. No calendar block, no protected hour, nothing that competed with a meeting that could run over. Just five minutes, attached to a cup of coffee that happens every single day regardless of how the week is going.
>
> Small and anchored beats large and scheduled. This is not a claim about willpower. It is a claim about what survives contact with an ordinary bad week, because every habit eventually meets one.
>
> The same logic applies to sharing what you learn, not just consuming it. A habit of writing one sentence after each highlighted passage turns passive reading into something closer to retrieval practice, and it costs almost nothing extra once the anchor is already in place.
>
> Notice how the smallest version of a habit is also the version most likely to survive a bad week. That is not a coincidence. Ambitious versions of a habit are optimized for a good week, and good weeks are not the ones a habit needs to survive.
>
> Once the small version is reliable, and only then, consider making it bigger. Five minutes becomes ten. One sentence becomes three. But the anchor never changes, because the anchor was never the part that needed to grow.
>
> Ask yourself which part of your day already happens without fail. That is where the next habit belongs, not on a calendar, and not on willpower you are hoping to have more of next month than you have had of it so far.
>
> Feedback follows the same rule, and most people apply it backward. They save feedback for a scheduled review, then wonder why the review feels like an ambush to the person receiving it and a chore to the person giving it. Feedback saved up for a calendar slot has gone stale by the time it arrives; the moment that would have made it useful already passed weeks earlier.
>
> Attach feedback to the same anchor that already exists: the end of the meeting where the thing happened, the five minutes after the draft was sent, the walk back from the room where the decision got made. Say the small true thing while it is still attached to a specific, remembered moment, not a generic pattern reconstructed from memory a month later.
>
> This is uncomfortable at first, mostly because small immediate feedback feels too minor to justify interrupting anyone. That feeling is backward. A small true thing said close to the moment costs the other person almost nothing to hear and almost nothing for you to say. A large accumulated thing said at a scheduled review costs both of you the whole conversation, and by then neither of you remembers the details well enough to make it specific.
>
> Specific beats large, every time. "The section on pricing needed a stronger opening" said the day the draft went out is more useful than "your recent drafts have had structural issues" said at the quarterly review, even though the second sentence sounds more comprehensive. Comprehensive is not the same as useful. A comprehensive summary of three months of drafts is a eulogy for feedback that should have been said three months earlier.
>
> Notice your own resistance to saying the small thing in the moment. That resistance is not politeness. It is usually just a habit of deferring, dressed up as consideration. The considerate version of feedback is the one that arrives while it can still change something.
>
> Deferred feedback has a second cost beyond staleness: it teaches the other person that feedback is a rare, formal event rather than an ordinary part of working together. Ordinary things do not need to be braced for. A quarterly review that arrives every three months, carrying three months of accumulated observations, cannot help but feel like an event, and events are exactly what make people defensive before a single word has been said.
>
> **Sample 5** (draft of chapter 4, "The Open Ledger"):
>
> Most professional advice about networking treats the network as the goal. Build a bigger one, know more people, collect more contacts. This gets the order backward. The network is not the goal. It is what accumulates as a side effect of doing useful, visible work over enough time that the right people notice.
>
> You cannot shortcut the accumulation by attending more events. I have watched people treat a conference badge like a harvest, collecting business cards the way you might collect stamps, and I have watched almost none of those cards turn into anything a year later. A card is not a relationship. A relationship is built from repeated, small, genuine exchanges, and a three-day conference does not have room for repetition.
>
> What actually works is slower and less exciting to describe: show up in the same three or four places consistently, contribute something real each time, and let the relationships form at whatever pace relationships actually form at. This is not a technique you can compress. Trying to compress it produces exactly the behavior that makes people distrust networking in the first place, the sense of being worked rather than known.
>
> Consistency beats intensity here, the same way it does with habits. A person who comments thoughtfully in the same community every week for a year is more trusted, by the end of that year, than a person who attended twelve events and never returned to any of them. The weekly person accumulated a track record. The event-hopper accumulated a stack of cards nobody remembers receiving.
>
> Ask which four or five places you could show up consistently, rather than which fifty events you could attend once. The answer will feel smaller than networking advice usually recommends, and that is the point: smaller and sustained beats large and sporadic, in a network the same way it does in a habit.
>
> There is a second mistake worth naming, related but distinct: treating every exchange as a transaction to be balanced immediately. Someone helps you with something small, and the instinct is to look for an equally small way to pay it back right away, as though the ledger has to close before the conversation ends. This instinct is understandable and it is also wrong.
>
> Real professional relationships run an open ledger, not a closed one. You help when you can help, you ask when you need to ask, and the two do not need to happen in the same week or even the same year. A relationship where every exchange gets balanced immediately is not actually a relationship; it is a series of small transactions that happen to involve the same two people. The open ledger is what makes it possible to ask for something significant five years in, from someone you helped with something small five years ago, without either side keeping score in between.
>
> This is uncomfortable for people who like clean accounts. It should be. A clean, immediately-balanced account is a sign the relationship has not yet become the kind of relationship that survives an actual ask.
>
> None of this means ignore reciprocity altogether. It means measuring it over years rather than exchanges, and trusting that a pattern of genuinely useful presence, sustained long enough, evens out on its own without anyone needing to track it.
>
> The same patience applies to when the value of a relationship becomes visible. Most of the people who have mattered most to my own work were not obviously important when I met them. They became important slowly, through years of the same small, consistent exchanges described above, and I could not have identified in advance which of the dozens of people I was meeting would turn out to be the ones that mattered.
>
> This is, I think, the real argument against optimizing a network for status. You cannot see far enough ahead to optimize correctly. The person worth knowing in five years does not look, today, like the person worth knowing in five years. They look like anyone else you might meet at one of the same four or five places you keep showing up.
>
> So show up. Contribute something real when you do. Let the ledger stay open. And do not expect to be able to tell, in the moment, which of these ordinary exchanges is the one that will matter most a decade from now.
>
> There is a practical test for whether you are showing up for the right reasons. Ask whether you would keep coming back to the same four or five places if nobody there ever turned into a useful connection at all. If the honest answer is no, the contribution you are making there is probably thinner than it looks, and the people around you can usually tell before you can.
>
> The test works because genuine contribution and transactional presence look almost identical from the outside for the first few months. Only time separates them: the transactional version thins out once the expected payoff fails to arrive on schedule, while the genuine version keeps showing up regardless, because showing up was never contingent on the payoff in the first place.
>
> None of this scales the way a networking event promises to scale. It is slower, narrower, and far less impressive to describe at a conference. It is also the only version that produces relationships strong enough to survive an actual ask five years later, which the version that scales almost never does.

**Studio (Step 2 continued - Word-count assessment):**

The skill uses the Bash tool to count the total words in the submitted text:
```
printf '%s\n' "<submitted-samples>" | wc -w
```
Output: `2221`

2,221 words clears the 2,200-word calibration floor, but stays under roughly 3,000, so the skill adds a note: "Confidence in the calibrated baseline improves with more sample text; consider re-running capture-voice after writing a few chapters to strengthen it further."

**Studio (Step 3 - Load brief context and delegate):**

The skill uses the Read tool on `context/brief.md` and loads the confirmed project brief for "The Quiet Network" (genre: practical non-fiction; voice section: plainspoken, warm, practical; second person for instruction; first person for occasional anecdote).

Before delegating, the skill states: "Calibration resamples the corpus a large, fixed number of times to measure natural same-voice variation. This takes real time - seconds to roughly a minute for a corpus this size."

The `voice-capture` agent is spawned via the `nfs-capture-voice -> voice-capture` chain edge with:
- The five submitted samples
- The content of `context/brief.md`
- Word count: 2,221

**Voice-capture agent (summary of actions):**

The agent reads `context/brief.md` section 6, persists all five samples to `context/samples/voice-sample-01.md` through `-05.md`, analyzes them against the D-08 (hybrid voice scoring) marker set, resolves the plugin root, and runs the stylometry engine:
```
node "<plugin-root>/bin/ns-stylometry" --calibrate=context/samples/voice-sample-01.md,context/samples/voice-sample-02.md,context/samples/voice-sample-03.md,context/samples/voice-sample-04.md,context/samples/voice-sample-05.md
```

The engine prints the eight-marker vector, `marker_set_version`, and the five-rung calibration ladder to stdout (noise_scales and block_thresholds abbreviated here for readability). The agent reads the output:
```json
{
  "markers": {
    "function_word_rate": 0.4717,
    "contraction_rate": 0.0299,
    "first_person_rate": 0.2262,
    "second_person_rate": 3.3937,
    "type_token_ratio": 0.7516,
    "avg_word_length": 5.1923,
    "avg_sentence_length": 13.1940,
    "punctuation_rate": 13.0090
  },
  "marker_set_version": 5,
  "calibration": {
    "spans": [550, 1100, 2200, 4400, 8800],
    "noise_scales": { "550": { "...the eight markers...": 0.0 } },
    "block_thresholds": { "550": 3.61, "1100": 3.52, "2200": 4.02, "4400": 4.71, "8800": 5.58 },
    "detectability_auc": 0.612,
    "regime": "book",
    "replicates": 1000,
    "seed": 4242
  }
}
```
and to stderr:
```
ns-stylometry: regime = book. Detectability AUC 0.612 at the 550-word rung falls
short of the 0.95 bar, so only a book-scale aggregate verdict is supportable.
```

The agent drafts the seven-section profile in `context/style-profile.md`, states the current UTC time as `captured`, and presents the draft for author review. The author confirms. The agent writes:

1. `.studio/config.json` (`stylometry.baseline`: `markers`, `marker_set_version`, and `calibration` verbatim from stdout, plus `captured`, `sample_count: 5`, and `method`, via read-modify-write; no other config fields are touched) - written as soon as calibration completed, before the profile draft was presented
2. `context/style-profile.md` (the confirmed seven-section profile, `bootstrapped: false`, `Baseline reference` `captured`/`sample_count` copied from what was just written to config)

The agent reports the two regime-disclosure sentences from stderr, verbatim, to the skill.

**Studio (Step 4 - Confirm output files and relay the regime disclosure):**

The skill uses the Read tool on `context/style-profile.md`. The file is present with all seven sections populated in order and `bootstrapped: false`.

The skill uses the Read tool on `.studio/config.json`. The `stylometry.baseline` object carries `markers`, `marker_set_version`, `calibration`, `captured`, and `sample_count`, all present.

Both checks pass. The skill relays the agent's regime disclosure to the author verbatim:

> This corpus supports a book-scale verdict only: detectability AUC 0.612 at the 550-word rung falls short of the 0.95 bar, so drift is scored on the whole book's prose rather than chapter by chapter.

The skill continues to Step 5.

**Studio (Step 5 - Preview the baseline):**

Using the marker values already in the `.studio/config.json` read in Step 4:

> Two markers from the baseline:
>
> **Mean sentence length: 13.2 words.** That places your prose at the shorter, more direct end of the trade non-fiction range. The drift scorer will flag chapters where the average rises significantly above this.
>
> **Second-person rate: 3.4 per hundred words.** Your "you" address is a defining feature of this voice. Chapters that drop well below this rate will read as more distant than your baseline register.

**Studio (Step 6 - Close):**

> The voice baseline is calibrated and in place. `context/style-profile.md` holds the seven-section profile you can edit directly, and `config.json` holds the numeric vector and calibration ladder the gate scorer reads. As stated above, this book scores drift at book scale, not per chapter.
>
> Two optional next steps:
>
> 1. Run `nfs-outline` to produce the chapter-by-chapter structure: `/nonfiction-studio:nfs-outline`
> 2. If the project brief has not been completed yet, run `nfs-interview` first: `/nonfiction-studio:nfs-interview`

---

## Key assertions from this transcript

- **Existing-profile check is a tool call.** The Bash call on `context/style-profile.md` determines whether an existing profile is present before any other work begins.
- **Word-count check is a tool call.** The Bash count of submitted words (2,221 in this run) determines whether calibration can proceed; no prose estimate is made.
- **Cost disclosed before delegating.** The skill states, in one sentence, that calibration resamples the corpus and takes real time - before spawning the agent, not after.
- **The agent writes all three outputs; the skill writes none.** `context/samples/voice-sample-NN.md`, `context/style-profile.md`, and the full `stylometry.baseline` object in `config.json` are written by the `voice-capture` agent only.
- **Numeric baseline written before profile confirmation.** `.studio/config.json` is written as soon as calibration completes; `context/style-profile.md` is written only after the author confirms the draft. The profile's `captured`/`sample_count` are copied from what config already holds, not independently restated.
- **No `.studio/progress.json` write.** The captured signal is the presence of `context/style-profile.md` on disk per D-06 (single-writer state discipline); no secondary status field is set.
- **Read checks are mandatory.** The skill reads both files after the agent completes, checking for `calibration`, `captured`, and `sample_count` alongside `markers` and `marker_set_version`. Only when both pass does the skill continue.
- **Regime disclosure relayed verbatim.** The skill states the same two sentences the engine's stderr disclosure gave the agent - it does not rephrase or recompute the regime call.
- **Preview uses already-read values.** The two marker values quoted in Step 5 come from the `.studio/config.json` read in Step 4. No additional engine run occurs.
- **Bootstrap path is not duplicated here.** For the no-samples path, see `agents/voice-capture.md` Path B.
