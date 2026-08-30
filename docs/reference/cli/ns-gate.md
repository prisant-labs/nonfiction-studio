---
title: "ns-gate CLI reference"
description: "Reference for the ns-gate CLI - the Stop-gate orchestrator that aggregates all engine checks"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "gate", "orchestrator", "quality", "stop"]
---

# ns-gate

Orchestrates all quality-gate checks (claim coverage, quote fidelity, prompt scrub,
stylometry drift, state coherence, continuity, thesis alignment, and session write flag)
and writes a timestamped gate report under `.studio/gate/`. Exits according to the gate
mode in `.studio/config.json`: 0 in warn mode; 0 or 1 in block mode depending on which
checks are configured to block; 2 on operational error.

## Purpose

`ns-gate` is the Stop-gate orchestrator per D-03 (layered Stop gate) and S-07 (hooks and
scripts). It is invoked by the `hooks/stop-gate.mjs` Stop hook at the end of each AI
session and by `scripts/test-fixtures.mjs` in CI. It delegates to the shared engine
functions from `hooks/lib/gate-engine.mjs` so the hook and the CLI share one implementation.

The gate's deterministic checks (claim coverage, quote fidelity, prompt scrub, state
coherence, continuity) always run. The judgment check (thesis alignment) always runs but
can only emit warn, never block, in v1 per D-03. The quote-fidelity check (D-03 (layered
Stop gate)) can likewise only emit warn, never block, until the quote normalization and
adjudication policy ships (roadmap row 1.5); a configured
`block` mode is structurally coerced to `warn`, the same mechanism D-03 uses for thesis
alignment. Per-check mode overrides in config.json control whether a warn or block verdict
is returned when any other check fires.

## Invocation

```
ns-gate [--check=<checks>] [--chapter=<slug>] [--project=<dir>] [--json]
```

## Windows invocation

Bare `ns-gate` invocation fails in the Bash tool on Windows; the plugin
system does not add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill,
and agent contexts must resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-gate" [--check=<checks>] [--chapter=<slug>] [--project=<dir>] [--json]
```

where `<plugin-root>` is the resolved plugin installation path. Direct
interactive invocation from a user's own shell can add `bin/` to PATH manually,
or use the same `node` plus full-path form.

## Flags

| Flag | Type | Description |
|---|---|---|
| `--check=<checks>` | string (comma-separated) | Run only the named checks. Valid flag values: `claims`, `quotes`, `stylometry`, `scrub`, `continuity-quick`, `coherence`. See the flag-to-report mapping table below. |
| `--chapter=<slug>` | string | Limit chapter-scoped checks to `chapters/<slug>.md`. |
| `--project=<dir>` | string | Override the book root to `<dir>`. If omitted, walks up from the current directory looking for `.studio/meta.json`. |
| `--json` | boolean | Emit the full gate report as JSON to stdout. |

### --check flag values

The `--check` flag accepts CLI flag names, not REPORT check names. The six valid flag values and their corresponding report check names are:

| `--check` value | Report check name |
|---|---|
| `claims` | `claim_coverage` |
| `quotes` | `quote_fidelity` |
| `stylometry` | `stylometry` |
| `scrub` | `prompt_scrub` |
| `continuity-quick` | `continuity` |
| `coherence` | `state_coherence` |

`session_write_flag` is always evaluated and is not selectable via `--check` (it is not a flag).
`thesis_alignment` is the judgment layer and is never a gate check; it is not a valid `--check` value.

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Pass - all checks passed, or all fired checks are in warn mode |
| 1 | One or more block-mode checks fired; the block verdict survives whenever top-level `gate.mode` is anything other than `warn` (D-03 (layered Stop gate) Invariant 2 caps every verdict to `warn` only when `gate.mode` is `warn`, regardless of any individual check's own mode - see `hooks/lib/gate-engine.mjs:625`) |
| 2 | Argument error, missing book root, or engine failure |

## Gate checks and default modes (Phase 1)

The table below reflects the `examples/sample-book/.studio/config.json` defaults. Authors
override modes via their own `.studio/config.json`. Whether a block-mode check's block
verdict actually stops the session depends on top-level `gate.mode`: every verdict is
capped to `warn` only when top-level `gate.mode` is `warn`, the shipped default; a block
verdict survives when top-level `gate.mode` is anything else (D-03 (layered Stop gate)
Invariant 2, `hooks/lib/gate-engine.mjs:625`).

| Check | Default mode | Blocks when mode=`block` and top-level `gate.mode` is not `warn`? |
|---|---|---|
| `claim_coverage` | block | Yes |
| `quote_fidelity` | warn | No (structurally coerced to warn; block is unreachable until the quote normalization and adjudication policy ships, roadmap row 1.5) |
| `prompt_scrub` | block | Yes |
| `stylometry` | warn | No (warn only) |
| `continuity` | warn | No (warn only) |
| `thesis_alignment` | warn | No (judgment check; v1 never blocks) |
| `state_coherence` | warn | No (warn only in Phase 1) |
| `session_write_flag` | block | Yes |

## Output

Human-readable summary:

```
[ns-gate] verdict: pass (report: .studio/gate/01-listening-before-speaking.20260719T120000Z.json)
  [claim_coverage] pass: coverage 100.0% (10/10 markers resolved)
  [prompt_scrub] pass: no injection patterns found
  [stylometry] pass: drift score 2.34 is within threshold 25
```

JSON output (with `--json`) follows the S-08 section 11 gate-report shape with `verdict`,
`checks`, `ts`, and per-check entries (each with `check`, `verdict`, `detail`, `evidence`,
`next` fields).

## Report files

Every `ns-gate` run writes one file directly:

- `.studio/gate/<slug>.<YYYYMMDDTHHMMSSZ>.json` - the timestamped full gate report

When `ns-gate` runs under the `Stop` hook (`hooks/stop-gate.mjs`), the hook - not `ns-gate`
itself - separately writes a second file by copying that same run's stdout verbatim:

- `.studio/gate/last-gate.json` - the most recent gate report for the chapter, exactly as
  `ns-gate` emitted it

A direct `ns-gate` invocation with no Stop hook in the loop (a manual run, or CI) never
touches `last-gate.json`; only the Stop hook does. See docs/formats/gate-report.md.

## Example invocations

Run against the current book in warn mode (default):

```
ns-gate
```

Run against a specific fixture, JSON output:

```
ns-gate --project=examples/sample-book --json
```

Run only the claim coverage and scrub checks:

```
ns-gate --check=claims,scrub
```

## Relationship to other CLIs

`ns-gate` calls the same engine functions used in the Stop hook sequence: `gate-engine.mjs`
imports `checkWordCountCoherence` from `doctor-engine.mjs` and calls `scrub`, `computeDrift`,
`computeCoverage`, and (OPP-D03 (quote fidelity and source packets))
`scanQuoteAnchors`/`computeQuoteFindings` from their respective engines. `hooks/stop-gate.mjs`
does NOT import `gate-engine.mjs` or call `runGate` directly: it spawns `bin/ns-gate` as a
subprocess and reads the JSON it prints to stdout, exactly as a human or CI invocation would.
CI likewise invokes `bin/ns-gate` directly to exercise the same path via the public CLI
surface. `gate-engine.mjs` has exactly one caller, `bin/ns-gate`; the Stop hook and CI both
reach it only through that CLI boundary.

## See also

- [ns-claims CLI reference](./ns-claims.md) - claim-coverage engine called by ns-gate
- [ns-scrub CLI reference](./ns-scrub.md) - injection and continuity engine called by ns-gate
- [ns-stylometry CLI reference](./ns-stylometry.md) - drift engine called by ns-gate
- [ns-doctor CLI reference](./ns-doctor.md) - coherence check shared with ns-gate
- [nfs-check-chapter skill reference](../skills/nfs-check-chapter.md) - skill that invokes ns-gate
