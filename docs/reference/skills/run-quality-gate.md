---
title: "run-quality-gate skill reference"
description: "Reference for the run-quality-gate skill - the surface-independent deterministic quality gate that wraps bin/ns-gate, maps exit codes to presented verdicts, pre-checks the voice baseline, and resolves the chapter argument from progress.json when none is supplied"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "gate", "quality", "deterministic", "claims", "stylometry", "scrub"]
---

# run-quality-gate

The `run-quality-gate` skill is the surface-independent Definition-of-Done gate per D-03 (layered Stop gate) and D-14 (three-surface compatibility). On CLI and Cowork the Stop hook runs the same `bin/ns-gate` orchestrator automatically at session end; on chat the author invokes this skill explicitly as the substitute. The skill wraps a single `bin/ns-gate` Bash call, maps the exit code to a presented verdict, pre-checks the voice baseline, and resolves the chapter argument from progress.json when none is supplied. It is a Phase 1 skill specified in S-06 3.8 (skills and invocation surface) and governed by D-03 (layered Stop gate), D-05 (five shipped CLIs), D-06 (single-writer state discipline), and D-14 (three-surface compatibility).

## Purpose

`run-quality-gate` bridges the deterministic gate layer and the author conversation. The `bin/ns-gate` orchestrator it invokes runs up to five checks (claim coverage, voice drift, prompt scrub, continuity, state coherence) composed into a single policy verdict; policy including D-03 coercions and the warn-cap lives inside the orchestrator per TSK-029 (ns-gate orchestrator). The skill's role is to pre-check the baseline, select the right check set, invoke the gate, and present the verdict honestly.

**The verdict this skill presents is the deterministic layer only.** On CLI and Cowork the Stop hook additionally runs a thesis-alignment judgment prompt (warn-only, never blocks in Phase 1). That judgment layer is not available when invoking this skill directly; on chat it does not exist in v1 and the skill states this fact when presenting the verdict.

**No agents invoked.** This is a deterministic-CLI-only skill in Phase 1. No chain edges exist. The Phase 2 deep mode, which would add `fact-checker`, `voice-guardian`, and `continuity-checker` as background subagents, is not implemented in v1; the `deep` argument is politely declined.

**The skill writes no `.studio/` state.** `bin/ns-gate` writes `.studio/gate/<slug>.<ts>.json` and prunes to the last 10 per slug per D-06 (single-writer state discipline) and S-08 section 11. The `progress.json` `last_gate` per-chapter field is reserved and unpopulated in v1; no component writes it during a live gate run.

## Invocation

```
/nonfiction-studio:run-quality-gate [chapter]
```

The chapter argument is optional. The chapter may be a slug (for example `02-finding-your-network`) or a number (for example `2`). When omitted the skill resolves the target chapter from `progress.json`. A `deep` argument is not part of the invocation form: if supplied anyway, Step 1 acknowledges and politely declines it in v1.

Alternate entry points:
- Via the `studio` dispatcher: routes here from Path 4 (Review quality and status) after `status-dashboard`
- Via `draft-chapter` Step 6: that skill closes with an explicit prompt to run `run-quality-gate` on chat because the Stop hook does not fire automatically there
- Via `fact-check-pass` Step 6: when coverage reaches 100% the skill suggests running the quality gate
- Verb alias: `/gate` (introduced in v2; the namespaced `/nonfiction-studio:run-quality-gate` form also works)

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `.studio/progress.json` | Step 2 (Bash probe + Read) when no chapter argument is supplied | Identify the most-recently-modified chapter for gating |
| `structure/chapter-list.md` | Step 2 (Bash probe + Read) when a chapter argument is supplied | Resolve the chapter slug or number to the canonical slug |
| `chapters/<slug>.md` | Step 2 (Bash probe) | Confirm the chapter file exists before invoking the gate |
| `context/style-profile.md` | Step 3 (Bash probe) | Presence check for the baseline pre-check; absence triggers the degraded check subset |
| `.studio/config.json` | Step 3 (Read) when style-profile.md is present | Check `stylometry.baseline.markers`; absence or null triggers the degraded check subset |

### Outputs

The skill writes no files. All state writes are performed by `bin/ns-gate`, not by the skill.

| Path | Written by | Contents |
|---|---|---|
| `.studio/gate/<slug>.<ts>.json` | `bin/ns-gate` (via Step 5 Bash call) | S-08 section 11 gate report: version, chapter, ts, verdict, per-check entries with detail, evidence, and next action |

The `.studio/progress.json` `last_gate` per-chapter field is reserved in the schema (S-08 section 3) and unpopulated in v1; no component writes it during a live gate run.

## Flow Summary

The skill runs five steps.

1. **Argument parsing and deep argument check.** Parses the supplied argument. If the literal token `deep` appears, declines as Phase 2 and halts without any tool calls. Carries the chapter token (if any) forward to Step 2.

2. **Chapter resolution (mandatory first tool call).** When a chapter argument was supplied: probes `structure/chapter-list.md` for the registry (Bash) and resolves the slug or number (Read); probes `chapters/<slug>.md` (Bash). When no chapter argument was supplied: probes `.studio/progress.json` (Bash), reads it, and selects the most-recently-modified chapter by these criteria in order: (a) the chapter with the most recent `last_gate.ts`; (b) the last chapter in the array with `status: drafted` or `status: drafting`; (c) asks the author when no clear candidate emerges. Halts on any missing file that prevents resolution. This is the deterministic-guard convention per S-06 1.1 (skill anatomy and discovery).

3. **Voice baseline pre-check.** Probes `context/style-profile.md` (Bash). If absent, or if present but `.studio/config.json` lacks `stylometry.baseline.markers`, the skill sets the check subset to `claims,scrub,continuity-quick,coherence`, warns that voice drift was skipped, and continues. If both the profile and the markers are present, the skill runs the full gate (all five checks). This is the degradation mechanism the brief describes: the gate engine exits 2 on a missing baseline, so the skill pre-checks and routes around the error with a clear warning rather than a halt.

4. **Resolve the plugin root.** Before ns-gate is invoked, the skill resolves the plugin's installed path: a primary lookup against `extraKnownMarketplaces['nonfiction-studio'].source.path` in `~/.claude/settings.json`, a `~/.claude/plugins/cache` search fallback, and a dev-mode fallback that checks for `bin/ns-gate` in the current directory. This is the same three-tier convention `init-project` uses to locate its scaffold templates; it exists because a literal relative `bin/ns-gate` path resolves against the invoking shell's working directory, not the installed plugin, and would silently fail for a marketplace-installed author. If all three lookups fail, the skill halts and names the settings.json and cache paths it attempted.

5. **Gate invocation (single Bash call; maps exit code to verdict).** Runs one Bash call: `node "<plugin-root>/bin/ns-gate" --chapter=<slug> [--check=<subset>] --json`. Captures exit code, stdout (JSON report), and stderr. Maps as follows:
   - **Exit 0:** present the pass or warn verdict summary. Pass is never silent. For warn, lists each non-passing check with its detail and next action. Notes that this verdict is the deterministic layer only.
   - **Exit 1:** present the block verdict with each blocking check's detail, evidence pointers, and next action. Suggests the appropriate remediation skill per blocking check type.
   - **Exit 2:** surface the stderr error. NEVER treated as a pass, warn, or block verdict. Routes to `doctor` for diagnosis.

## Exit-Code Mapping

The mapping mirrors the Stop hook's exit-code semantics (hooks/stop-gate.mjs) but presents verdicts to the author in conversation rather than as JSON decision output:

| Exit code | Meaning | Skill action |
|---|---|---|
| 0, verdict `pass` | All checks passed or were skipped; no blocking condition | Present pass summary; note deterministic-only scope; suggest next chapter or next step |
| 0, verdict `warn` | Checks ran; highest severity was warn (gate top-level mode capped block to warn) | Present warn summary per non-passing check with detail and next action; note deterministic-only scope |
| 0, verdict `skip` | No checks ran (extremely rare; means all checks were disabled) | Present skip summary and recommend checking `.studio/config.json` |
| 1 | Final verdict is block; at least one check is in block mode and fired | Present block verdict; list each blocking check with detail, evidence, and next action; route to remediation |
| 2 | Gate error: config parse error, engine throw, or spawn failure | Surface error from stderr; NEVER treat as a pass; route to `doctor` for diagnosis |

## Baseline Pre-Check and Degradation

The `bin/ns-gate` engine exits 2 when `stylometry.baseline.markers` is absent from `.studio/config.json` but the stylometry check is enabled. Rather than surfacing an exit 2 error, the skill pre-checks both the style profile and the config baseline before invoking the gate.

When either is absent:
- The skill sets `--check=claims,scrub,continuity-quick,coherence` on the gate invocation
- The stylometry check is excluded from this run
- The skill warns the author explicitly: "Voice drift check skipped: [reason]. Run `/nonfiction-studio:capture-voice` to enable voice drift detection."
- The gate still runs the four remaining checks and produces a valid report

The baseline must be established via `/nonfiction-studio:capture-voice`, which runs `bin/ns-stylometry --measure` and writes the marker vector to `.studio/config.json`.

## Chapter Resolution from Progress.json

When no chapter argument is supplied, the skill reads `.studio/progress.json` (the progress layer is alive per TSK-050b (progress entry ownership)) and selects the target chapter in this order:

1. The chapter with the most recent `last_gate.ts` among all chapters that have been gated. This is typically the chapter most recently worked on, whether or not the gate passed.
2. If no chapters have been gated, the last chapter in the `chapters` array with `status: drafted` or `status: drafting` (currently being worked on or ready for gating).
3. If no chapter satisfies either criterion, the skill asks the author directly.

After selection, the skill probes the chapter file (`chapters/<slug>.md`) and halts clearly if the file is missing.

## Surface Behavior

This skill works identically across all three surfaces per D-14 (three-surface compatibility). `bin/ns-gate` runs via the Bash tool on all surfaces; no surface-conditional behavior is needed.

**On CLI and Cowork.** The Stop hook fires the same `bin/ns-gate` call automatically at session end when a chapter write occurred during the session. Authors invoke this skill explicitly for an on-demand mid-session gate run or on surfaces where the hook does not fire. The Stop hook's thesis-alignment judgment prompt (warn-only) is separate from this skill; the skill's verdict does not include it.

**On chat.** The Stop hook does not fire. Any skill that produces chapter content closes with an explicit prompt to run `run-quality-gate`. This skill is the primary gate mechanism on chat. The thesis-alignment judgment layer does not exist in v1 on chat; the skill states this explicitly when presenting a verdict.

## Gate Report

`bin/ns-gate` writes the gate report to `.studio/gate/<slug>.<YYYYMMDDTHHMMSSZ>.json` per S-08 section 11. The report has the following shape:

```json
{
  "version": 2,
  "chapter": "<slug>",
  "ts": "<RFC 3339 UTC>",
  "verdict": "<pass|warn|block|skip>",
  "checks": [
    {
      "check": "<check-name>",
      "verdict": "<pass|warn|block|skip>",
      "detail": "<human summary>",
      "evidence": ["<bible-relative pointer>"],
      "next": "<actionable sentence or null>"
    }
  ]
}
```

The top-level `verdict` is the most severe check verdict subject to the D-03 coercions applied inside the gate engine:
- `thesis_alignment.mode: block` is coerced to `warn` (judgment checks cannot block in v1)
- When `gate.mode` is `warn` (the default), the top-level verdict is capped at `warn` even if per-check entries carry `block`; per-check entries keep their actual verdict so authors see what would block once they opt in

Reports are retained and pruned to the last 10 per chapter slug by `bin/ns-gate`. `bin/ns-status` reads the timestamp in the most recent report file name per slug to derive the drift score and gate verdict in its JSON output; `status-dashboard` narrates that JSON rather than reading report files itself.

## Failure Behavior

**`deep` argument supplied.** Step 1 declines as Phase 2 and halts without any tool calls. No gate invocation, no file reads.

**Chapter argument not matched.** Step 2 halts with the supplied value, the registry file path, and the list of valid slugs. No gate invocation.

**Chapter file missing.** The Step 2 Bash probe halts on `NO_CHAPTER`. The halt message names the file path and routes to `draft-chapter`.

**No argument and no `progress.json`.** Step 2 halts and asks the author which chapter to gate. No gate invocation until the author replies.

**Voice baseline absent.** Step 3 sets the degraded check subset and warns. The gate still runs; baseline absence is not a halt condition.

**Exit 2 from ns-gate.** Step 5 presents the stderr error. Never treated as a pass, warn, or block. Routes to `doctor` for diagnosis.

## Worked Example

See [run-quality-gate.example.md](./run-quality-gate.example.md) for a condensed transcript of a `run-quality-gate` session over the committed Chapter 2 of the sample book "The Quiet Network" (see `examples/sample-book/`). The example is a baseline-absent run (voice drift skipped) that demonstrates the pre-check mechanism and the degraded four-check pass; the gate exits 0 with verdict `pass`. This example is grounded in a live temp-clone gate run at `<temp-dir>` on 2026-07-19.
