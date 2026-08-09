---
title: "ns-claims CLI reference"
description: "Reference for the ns-claims CLI - claim-coverage scanner for EV-marker resolution"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "claims", "coverage", "evidence"]
---

# ns-claims

Scans chapter files for `[claim: EV-nnnn]` markers and computes coverage against the
evidence ledger. Exits 0 when all markers resolve to ledger entries; exits 1 when
unresolved markers remain; exits 2 on argument or operational error.

## Purpose

`ns-claims` is the claim-coverage engine per S-07 (hooks and scripts). It reads
`research/evidence-log.md`, walks `chapters/`, finds every `[claim: EV-nnnn]` anchor,
and reports the resolution rate. A resolved marker is one whose EV ID appears in the
ledger with a resolved status (`verified` or `interpretation` per the 2026-07-18
ledger-grammar adjudication). Unresolved markers are those whose EV ID is absent from
the ledger or carries a non-resolved status (`pending`, `unverified`, `source-unverifiable`).
An unmarked factual sentence is invisible to this deterministic engine; semantic judgment
belongs to the `fact-checker` agent and the gate's advisory layer.

## Invocation

```
ns-claims [--chapter=<slug>] [--all] [--project=<dir>] [--json]
```

## Windows invocation

Bare `ns-claims` invocation fails in the Bash tool on Windows; the plugin
system does not add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill,
and agent contexts must resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-claims" [--chapter=<slug>] [--all] [--project=<dir>] [--json]
```

where `<plugin-root>` is the resolved plugin installation path. Direct
interactive invocation from a user's own shell can add `bin/` to PATH manually,
or use the same `node` plus full-path form.

## Flags

| Flag | Type | Description |
|---|---|---|
| `--chapter=<slug>` | string | Scan a single chapter file `chapters/<slug>.md`. Mutually exclusive with `--all`. |
| `--all` | boolean | Scan all `.md` files in `chapters/` (default when no scope flag is given). |
| `--project=<dir>` | string | Override the book root to `<dir>`. If omitted, the tool walks up from the current directory looking for `.studio/meta.json`. |
| `--json` | boolean | Emit the full gate report as JSON to stdout instead of the human-readable summary. |
| `--online` | boolean | (Not yet implemented; reserved for a future DOI/URL resolution pass.) |

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Pass - all claim markers resolved; coverage is 100% |
| 1 | One or more unresolved claim markers; see stdout findings |
| 2 | Argument error, missing evidence log, or missing chapters directory |

## Output

Without `--json`, `ns-claims` emits a single summary line per run:

```
[claim_coverage] pass: coverage 100.0% (10/10 markers resolved)
```

On failure, a per-finding breakdown follows:

```
[claim_coverage] 1 open claim(s): coverage 90.9%
  chapters/02-finding-your-network.md:34 [unresolved]: EV-0011 not found in evidence-log.md
```

With `--json`, the output is the S-08 section 11 gate-report shape extended with
`totalMarkers`, `resolvedCount`, `coveragePct`, and a `chapters` array.

## Example invocation

Scan all chapters in the current book project:

```
ns-claims --json
```

Scan a single chapter, human-readable:

```
ns-claims --chapter=02-finding-your-network
```

Run from a specific project directory:

```
ns-claims --project=examples/sample-book
```

## Relationship to other CLIs

`ns-claims` is one of the five shipped CLIs per D-05 (five shipped CLIs via bin/). In
the Stop gate sequence, `bin/ns-gate` calls the claims engine internally so the same
coverage computation runs in both interactive sessions and CI. The `fact-checker` agent
reads `ns-claims` JSON output to locate markers that need adversarial verification.

## See also

- [ns-gate CLI reference](./ns-gate.md) - orchestrator that aggregates ns-claims output
- [ns-doctor CLI reference](./ns-doctor.md) - checks word-count coherence against progress.json
- [fact-check-pass skill reference](../skills/fact-check-pass.md) - skill that invokes the fact-checker agent
