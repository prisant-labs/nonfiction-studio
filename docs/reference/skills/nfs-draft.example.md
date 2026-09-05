---
title: "nfs-draft worked example"
description: "Condensed transcript of a nfs-draft session on the chat surface for The Quiet Network - shows the registry probe, evidence check, drafting-partner new-chapter write, line-editor proposal, and chat compliance append"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "draft", "chapter", "drafting-partner", "line-editor", "compliance", "example"]
---

# nfs-draft - worked example

This is a condensed transcript of a `nfs-draft` session on the chat surface for the sample book "The Quiet Network" (see `examples/sample-book/`). The session drafts Chapter 3 (Your Curation Practice, slug `03-your-curation-practice`) for the first time. The example follows the flow specified in S-06 3.6 (skills and invocation surface) and the adjudications recorded in TSK-049 (draft-chapter skill).

**Session provenance note.** This example continues from the committed sample-book baseline after a `nfs-research` session added EV-0011 (information-volume-overload) and EV-0012 (intentional-selection-sustainability) for Chapter 3, as shown in `docs/reference/skills/nfs-research.example.md`. Chapters 1 and 2 in `examples/sample-book/chapters/` are committed fixtures; the content of Chapter 3 shown here is a hypothetical draft that does not contradict those committed chapters. The session runs on the chat surface to illustrate the verify-then-append compliance rule's count-delta check finding no hook coverage and appending its own records (see [Compliance Append](./nfs-draft.md#compliance-append) in the skill reference).

---

## Setup: what was already in place

The chapter registry (`structure/chapter-list.md`) shows Chapter 3 at status `outlined`, word count `0`. No file exists at `chapters/03-your-curation-practice.md`.

Chapter 2 (`chapters/02-finding-your-network.md`) is the committed preceding chapter. Its closing passage (approximately the final three paragraphs) covers building a deliberate source list under three categories: people, publications, communities.

The evidence ledger has two entries relevant to Chapter 3 (from the prior research-pass session):

- **EV-0011 (information-volume-overload):** The average professional encounters roughly 34 gigabytes of information content per day, the vast majority designed to provoke engagement rather than build understanding. Source: SRC-0007 (Johnson 2012), status: pending.
- **EV-0012 (intentional-selection-sustainability):** Setting intentional selection criteria for which sources and signals receive regular attention reduces the ongoing cognitive cost of information triage and makes a personal curation practice sustainable long-term. Source: SRC-0007 (Johnson 2012), status: pending.

The session runs on the chat surface. No hooks fire on chat; the skill appends the compliance records at Step 6.

---

## Session: Chapter 3 first draft, chat surface, evidence present

**Author:** `/nonfiction-studio:nfs-draft 03-your-curation-practice`

**Studio (Step 1 - Registry probe and chapter argument resolution):**

The skill uses the Bash tool:
```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```
Output: `HAS_REGISTRY`

The skill uses the Read tool on `structure/chapter-list.md`. The registry has six rows. The argument `03-your-curation-practice` matches the slug in row 3:

```
| 3 | 03-your-curation-practice | Your Curation Practice | outlined | 0 |
```

Chapter resolved: number 3, working title "Your Curation Practice", slug `03-your-curation-practice`. Continue to Step 2.

**Studio (Step 2 - Load chapter context):**

The skill uses the Read tool on `structure/outline.md` to load Chapter 3's entry:
- Promise: consistent curation requires a sustainable routine, not heroic daily effort
- Key beats: the volume problem, the daily-block-plus-weekly-review pattern, why the pattern works
- Evidence-needed: TBD (the outline marks evidence as pending; the research-pass session has since added EV-0011 and EV-0012)

The skill uses the Read tool on `research/evidence-log.md`. EV-0011 (information-volume-overload) and EV-0012 (intentional-selection-sustainability) are identified as relevant to Chapter 3.

The skill uses the Read tool on `chapters/02-finding-your-network.md` to extract the closing passage. The final three paragraphs cover building a three-category list (people, publications, communities), asking "what is missing from my question area?" and ending with the "Building the list" section close.

The skill attempts to Read `chapters/03-your-curation-practice.md`. The file is absent. New-chapter mode.

**Studio (Step 3 - Evidence check):**

Two relevant EV entries found: EV-0011, EV-0012. Continue to Step 4.

**Studio (Step 4 - Delegate to drafting-partner):**

The skill spawns `drafting-partner` via the `nfs-draft -> drafting-partner` chain edge, passing:
- Chapter 3 outline section (promise, beats, evidence-needed items)
- EV-0011 (information-volume-overload) and EV-0012 (intentional-selection-sustainability)
- `context/style-profile.md`
- `context/brief.md`
- Closing passage of Chapter 2 for continuity
- Mode: new chapter (file absent)

**drafting-partner (pre-flight checks):**

> Check 1: `context/style-profile.md` - present and non-empty. Pass.
> Check 2: `structure/outline.md` Chapter 3 entry - promise and beats present. Pass.
> Check 3: EV entries for Chapter 3 - EV-0011 and EV-0012 present. Pass.
>
> Beginning new chapter draft for Chapter 3: Your Curation Practice.

The agent drafts and writes `chapters/03-your-curation-practice.md`:

---

```markdown
# Chapter 3: Your Curation Practice

The list you built in the previous chapter is only useful if you actually work it. Most professionals who try to build a personal learning network get stuck here: they have the list, but they do not have a practice that fits their real schedule.

The problem is volume. The average professional encounters roughly 34 gigabytes of information content per day, the vast majority designed to provoke engagement rather than build understanding. [claim: EV-0011] Trying to read everything from your curated list on top of that ambient noise is not a strategy. It is a recipe for abandoning the list entirely.

The solution is a routine small enough to keep. A daily reading block of fifteen to twenty minutes at a consistent time is enough to maintain active contact with your network. [UNVERIFIED] Pair it with a weekly review of thirty minutes to process what you flagged during the week and decide what is worth acting on. The daily block feeds the weekly review; the weekly review closes the loop.

Why does this pattern work? Setting intentional selection criteria for which sources receive your regular attention reduces the ongoing cognitive cost of information triage. [claim: EV-0012] Once you have established which sources deserve your daily fifteen minutes, the block becomes a ritual rather than a decision. That reduction in friction is what makes a curation practice sustainable over months and years rather than collapsing at the first busy week.

## The daily block

Fifteen minutes sounds too short to matter. It is enough. The goal of the daily block is not to finish everything. It is to maintain contact. You skim headlines and titles, read one thing through, and flag two or three items for the weekly review. That is all.

The time of day matters more than the duration. Attach the block to something that already happens: morning coffee, the commute, lunch. A habit anchored to an existing routine is harder to displace than one that floats.

## The weekly review

The weekly review is where the work happens. Thirty minutes on a consistent day. You open your flagged items, read the ones worth reading, and decide what to act on. [UNVERIFIED] Some items will have lost their urgency. Drop them. Some will prompt a question you can send to a contact. Send it. Some will surface an idea worth writing down. Write it down.

The review also serves as a pruning mechanism. If a source consistently produces items you drop in the review, remove it from your list and replace it with a source that earns its place.
```

---

The agent confirms the file is written.

**Studio:**

The skill uses the Read tool on `chapters/03-your-curation-practice.md`. The file is present (approximately 320 words). Two markers: one `[claim: EV-0011]`, one `[claim: EV-0012]`, and two `[UNVERIFIED]` tags. Continue to Step 5.

**Studio (Step 5 - Delegate to line-editor):**

The skill spawns `line-editor` via the `nfs-draft -> line-editor` chain edge, passing:
- `chapters/03-your-curation-practice.md` (current content)
- `context/style-profile.md`

**line-editor:**

> Step 1 - Read `context/style-profile.md`: rhythm guidance notes mostly short sentences with one longer sentence per paragraph for variation. Do-not list includes "In today's world" openers and stacked qualifiers.
>
> Step 2 - Read `chapters/03-your-curation-practice.md`: 320 words. Two `[UNVERIFIED]` tags and two `[claim: EV-nnnn]` markers noted; these are not touched.
>
> Step 3 - Applying three edit families:
>
> One rhythm proposal. The opening of the "The daily block" section has two consecutive short sentences followed by another short sentence, creating a flat cadence. The style profile calls for one longer sentence per paragraph for variation.

```
PROPOSED REPLACEMENT

Original passage:
Fifteen minutes sounds too short to matter. It is enough. The goal of the daily block is not to finish everything.

Proposed replacement:
Fifteen minutes sounds too short to matter, and that skepticism is worth examining, because the goal of the daily block is not to finish everything.
```

> One grammar note: no errors found beyond the proposal above.
>
> Do-not list check: no violations found.
>
> One meaning-change flag for the combined sentence: the original gives the skepticism statement and the reassurance as two separate beats; the replacement joins them with a causal link.

```
[MEANING CHANGE: joining the two sentences creates a causal relationship that was implied but not stated in the original]

PROPOSED REPLACEMENT

Original passage:
Fifteen minutes sounds too short to matter. It is enough. The goal of the daily block is not to finish everything.

Proposed replacement:
Fifteen minutes sounds too short to matter, and that skepticism is worth examining, because the goal of the daily block is not to finish everything.
```

> No further proposals.

**Author:** "I'll accept the rhythm change. The meaning shift is fine - I like the causal link."

**line-editor:**

> Applying the accepted replacement.

The agent writes the updated `chapters/03-your-curation-practice.md` with the accepted replacement applied.

---

**Studio (Step 6 - Confirm chapter file, compliance append, and gate close):**

The skill uses the Read tool on `chapters/03-your-curation-practice.md`. The file is present with the accepted replacement applied.

**Compliance append.** The skill's count-delta check finds no hook-appended record for `chapters/03-your-curation-practice.md` since the flow started (no hooks fire on chat). It appends two records to `.studio/ai-use-log.jsonl`:

```json
{"ts":"2026-07-19T15:04:22Z","agent":"drafting-partner","surface":"chat","scope":"generated","targets":["chapters/03-your-curation-practice.md"],"summary":"Drafted 03-your-curation-practice with claim anchors from the evidence ledger."}
{"ts":"2026-07-19T15:04:22Z","agent":"line-editor","surface":"chat","scope":"assisted","targets":["chapters/03-your-curation-practice.md"],"summary":"Applied sentence-level polish proposals to 03-your-curation-practice."}
```

**Studio:**

> The draft of `chapters/03-your-curation-practice.md` is complete (approximately 320 words).
>
> Claim markers:
> - 2 resolved anchors: `[claim: EV-0011]`, `[claim: EV-0012]`
> - 2 open placeholders: `[UNVERIFIED]` (sentence about 15-20 minute daily block duration; sentence about 30-minute weekly review)
>
> Run the quality gate to check claim coverage, voice drift, and prompt scrub:
> `/nonfiction-studio:nfs-check-chapter 03-your-curation-practice`
>
> Or advance the EV entries from `status: pending` to verified first:
> `/nonfiction-studio:nfs-fact-check 03-your-curation-practice`
>
> Note: on chat the Stop hook gate does not fire automatically. The `/nonfiction-studio:nfs-check-chapter` prompt above is the substitute per S-06 1.3.

---

## Key assertions from this transcript

- **Registry probe is a tool call.** The Bash call on `structure/chapter-list.md` determines the `HAS_REGISTRY`/`NO_REGISTRY` token before any other work begins. No prose inference substitutes for the tool result.

- **Chapter argument resolved via Read.** The skill reads `structure/chapter-list.md` and matches the supplied slug `03-your-curation-practice` to row 3. An unmatched argument would halt with the registry file name and the list of valid slugs.

- **Evidence check passes.** EV-0011 and EV-0012 are relevant to Chapter 3. The check-3 alert does not fire. If no EV entries had been found, the skill would have alerted and waited for explicit author confirmation before proceeding.

- **Prior chapter continuity used.** The skill read the closing passage of Chapter 2 (`chapters/02-finding-your-network.md`) and passed it to `drafting-partner`. Chapter 3 opens with a direct callback to the list-building close of Chapter 2, demonstrating continuity context in practice.

- **Agents write the chapter file.** `drafting-partner` wrote `chapters/03-your-curation-practice.md` with a Write tool call. `line-editor` wrote the polished version via a Write tool call after the author accepted the proposal. The skill used only Read tool calls on the chapter path; it confirmed the file but did not write it.

- **Claim markers preserved.** `[claim: EV-0011]` and `[claim: EV-0012]` and the two `[UNVERIFIED]` tags are unchanged by `line-editor`. The rhythm proposal worked around them. The meaning-change flag was presented correctly.

- **No progress.json write.** The skill wrote no `.studio/progress.json`. On CLI or Cowork, the PostToolBatch hook would update the word count for `03-your-curation-practice` in `progress.json` when `drafting-partner` writes the file - but only if a matching slug entry already exists in the `chapters` array. The chapter STATUS lifecycle field is not updated by this flow.

- **Compliance append via count-delta, not a chat-only special case.** The two ai-use-log records (scope `generated` for `drafting-partner`, scope `assisted` for `line-editor`) are appended by the skill at Step 6 because its count-delta check found no hook-appended record for `chapters/03-your-curation-practice.md` since the flow started - true here because no hooks fire on chat. On CLI or Cowork the PostToolBatch hook normally appends those records first, so the same check normally finds no append needed there; either way it is the identical verify-then-append rule, not two different code paths.

- **Explicit quality gate prompt on chat.** The skill closes with an explicit `/nonfiction-studio:nfs-check-chapter` prompt. On CLI and Cowork the Stop hook fires automatically; on chat this prompt is the substitute per S-06 1.3 (gate closure compensation).
