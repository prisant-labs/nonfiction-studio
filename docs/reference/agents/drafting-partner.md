---
title: "drafting-partner agent reference"
description: "Reference for the drafting-partner agent - the voice-matched, evidence-first chapter drafting agent that anchors every factual assertion to the claim ledger and produces diff proposals against existing chapters"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "drafting", "voice", "evidence", "claim-markers", "ledger"]
---

# drafting-partner

The `drafting-partner` agent is the evidence-first chapter drafting agent for the
Drafting and Voice pillar. It is the first agent to write a chapter file: every
factual assertion it produces carries a `[claim: EV-nnnn]` anchor referencing the
evidence ledger, or an `[UNVERIFIED]` tag where no ledger entry exists. It is a
Phase 1 Drafting-pillar agent specified in S-04 (drafting and voice agents) and
governed by D-07 (claim ledger), D-13 (security posture), D-18 (in-plugin model
routing), and D-19 (colors by pillar).

## Purpose

The `drafting-partner` converts outline and evidence into prose. It reads three
inputs before producing any output: the author's operational voice profile, the
target chapter's outline entry, and the project evidence ledger. From those it
drafts chapter text in the author's register and diction, with every factual
sentence anchored.

The evidence-first principle is absolute: the agent never invents facts and never
writes a sentence that could mislead a reader into attributing a claim to a source
it did not consult. Assertions that cannot be mapped to an existing ledger entry
receive `[UNVERIFIED]` rather than a fabricated anchor.

The `drafting-partner` does not line-edit its own output, does not score voice
adherence, and does not generate formatted citations from memory. Those roles
belong to `line-editor`, `voice-guardian`, and `citation-manager` respectively.
It also does not write to `.studio/` machine state; chapter word counts and
session progress are the PostToolBatch hook's responsibility per D-06
(single-writer state discipline).

## Invocation triggers

Invoke `drafting-partner` when any of the following holds.

- The author or the `draft-chapter` skill is ready to produce the first draft of
  a chapter whose outline entry exists in `structure/outline.md`.
- An existing chapter needs to be extended or revised; the agent enters diff
  proposal mode and produces PROPOSED ADDITION or PROPOSED REPLACEMENT blocks
  rather than overwriting the file.
- `draft-chapter` is invoked; it routes here directly and manages the pre-flight
  sequence.

## At a glance

Registry facts for this agent, from the CANON component registry, are fixed.

| Property | Value |
|---|---|
| Pillar | Drafting and Voice |
| Phase | 1 |
| Model | `sonnet` |
| Color | orange |
| Memory | none |
| Tools | Read, Write |

The `model: sonnet` declaration follows D-18 (in-plugin model routing): the CANON
registry assigns `sonnet` as an explicit override for `drafting-partner`, making it
the roster's first non-inherit model assignment. The orange color follows D-19
(colors by pillar), which assigns orange to the Drafting and Voice pillar. No
`memory` is declared because all ledger state lives on disk in `research/` and no
cross-session cache is needed for the drafting role.

## Inputs

The `drafting-partner` reads only these paths.

| Path | When it is read | Why |
|---|---|---|
| `context/style-profile.md` | Start of every invocation | Pre-flight check 1; provides voice register, diction rules, and do-not list for the entire draft |
| `structure/outline.md` | Start of every invocation | Pre-flight check 2; provides the target chapter's promise, beats, and evidence-needed list |
| `research/evidence-log.md` | Start of every invocation | Pre-flight check 3; provides the EV ledger from which factual anchors are resolved |
| `chapters/NN-*.md` | When the file already exists | Triggers diff proposal mode; the existing prose is read before any proposal is formed |

## Outputs

The `drafting-partner` writes only to `chapters/`.

| Path | Written when | Contents |
|---|---|---|
| `chapters/NN-*.md` | First invocation for a chapter (no file exists) | Full chapter draft with `[claim: EV-nnnn]` anchors and `[UNVERIFIED]` tags inline |
| `chapters/NN-*.md` (diff file) | Subsequent invocation (chapter file already exists) | PROPOSED ADDITION and PROPOSED REPLACEMENT blocks, each identifying the backing EV entry; no silent overwrite of existing content |

## The three pre-flight checks

Before producing any prose, the agent performs three checks in sequence. Each
failed check produces a specific halt with a suggested next step; the agent writes
no chapter prose while any hard halt is pending.

**Check 1 - voice profile present.** The agent reads `context/style-profile.md`.
If the file is absent or empty: halt and offer to invoke `voice-capture` to build
the profile. No prose is produced until the profile exists.

**Check 2 - outline entry present.** The agent reads `structure/outline.md` and
locates the entry for the target chapter. The entry must state a promise and at
least one beat. If the entry is absent or contains no stated promise: halt and ask
the author to confirm the chapter structure before drafting begins.

**Check 3 - relevant EV entries present.** The agent reads
`research/evidence-log.md` and identifies EV entries relevant to the chapter's
evidence-needed list. If no relevant entries exist: alert the author and suggest
invoking `research-librarian` to populate the ledger. This is an alert, not a
hard halt; the author may continue knowing the draft will carry `[UNVERIFIED]`
tags throughout.

All three checks must be attempted before any prose is produced.

## Claim marking

Every sentence that asserts a fact, figure, or attributed statement receives an
inline `[claim: EV-nnnn]` anchor referencing the matching entry in
`research/evidence-log.md`. The marker format and placement rules are defined in
`docs/formats/claim-markers.md`; a marker appears after the sentence's terminal
punctuation, separated by a single space.

Two rules govern the anchoring:

**Existing entries only.** The agent anchors only to EV IDs that exist in
`research/evidence-log.md` at the time of the drafting run. It does not invent an
EV ID, guess an ID, or anchor to an ID it has not read from the ledger. A claim
marker pointing to a nonexistent ID will fail the `bin/ns-claims` coverage check.

**`[UNVERIFIED]` for unresolvable assertions.** When a factual sentence cannot be
mapped to any existing EV entry, the agent places `[UNVERIFIED]` where the claim
marker would appear. The assertion is preserved in the draft; `[UNVERIFIED]` is
not an editorial judgment, it is a sourcing placeholder. `fact-checker` and
`research-librarian` resolve the tag in a subsequent pass.

## Secondary source signaling

When drafting a sentence that draws on evidence from a secondary source - a
synthesis, commentary, or report citing another source - the agent may note the
secondary nature in prose. To make that determination, the agent dereferences
the EV entry's `source` field to the SRC record in `research/sources.md` and
reads its `nature` value: `primary` (original study, dataset, interview, legal
text, or first-person account) or `secondary` (synthesis, commentary, or report
citing another source). No annotation field exists on EV entries; the SRC
`nature` value is the authoritative signal. An EV entry whose source carries
`nature: secondary` may warrant prose language such as "according to a practitioner
framework" rather than "research shows."

## No fabricated citations

The `drafting-partner` does not generate bibliography entries, footnotes, or
in-text citation strings from memory. If the author asks for a formatted citation
during a drafting session, the agent names the source from the evidence ledger -
for example, "SRC-0002 (Granovetter 1973)" - and refers formatting to
`citation-manager`, the Phase 2 agent responsible for citation output. Generating
a citation string from model knowledge rather than the registered source record
is a guardrail violation.

## Diff proposal mode

When `chapters/NN-*.md` already contains prose, the agent reads the existing file
and produces all additions and revisions as clearly delimited proposal blocks. The
two block forms are:

**PROPOSED ADDITION** - new prose to be appended or inserted.

```
PROPOSED ADDITION

[new prose block with [claim: EV-nnnn] anchors or [UNVERIFIED] tags]

Backed by: EV-nnnn (handle)
```

**PROPOSED REPLACEMENT** - a revision to an existing passage, with the original
quoted so the author can compare.

```
PROPOSED REPLACEMENT

Original passage:
[quoted original text]

Proposed replacement:
[revised prose with claim markers]

Backed by: EV-nnnn (handle)
```

Each block identifies the backing EV entry. The author accepts or rejects each
block individually. The agent never calls Write on the existing chapter file to
replace its contents directly; every change to an existing file is a proposal.

## Voice adherence and role boundaries

The agent drafts in the register, rhythm, and diction described in
`context/style-profile.md`, observing any item on the do-not list. It does not
score its own voice adherence, rewrite its output for style, or embed voice-quality
notes in the chapter file. If the agent suspects a passage drifts from the profile,
it notes this in a session observation. Voice scoring belongs to `voice-guardian`
and sentence-level polishing belongs to `line-editor`.

## Guardrails

- **Pre-flight checks are mandatory.** The agent does not produce prose until all
  three checks have been attempted. Each failed hard-halt check produces a specific
  halt message and a suggested next step.
- **Never invents an EV ID.** Every `[claim: EV-nnnn]` written to a chapter file
  must resolve to an entry that exists in `research/evidence-log.md` at the time
  of writing. No anchor is written for an ID absent from the ledger.
- **Never silently drops an assertion.** Every factual sentence receives either a
  claim marker or `[UNVERIFIED]`. No factual assertion passes into the draft
  unmarked.
- **Never overwrites existing prose.** When a chapter file exists, the agent
  produces diff proposals only. It does not call Write on the existing file to
  replace its contents.
- **No fabricated citations.** Citation formatting is deferred to `citation-manager`.
  The agent names the source and refers; it does not generate the formatted string.
- **No `.studio/` writes.** Chapter progress is recorded by the PostToolBatch hook
  per D-06 (single-writer state discipline). The agent does not write to `.studio/`
  under any circumstance.
- **No line-editing or voice scoring.** Sentence-level revision is `line-editor`'s
  role; voice-drift scoring is `voice-guardian`'s.

Per A-02 (platform capability baseline), a plugin-shipped agent cannot declare
`hooks`, `permissionMode`, or `mcpServers` in frontmatter; the platform ignores
those fields. Every guardrail above is enforced in the agent's system prompt.

## Natural next step

After a `drafting-partner` session, the natural next steps depend on what the
output contains. If the chapter carries `[UNVERIFIED]` tags: invoke
`research-librarian` to supply the missing sources and log the underlying claims,
then re-run `draft-chapter` or `fact-check-pass` to resolve the tags. Once all
tags resolve, the chapter is ready for `line-editor` for sentence-level polish and
`fact-checker` for adversarial verification before the quality gate clears. The
claim anchors written here survive that polish pass: the cross-agent contract in
S-04 (drafting and voice agents) forbids `line-editor` from altering or removing
`[claim: EV-nnnn]` or `[UNVERIFIED]` markers, so drafting-time anchoring is never
lost downstream. In Phase 2, structural critique by `developmental-editor` should
precede `line-editor` work because line edits can be invalidated by structural
revision.

## Worked example

See [drafting-partner.example.md](./drafting-partner.example.md) for a condensed
transcript of a `draft-chapter` session extending Chapter 2 of the sample book
"The Quiet Network," showing the three pre-flight checks, diff proposal mode
triggered by an existing chapter, PROPOSED ADDITION blocks with anchors resolving
to committed EV entries, and an `[UNVERIFIED]` tag for an assertion absent from
the fixture ledger.
