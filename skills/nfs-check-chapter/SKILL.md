---
name: nfs-check-chapter
user-invocable: true
argument-hint: "[chapter: slug or number]"
description: "Runs the surface-independent deterministic quality gate over a chapter by wrapping bin/ns-gate in a single Bash call: maps exit 0 to a pass or warn verdict summary from the report JSON, exit 1 to a block verdict with per-check details and next actions, and exit 2 to an error that is never treated as a pass. Pre-checks the voice baseline before invoking the gate; degrades to a four-check subset (claims, scrub, continuity-quick, coherence) with a voice-drift-skipped warning when the baseline is absent or stale. Resolves the chapter argument from the supplied value, the most-recently-modified chapter in progress.json, or by asking the author when neither is available. Deep mode (Phase 2) is acknowledged and politely declined in v1. Use when the author asks 'is this chapter done' or wants to 'run the quality gate,' seeking the overall pass, warn, or block verdict rather than the claims-only check that fact-check-pass performs."
when_to_use: "Use when the author types the /gate verb alias, invokes explicitly on chat after any chapter-writing flow, draft-chapter or revise-pass prompts for it on completion, or wants an explicit deterministic gate verdict. Do not invoke for project status overviews (use status-dashboard for that), to re-trigger the Stop hook gate (automatic on CLI and Cowork), in deep mode (Phase 2, not yet available), or for unrelated queries."
---

This skill is the surface-independent quality gate. It resolves the chapter argument, pre-checks the voice baseline to determine which check set to run, invokes `bin/ns-gate` in a single Bash call, and maps the exit code to a presented verdict: exit 0 presents the pass or warn summary from the report JSON, exit 1 presents the block verdict with per-check details and next actions, and exit 2 surfaces an error that is never treated as a pass. The `bin/ns-gate` orchestrator is the sole writer of `.studio/gate/<slug>.<ts>.json` reports and handles its own prune policy; the skill writes no `.studio/` state.

**Judgment honesty note.** The verdict this skill presents is the deterministic layer only. On CLI and Cowork the Stop hook additionally runs a thesis-alignment judgment prompt (warn-only, never blocks in Phase 1 per D-03 (layered Stop gate)). That judgment layer is not available when invoking this skill directly; on chat it does not exist in v1 and the skill states this fact when presenting the verdict.

**No agents invoked.** This is a deterministic-CLI-only skill. No chain edges exist. The Phase 2 deep mode, which would add `fact-checker`, `voice-guardian`, and `continuity-checker` as background subagents, is not implemented in v1.

Skill inputs read:
- `.studio/progress.json` (chapter resolution at Step 2 when no chapter argument is supplied; the progress layer is alive per TSK-050b (progress entry ownership))
- `structure/chapter-list.md` (slug registry; probed at Step 2 to resolve a chapter argument to a canonical slug)
- `chapters/<slug>.md` (target chapter; file-existence probed at Step 2)
- `context/style-profile.md` (baseline pre-check at Step 3; absence triggers the degraded check subset)
- `.studio/config.json` (baseline pre-check at Step 3; `stylometry.baseline.markers` absence, or a `stylometry.baseline.marker_set_version` that is absent or does not match the engine's current version, also triggers the degraded check subset)

No skill chain edges exist for this skill.

---

## Step 1 - Argument parsing and deep argument check

Parse the supplied argument (if any). Split on whitespace; check whether any token is the literal string `deep`.

If `deep` is present in the argument tokens: state the following and halt, making no tool calls:

> Deep mode (adding the parallel review fleet of `fact-checker`, `voice-guardian`, and `continuity-checker`) is a Phase 2 capability and is not available in v1 - no fleet is running. Run the quality gate without the `deep` argument to get the deterministic layer verdict: `/nonfiction-studio:run-quality-gate [chapter]`

Do not proceed to Step 2 when `deep` is present.

The chapter token (if any) is the first non-`deep` argument token. Carry it forward to Step 2. No tool call is needed in Step 1.

---

## Step 2 - Chapter resolution (mandatory first tool call)

**Branch A - Chapter argument was supplied.** Use the Bash tool to check whether the chapter-list registry is present:

```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```

- `HAS_REGISTRY`: use the Read tool on `structure/chapter-list.md` to resolve the supplied argument to the canonical slug.
  - **Slug match** (for example `02-finding-your-network`): locate the row whose slug column matches exactly. Carry the slug forward.
  - **Number match** (for example `2` or `02`): locate the row whose chapter number matches. Carry the slug forward.
  - **No match:** halt with a clear error. State: "Chapter `[supplied value]` was not found in the chapter registry. Check `structure/chapter-list.md` for the valid slugs." List the available slugs.
- `NO_REGISTRY`: use the supplied argument directly as the slug candidate.

After resolving the slug, probe the chapter file:

```
test -f chapters/<slug>.md && echo HAS_CHAPTER || echo NO_CHAPTER
```

- `NO_CHAPTER`: halt immediately. State: "Chapter file `chapters/<slug>.md` was not found. Produce the chapter with `/nonfiction-studio:draft-chapter <slug>` before running the quality gate."
- `HAS_CHAPTER`: carry the slug forward to Step 3.

**Branch B - No chapter argument supplied.** Use the Bash tool to check whether the progress file is present:

```
test -f .studio/progress.json && echo HAS_PROGRESS || echo NO_PROGRESS
```

- `NO_PROGRESS`: ask the author directly. State: "No chapter argument was supplied and no `progress.json` was found. Which chapter would you like to gate? Supply the slug or number, for example `/nonfiction-studio:run-quality-gate 02-finding-your-network`." Halt until the author supplies an argument; then restart from Step 2 Branch A.
- `HAS_PROGRESS`: use the Read tool on `.studio/progress.json`. Select the most-recently-modified chapter using these criteria in order:
  1. The chapter with the most recent `last_gate.ts` (the one that was gated most recently and may need re-gating after revision).
  2. If no chapters have a gate record, the last chapter in the array with `status: drafted` or `status: drafting`.
  3. If still ambiguous (no chapters at either status, or multiple candidates with equal recency), ask the author which chapter to gate and halt until they reply.

  Once a chapter is selected, probe its file:
  ```
  test -f chapters/<slug>.md && echo HAS_CHAPTER || echo NO_CHAPTER
  ```
  `NO_CHAPTER`: ask the author and halt. `HAS_CHAPTER`: carry the slug forward to Step 3.

---

## Step 3 - Voice baseline pre-check

Use the Bash tool to probe the style profile:

```
test -f context/style-profile.md && echo HAS_PROFILE || echo NO_PROFILE
```

**If `NO_PROFILE`:** the voice baseline is absent. Set the check subset to `claims,scrub,continuity-quick,coherence` and present the following warning to the author before continuing:

> Voice drift check skipped: `context/style-profile.md` was not found. The gate will run claim coverage, prompt scrub, continuity, and state coherence checks only. Capture your voice baseline with `/nonfiction-studio:capture-voice` to enable voice drift detection.

Continue to Step 4 to resolve the plugin root; the gate invocation in Step 5 uses check subset `claims,scrub,continuity-quick,coherence`.

**If `HAS_PROFILE`:** use the Read tool on `.studio/config.json` to check whether `stylometry.baseline.markers` is present and non-null. If the field is absent or null, treat this the same as the `NO_PROFILE` case: set the check subset to `claims,scrub,continuity-quick,coherence` and present:

> Voice drift check skipped: `context/style-profile.md` is present but `stylometry.baseline.markers` is absent or null in `.studio/config.json`. Run `/nonfiction-studio:capture-voice` to populate the baseline and enable voice drift detection.

If `stylometry.baseline.markers` is present and non-null, also check `stylometry.baseline.marker_set_version` in that same read. If it is absent, null, or different from the value of `CURRENT_MARKER_SET_VERSION` exported by `hooks/lib/stylometry-engine.mjs`, read that constant rather than comparing against a number written here, the stored baseline predates the current engine and `ns-gate` will reject it. Route this the same as the case above: set the check subset to `claims,scrub,continuity-quick,coherence` and present:

> Voice drift check skipped: the stored baseline in `.studio/config.json` was captured under an earlier version of the stylometry engine (`stylometry.baseline.marker_set_version` is missing or does not match the engine's current version). Run `/nonfiction-studio:capture-voice` to re-capture the baseline with the corrected engine and enable voice drift detection.

Only when `stylometry.baseline.markers` is present and non-null AND `marker_set_version` matches the engine's current version, run the full gate. Set no check subset (all five checks will be included by ns-gate's default).

---

## Step 4 - Resolve the plugin root

Use the Bash tool to run the primary lookup:
```
node -e "const s=require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8');const m=JSON.parse(s).extraKnownMarketplaces;const ns=m&&m['nonfiction-studio'];console.log(ns&&ns.source&&ns.source.path||'not-found')"
```

The output is the plugin root. If it prints `not-found`, run the platform cache fallback:
```
find "$HOME/.claude/plugins/cache" -maxdepth 3 -type d -name "nonfiction-studio*" 2>/dev/null | head -1
```

If that also returns nothing, run the dev-mode fallback:
```
test -f bin/ns-gate && pwd || echo not-found
```

If all three lookups fail: halt immediately. Report the settings.json path attempted (`$HOME/.claude/settings.json`) and the cache path attempted (`$HOME/.claude/plugins/cache`). Do not invoke ns-gate. Ask the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>` for Step 5.

**Shared plugin-root convention.** This three-tier resolution (settings.json lookup, plugins-cache search, dev-mode fallback) is the same routine as `skills/init-project/SKILL.md` Step 4; a future wave extracts it to a shared reference.

---

## Step 5 - Gate invocation (single Bash call; maps exit code to verdict)

Use the Bash tool to run the gate. This is the ONE Bash call that wraps the gate; no individual CLI invocations (ns-claims, ns-stylometry, ns-scrub) are made by the skill.

When a check subset was set in Step 3:
```
node "<plugin-root>/bin/ns-gate" --project=. --chapter=<slug> --check=<subset> --json
```

When no subset was set (full gate):
```
node "<plugin-root>/bin/ns-gate" --project=. --chapter=<slug> --json
```

Capture the exit code and the stdout (the JSON report) and the stderr.

Map the exit code as follows. The exit 2 path is never treated as a pass under any circumstance.

**Exit 0 - gate ran without a blocking condition:**

Parse stdout as the gate report JSON. Present the full verdict:

- **Verdict `pass`:** state the gate outcome.

  > Gate verdict: PASS for `chapters/<slug>.md`. All checks passed (or were skipped). This verdict is the deterministic layer only; the Stop hook's thesis-alignment judgment prompt (warn-only, CLI and Cowork only) is not part of this skill invocation and does not exist in v1 on chat.

  List the per-check results from `report.checks` as a compact table or list (check name, verdict, detail). A `session_write_flag` verdict of `skip` means no chapter writes were detected in the current session; note this if relevant.

- **Verdict `warn`:** state the gate outcome and present the warn entries.

  > Gate verdict: WARN for `chapters/<slug>.md`. The gate ran without a blocking condition (exit 0). Voice drift is warn-only by default; coverage and scrub issues block only when blocking mode is explicitly enabled. This verdict is the deterministic layer only.

  For each check with verdict `warn` or `block` (capped to `warn` by the top-level gate mode), present the check name, detail, and `next` action. List the remaining checks as pass or skip. Suggest next steps based on which checks warned.

**Exit 1 - gate blocked:**

Parse stdout as the gate report JSON. The top-level `verdict` is `block`. State the block outcome prominently:

> Gate verdict: BLOCK for `chapters/<slug>.md`. The chapter cannot proceed until the blocking conditions below are resolved.

For each check entry with `verdict: block`, present the check name, detail, evidence pointers (if any), and next action. These are the specific conditions the author must address. For checks with other verdicts, list them as secondary context.

Suggest the appropriate remediation skill for each blocking check type:
- `claim_coverage` block: `/nonfiction-studio:fact-check-pass <slug>`
- `prompt_scrub` block: manual edit to remove agent scaffolding or prompt residue from the chapter file

**Exit 2 - gate error:**

Surface the error from stderr and halt. Never report the chapter as passed, warned, or blocked based on an exit 2 result.

> Gate error (exit 2): [first line of stderr, or "gate subprocess exited with code 2" if stderr is empty]. The gate run did not complete. This result is never treated as a pass. Check that the project bible is intact (run `/nonfiction-studio:doctor` to diagnose) and re-run the quality gate.

If stdout also contains output (partial JSON or other text), include it verbatim for diagnostic purposes.

---

## Failure behavior

**`deep` argument supplied.** Step 1 halts with the Phase 2 decline message. No file reads, no tool calls, no gate invocation.

**Chapter argument not matched.** Step 2 halts with the supplied value, the registry file path, and the list of valid slugs. No gate invocation and no `.studio/` writes occur.

**Chapter file missing.** The Step 2 Bash probe halts on `NO_CHAPTER`. The halt message names the file path and routes to `draft-chapter`. No gate invocation occurs.

**No argument and no progress.json.** Step 2 halts and asks the author which chapter to gate. No gate invocation until the author replies with a chapter.

**Voice baseline absent or stale.** Step 3 sets the degraded check subset and warns about the skipped voice drift check, whether the baseline is missing entirely or its `marker_set_version` is absent or does not match the engine's current version. The gate still runs; neither condition is a halt condition. The four remaining checks run normally.

**Exit 2 from ns-gate.** Step 5 presents the error from stderr and halts. Never treated as a pass, warn, or block verdict. Re-run after diagnosing with `doctor`.
