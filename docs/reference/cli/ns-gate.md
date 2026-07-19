---
title: "ns-gate CLI reference"
description: "Reference for the ns-gate CLI - the Stop-gate orchestrator that aggregates all engine checks"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "gate", "orchestrator", "quality", "stop"]
---

# ns-gate

Orchestrates all quality-gate checks (claim coverage, prompt scrub, stylometry drift,
state coherence, continuity, thesis alignment, and session write flag) and writes a
timestamped gate report under `.studio/gate/`. Exits according to the gate mode in
`.studio/config.json`: 0 in warn mode; 0 or 1 in block mode depending on which checks
are configured to block; 2 on operational error.

## Purpose

`ns-gate` is the Stop-gate orchestrator per D-03 (layered Stop gate) and S-07 (hooks and
scripts). It is invoked by the `hooks/stop-gate.mjs` Stop hook at the end of each AI
session and by `scripts/test-fixtures.mjs` in CI. It delegates to the shared engine
functions from `hooks/lib/gate-engine.mjs` so the hook and the CLI share one implementation.

The gate's deterministic checks (claim coverage, prompt scrub, state coherence,
continuity) always run. The judgment check (thesis alignment) always runs but can
only emit warn, never block, in v1 per D-03. Per-check mode overrides in config.json
control whether a warn or block verdict is returned when a check fires.

## Invocation

```
ns-gate [--check=<checks>] [--chapter=<slug>] [--project=<dir>] [--json]
```

## Flags

| Flag | Type | Description |
|---|---|---|
| `--check=<checks>` | string (comma-separated) | Run only the named checks. Valid flag values: `claims`, `stylometry`, `scrub`, `continuity-quick`, `coherence`. See the flag-to-report mapping table below. |
| `--chapter=<slug>` | string | Limit chapter-scoped checks to `chapters/<slug>.md`. |
| `--project=<dir>` | string | Override the book root to `<dir>`. If omitted, walks up from the current directory looking for `.studio/meta.json`. |
| `--json` | boolean | Emit the full gate report as JSON to stdout. |

### --check flag values

The `--check` flag accepts CLI flag names, not REPORT check names. The five valid flag values and their corresponding report check names are:

| `--check` value | Report check name |
|---|---|
| `claims` | `claim_coverage` |
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
| 1 | One or more block-mode checks fired (only possible when `gate.mode` is `warn` and at least one check has `mode: block`, or when `gate.mode` is `block`) |
| 2 | Argument error, missing book root, or engine failure |

## Gate checks and default modes (Phase 1)

The table below reflects the `examples/sample-book/.studio/config.json` defaults. Authors
override modes via their own `.studio/config.json`.

| Check | Default mode | Blocks when mode=block? |
|---|---|---|
| `claim_coverage` | block | Yes |
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
  [stylometry] pass: drift score 2.34 is within threshold 35
```

JSON output (with `--json`) follows the S-08 section 11 gate-report shape with `verdict`,
`checks`, `ts`, and per-check entries (each with `check`, `verdict`, `detail`, `evidence`,
`next` fields).

## Report files

Every `ns-gate` run writes two files:

- `.studio/gate/last-gate.json` - a summary map from chapter slug to `{ts, verdict, report}`
- `.studio/gate/<slug>.<YYYYMMDDTHHMMSSZ>.json` - the timestamped full gate report

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

`ns-gate` calls the same engine functions used by the Stop hook: `gate-engine.mjs` imports
`checkWordCountCoherence` from `doctor-engine.mjs` and calls `scrub`, `computeDrift`, and
`computeCoverage` from their respective engines. In the Stop hook sequence, `stop-gate.mjs`
calls `runGate` directly; CI uses `bin/ns-gate` to exercise the same path via the public
CLI surface.

## See also

- [ns-claims CLI reference](./ns-claims.md) - claim-coverage engine called by ns-gate
- [ns-scrub CLI reference](./ns-scrub.md) - injection and continuity engine called by ns-gate
- [ns-stylometry CLI reference](./ns-stylometry.md) - drift engine called by ns-gate
- [ns-doctor CLI reference](./ns-doctor.md) - coherence check shared with ns-gate
- [run-quality-gate skill reference](../skills/run-quality-gate.md) - skill that invokes ns-gate
