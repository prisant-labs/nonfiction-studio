---
title: "drafting-partner worked example"
description: "Condensed transcript of a draft-chapter session extending Chapter 2 of The Quiet Network - shows the three pre-flight checks, diff proposal mode, PROPOSED ADDITION blocks with committed EV anchors, and an [UNVERIFIED] tag for an assertion absent from the fixture ledger"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "drafting", "voice", "evidence", "claim-markers", "example"]
---

# drafting-partner - worked example

This is a condensed transcript of a `drafting-partner` session for the sample
book "The Quiet Network" (see `examples/sample-book/`). It shows the three
pre-flight checks, diff proposal mode triggered by an existing chapter, PROPOSED
ADDITION blocks with anchors resolving to committed EV entries, an `[UNVERIFIED]`
tag for an assertion genuinely absent from the ledger, and the agent's response
when the author asks for a formatted citation. It follows the contracts specified
in S-04 (drafting and voice agents).

A note at the end illustrates each key assertion from the transcript.

---

## Setup: what was already in place

Chapter 2 ("Finding Your Network") was drafted in a prior session. The chapter
file `chapters/02-finding-your-network.md` exists and contains five claim markers
referencing EV-0006 through EV-0010. The author now wants to extend Chapter 2
with a closing section on why a well-built network compounds over time.

The ledger at session start:

- `research/evidence-log.md`: 10 entries, highest is EV-0010 (pacing recommendation)
- `research/sources.md`: 6 records, SRC-0001 through SRC-0006; no `changed: true`
  flags present

`context/style-profile.md` was written by `voice-capture` and is non-empty. The
Chapter 2 outline entry in `structure/outline.md` states the chapter promise and
four beats, one of which is "compounding returns from a deliberate list."

---

## Session: extending Chapter 2

**Author:** `/nonfiction-studio:draft-chapter chapter=02`

The `draft-chapter` skill routes to `drafting-partner`.

**drafting-partner:**

> **Pre-flight check 1 - voice profile**
>
> Reading `context/style-profile.md`. The file is present and non-empty. Voice
> profile loaded: plainspoken, warm, second person for instruction, short sentences
> preferred, do-not list includes em-dashes and throat-clearing openers. Check 1
> passes.
>
> **Pre-flight check 2 - outline entry**
>
> Reading `structure/outline.md` and locating the Chapter 2 entry. The entry
> states: core argument ("A personal learning network is built around a question,
> not a platform"), key evidence list (EV-0007, EV-0008, EV-0006, EV-0009), and
> beats including "deliberate source selection" and "compounding returns from a
> deliberate list." Promise and beats are present. Check 2 passes.
>
> **Pre-flight check 3 - relevant EV entries**
>
> Reading `research/evidence-log.md`. The evidence-needed beat "compounding returns
> from a deliberate list" maps to EV-0005 (pln compounding) and EV-0004 (network
> trust). Both exist in the ledger. Check 3 passes.
>
> **Diff proposal mode**
>
> `chapters/02-finding-your-network.md` already exists. Switching to diff proposal
> mode. Reading the existing chapter to understand the current ending point.
>
> The chapter currently ends at the "Building the list" section. The proposed
> addition below extends the chapter with a closing section on the compounding
> argument, as called for by the final beat in the outline entry.
>
> Before writing the proposal, a note on sources: EV-0004 (network trust) cites
> SRC-0001 (Hart 2015), which carries `nature: secondary` in `research/sources.md`.
> EV-0005 (pln compounding) cites SRC-0003 (Jarche 2014), also `nature: secondary`.
> Both claims will be framed accordingly in the prose.

---

## Proposed addition

**drafting-partner:**

```
PROPOSED ADDITION

## Why the list compounds

The list you built in the previous section is not a static directory. It is
a learning system that gets more valuable the longer you maintain it.

Trust in professional networks builds through consistency of presence and
quality of contribution, not through frequency of posting. [claim: EV-0004]
That applies to the networks you are part of and to the way your sources
perceive you over time. When you read the same thinkers steadily, you begin
to notice when their reasoning shifts, when their predictions fail, and when
their emphasis changes. That pattern recognition takes months. It cannot be
shortcut.

One practitioner framework describes a self-reinforcing loop: better inputs
lead to better thinking, which over time attracts better connections.
[claim: EV-0005] The first word of that description is "over time." The
compounding does not arrive at week two. It shows up in month eight, when
you realize you are no longer searching for ideas because ideas are arriving.

Professionals who maintain a weekly curation review report a 30 percent
reduction in time spent searching for information later in their careers.
[UNVERIFIED]

This is why the size of your starting list matters less than the consistency
of your attention to it.

Backed by: EV-0004 (network trust), EV-0005 (pln compounding)
Note: EV-0004 and EV-0005 both cite secondary sources (SRC-0001 (Hart 2015)
and SRC-0003 (Jarche 2014) respectively). Prose is framed accordingly:
"one practitioner framework" rather than "research shows."
Note: the sentence citing a 30 percent reduction carries [UNVERIFIED]; no
EV entry in the current ledger supports that specific figure.
```

---

## Author follow-up: citation request

**Author:** Can you generate the full citation for Dunbar 1992 so I can add it
to the bibliography?

**drafting-partner:**

> The ledger records this source as SRC-0005 (Dunbar 1992): Dunbar, R. I. M.,
> "Neocortex size as a constraint on group size in primates," Journal of Human
> Evolution, 1992, DOI 10.1016/0047-2484(92)90081-J.
>
> Citation formatting - the bibliography entry, footnote, or in-text style string
> - belongs to `citation-manager`, the Phase 2 agent. Invoke `citation-manager`
> with SRC-0005 (Dunbar 1992) and the target citation style to get the formatted
> output. Generating a citation string from model knowledge rather than from the
> registered source record is not a task the drafting-partner performs.

---

## Author follow-up: the [UNVERIFIED] tag

**Author:** What do I do about the unverified sentence on the 30 percent figure?

**drafting-partner:**

> That sentence asserts a specific statistic that does not resolve to any entry
> in `research/evidence-log.md`. The options are:
>
> - Remove the sentence from the proposed addition.
> - Keep the sentence and invoke `research-librarian` to locate a source that
>   states the 30 percent figure, register it as a new SRC record, and log an
>   EV entry. Once the entry exists, the `[UNVERIFIED]` tag can be replaced with
>   `[claim: EV-NNNN]` in a subsequent drafting pass.
> - Reframe the sentence as the author's observation rather than a factual
>   finding, removing the need for a claim marker entirely - but only if the
>   framing makes clear it is the author's view, not an evidenced claim.
>
> The sentence will count as one open claim in `open_claim_count` until resolved.
> The coverage gate will not clear while it remains tagged `[UNVERIFIED]`.

---

## Chapter file state after the session

The existing `chapters/02-finding-your-network.md` is unchanged. The agent
produced a diff proposal; it did not write to the existing file. The author
accepts or rejects the PROPOSED ADDITION block and applies it manually or via the
`draft-chapter` skill's apply mode.

---

## Key assertions from this transcript

- **Pre-flight checks run first.** All three checks - voice profile, outline entry,
  relevant EV set - were attempted before any prose was produced. Each check
  passed in this session; the agent proceeded to diff proposal mode only after all
  three cleared.
- **Diff proposal mode is triggered by an existing file.** Because
  `chapters/02-finding-your-network.md` existed, the agent did not attempt to
  overwrite it. The PROPOSED ADDITION block gives the author control over whether
  and where to insert the new passage.
- **Anchors resolve to committed entries only.** EV-0004 (network trust) and
  EV-0005 (pln compounding) both exist in the fixture ledger. The agent did not
  invent IDs or guess at entries not in the ledger.
- **Secondary sourcing is noted in prose.** EV-0004 (network trust) and EV-0005
  (pln compounding) both cite secondary sources. The agent dereferenced each EV
  entry's `source` field to the SRC record and read its `nature` value. The
  resulting prose says "one practitioner framework" rather than "research shows,"
  reflecting the secondary nature of the source.
- **`[UNVERIFIED]` is used for a genuinely absent claim.** The 30 percent reduction
  figure is not supported by any entry in the 10-entry committed ledger. The agent
  did not fabricate an EV ID to anchor it; instead it placed `[UNVERIFIED]` and
  explained the options to the author.
- **No citation string generated.** When the author asked for a formatted citation
  for SRC-0005 (Dunbar 1992), the agent named the source and referred formatting
  to `citation-manager`. It did not produce a formatted bibliography entry from
  model knowledge.
- **No `.studio/` writes.** The agent wrote no machine state during this session.
  Chapter word-count updates are the PostToolBatch hook's responsibility per
  D-06 (single-writer state discipline).
- **Existing markers preserved.** The pre-existing claim markers in Chapter 2
  (EV-0006 through EV-0010) were not touched. The agent read the chapter file to
  determine its current state; it did not alter any existing content.
