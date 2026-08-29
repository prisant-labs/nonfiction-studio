---
title: "nfs-build-apparatus skill reference"
description: "Reference for the build-apparatus skill - generates Chicago-style endnotes, a deduplicated bibliography, index-term candidates, and an attention list from the evidence ledger by wrapping bin/ns-notes in a single Bash call"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "apparatus", "endnotes", "bibliography", "index", "chicago", "citations"]
---

# nfs-build-apparatus

The `build-apparatus` skill generates publisher-ready back matter from the evidence ledger per OPP-D05 (apparatus generator). It fronts the read-only-over-the-ledger `bin/ns-notes` engine in a single Bash call, maps the exit code to a presented verdict, and names exactly which ledger entries still need attention before the back matter is complete. It is governed by D-05 (five shipped CLIs), D-06 (single-writer state discipline), and D-07 (claim ledger with stable IDs).

## Purpose

`build-apparatus` bridges the deterministic apparatus-generation engine and the author conversation. The `bin/ns-notes` engine it invokes reads `research/evidence-log.md`, `research/sources.md`, `chapters/*.md`, and the Chicago style data at `hooks/lib/citation-styles/chicago.json`, then writes four files under `production/`: `endnotes.md`, `bibliography.md`, `index-candidates.md`, and `apparatus-attention.md`. The skill's role is to invoke the engine and present its verdict honestly, including every item that still needs attention.

**`bin/ns-notes` never writes to the ledger.** It reads `research/evidence-log.md`, `research/sources.md`, and `chapters/*.md` and never modifies any of them (OPP-D05: read-then-emit only). Its only writes are the four files under `production/`, which is the author-facing directory that already holds `front-matter.md` and `back-matter.md`, not `.studio/` machine state, so D-06 (single-writer state discipline) is not implicated.

**No agents invoked.** This is a deterministic-CLI-only skill. No chain edges exist.

**Regeneration is deterministic.** Running `build-apparatus` twice over an unchanged ledger reproduces byte-identical files under `production/`: no generation timestamp is stamped into any of the four. It is always safe to re-run.

## Invocation

```
/nonfiction-studio:build-apparatus
```

The skill takes no arguments. It always operates on the whole book: endnotes are numbered per chapter but the bibliography and index candidates are book-wide, so there is no meaningful single-chapter scope for this skill to accept.

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `research/evidence-log.md` | Step 2 (Bash call to `bin/ns-notes`) | EV entries: claim, source, locator, confidence, status |
| `research/sources.md` | Step 2 (Bash call to `bin/ns-notes`) | SRC records: type, author, title, year, publisher, identifier, url, accessed |
| `chapters/*.md` | Step 2 (Bash call to `bin/ns-notes`) | Scanned for `[claim: EV-nnnn]` anchors, one per citation |
| `hooks/lib/citation-styles/chicago.json` | Step 2 (Bash call to `bin/ns-notes`) | Chicago style expressed as data: field order and punctuation per source type |

### Outputs

The skill writes no files itself. All writes are performed by `bin/ns-notes`, always attempted regardless of verdict.

| Path | Written by | Contents |
|---|---|---|
| `production/endnotes.md` | `bin/ns-notes` (via Step 2 Bash call) | Chicago-style notes, numbered per chapter; first citation of a source in a chapter is full form, a repeat is short form |
| `production/bibliography.md` | `bin/ns-notes` (via Step 2 Bash call) | Every actually-cited source exactly once, in Chicago bibliography form, sorted by author surname, then title, then year |
| `production/index-candidates.md` | `bin/ns-notes` (via Step 2 Bash call) | Candidate index terms (source author surnames, source short titles, evidence-log entry handles) paired with the chapters they appear in |
| `production/apparatus-attention.md` | `bin/ns-notes` (via Step 2 Bash call) | Every ledger or source gap the engine found, naming the EV or SRC ID, the chapter, and what is missing |

## Flow Summary

The skill runs three steps.

1. **Resolve the plugin root.** A primary lookup against `extraKnownMarketplaces['nonfiction-studio'].source.path` in `~/.claude/settings.json`, a `~/.claude/plugins/cache` search fallback, and a dev-mode fallback that checks for `bin/ns-notes` in the current directory. The same three-tier convention `init-project` and `run-quality-gate` use. If all three lookups fail, the skill halts and names the settings.json and cache paths it attempted.

2. **Single Bash invocation.** Runs one Bash call: `node "<plugin-root>/bin/ns-notes" --project=. --json`. Captures the exit code, stdout (the JSON report), and stderr. No individual sub-steps; the engine composes the read, compute, and write internally.

3. **Present the result (exit-code mapping).** Maps the exit code to a presented verdict per the table below.

## Exit-Code Mapping

| Exit code | Meaning | Skill action |
|---|---|---|
| 0 | Clean: every `[claim: EV-nnnn]` anchor produced a note, every cited source is complete for its type | Present the pass verdict with the note, bibliography, and index-candidate counts from the JSON report; state that nothing needs attention |
| 1 | One or more attention items: a blank locator, an unresolved or incomplete source, or an anchor naming an EV ID absent from the ledger | Group findings by chapter and list each one (EV or SRC ID plus what is missing); state that the other three files were still regenerated and each affected citation is simply omitted until its ledger entry is fixed |
| 2 | Operational error: missing project bible, missing evidence log, missing sources registry, or missing `chapters/` directory | Surface the stderr error; NEVER treat as a pass; no `production/` files were written or updated by this invocation |

## The Attention List is the Honesty Mechanism

`production/apparatus-attention.md` is not an error log to ignore; it is the mechanism that keeps the other three files honest. When `bin/ns-notes` cannot build a correct Chicago citation for an anchor, it never guesses or emits a partial note - it omits that citation entirely from `endnotes.md` and names the specific gap in `apparatus-attention.md` instead. At minimum, an item lands in the attention list rather than in the generated back matter when:

- an EV entry's `locator` field is blank,
- an EV entry's `source` field names a SRC ID that does not exist in `research/sources.md` (or is itself blank),
- a SRC record is missing a field Chicago requires for its `type` (for example, a `web` source with no `url`),
- a SRC record's `type` has no entry in `hooks/lib/citation-styles/chicago.json` (a source type not yet covered by the style data, rather than a guessed format), or
- a chapter anchors an EV ID that does not exist in `research/evidence-log.md` at all.

Fixing the named gap in `research/evidence-log.md` or `research/sources.md` and re-running `build-apparatus` is the whole remediation loop.

## Citation Style as Data

The Chicago style itself lives in `hooks/lib/citation-styles/chicago.json`, not in `bin/ns-notes` or its engine. The data file names, per source `type`, which `research/sources.md` fields are required before a citation can be built, and the field order and punctuation for the full note, short note, and bibliography forms. `hooks/lib/apparatus-engine.mjs` interprets this data generically: adding a second citation style, or extending Chicago coverage to a source `type` not yet in the file, is a data edit, not a code change. See [ADR-0009](../../adr/ADR-0009-apparatus-cli.md) for the reasoning.

## Failure Behavior

**Plugin root cannot be resolved.** Step 1 halts before any Bash call to `ns-notes`. Reports the settings.json path and cache path attempted, and asks the author how to proceed.

**Exit 2 from `ns-notes`.** Step 3 surfaces the stderr error and halts. Never treated as a pass, and never presented as if any `production/` file changed. Routes to `doctor` for a broader structural diagnosis.

**Project root not found.** `bin/ns-notes` exits 2 with a `BibleError` message on stderr when `.studio/meta.json` cannot be located walking up from the current directory. The skill surfaces it verbatim.

**Evidence log, sources registry, or chapters/ missing.** `bin/ns-notes` exits 2 naming the missing path on stderr. The skill surfaces it verbatim rather than guessing at a fix.

## See also

- [ns-notes CLI reference](../cli/ns-notes.md) - the engine this skill fronts
- [ADR-0009: apparatus CLI](../../adr/ADR-0009-apparatus-cli.md) - why an engine CLI, the growth policy for the sixth CLI onward, and the citation-style-as-data design
- [run-quality-gate skill reference](./run-quality-gate.md) - the deterministic quality gate this skill does not replace
- [fact-check-pass skill reference](./fact-check-pass.md) - claim-coverage and quote-fidelity verification, a separate concern from apparatus generation
