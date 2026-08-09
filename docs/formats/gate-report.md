# Gate Report Format

**Purpose.** This is the normative grammar for gate report files under `.studio/gate/`, one file per gate run, defined in S-08 (schemas and file formats) section 11. `bin/ns-gate` writes a gate report file at the end of every run; the `status-dashboard` skill and `progress.json` `last_gate.report` read it. The file `.studio/gate/last-gate.json` carries the most recent gate debt for each chapter and is the SessionStart gate-debt input per S-07 (hooks and scripts). Every field name, value constraint, and structural rule below is authoritative. A parser author must be able to implement a conformant reader without consulting any other document.

## Filename pattern

Gate report files follow this naming rule:

```
.studio/gate/<chapter-slug>.<YYYYMMDDTHHMMSSZ>.json
```

For example: `.studio/gate/03-the-signal.20260717T154022Z.json`. The timestamp is compact ISO 8601 in UTC, with no colons or hyphens in the time component. `<chapter-slug>` is the two-digit ordinal plus kebab title matching the chapter filename stem.

## Record structure

Each gate report is a JSON object with these top-level fields:

| Field | Type | Required | Allowed values and notes |
|---|---|---|---|
| `version` | integer | required | Bible schema major; must equal `meta.json` `schema_version` (currently `2`) |
| `chapter` | string | required | The chapter slug; matches the filename stem prefix |
| `ts` | string | required | RFC 3339 UTC timestamp of the gate run |
| `verdict` | enum | required | One of `pass`, `warn`, `block`, `skip`; the most severe per-check verdict, subject to config coercions |
| `checks` | array | required | One entry per gate check run (see Check entry below) |

### Check entry fields

Each entry in the `checks` array carries:

| Field | Type | Required | Allowed values and notes |
|---|---|---|---|
| `check` | string | required | The check name as it appears in `config.json` `gate.checks` |
| `verdict` | enum | required | One of `pass`, `warn`, `block`, `skip` |
| `detail` | string | required | A human-readable summary of the check finding |
| `evidence` | array of strings | required | Bible-relative pointers to the supporting evidence: file paths with optional line anchors (for example, `chapters/03-the-signal.md#L44`) or JSON pointers into `progress.json` (for example, `.studio/progress.json#/chapters/2/drift_score`) |
| `next` | string or null | required | The recommended author action, or `null` when the verdict is `pass` or `skip` |

### Verdict values

| Value | Meaning |
|---|---|
| `pass` | The check found no issues |
| `warn` | The check found issues that do not block the session |
| `block` | The check found issues that stop the session, subject to coercions in `config.json` |
| `skip` | The check was not run (disabled in `config.json` or skipped due to missing data) |

## Placement and retention rules

- Reports are written atomically by `bin/ns-gate` to `.studio/gate/<slug>.<YYYYMMDDTHHMMSSZ>.json` at the end of every gate run.
- `bin/ns-gate` also updates `.studio/gate/last-gate.json` with the most recent gate result for the chapter after each run; this file is the gate-debt input read by the `SessionStart` hook per S-07 (hooks and scripts).
- The top-level `verdict` is the most severe per-check verdict, subject to the coercions in `config.json` section 4: judgment checks (`thesis_alignment`) are coerced from `block` to `warn`; the top-level `gate.mode` setting governs whether `block` verdicts actually stop the session.
- Retention mirrors the snapshot policy: the last 10 reports per chapter slug are kept; older reports are pruned by `bin/ns-gate` at creation time.
- `progress.json` `last_gate.report` is updated by `bin/ns-gate` to point at the new report's bible-relative path after each run.

## Example

```json
{
  "version": 2,
  "chapter": "03-the-signal",
  "ts": "2026-07-17T15:40:22Z",
  "verdict": "block",
  "checks": [
    {
      "check": "claim_coverage",
      "verdict": "block",
      "detail": "2 factual sentences without a resolved marker",
      "evidence": ["chapters/03-the-signal.md#L44", "chapters/03-the-signal.md#L61"],
      "next": "Add a [claim: EV-nnnn] marker or tag the sentence [UNVERIFIED]."
    },
    {
      "check": "prompt_scrub",
      "verdict": "pass",
      "detail": "no agent scaffolding or prompt residue found",
      "evidence": [],
      "next": null
    },
    {
      "check": "stylometry",
      "verdict": "warn",
      "detail": "drift_score 38 exceeds threshold 35",
      "evidence": [".studio/progress.json#/chapters/2/drift_score"],
      "next": "Review long-sentence rate and contraction rate against the baseline."
    }
  ]
}
```

## Consumed by

- `bin/ns-gate` (TSK-029 (ns-gate orchestrator)): writes one report per gate run; updates `.studio/gate/last-gate.json`; updates `progress.json` `last_gate.report`; prunes to the last 10 reports per chapter slug.
- `Stop` gate hook (TSK-034 (stop-gate hook)): invokes `bin/ns-gate` at session end and reads the resulting report to determine whether to block the session.
- `status-dashboard` skill: reads the latest report per chapter to populate the gate status column in the dashboard.
