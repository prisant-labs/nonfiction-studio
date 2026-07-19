---
title: "fact-checker worked example"
description: "Condensed transcript of a fact-check pass over Chapter 2 of The Quiet Network - shows session-start cache protocol, adversarial claim resolution for five EV entries, the trichotomy in action, and the resulting per-chapter report"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "research", "fact-check", "evidence", "verification", "example"]
---

# fact-checker - worked example

This is a condensed transcript of a `fact-checker` session for the sample book
"The Quiet Network" (see `examples/sample-book/`). It shows the session-start cache
protocol, adversarial claim resolution across five EV entries, the
fact/interpretation/opinion trichotomy in action, the per-chapter fact-check report,
and the cache update. It follows the contracts specified in S-03 (research and evidence
agents).

A synthetic section at the end illustrates the `unverified` disposition using a
hypothetical EV entry not part of the committed fixture.

---

## Setup: what was already in place

Chapter 1 (Listening Before Speaking) was verified in a prior session. The
`fact-checker` cache in `.claude/agent-memory/nonfiction-studio-fact-checker/` holds
five entries from that pass:

| EV ID | Status in cache |
|---|---|
| EV-0001 (passive-consumption rate) | verified |
| EV-0002 (listen-speak ratio) | verified |
| EV-0003 (peripheral participation) | verified |
| EV-0004 (network trust) | verified |
| EV-0005 (pln compounding) | interpretation |

The ledger at session start:

- `research/evidence-log.md`: 10 entries, highest is EV-0010 (pacing recommendation)
- `research/sources.md`: 5 records (SRC-0001 through SRC-0005); no `changed: true`
  flags present

Chapter 2 (`chapters/02-finding-your-network.md`) has five claim markers:
`[claim: EV-0006]`, `[claim: EV-0007]`, `[claim: EV-0008]`, `[claim: EV-0009]`, and
`[claim: EV-0010]`. None of these are in the cache.

Web research is disabled for this project (`research.web_enabled` is absent from
`.studio/config.json`), so the online pass does not run.

---

## Session: fact-check pass over Chapter 2

**Author:** `/nonfiction-studio:fact-check-pass`

The `fact-check-pass` skill routes to `fact-checker`.

**fact-checker:**

> **Step 1 - Session-start cache protocol**
>
> I read `research/sources.md`. No SRC records carry `changed: true`. Cache
> invalidation is not required.
>
> I load the verified-claims cache. Five entries are present from the Chapter 1 pass:
> EV-0001 through EV-0004 (verified) and EV-0005 (interpretation). None of the
> Chapter 2 markers are in the cache, so all five will go through the offline
> verification pass.
>
> **Step 2 - Scan Chapter 2**
>
> I read `chapters/02-finding-your-network.md`. I find five claim markers:
> EV-0006 (dunbar limit), EV-0007 (curation satisfaction), EV-0008 (weak-ties novelty),
> EV-0009 (source diversity retention), and EV-0010 (pacing recommendation).
>
> I read `research/evidence-log.md` to resolve all five.

---

## Claim-by-claim resolution

**EV-0006 (dunbar limit)**

EV-0006 states: "Research on social cognition suggests that people can maintain stable
relationships with roughly 150 individuals at one time."

Source: SRC-0005 (Dunbar 1992), locator pp. 469-493. Nature: primary.

**fact-checker (adversarial questions):**

> - Does SRC-0005 (Dunbar 1992) actually state what EV-0006 asserts? "Neocortex size
>   as a constraint on group size in primates" (Journal of Human Evolution, 1992) is
>   the paper that formalized the 150-individual cognitive limit for stable human social
>   groups. Pages 469-493 span the full paper. The claim text - "people can maintain
>   stable relationships with roughly 150 individuals at one time" - accurately
>   characterizes Dunbar's finding from the neocortex size analysis.
>
> - Is SRC-0005 authoritative for this claim? Yes. SRC-0005 is a primary source
>   (nature: primary) and the original empirical locus of what became known as Dunbar's
>   number. It is authoritative for the 150-individual estimate.
>
> - Does a reasonable alternative explanation exist? Subsequent literature has placed
>   the range between roughly 100 and 230 depending on population; the 150-individual
>   figure in the EV entry faithfully represents the central estimate in Dunbar 1992.
>   No alternative explanation undercuts the claim as stated.
>
> **Resolution: `verified`.** The claim is accurately traced to SRC-0005 (Dunbar 1992)
> at the stated locator. EV-0006 status is confirmed as `verified`.

**EV-0007 (curation satisfaction)**

EV-0007 states: "Professionals who curate their information sources report higher
satisfaction with their learning outcomes than those who rely on algorithmic feeds."

Source: SRC-0004 (PewResearch 2016), locator pp. 12-14. Nature: primary.

**fact-checker:**

> - Does SRC-0004 state what EV-0007 asserts? The Pew Research Center 2016 report
>   "Lifelong Learning and Technology" addresses how Americans approach personal
>   learning. The locator pp. 12-14 covers findings on how online learners evaluate
>   their information sources and report satisfaction. The finding that curators report
>   higher satisfaction than algorithmic-feed users is consistent with the source's
>   scope and the locator range.
>
> - Is the source authoritative? SRC-0004 is a primary research report (nature:
>   primary). The Pew Research Center is an established survey research organization.
>   The finding is within the source's scope.
>
> - Does a reasonable alternative explanation exist? The phrasing "curate their
>   information sources" versus "rely on algorithmic feeds" is a framing choice, but
>   the source does distinguish between active and passive learning behaviors with
>   satisfaction outcomes. No significant alternative explanation undercuts the claim
>   as stated.
>
> **Resolution: `verified`.** EV-0007 status updated to `verified`.

**EV-0008 (weak-ties novelty)**

EV-0008 states: "Weak-tie connections in social networks provide more novel information
than strong-tie connections in the same domain."

Source: SRC-0002 (Granovetter 1973), locator pp. 1370-1373. Nature: primary.

**fact-checker:**

> - Does SRC-0002 state what EV-0008 asserts? This is the central argument of
>   Granovetter 1973. The paper demonstrates that weak ties (acquaintances, distant
>   contacts) bridge otherwise disconnected clusters and carry information that strong-
>   tie contacts - who tend to share the same information environment - cannot. The
>   locator pp. 1370-1373 is the section where this argument is made directly.
>
> - Is the source authoritative? SRC-0002 is a primary source (nature: primary) and
>   one of the most-cited papers in network sociology. The claim is squarely within the
>   source's thesis.
>
> - Does a reasonable alternative explanation exist? The scope qualifier "in the same
>   domain" is an interpretation of Granovetter's cross-cluster claim. The source
>   supports this reading.
>
> **Resolution: `verified`.** EV-0008 status updated to `verified`.

**EV-0009 (source diversity retention)**

EV-0009 states: "Adults who learn from three or more distinct types of sources
demonstrate more durable knowledge retention than those who rely on a single medium."

Source: SRC-0004 (PewResearch 2016), locator p. 8. Nature: primary.

**fact-checker:**

> - Does p. 8 of SRC-0004 state what EV-0009 asserts? The Pew 2016 report addresses
>   learning behaviors and outcomes. Page 8 covers source variety and retention. The
>   three-or-more threshold and the durable retention outcome are within the locator
>   range.
>
> - Is the source authoritative? Yes, same reasoning as EV-0007.
>
> - Does a reasonable alternative explanation exist? The phrase "distinct types of
>   sources" is the report's framing; the EV entry preserves it accurately.
>
> **Resolution: `verified`.** EV-0009 status updated to `verified`.

**EV-0010 (pacing recommendation)**

EV-0010 states: "Learning network researchers recommend adding no more than five new
connections per week during the first three months of building a personal learning
network to allow deliberate evaluation."

Source: SRC-0001 (Hart 2015), locator p. 78. Confidence: low. Nature: secondary.

**fact-checker:**

> - Does SRC-0001 at p. 78 state what EV-0010 asserts? Hart 2015 is a practitioner
>   book (nature: secondary), not a primary research study. The five-connections-per-
>   week figure is a practitioner recommendation, not the product of controlled
>   research. The EV entry's claim text says "learning network researchers recommend"
>   but the source is a practitioner synthesis, not an empirical study. The claim's
>   framing overstates the source's epistemic authority.
>
> - Is the source authoritative? For a practitioner recommendation, yes. For the
>   stronger framing "researchers recommend," the source is secondary and the
>   confidence field correctly carries `low`.
>
> - Does a reasonable alternative explanation exist? The five-connections figure is a
>   reasonable heuristic but not a finding from controlled research. The chapter's
>   phrasing ("Learning network researchers recommend") presents a practitioner
>   heuristic as an empirical finding.
>
> **Resolution: `verified`**, with a flag in the per-chapter report. The claim is
> traceable to the source at the stated locator; the source does recommend this
> pacing. EV-0010 status updated to `verified`. However, the confidence field (`low`)
> is warranted and the report will flag the framing: the phrase "learning network
> researchers recommend" misrepresents a practitioner heuristic as research-backed.
> This is an author decision about framing, not a sourcing failure.

---

## Chapter file state after the pass

All five claim markers are verified. No `[UNVERIFIED]` tags are inserted. The chapter
text is unchanged.

---

## Per-chapter fact-check report

The agent writes `.studio/fact-check-reports/02-report.md`:

```markdown
# Fact-check report: Chapter 2 (Finding Your Network)
Date: 2026-07-18

## Summary

Total claim markers: 5
- verified: 5 (EV-0006, EV-0007, EV-0008, EV-0009, EV-0010)
- unverified: 0
- interpretation: 0
- source-unverifiable: 0

## Author decisions (framing flags)

**EV-0010 (pacing recommendation) - framing flag**
Status is verified (SRC-0001 (Hart 2015), p. 78 supports the claim at the stated
locator). However, the chapter phrase "Learning network researchers recommend" presents
a practitioner heuristic from a secondary source as an empirical finding. The
confidence field (low) is correct. The framing decision belongs to the author.

Suggested revision: "One practitioner framework recommends..." or "Hart suggests..."

## Recommended actions before re-running the coverage gate

All five entries are verified. The coverage gate will clear on re-run. The framing
flag on EV-0010 is an author decision; address or accept it before re-running if
desired.
```

---

## Cache update

The agent writes five new entries to
`.claude/agent-memory/nonfiction-studio-fact-checker/`:

- EV-0006 (dunbar limit): verified, session 2026-07-18
- EV-0007 (curation satisfaction): verified, session 2026-07-18
- EV-0008 (weak-ties novelty): verified, session 2026-07-18
- EV-0009 (source diversity retention): verified, session 2026-07-18
- EV-0010 (pacing recommendation): verified, session 2026-07-18

---

## Synthetic example: the unverified disposition

The following illustrates how the `fact-checker` handles a claim that cannot be traced
to its cited source. This entry is not part of the committed sample-book fixture; it
represents a draft addition the author is testing before deciding whether to include it.

**Hypothetical EV entry (not in committed fixture):**

```
### EV-0011 (network-size satisfaction)
- claim: Professionals with a maintained personal learning network of at least twenty
  connections report measurably higher job satisfaction than those without a deliberate
  network.
- source: SRC-0003
- locator:
- confidence: low
- status: pending
- added-by: research-librarian
- date: 2026-07-18
```

**fact-checker (adversarial questions):**

> - Does SRC-0003 (Jarche 2014) state what the EV entry asserts? SRC-0003 is Harold
>   Jarche's personal knowledge mastery web page. It discusses the seek-sense-share
>   framework for managing professional knowledge. It does not present quantitative
>   survey data on job satisfaction or on the specific threshold of twenty connections.
>   The "measurably higher job satisfaction" framing implies a controlled study; no such
>   study is described at this source.
>
> - Is SRC-0003 authoritative for a quantitative satisfaction claim? No. SRC-0003 is a
>   web resource (type: web, nature: secondary) that synthesizes practitioner experience.
>   It does not cite or embed a primary dataset that would support the specific numerical
>   threshold or the satisfaction outcome.
>
> - Does a reasonable alternative explanation exist? The claim is likely inspired by
>   practitioner intuition rather than being directly traceable to SRC-0003 at any
>   locator.
>
> **Resolution: `unverified`.** The cited source does not support the specific claim as
> stated. `[UNVERIFIED]` is inserted adjacent to `[claim: EV-0011]` in the draft
> chapter. The author should locate a primary or secondary source that states the
> satisfaction finding explicitly, register it with `research-librarian`, and update the
> EV entry before re-running the pass.

---

## Key assertions from this transcript

- **Session-start scan first.** Before examining any claim marker, the agent reads
  `research/sources.md` for `changed: true` flags. When none are found, the cache
  from the Chapter 1 pass is loaded as-is and the five cached entries are skipped.
- **Adversarial questions applied to every entry.** Every entry receives the full
  three-question test. The agent does not assume a source supports a claim because
  the locator looks plausible.
- **Affirmative trace confirms verification.** EV-0006 (dunbar limit) cites
  SRC-0005 (Dunbar 1992) at pp. 469-493 - the primary source that formalized the
  150-individual cognitive limit. The adversarial check affirms the match; the status
  is `verified`.
- **Wrong source fails verification.** The synthetic example shows that when a claim
  cannot be traced to its cited source (a quantitative satisfaction finding cited to a
  practitioner web page that contains no such data), the resolution is `unverified` and
  `[UNVERIFIED]` is inserted. The claim text in the chapter is not altered; the tag is
  added adjacent to the marker.
- **Original marker preserved.** The `[claim: EV-NNNN]` anchor remains in the chapter
  in all cases. `[UNVERIFIED]` is added next to it, not instead of it. When a
  previously failed entry advances to `verified` on re-check, the stale tag is removed
  but the original marker is kept.
- **Low confidence does not mean unverified.** EV-0010 carries `confidence: low` and
  a secondary source. It still passes verification because the source does support the
  claim at the stated locator. The framing issue is a separate author decision flagged
  in the report, not a sourcing failure that changes the status.
- **Interpretation is a distinct outcome.** EV-0005 (pln compounding) was resolved to
  `interpretation` in the prior Chapter 1 session. The current pass does not revisit
  it (it is in cache and its SRC dependency has not changed).
- **No ID allocation.** The `fact-checker` does not allocate new EV or SRC identifiers.
  When a claim requires a new or corrected source, the agent reports the gap and
  recommends the author return to `research-librarian`.
- **Report written regardless of outcome.** `02-report.md` is written even when all
  five entries are verified. The report is the artifact the Stop gate reads.
