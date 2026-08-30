---
title: "nfs-research worked example"
description: "Condensed transcript of a chapter-scoped nfs-research session for The Quiet Network - shows the outline probe, chapter argument resolution, web gate disclosure, research-librarian delegation, and three-count summary"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "research", "evidence", "sources", "ledger", "example"]
---

# nfs-research - worked example

This is a condensed transcript of a chapter-scoped `nfs-research` session for the sample book "The Quiet Network" (see `examples/sample-book/`). The session scopes to Chapter 3 (Your Curation Practice, slug `03-your-curation-practice`). The outline probe returns `HAS_OUTLINE`. The chapter argument resolves cleanly against `structure/chapter-list.md`. The web gate is closed. The author provides source text for analysis; the `research-librarian` agent registers one new SRC record and logs two new EV entries. The session closes with the three-count summary. The example follows the flow specified in S-06 3.5 (skills and invocation surface) and the adjudications recorded in TSK-048 (research-pass skill).

**Session provenance note.** This example is an alternative illustration session that branches from the same committed ledger baseline as the `research-librarian` worked example (see `docs/reference/agents/research-librarian.example.md`). Both examples start from the committed state: EV-0010 is the highest EV entry (pacing recommendation) and SRC-0006 (Lave and Wenger 1991) is the highest SRC record. In practice only one session runs before the other, so the IDs EV-0011, EV-0012, and SRC-0007 do not conflict between the two examples - they represent independent hypothetical paths from the same baseline. The committed `research/evidence-log.md` and `research/sources.md` in `examples/sample-book/research/` carry the baseline state (10 EV entries, 6 SRC records); the new entries shown here are the hypothetical outcome of this session only.

---

## Setup: what was already in place

The `structure-architect` session had written the outline and appended open questions for all six chapters. Chapter 3 (Your Curation Practice) carries two unresolved items in `research/open-questions.md`:

```
## OQ-003: Information selection and curation psychology

Source chapter: Chapter 3 (Your Curation Practice)
Outline item: EV-NEEDED: Research on cognitive patterns distinguishing deliberate
  curators from passive information consumers.
Question: Is there research on how setting explicit selection criteria affects
  information consumption behavior and the quality of learning outcomes?
Status: open

## OQ-004: Attention and information overload

Source chapter: Chapter 3 (Your Curation Practice)
Outline item: EV-NEEDED: Data on information overload and its effect on
  professional learning quality.
Question: What does the evidence say about the relationship between information
  volume consumed per day and the quality of understanding retained?
Status: open
```

The ledger at session start:
- `research/evidence-log.md`: 10 entries, highest is EV-0010 (pacing recommendation)
- `research/sources.md`: 6 records, highest is SRC-0006 (Lave and Wenger 1991)

Web research is disabled for this project (`research.web_enabled` is absent from `.studio/config.json`).

The author has located a relevant book: Clay Johnson, "The Information Diet: A Case for Conscious Consumption," O'Reilly Media, 2012, ISBN 978-1449304683.

---

## Session: chapter-scoped research pass, gate closed, pasted source text

**Author:** `/nonfiction-studio:nfs-research 03-your-curation-practice`

**Studio (Step 1 - Outline probe):**

The skill uses the Bash tool:
```
test -f structure/outline.md && echo HAS_OUTLINE || echo NO_OUTLINE
```
Output: `HAS_OUTLINE`

`structure/outline.md` is present. Continue to Step 2.

**Studio (Step 2 - Chapter argument resolution):**

The skill uses the Read tool on `structure/chapter-list.md`. The registry contains six rows. The argument `03-your-curation-practice` matches the slug in row 3:

```
| 3 | 03-your-curation-practice | Your Curation Practice | outlined | 0 |
```

Chapter resolved: number 3, working title "Your Curation Practice", slug `03-your-curation-practice`.

**Studio (Step 3 - Load inputs, check web gate, and present agenda):**

The skill reads `structure/outline.md` and extracts the evidence-needed items for Chapter 3. It reads `research/open-questions.md` and loads OQ-003 and OQ-004 (both open).

The skill reads `research/evidence-log.md` (highest: EV-0010) and `research/sources.md` (highest: SRC-0006).

The skill reads `.studio/config.json`. The field `research.web_enabled` is absent.

**Studio:**

> Research agenda for Chapter 3 (Your Curation Practice):
>
> Open questions to resolve:
> - OQ-003: How do explicit selection criteria affect information consumption behavior?
> - OQ-004: What does evidence say about information volume and quality of understanding?
>
> Current ledger: 10 EV entries (highest: EV-0010), 6 SRC records (highest: SRC-0006).
>
> Web research status: not enabled for this project (`research.web_enabled` is absent from `.studio/config.json`). Source material arrives as pasted text. Paste the text of any sources you want registered; the `research-librarian` agent will analyze pasted content with the same quote-and-attribute discipline it applies to fetched content.
>
> To enable web research, add `"research": { "web_enabled": true }` to `.studio/config.json`.
>
> Ready to proceed with this agenda?

**Author:** "Yes. Here is the relevant passage from Johnson's 'The Information Diet' (2012): [author pastes two excerpts from the book totaling approximately 400 words, covering information consumption statistics and the concept of intentional selection criteria]."

**Studio (Step 4 - Delegate to research-librarian):**

The skill spawns `research-librarian` via the `nfs-research -> research-librarian` chain edge, passing:
- Chapter scope: 03-your-curation-practice (Chapter 3, Your Curation Practice)
- Open questions: OQ-003 and OQ-004 from `research/open-questions.md`
- Current ledger highs: EV-0010, SRC-0006 (informational; the agent reads the files again for allocation)
- Web gate status: closed
- Pasted source text: the two Johnson 2012 excerpts

**research-librarian:**

> I read `research/evidence-log.md`: 10 entries, highest ID is EV-0010 (pacing recommendation). The next EV ID will be EV-0011.
>
> I read `research/sources.md`: 6 records, highest ID is SRC-0006 (Lave and Wenger 1991). Before allocating a new SRC ID, I will confirm whether Johnson 2012 is already registered.
>
> Johnson 2012 ("The Information Diet") is not in the source registry. The next SRC ID is SRC-0007.
>
> I read `research/open-questions.md` for Chapter 3: OQ-003 and OQ-004 are open.
>
> Analyzing the pasted passages. The first excerpt states that the average American adult consumes approximately 34 gigabytes of content per day, and that the vast majority of this consumption is designed to provoke an emotional response rather than build understanding. The second excerpt presents Johnson's argument that intentional selection criteria - deciding in advance what sources and signals are worth regular attention - reduce the cognitive cost of ongoing triage and make information diets sustainable over time.
>
> These passages address both open questions. Here are the two EV entries I propose to log, pending your confirmation:
>
> **EV-0011 (information-volume-overload)**
> Claim: The average American adult consumes approximately 34 gigabytes of information content per day, the majority designed to produce an emotional response rather than build understanding.
> Source: SRC-0007 (to be registered as Johnson 2012)
> Locator: pp. 6-8
> Confidence: medium - data cited from a third-party survey rather than original primary research; secondary source
>
> **EV-0012 (intentional-selection-sustainability)**
> Claim: Setting intentional selection criteria for which sources and signals receive regular attention reduces the ongoing cognitive cost of information triage and makes a personal curation practice sustainable long-term.
> Source: SRC-0007
> Locator: pp. 103-107
> Confidence: medium - argument in a secondary source; consistent with cognitive load literature but not itself primary research
>
> Johnson 2012 is a practitioner book synthesizing research and observation, not original primary research, so the `nature` field will be `secondary` and `type` will be `book`.
>
> OQ-003 is addressed by EV-0012 (intentional selection criteria). OQ-004 is addressed by EV-0011 (information volume and emotional-response framing).
>
> Before writing anything: do these claims accurately represent the passages you shared?

**Author:** "EV-0011 is right. For EV-0012 the locator should be pp. 100-107, not 103-107. Adjust that and go ahead."

**research-librarian:**

> Noted - I will use `pp. 100-107` for EV-0012.
>
> The source record registers first; no EV entry is logged until SRC-0007 is in `research/sources.md`.

The agent writes SRC-0007, then EV-0011, then EV-0012. The agent also marks OQ-003 and OQ-004 resolved in `research/open-questions.md`.

---

## research/sources.md append

```markdown
### SRC-0007 (Johnson 2012)
- type: book
- nature: secondary
- author: Johnson, Clay
- title: The Information Diet: A Case for Conscious Consumption
- year: 2012
- publisher: O'Reilly Media
- identifier: ISBN 978-1449304683
- url:
- accessed:
- retrieval-status: stable
```

---

## research/evidence-log.md appends

```markdown
### EV-0011 (information-volume-overload)
- claim: The average American adult consumes approximately 34 gigabytes of information content per day, the majority designed to produce an emotional response rather than build understanding.
- source: SRC-0007
- locator: pp. 6-8
- confidence: medium
- status: pending
- added-by: research-librarian
- date: 2026-07-19

### EV-0012 (intentional-selection-sustainability)
- claim: Setting intentional selection criteria for which sources and signals receive regular attention reduces the ongoing cognitive cost of information triage and makes a personal curation practice sustainable long-term.
- source: SRC-0007
- locator: pp. 100-107
- confidence: medium
- status: pending
- added-by: research-librarian
- date: 2026-07-19
```

---

## research/open-questions.md updates

The agent marks OQ-003 and OQ-004 resolved:

```markdown
## OQ-003: Information selection and curation psychology

Source chapter: Chapter 3 (Your Curation Practice)
Outline item: EV-NEEDED: Research on cognitive patterns distinguishing deliberate
  curators from passive information consumers.
Question: Is there research on how setting explicit selection criteria affects
  information consumption behavior and the quality of learning outcomes?
Status: resolved
Resolved-by: EV-0012 (intentional-selection-sustainability), SRC-0007 (Johnson 2012)

## OQ-004: Attention and information overload

Source chapter: Chapter 3 (Your Curation Practice)
Outline item: EV-NEEDED: Data on information overload and its effect on
  professional learning quality.
Question: What does the evidence say about the relationship between information
  volume consumed per day and the quality of understanding retained?
Status: resolved
Resolved-by: EV-0011 (information-volume-overload), SRC-0007 (Johnson 2012)
```

---

## Studio (Step 5 - Report from the agent's session output)

The skill reads `research/open-questions.md`. OQ-003 and OQ-004 are now resolved. The remaining open items for Chapter 3 are none: all open questions are resolved for this chapter.

**Studio:**

> Research session for Chapter 3 (Your Curation Practice) complete:
>
> - 1 new source: SRC-0007 (Johnson 2012)
> - 2 new evidence entries: EV-0011 (information-volume-overload), EV-0012 (intentional-selection-sustainability)
> - 0 claims still unsourced: all open questions for Chapter 3 are resolved
>
> Both entries land at `status: pending`. `nfs-fact-check` advances them through the verification cycle.
>
> Optional next steps:
>
> 1. Run `nfs-fact-check` to verify EV-0011 (information-volume-overload) and EV-0012 (intentional-selection-sustainability): `/nonfiction-studio:nfs-fact-check 03-your-curation-practice`
> 2. Run `nfs-draft` now that Chapter 3 has sourced entries: `/nonfiction-studio:nfs-draft 03-your-curation-practice`
> 3. Run `nfs-research` for another chapter with open questions: `/nonfiction-studio:nfs-research 04-making-connections`

---

## Key assertions from this transcript

- **Outline probe is a tool call.** The Bash call on `structure/outline.md` determines the `HAS_OUTLINE`/`NO_OUTLINE` token before any other work begins. No prose inference substitutes for the tool result.
- **Chapter argument resolved via Read.** The skill reads `structure/chapter-list.md` and matches the supplied slug `03-your-curation-practice` to row 3. An unmatched argument would halt with the registry file name and the list of valid slugs.
- **Web gate stated honestly in the agenda.** The skill reads `.studio/config.json` before presenting the agenda. The gate is closed; the skill states this explicitly and tells the author how to enable web research. The agent confirms the gate status when it runs and declines any web call accordingly.
- **Skill writes no ledger files.** SRC-0007, EV-0011, and EV-0012 are written by the `research-librarian` agent, not by the skill. The skill's Step 4 delegates and waits; it calls no Write tool on ledger paths.
- **Source-first contract.** SRC-0007 is written before EV-0011 and EV-0012. The agent confirms no SRC record for Johnson 2012 exists before allocating SRC-0007.
- **Author confirmation before write.** The agent presents the two proposed entries and the corrected locator for EV-0012 and waits for explicit author confirmation before writing any file.
- **Status is pending.** Both EV entries land at `status: pending`. Only `fact-checker` may advance them to `verified` or any other status.
- **Three counts from the agent's report.** The skill formats the three counts (1 new source, 2 new evidence entries, 0 claims still unsourced) from the agent's session report. It reads `research/open-questions.md` to count remaining open items; it does not recount the ledger files independently.
- **Pasted source text, same discipline.** The agent analyzed pasted excerpts with the same quote-and-attribute discipline it would apply to fetched web content per D-13 (security posture). No editorial invention; both entries are attributed to Johnson 2012 with locators.
- **Append-only safety.** The locator correction for EV-0012 (pp. 103-107 to pp. 100-107) was applied before the entry was written, not as an edit after the fact. The append-only contract means corrections happen before a write, not as a rewrite of a landed entry.
