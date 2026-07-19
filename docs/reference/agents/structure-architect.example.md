---
title: "structure-architect worked example"
description: "Condensed transcript of a structure session for The Quiet Network - shows craft model check, gap surfacing, confirm-write sequence, and the three output files"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "structure", "outline", "example"]
---

# structure-architect - worked example

This is a condensed transcript of a `structure-architect` session for the sample
book "The Quiet Network" (see `examples/sample-book/`). It shows the craft model
check, the argument-spine-to-chapter mapping, gap surfacing and author
disposition, the confirm-write sequence, and the three files written:
`structure/outline.md`, `structure/chapter-list.md`, and the
`research/open-questions.md` appends. It follows the contracts specified in S-02
(structure and argument agents).

---

## Setup: what was already in place

The `thesis-architect` session confirmed `structure/thesis.md`. The relevant
contents for this session are:

**Thesis:** Building a personal learning network is a deliberate, ongoing
practice - not a passive accumulation of follows and subscriptions - and
professionals who treat it as a system compound their expertise faster than those
who do not.

**Argument spine:**
1. Deliberate curation produces compound expertise gains that passive consumption
   cannot, because it closes the feedback loop between input and applied learning.
2. Listening and intentional source selection are the foundational skills of a
   personal learning network - platform choice is secondary.
3. A learning network is a durable personal asset that the practitioner owns and
   carries across platforms - it is not a social media artifact or follower count.
4. Sustainable practice requires a small set of recurring habits, not a large set
   of intermittent efforts.
5. Reciprocity - contributing ideas, questions, and connections back to the network
   - is what keeps the network alive, trustworthy, and generative over time.

`context/audience.md` defines the reader as knowledge workers and professionals
who want to grow their expertise systematically and stay current in a fast-changing
field.

`research/open-questions.md` exists and carries three open entries from the
intake interview.

The craft model selected at intake was `big-idea`. The file
`templates/craft-models/big-idea.yaml` exists.

---

## Session: building the outline

**Author:** `/nonfiction-studio:outline-book`

The `outline-book` skill confirms `structure/thesis.md` is present and reviewed.
It routes to `structure-architect`.

**structure-architect:**

> I read `templates/craft-models/big-idea.yaml`: central premise stated early;
> each chapter adds evidence and extension. The `big-idea` shape maps well to the
> five-claim spine: the thesis is stated up front, and chapters layer the
> evidence and mechanics behind each claim.
>
> I read `structure/thesis.md`: five spine claims confirmed by the author. I read
> `context/audience.md`: knowledge workers who want systematic expertise growth.
> I read `research/open-questions.md`: three existing entries noted for duplicate
> avoidance.
>
> Here is my proposed chapter mapping against the spine:
>
> - **Chapter 1: Listening Before Speaking** - spine claim 2 (listening and source
>   selection as foundational skills). Opens with the observation that most people
>   enter learning communities broadcasting before they understand the room. A
>   listening-first posture is the gateway behavior.
>
> - **Chapter 2: Finding Your Network** - spine claim 3 (the network as a durable
>   personal asset built around a question, not a platform). Source selection is
>   the first act of ownership.
>
> - **Chapter 3: Your Curation Practice** - spine claims 1 and 4 together
>   (deliberate curation produces compound gains; sustainable practice is a small
>   set of recurring habits). The daily and weekly routine that closes the
>   feedback loop.
>
> - **Chapter 4: Making Connections** - spine claim 5 (reciprocity keeps the
>   network alive). Moving from observer to participant through low-stakes,
>   consistent contribution.
>
> - **Chapter 5: Contributing Value** - spine claim 1 extended (show your work;
>   the mechanism of compound learning is visible contribution). The most effective
>   contributions share reasoning and process, not just conclusions.
>
> - **Chapter 6: The Compounding Effect** - synthesis across all five claims.
>   Returns on a well-maintained network accelerate over time as inputs,
>   relationships, and contributions reinforce each other.
>
> No gaps detected: all six chapters map to at least one spine claim and the
> `big-idea` shape is fully satisfied. No `[GAP]` markers are needed.
>
> Dependency cross-check: Chapter 2 builds on the listening posture introduced in
> Chapter 1. Chapter 3 builds on the source selection from Chapter 2. Chapter 4
> introduces reciprocity as a behavior that presupposes a working curation
> practice from Chapter 3. Chapter 5 presupposes the contribution behavior from
> Chapter 4. Chapter 6 synthesizes all prior chapters. Chapter 1 has no incoming
> dependencies and may be drafted independently.
>
> Does this mapping look right, or do you want to adjust before I build the full
> blocks?

**Author:** "That looks right. Chapters 3 and 5 both touch the compound-learning
claim - is that a problem?"

**structure-architect:**

> No. In a `big-idea` structure, the central mechanism (closing the feedback
> loop) can and should appear in multiple chapters from different angles. Chapter
> 3 shows it through habit and routine; Chapter 5 shows it through visible
> contribution. The thesis link in each block will name the specific angle so the
> reader tracks how the claim accumulates. Do you want to proceed to the full
> chapter blocks?

**Author:** "Yes."

**structure-architect:**

> Here is the complete proposed outline. I will wait for your confirmation before
> writing anything to disk.
>
> ---
>
> **Chapter 1: Listening Before Speaking**
> Promise: Readers learn why a listening-first posture accelerates trust-building
> and learning in any new community.
> Payoff: The chapter opens with a contrast between a broadcaster and a listener
> entering the same community, then grounds the behavior in research on legitimate
> peripheral participation and listen-to-speak ratios.
> Thesis link: Advances spine claim 2 - listening and source selection are the
> foundational skills; this chapter establishes the listening half.
>
> [... and so on for all six chapters ...]
>
> **Evidence needed across the outline:**
> - Chapter 1: legitimate peripheral participation research (EV-NEEDED)
> - Chapter 1: listen-to-speak ratio data (EV-NEEDED)
> - Chapter 1: passive consumption rate in professional communities (EV-NEEDED)
> - Chapter 2: curation satisfaction research (EV-NEEDED)
> - Chapter 2: weak-ties novelty data (EV-NEEDED)
> - Chapter 2: Dunbar limit relevance to learning networks (EV-NEEDED)
> - Chapter 2: source diversity and retention correlation (EV-NEEDED)
>
> Does this plan match your intent? I will write `structure/outline.md`,
> `structure/chapter-list.md`, and the `research/open-questions.md` appends
> only after you confirm.

**Author:** "Yes. Write it."

The agent writes three files.

---

## structure/outline.md (excerpt showing one complete block)

```markdown
# Outline

## Argument arc
The book moves the reader from passive observer to active participant in a personal
learning network. Each chapter adds one layer of the practice: beginning with the
mindset (listen first), moving through the mechanics (who to follow, how to
curate), and arriving at the compounding effects of a well-maintained network over
time.

## Chapter summaries

## Chapter 1: Listening Before Speaking

**Promise:** The reader learns why a listening-first posture accelerates
trust-building and expertise growth in any new learning community.
**Payoff:** The chapter opens with a contrast between a broadcaster and a
listener entering the same online community, grounds the behavior in research on
legitimate peripheral participation, and closes with a practical diagnostic the
reader can apply immediately.
**Thesis link:** Advances spine claim 2 - listening and intentional source
selection are the foundational skills of a personal learning network. This chapter
establishes the listening half before Chapter 2 addresses source selection.

### Key beats

1. Opening: two people join the same Slack community on the same day; one
   broadcasts, one observes; the observer builds relationships faster.
2. Main argument: legitimate peripheral participation is not lurking - it is how
   expertise communities have always inducted newcomers.
3. Evidence anchor: listen-to-speak ratios in high-trust professional communities;
   passive consumption rate before first contribution.
4. Closing: the listening diagnostic - three questions the reader answers before
   their first post in a new community.

### Evidence needed

- [ ] EV-NEEDED: Legitimate peripheral participation research (Lave and Wenger
  or equivalent) - the academic grounding for observation-before-contribution.
- [ ] EV-NEEDED: Listen-to-speak ratio data in professional communities - quantified
  support for the contrast in the opening beat.
- [ ] EV-NEEDED: Passive consumption rate - what percentage of community members
  consume without posting and for how long before first contribution.

### Dependencies

- **Requires:** (none - this chapter may be drafted independently)
- **Informs:** Chapter 2 (source selection presupposes the reader has established
  a listening posture; the diagnostic in this chapter is the bridge)
```

---

## structure/chapter-list.md

```markdown
# Chapter List

| # | Working title | Slug | Promise |
|---|---|---|---|
| 1 | Listening Before Speaking | 01-listening-before-speaking | The reader learns why a listening-first posture accelerates trust-building and expertise growth in any new learning community. |
| 2 | Finding Your Network | 02-finding-your-network | The reader learns to build a personal learning network around a question, not a platform, and to select sources deliberately rather than by algorithm. |
| 3 | Your Curation Practice | 03-your-curation-practice | The reader builds a sustainable daily and weekly curation routine that closes the feedback loop between reading and applied learning. |
| 4 | Making Connections | 04-making-connections | The reader learns to move from observer to participant through low-stakes, consistent contribution before high-stakes asks. |
| 5 | Contributing Value | 05-contributing-value | The reader learns that sharing reasoning and process - not just conclusions - is the contribution that compounds learning for both giver and receiver. |
| 6 | The Compounding Effect | 06-the-compounding-effect | The reader sees how inputs, relationships, and contributions reinforce each other over time and produce returns that accelerate. |
```

---

## research/open-questions.md appends (excerpt)

The following entries were appended atomically in the same invocation as the
outline write. They give `research-librarian` a concrete work queue.

```markdown
## OQ-004: Legitimate peripheral participation research

Source chapter: Chapter 1 (Listening Before Speaking)
Outline item: EV-NEEDED: Legitimate peripheral participation research
Question: What is the best primary source for Lave and Wenger's legitimate
peripheral participation concept, and is there a more recent replication or
extension in professional online communities?
Status: open

## OQ-005: Listen-to-speak ratio data

Source chapter: Chapter 1 (Listening Before Speaking)
Outline item: EV-NEEDED: Listen-to-speak ratio data in professional communities
Question: Is there quantified research on listen-to-speak ratios in
professional Slack communities or similar environments, distinct from general
social media lurk ratios?
Status: open
```

---

## Key assertions from this transcript

- **Craft model check first.** The agent reads `templates/craft-models/big-idea.yaml`
  before doing any other work. If that file had been absent, the agent would have
  surfaced the path and halted rather than guessing a chapter shape.
- **No silent craft-model default.** The `big-idea` model was confirmed at intake;
  if no model had been selected, the agent would have presented the six options
  and waited for the author's choice before proceeding.
- **All five spine claims are covered.** Every chapter block names the spine claim
  it advances in its Thesis link field. No chapter is written without one.
- **No gaps in this instance.** The six-chapter plan fully satisfies the `big-idea`
  shape and all five spine claims. A book with a missing transition chapter would
  produce `[GAP]` markers and a pause for author disposition before any writing.
- **Dependency cross-check in both directions.** Chapter 1 names "Informs: Chapter
  2" in its Dependencies block; Chapter 2 names "Requires: Chapter 1" in its
  Dependencies block. Both entries are written by the same invocation.
- **Confirm before write.** The agent presents the full proposed plan and waits for
  explicit author confirmation before writing any file to disk.
- **Three outputs in one invocation.** `structure/outline.md`,
  `structure/chapter-list.md`, and the `research/open-questions.md` appends are
  all written in the same invocation. The appends are never deferred.
- **Chapter-list has no word-count column.** Word counts are owned by the
  `PostToolBatch` hook and written to `.studio/progress.json` per D-06 (single-writer
  state discipline). The chapter list carries only number, working title, slug, and
  promise.
- **Slugs match the pattern.** Every slug in the chapter-list matches
  `^[0-9]{2}-[a-z0-9-]+$`: two-digit ordinal, hyphen, lowercase kebab title.
  These slugs correspond to the chapter filenames under `chapters/`.
- **Evidence-needed pipeline boundary respected.** The agent owns only the first
  two steps: writing EV-NEEDED items into chapter blocks and appending them to
  `research/open-questions.md`. Resolving them to ledger entries belongs to
  `research-librarian` per S-03 (agents: research and evidence).
- **No prose drafted.** The agent produces architecture, not prose. Inviting the
  author to draft Chapter 1 next belongs to `drafting-partner`, not here.
