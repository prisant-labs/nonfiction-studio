---
title: "ns-notes CLI reference"
description: "Reference for the ns-notes CLI - the apparatus generator that builds Chicago-style endnotes, a bibliography, index candidates, and an attention list from the evidence ledger"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "apparatus", "endnotes", "bibliography", "index", "chicago", "citations"]
---

# ns-notes

Reads the evidence ledger, the sources registry, and every chapter's `[claim: EV-nnnn]`
anchors, and writes four publisher-ready back-matter files under `production/`: Chicago-style
endnotes, a deduplicated bibliography, candidate index terms, and an honest needs-attention
list. Exits 0 when every anchor produced a note; exits 1 when one or more anchors need
attention; exits 2 on an argument or operational error.

## Purpose

`ns-notes` is the apparatus-generation engine per OPP-D05 (apparatus generator). Maintaining
`research/evidence-log.md` and `research/sources.md` is a tax on the author paid at gate-check
time; this CLI generates the reward the ledger already earns. It reads the ledger
(`hooks/lib/ledger.mjs`), scans `chapters/` for `[claim: EV-nnnn]` anchors, resolves each
against the ledger and a citation style expressed as data
(`hooks/lib/citation-styles/chicago.json`), and writes the result. It never writes to the
ledger or to any chapter file; the only writes are the four files under `production/`.

## Invocation

```
ns-notes [--project=<dir>] [--json]
```

## Windows invocation

Bare `ns-notes` invocation fails in the Bash tool on Windows; the plugin system does not
add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill, and agent contexts must
resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-notes" [--project=<dir>] [--json]
```

where `<plugin-root>` is the resolved plugin installation path. Direct interactive
invocation from a user's own shell can add `bin/` to PATH manually, or use the same
`node` plus full-path form.

## Flags

| Flag | Type | Description |
|---|---|---|
| `--project=<dir>` | string | Override the book root to `<dir>`. If omitted, the tool walks up from the current directory looking for `.studio/meta.json`. |
| `--json` | boolean | Emit the full gate report as JSON to stdout instead of the human-readable summary. |

There is no `--chapter` or `--all` scope flag. Endnotes are numbered per chapter, but the
bibliography and index candidates are book-wide (a source cited from three chapters still
appears exactly once), so there is no coherent single-chapter output for this CLI to produce.

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Clean - every `[claim: EV-nnnn]` anchor resolved to a complete, renderable Chicago citation; the attention list is empty |
| 1 | One or more attention items: a blank locator, a source that does not exist or is missing a field its type requires, a source of a type the citation style does not define, or a chapter anchor naming an EV ID absent from the ledger |
| 2 | Argument error, missing project bible (the book's canonical reference files under `context/`, `structure/`, `chapters/`, `research/`, and `production/`), missing evidence log or sources registry, or missing `chapters/` directory |

`production/endnotes.md`, `production/bibliography.md`, `production/index-candidates.md`,
and `production/apparatus-attention.md` are all written whenever the run reaches the write
step, regardless of whether the exit code is 0 or 1. Only exit 2 (an error before or during
the write) leaves `production/` unwritten by that invocation.

## Output

Without `--json`, `ns-notes` emits a single summary line, followed by one line per attention
item when the attention list is non-empty:

```
[apparatus] pass: 10 note(s), 6 bibliography entries, 22 index candidate(s); production/ written
```

On findings:

```
[apparatus] 2 item(s) need attention (see production/apparatus-attention.md):
  chapters/01-listening-before-speaking.md:11 [missing-locator]: EV-0001 has a blank locator; no Chicago note can be built without one
  chapters/01-listening-before-speaking.md:19 [missing-locator]: EV-0005 has a blank locator; no Chicago note can be built without one
```

With `--json`, the output is the S-08 section 11 gate-report shape extended with `chapters`,
`totalNotes`, `bibliographyCount`, `indexCandidateCount`, and `written` (the four
`production/` paths).

## What Gets Generated

**`production/endnotes.md`.** One heading per chapter, notes numbered contiguously within
that chapter in the order their `[claim: EV-nnnn]` anchors appear (an anchor that needs
attention is skipped in the numbering, not left as a gap). The first citation of a source
within a chapter uses the Chicago full note form; a later citation of the same source in the
same chapter uses the Chicago short form. The full/short state resets at the start of each
chapter, because endnotes are numbered per chapter.

**`production/bibliography.md`.** Every source actually cited by at least one anchored EV
entry, exactly once, in Chicago bibliography form, sorted by author surname, then title, then
year - independent of ledger insertion order or citation order. A source is "actually cited"
the moment an EV entry naming it is anchored in a chapter, whether or not that specific EV
entry's own locator is filled in yet: the missing locator blocks only that one note (named in
`apparatus-attention.md`), not the source's bibliography entry, because a bibliography entry
does not carry a locator. A source present in `research/sources.md` but cited by no EV entry
does not appear.

**`production/index-candidates.md`.** Candidate index terms derived deterministically from
three input classes, documented in the file's own header: every distinct source author
surname, every distinct source short title (the same derivation the endnotes use for Chicago
short-form citations), and every evidence-log entry handle - each paired with the chapter(s)
where a citing anchor appears. Author and title terms require the underlying source to be
fully resolvable; a claim-handle term requires only that its evidence-log entry exist (the
concept is present in the manuscript even if its citation cannot yet be rendered). These are
candidates for a human to curate into a real index, not a finished index.

**`production/apparatus-attention.md`.** The honesty mechanism. Every gap the generator found,
one row per gap, naming the EV or SRC ID, the chapter, and what is missing. Nothing is
silently dropped: a citation with any of these problems produces no note and no bibliography
entry until the gap is fixed and `ns-notes` is run again. See "Chicago Style as Data" below
for why an unknown source type is an attention row rather than a guessed format or a crash.

## Chicago Style as Data

The citation style lives in `hooks/lib/citation-styles/chicago.json`, not in
`hooks/lib/apparatus-engine.mjs`. Per source `type`, the data file names which
`research/sources.md` fields are required before any citation can be built for that type, and
the field order and punctuation for the full note, short note, and bibliography forms. The
engine's interpreter is generic: it reads whichever fields a template names and fills them,
and it never guesses a format for a `type` absent from the file - that source's citations land
in `apparatus-attention.md` instead. Today's file covers the four source types the plugin's
own worked example cites (`book`, `article`, `report`, `web`); adding coverage for another
`research/sources.md` type value (`interview`, `dataset`, `other`), or an entirely different
citation style, requires no change to the engine. See
[ADR-0009](../../adr/ADR-0009-apparatus-cli.md) for the growth policy.

## Determinism

Regenerating over an unchanged ledger produces byte-identical files: no generation timestamp
is stamped into any of the four `production/` files, matching the pattern
`ns-claims --packets` already established for `research/packets/*.md`. It is always safe to
re-run `ns-notes`.

## Example invocation

Regenerate the apparatus for the current book project:

```
ns-notes
```

Run from a specific project directory, machine-readable:

```
ns-notes --project=examples/sample-book --json
```

## Relationship to other CLIs

`ns-notes` is the seventh CLI shipped under `bin/`; see [ADR-0009](../../adr/ADR-0009-apparatus-cli.md)
for the growth history and policy. It reads the same ledger `bin/ns-claims` reads
(`hooks/lib/ledger.mjs`) and the same `[claim: EV-nnnn]` marker form `bin/ns-claims` scans for
(docs/formats/claim-markers.md form 1), but it computes a distinct thing: `ns-claims` measures
whether a claim is evidenced and verified; `ns-notes` assumes evidencing is `ns-claims`'s job
and instead turns whatever is already in the ledger into publisher-ready back matter. Neither
CLI writes to the other's output, and `ns-notes` never writes to the ledger itself.

## See also

- [build-apparatus skill reference](../skills/nfs-build-apparatus.md) - the skill that fronts this CLI
- [ns-claims CLI reference](./ns-claims.md) - the claim-coverage engine that reads the same ledger
- [ADR-0009: apparatus CLI](../../adr/ADR-0009-apparatus-cli.md) - why an engine CLI, and the standing growth-policy test for any future CLI
