---
title: "ns-overlap CLI reference"
description: "Reference for the ns-overlap CLI - local n-gram overlap detection against your own research corpus"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "overlap", "research", "quotes"]
---

# ns-overlap

Scans chapter files for n-gram overlap against your own local research corpus: research
packets, verbatim excerpts saved in the evidence ledger, and (when present) prior-work
drafts. Exits 0 when clean; exits 1 with named findings when a long unattributed match
is detected; exits 2 on argument or operational error. No network access - every text
it compares against already lives in the project.

## Purpose

`ns-overlap` answers one question: does a chapter contain a long run of words copied
from material you already have on file, without attribution? It is not a plagiarism
checker against the outside world - it never fetches anything - it is a check against
your OWN prior work, so a long lift from a research packet you already gathered (or a
verbatim excerpt you already logged) surfaces before it ships as if it were original
prose.

The corpus it checks against, discovered fresh on every run:

- every file in `research/packets/*.md`
- every non-empty `verbatim` field in `research/evidence-log.md`
- every file in `context/prior-work/*.md`, when that directory exists (it does not by
  default)

A chapter span that sits inside a properly quoted-and-anchored passage (a straight-quoted
span immediately followed by a `[quote: EV-nnnn]` anchor - the same marker grammar
`ns-claims --quotes` parses) is excluded from the findings as properly attributed. That
exclusion is never silent: it is reported as an informational count, both in `--json`
output and in the human-readable NOTICE line.

## Invocation

```
ns-overlap [--chapter=<slug>|--all] [--project=<dir>] [--min-words=<n>] [--json]
```

## Windows invocation

Bare `ns-overlap` invocation fails in the Bash tool on Windows; the plugin
system does not add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill,
and agent contexts must resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-overlap" [--chapter=<slug>|--all] [--project=<dir>] [--min-words=<n>] [--json]
```

where `<plugin-root>` is the resolved plugin installation path. Direct
interactive invocation from a user's own shell can add `bin/` to PATH manually,
or use the same `node` plus full-path form.

## Flags

| Flag | Type | Description |
|---|---|---|
| `--chapter=<slug>` | string | Scan a single chapter file `chapters/<slug>.md`. |
| `--all` | boolean | Scan all `.md` files in `chapters/` (default when no scope flag is given). |
| `--project=<dir>` | string | Override the book root to `<dir>`. |
| `--min-words=<n>` | string | Minimum merged-span word length to flag. Defaults to 15. |
| `--json` | boolean | Emit the full report as JSON to stdout. |
| `--help` | boolean | Print usage text and exit 0. |

## Algorithm

Both the chapter text and every corpus text go through the same normalization before
comparison: Unicode NFC, case-fold (`toLowerCase`), typographic-to-straight quotes, and
whitespace-run collapse, then tokenization on whitespace into words. Consecutive
overlapping 8-word shingles are chained into a maximal merged span; a merged span of at
least `--min-words` words (default 15) becomes a finding. A 30-word lift, for example, is
23 chained 8-word shingles merging into one 30-word span (23 shingles + 7 = 30 words).

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Pass - no overlap findings |
| 1 | One or more overlap findings |
| 2 | Invalid `--min-words` value, missing chapters directory, or operational error |

## Finding shape

Every finding names both locations, never only one:

```json
{
  "chapter": "chapters/03-example.md",
  "chapterSpan": { "start": 120, "end": 150, "excerpt": "..." },
  "source": "research/packets/03-example.md",
  "sourceSpan": { "start": 40, "end": 70, "excerpt": "..." },
  "words": 30
}
```

`start`/`end` are 0-based word offsets over the normalized token stream (`end`
exclusive). Excerpts are capped at 40 words, with a trailing ` ...` marker when a longer
span was truncated for display.

## Output

Human-readable pass:

```
[overlap] pass: no overlap findings (3 corpus text(s) checked)
```

Human-readable findings, with the exclusion count always named when nonzero:

```
[overlap] 1 finding(s):
  chapters/03-example.md:120-150 <- research/packets/03-example.md:40-70 (30 words)
    "excerpt of the overlapping words here"
[overlap] NOTICE: 1 span(s) excluded as properly quoted
```

JSON output (with `--json`) carries `check`, `minWords`, `chapters` (the sorted list of
chapter files scanned), `corpora` (the sorted list of corpus source identifiers
scanned), `findings`, and `excluded`. It carries no timestamp field: two runs over an
unchanged tree produce byte-identical `--json` output.

## Example invocations

Run against all chapters (default):

```
ns-overlap
```

Scan a single chapter:

```
ns-overlap --chapter=03-example
```

Raise the flagging threshold to 25 words:

```
ns-overlap --min-words=25
```

## Relationship to other CLIs

`ns-overlap` shares its quoted-span exclusion grammar with `ns-claims --quotes`
(`hooks/lib/claims-engine.mjs`'s `findQuoteAnchorSpans`, exported for exactly this
reuse) rather than re-implementing the `[quote: EV-nnnn]` anchor rule. It is a
standalone read-only CLI; wiring its check into `ns-gate`'s quality gate is separate,
later work.

## See also

- [ns-claims CLI reference](./ns-claims.md) - the quote-fidelity check ns-overlap's exclusion rule reuses
- [ns-scrub CLI reference](./ns-scrub.md) - the CLI anatomy (parseArgs, exit taxonomy, `--json`/human modes) ns-overlap follows
