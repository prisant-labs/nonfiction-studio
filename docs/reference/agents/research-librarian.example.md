---
title: "research-librarian worked example"
description: "Condensed transcript of a research session for The Quiet Network - shows source registration, EV entry logging, deduplication, confidence assignment, and the web gate in action"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "research", "evidence", "sources", "ledger", "example"]
---

# research-librarian - worked example

This is a condensed transcript of a `research-librarian` session for the sample
book "The Quiet Network" (see `examples/sample-book/`). It shows source
registration, EV entry logging, the source-first and confidence-recording
contracts in action, the deduplication check, and the web gate declining a web
request. It follows the contracts specified in S-03 (research and evidence
agents).

---

## Setup: what was already in place

The `structure-architect` session had written the outline and appended open
questions to `research/open-questions.md`. One unresolved item requested primary
research on how visible contribution accelerates learning in professional
communities of practice - the evidence needed for Chapter 5 (Contributing Value):

```
## OQ-009: Contribution and community engagement research

Source chapter: Chapter 5 (Contributing Value)
Outline item: EV-NEEDED: Research on how contribution behavior accelerates
  learning in professional communities of practice.
Question: Is there primary research on the mechanism by which visible
  contribution - sharing reasoning, process, and questions - accelerates
  learning for the contributor as well as the reader?
Status: open
```

The ledger at session start:
- `research/evidence-log.md`: 10 entries, highest is EV-0010 (pacing recommendation)
- `research/sources.md`: 6 records, highest is SRC-0006 (Lave and Wenger 1991)

Web research is disabled for this project (`research.web_enabled` is absent from
`.studio/config.json`).

The author has provided a physical book: Etienne Wenger, "Communities of
Practice: Learning, Meaning, and Identity," Cambridge University Press, 1998,
ISBN 978-0521663632.

---

## Session: registering the source and logging evidence

**Author:** `/nonfiction-studio:research-pass`

The `research-pass` skill routes to `research-librarian`.

**research-librarian:**

> I read `research/evidence-log.md`: 10 entries, highest ID is EV-0010
> (pacing recommendation). The next EV ID will be EV-0011.
>
> I read `research/sources.md`: 6 records, highest ID is SRC-0006
> (Lave and Wenger 1991). Before allocating a new SRC ID, I will confirm whether
> Wenger 1998 is already registered.
>
> Wenger 1998 is not in the source registry. The next SRC ID is SRC-0007.
>
> I read `research/open-questions.md`: OQ-009 requests primary research on how
> visible contribution accelerates learning in communities of practice.
>
> The provided source is a foundational primary text for this topic. Wenger 1998
> theorizes directly how members of communities of practice move from peripheral
> to full participation through increasingly complex engagement, and how the
> interplay of participation and reification sustains community knowledge. This
> source supports at least two claims relevant to Chapter 5.
>
> Here are the two EV entries I propose to log, pending your confirmation:
>
> **EV-0011 (contribution-transition)**
> Claim: Members of communities of practice move from peripheral to full
> participation through increasingly complex engagement, not through explicit
> instruction.
> Source: SRC-0007 (to be registered as Wenger 1998)
> Locator: pp. 98-99
> Confidence: high - directly stated in a primary source
>
> **EV-0012 (reification-participation)**
> Claim: Sustaining learning in a community requires a balance between
> participation and reification; neither alone produces durable knowledge.
> Source: SRC-0007
> Locator: pp. 57-58
> Confidence: high - directly stated in a primary source
>
> Wenger 1998 is original theorization, not a synthesis or commentary, so the
> `nature` field will be `primary` and the `type` will be `book`.
>
> Before writing anything: do these claims accurately represent what you found at
> those page ranges?

**Author:** "Yes for EV-0011. For EV-0012 the fuller passage spans pp. 57-63,
not just 57-58. Adjust that and go ahead."

**research-librarian:**

> Noted - I will use `pp. 57-63` for EV-0012.
>
> The source record writes first; no EV entry is logged until SRC-0007 is in
> `research/sources.md`.

The agent writes SRC-0007, then EV-0011, then EV-0012.

---

## research/sources.md append

```markdown
### SRC-0007 (Wenger 1998)
- type: book
- nature: primary
- author: Wenger, Etienne
- title: Communities of Practice: Learning, Meaning, and Identity
- year: 1998
- publisher: Cambridge University Press
- identifier: ISBN 978-0521663632
- url:
- accessed:
- retrieval-status: stable
```

---

## research/evidence-log.md appends

```markdown
### EV-0011 (contribution-transition)
- claim: Members of communities of practice move from peripheral to full participation through increasingly complex engagement, not through explicit instruction.
- source: SRC-0007
- locator: pp. 98-99
- confidence: high
- status: pending
- added-by: research-librarian
- date: 2026-07-18

### EV-0012 (reification-participation)
- claim: Sustaining learning in a community requires a balance between participation and reification; neither alone produces durable knowledge.
- source: SRC-0007
- locator: pp. 57-63
- confidence: high
- status: pending
- added-by: research-librarian
- date: 2026-07-18
```

---

## research/open-questions.md update

The agent marks OQ-009 resolved:

```markdown
## OQ-009: Contribution and community engagement research

Source chapter: Chapter 5 (Contributing Value)
Outline item: EV-NEEDED: Research on how contribution behavior accelerates
  learning in professional communities of practice.
Question: Is there primary research on the mechanism by which visible
  contribution - sharing reasoning, process, and questions - accelerates
  learning for the contributor as well as the reader?
Status: resolved
Resolved-by: EV-0011 (contribution-transition), EV-0012 (reification-participation), SRC-0007 (Wenger 1998)
```

---

## Deduplication check: a second Wenger title

Later in the same session, the author mentions a related source.

**Author:** "I also want to use Wenger's 2002 book co-authored with McDermott
and Snyder - 'Cultivating Communities of Practice.' Different title, different
ISBN."

**research-librarian:**

> I am checking `research/sources.md` for any existing record of "Cultivating
> Communities of Practice" by Wenger, McDermott, and Snyder. Two records carry
> Wenger as an author: SRC-0006 (Lave and Wenger 1991), "Situated Learning",
> and SRC-0007 (Wenger 1998), registered earlier in this session. Both are
> different titles and different works, so neither is a duplicate of the
> requested source. A new SRC record is appropriate.
>
> SRC-0007 (Wenger 1998) was registered earlier in this session, so the next
> available SRC ID is SRC-0008. Do you want to provide the publication details
> now so I can register it?

**Author:** "Not yet - I will return to it in a later session."

No new record is written. The deduplication check confirms the agent reads the
current in-session state of `research/sources.md` - including SRC-0007 just
written - before allocating the next ID.

---

## Web gate declined

Earlier in the session the author asked whether more recent empirical research on
communities of practice was available online.

**research-librarian:**

> Web research is not enabled for this project. The `research.web_enabled` field
> is absent from `.studio/config.json`, which leaves the gate closed. No
> WebSearch or WebFetch call will be made.
>
> To enable web research for this project, add the following to
> `.studio/config.json`:
>
> ```json
> "research": {
>   "web_enabled": true
> }
> ```
>
> Once that key is set to boolean `true`, the agent will announce search terms
> before each call and register every fetched source as a SRC record before
> logging any derived EV entry.

---

## Key assertions from this transcript

- **Read before allocate.** The agent reads both ledger files at the start of the
  session to establish the current highest IDs (EV-0010, SRC-0006) before writing
  anything. When SRC-0007 is registered within the session, the agent's next SRC
  allocation correctly begins from SRC-0008.
- **Source registers first.** SRC-0007 is written to `research/sources.md`
  before EV-0011 and EV-0012 are written. No EV entry is logged until its source
  is in the registry.
- **Author confirmation before write.** The agent presents the proposed claims
  and locators and waits for explicit author confirmation. The locator for
  EV-0012 was corrected (pp. 57-58 to pp. 57-63) before any write.
- **Deduplication in-session.** When the author mentions a second Wenger title,
  the agent checks `research/sources.md` including SRC-0007 just written in the
  same session. The check correctly identifies that the proposed new source is a
  distinct work and that the next ID would be SRC-0008.
- **Confidence assigned at high.** Both EV entries carry `confidence: high`
  because both claims are directly stated in a primary source (original
  theorization, not synthesis). A secondary source citing Wenger would warrant
  `confidence: medium`.
- **Nature is primary.** Wenger 1998 is original theorization; `nature: primary`
  is correct. A news article or textbook chapter summarizing Wenger would use
  `nature: secondary` with `type: article` or `type: book` accordingly.
- **Status is pending.** Both EV entries land at `status: pending`. Only
  `fact-checker` may advance them to `verified`, `unverified`, or any other
  status.
- **Web gate is hard.** When the author requested web research, the agent
  declined without attempting any WebSearch or WebFetch call, stated the reason
  (gate closed), and provided the exact config change needed to open the gate.
- **Write grammar.** Every field in both ledger files matches the field grammar in
  `docs/formats/evidence-log.md` and `docs/formats/sources.md`; the entries parse
  correctly under `bin/ns-claims` and `bin/ns-doctor`.
- **Open-question resolved atomically.** OQ-009 was marked resolved in the same
  session that logged EV-0011 (contribution-transition) and EV-0012
  (reification-participation). The resolution note cites both EV IDs and
  SRC-0007 (Wenger 1998).
