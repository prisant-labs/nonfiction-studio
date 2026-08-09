---
title: "outline-book worked example"
description: "Single-session transcript of a full-scope outline-book run for The Quiet Network - shows the confirmed-brief probe, thesis check, structure-architect invocation, author review, and Read-check confirmations"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "outline", "structure", "example"]
---

# outline-book - worked example

This is a condensed transcript of an `outline-book` run for the sample book "The Quiet Network" (see `examples/sample-book/`). The author invokes with the default `full` scope. The confirmed-brief probe returns `CONFIRMED`. `structure/thesis.md` already exists from a prior `thesis-architect` run, so `thesis-architect` is not re-invoked. `structure-architect` is invoked and produces a six-chapter architecture. The author accepts the plan. The skill confirms both output files via Read checks and closes with next-step suggestions. The committed `structure/outline.md` and `structure/chapter-list.md` in `examples/sample-book/structure/` cover the same six chapters but predate the structure-architect format contracts (their normalization to the contracted formats is queued); this transcript illustrates the contracted formats a fresh run produces. The example follows the flow specified in S-06 3.4 (skills and invocation surface) and the adjudications recorded in TSK-047 (outline-book skill).

---

## Session: existing thesis, full-scope run, six-chapter outline accepted

**Author:** `/nonfiction-studio:outline-book`

**Studio (Step 1 - Confirmed-brief probe):**

The skill uses the Bash tool:
```
if [ ! -f context/brief.md ] || grep -q '<!-- DRAFT' context/brief.md; then echo UNCONFIRMED; else echo CONFIRMED; fi
```
Output: `CONFIRMED`

`context/brief.md` exists and contains no DRAFT-block markers. The brief is confirmed.

**Studio (Step 2 - Thesis check):**

Scope is `full` (no argument given). The skill uses the Read tool on `structure/thesis.md`.

The file is present and non-empty. The skill presents the controlling idea to the author:

> `structure/thesis.md` is present. The controlling idea:
>
> Building a personal learning network is a deliberate, ongoing practice - not a passive accumulation of follows and subscriptions - and the professionals who treat it as a system compound their expertise faster than those who do not.
>
> Proceed with this thesis, or invoke `thesis-architect` to revise it before building the outline?

**Author:** "Proceed with the existing thesis."

**Studio (Step 3 - Invoke structure-architect):**

The skill uses the Read tool on `research/evidence-log.md`. The file is present and contains evidence entries (EV-0001 through EV-0009).

The `structure-architect` agent is spawned via the `outline-book -> structure-architect` chain edge with:
- The content of `context/brief.md` (genre: practical non-fiction; six-chapter scope; 30,000 word target)
- The content of `structure/thesis.md`
- The nine evidence entries from `research/evidence-log.md`

**Structure-architect agent (summary of actions):**

The agent reads `templates/craft-models/how-to.yaml` (the craft model selected at intake), reads `context/audience.md` for reader calibration, and reads `research/open-questions.md` for existing entries to avoid duplicates.

Using the `how-to` craft model shape and the thesis argument as the dual skeleton, the agent maps the six-step learning journey to chapters:

```
01-listening-before-speaking  - Listening Before Speaking
02-finding-your-network       - Finding Your Network
03-your-curation-practice     - Your Curation Practice
04-making-connections         - Making Connections
05-contributing-value         - Contributing Value
06-the-compounding-effect     - The Compounding Effect
```

Each chapter block includes a promise, payoff, thesis link, key beats (four per chapter), evidence-needed items, and dependency links. The agent identifies no scope-creep gaps. The evidence entries for chapters 1 and 2 (EV-0001 through EV-0009) are mapped to their anchor chapters; chapters 3 through 6 carry EV-NEEDED items for evidence to be gathered in a future `research-pass`.

The agent presents the full proposed plan with all six chapter blocks, the chapter-list preview, and the evidence-needed summary to the author for review.

**Studio (Step 4 - Review and amendments):**

The skill presents the full outline to the author.

**Author:** "This is the structure. Confirm."

**Structure-architect writes the three outputs:**

1. `structure/outline.md` - the six-chapter architecture with all chapter blocks per the agent's format contract (Promise, Payoff, Thesis link, Key beats, Evidence needed, Dependencies)
2. `structure/chapter-list.md` - the slug registry with one row per chapter (number, working title, slug, one-line promise)
3. `research/open-questions.md` - four EV-NEEDED items appended (one per un-evidenced chapter: chapters 3-6), in the same invocation

**Studio (Step 5 - Confirm outputs):**

The skill uses the Read tool on `structure/outline.md`. The file is present with all six chapter blocks.

The skill uses the Read tool on `structure/chapter-list.md`. The file is present with six rows:

```
| # | Working title | Slug | Promise |
|---|---|---|---|
| 1 | Listening Before Speaking | 01-listening-before-speaking | ... |
| 2 | Finding Your Network | 02-finding-your-network | ... |
| 3 | Your Curation Practice | 03-your-curation-practice | ... |
| 4 | Making Connections | 04-making-connections | ... |
| 5 | Contributing Value | 05-contributing-value | ... |
| 6 | The Compounding Effect | 06-the-compounding-effect | ... |
```

Both checks pass.

**Studio:**

> The chapter list in `structure/chapter-list.md` is the locked chapter registry. The six slug rows are the authoritative identifiers for all downstream work: drafting, fact-checking, and the quality gate all resolve chapters by slug. The skill writes no `.studio/` state; the PostToolBatch hook creates progress entries the first time each chapter file is written.
>
> `context/style-profile.md` is not yet present. Optional next steps:
>
> 1. Run `capture-voice` to build the voice baseline before drafting: `/nonfiction-studio:capture-voice`
> 2. Run `research-pass` to gather evidence for the chapters with open EV-NEEDED items: `/nonfiction-studio:research-pass`
> 3. Start drafting with `draft-chapter`: `/nonfiction-studio:draft-chapter 01-listening-before-speaking`
>
> None of these is required before the others.

---

## Key assertions from this transcript

- **Confirmed-brief probe is a tool call.** The Bash call on `context/brief.md` determines the `CONFIRMED`/`UNCONFIRMED` token before any other work begins. No prose inference substitutes for the tool result.
- **Thesis check is a Read call.** The skill reads `structure/thesis.md` before deciding whether to invoke `thesis-architect`. In this run the file exists; `thesis-architect` is not invoked.
- **Two-revision-pass cap is not triggered.** The author accepts the existing thesis immediately. The cap applies only when the author rejects a thesis produced or revised by `thesis-architect`.
- **Craft-model selection belongs to the agent.** The skill does not ask the author to choose a craft model; `structure-architect` reads the model from the config and selects `how-to.yaml`. Absent or misconfigured craft model YAML would halt the agent with a clear error, not the skill.
- **All three structure writes are the agent's.** `structure/outline.md`, `structure/chapter-list.md`, and the `research/open-questions.md` appends are written by `structure-architect` in the same invocation after author confirmation. The skill writes none of them.
- **No `.studio/progress.json` write.** The locked chapter registry is `structure/chapter-list.md`. The PostToolBatch hook creates progress entries when chapter files are first written; the skill does not initialize slots in `.studio/progress.json`.
- **Read checks are mandatory.** The skill reads both output files after the agent completes. Only when both checks pass does the skill close with suggestions.
- **Amendments route to the agent.** If the author had requested changes in Step 4, the skill would re-invoke `structure-architect` with the change notes, not edit the files directly.
