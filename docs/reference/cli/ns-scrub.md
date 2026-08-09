---
title: "ns-scrub CLI reference"
description: "Reference for the ns-scrub CLI - injection detection and continuity quick-scan engine"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "scrub", "injection", "continuity", "security"]
---

# ns-scrub

Scans chapter files for AI injection patterns and continuity name-casing inconsistencies.
Exits 0 when clean; exits 1 with named findings when patterns are detected; exits 2 on
argument or operational error.

## Purpose

`ns-scrub` runs two scan modes per D-03 (layered Stop gate) and D-13 (security posture):

- **injection scan** - detects sentences structured as AI instructions embedded in prose
  or block quotes, surfacing `injection.pattern-match` findings with file and line location
- **continuity quick-scan** - detects the same named entity (method, person, place, product)
  appearing with different surface casing across chapters, surfacing `continuity.name-mismatch`
  findings that span chapter files

Both modes are exercises of the `scrub-engine.mjs` module so the Stop hook and CI share
the same computation path.

## Invocation

```
ns-scrub [--mode=injection|continuity|all] [--chapter=<slug>] [--all] [--project=<dir>] [--json]
```

## Windows invocation

Bare `ns-scrub` invocation fails in the Bash tool on Windows; the plugin
system does not add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill,
and agent contexts must resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-scrub" [--mode=injection|continuity|all] [--chapter=<slug>] [--all] [--project=<dir>] [--json]
```

where `<plugin-root>` is the resolved plugin installation path. Direct
interactive invocation from a user's own shell can add `bin/` to PATH manually,
or use the same `node` plus full-path form.

## Flags

| Flag | Type | Description |
|---|---|---|
| `--mode=<value>` | string | Scan mode. `injection` runs only the injection scan; `continuity` runs only the continuity scan; `all` runs both in sequence (default). |
| `--chapter=<slug>` | string | Scan a single chapter file `chapters/<slug>.md`. |
| `--all` | boolean | Scan all `.md` files in `chapters/` (default when no scope flag is given). |
| `--project=<dir>` | string | Override the book root to `<dir>`. |
| `--json` | boolean | Emit the full gate report as JSON to stdout. |

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Pass - no injection patterns or continuity mismatches found |
| 1 | One or more findings (injection or continuity type) |
| 2 | Invalid `--mode` value, missing chapters directory, or operational error |

## Finding types

| Type | Scan mode | Description |
|---|---|---|
| `injection.pattern-match` | injection | A sentence or block-quote matches an AI instruction pattern |
| `continuity.name-mismatch` | continuity | A named entity appears with inconsistent casing across chapters |

## Output

Human-readable pass:

```
[scrub] pass: no issues found
```

Human-readable findings:

```
[scrub] 1 finding(s):
  chapters/01-listening-before-speaking.md:47 [injection.pattern-match]: embedded AI instruction pattern detected in block quote
```

JSON output (with `--json`) follows the S-08 section 11 gate-report shape.

## Example invocations

Run both modes against all chapters (default):

```
ns-scrub
```

Run injection scan only:

```
ns-scrub --mode=injection
```

Run continuity scan on a single chapter:

```
ns-scrub --mode=continuity --chapter=02-finding-your-network
```

Test against the ai-injection fixture:

```
ns-scrub --mode=injection --project=examples/fixtures/ai-injection
```

## Relationship to other CLIs

`ns-scrub` is called by `bin/ns-gate` as the `prompt_scrub` and `continuity` gate checks.
The `ai-injection` fixture produces exit 1 with `injection.pattern-match` on injection
scan; the `continuity-error` fixture produces exit 1 with `continuity.name-mismatch` on
continuity scan; all other fixtures produce exit 0 on both scan modes, confirming the
bidirectionality property per Q-01 section 1.2.

## See also

- [ns-gate CLI reference](./ns-gate.md) - orchestrator that calls ns-scrub internally
