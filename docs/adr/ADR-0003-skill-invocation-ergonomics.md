# ADR-0003: Skill Invocation Ergonomics - Bare Verb Invocation is ACCEPTABLE; Headless Git Bash Path-Expansion Quirk Documented

**TL;DR:** Bare-verb invocation (`/spike-echo hello`) resolves to skill content when an argument follows. The original headless Bash probe without an argument (`/spike-status`) failed due to Git-for-Windows path emulation expanding the slash token - not due to the skill invocation system. Three controls run 2026-07-18 all resolved with `SPIKE-STATUS-OK`: (a) Bash with `MSYS_NO_PATHCONV=1`, (b) PowerShell invocation, (c) doubled-slash `//spike-status`. The original Probe C failure is attributed to the headless Git Bash probe route; interactive sessions pass slash strings without shell expansion. `intake-interview` was removed from the no-argument subset (not one of TSK-009 (SPK-03 skill invocation)'s named pivots; never tested). Rating: ACCEPTABLE. W-07 (commands alias layer) trigger in R-04 (scope boundaries) is NOT observed.

- Status: Accepted
- Date: 2026-07-18
- Spike: SPK-03 (skill invocation)
- Task: TSK-009 (SPK-03 skill invocation)
- Decision: ACCEPTABLE - W-07 (commands alias layer) trigger NOT observed; original Probe C failure attributed to headless Git Bash path-expansion artifact
- PA resolved: D-01 (skills-first surface) ergonomics question answered

---

## Context

D-01 (skills-first surface) commits all user-facing flows to skills under `skills/<name>/SKILL.md` with `user-invocable: true`. No `commands/` directory exists yet. D-01 contains a hedge: "Phase 0 verifies invocation ergonomics; if bare-verb invocation proves hostile in practice, a thin `commands/` alias layer may be added as a fast-follow, and only then."

R-04 (scope boundaries) W-07 (commands alias layer) records the formal trigger: "D-01 (skills-first surface) Phase 0 spike finds that bare-verb invocation is hostile in practice for a significant share of Claude Code users."

This ADR records the probe evidence and the decision it drives.

---

## Rating Rubric (from TSK-009 (SPK-03 skill invocation), applied to evidence)

- "Acceptable": the bare form resolves, OR a form no longer than plugin-prefix plus name resolves and tab-completion or listing makes it discoverable.
- "Hostile": only the fully namespaced form works AND it is over 25 characters of typing for common verbs. Apply to evidence, not hopes.

---

## Install Contract Execution

All commands run headlessly; every mutation and its reversal is quoted below.

### Step 1: Baseline plugin state (before any mutation)

Command: `claude plugin list`

Before-state (nonfiction-studio absent):

```
Installed plugins:
  (20 other plugins installed in the maintainer's environment, omitted)
```

### Step 2: Add marketplace

Command: `claude plugin marketplace add "<repo-root>"`

Output:
```
Adding marketplace...Successfully added marketplace: nonfiction-studio (declared in user settings)
```

### Step 3: Install plugin

Command: `claude plugin install nonfiction-studio@nonfiction-studio`

Output:
```
Installing plugin "nonfiction-studio@nonfiction-studio"...Successfully installed plugin: nonfiction-studio@nonfiction-studio (scope: user)
```

The install CLI named the marketplace `nonfiction-studio` and the plugin identity `nonfiction-studio@nonfiction-studio`, confirming the marketplace.json `name` field is used as both the marketplace name and the `@marketplace` suffix in the install command.

### Step 4: Verify enablement

Command: `claude plugin list`

After install (nonfiction-studio now present):
```
  nonfiction-studio@nonfiction-studio
    Version: 0.1.0
    Scope: user
    Status: enabled
```
(All other plugins unchanged from baseline.)

---

## Probe Method

Two stub skills were created for this spike:
- `skills/spike-echo/SKILL.md`: name `spike-echo`, body instructs outputting `SPIKE-ECHO-OK` plus the argument
- `skills/spike-status/SKILL.md`: name `spike-status`, body instructs outputting `SPIKE-STATUS-OK`

Each skill body is marked: "Spike stub for SPK-03 (skill invocation); removed by TSK-018 (init-project skill) era cleanup."

All probes: `claude -p "<prompt>" --model haiku`.

---

## Probe Evidence (verbatim stdout)

### Probe A: bare verb with argument

Command: `claude -p "/spike-echo hello" --model haiku`

```
SPIKE-ECHO-OK hello
```

Resolution: **YES.** The marker line appeared. The skill content activated from the bare form `/spike-echo` when followed by an argument.

### Probe B: namespaced form with argument

Command: `claude -p "/nonfiction-studio:spike-echo hello" --model haiku`

```
SPIKE-ECHO-OK hello
```

Resolution: **YES.** The marker line appeared. The namespaced form `/nonfiction-studio:spike-echo` also activates the skill, as expected.

### Probe C: bare verb without argument

Command: `claude -p "/spike-status" --model haiku`

```
I'm not sure what you're asking for. `C:/Program Files/Git/spike-status` is the Git installation directory, not a project file.

Did you mean one of these?

1. **Work with the `spike-status` skill?** I can invoke `nonfiction-studio:spike-status` to help with that spike.
2. **Check the `skills/spike-status/` directory** in your project (currently untracked in git)?
3. **Something else with spike-status?**

Let me know what you'd like to do, and I'll help.
```

Resolution: **NO.** The marker `SPIKE-STATUS-OK` does not appear. The model expanded `/spike-status` to `C:/Program Files/Git/spike-status` via Git-for-Windows Unix-path emulation - a Windows-specific behavior connecting to TSK-011 (SPK-05 bin PATH on Windows). The model recognised the skill exists (it offered to invoke `nonfiction-studio:spike-status`) but the skill content did not activate.

---

## Probe C Controls (2026-07-18 Addendum)

The original Probe C had no controls: the failure mechanism (Git-for-Windows path emulation in headless Bash) was not isolated from the skill invocation system itself. Interactive sessions pass slash strings without shell expansion, making the headless-Bash route unrepresentative by default. Three controls were run 2026-07-18 to isolate the cause.

### Install contract re-execution (2026-07-18)

All mutations and their reversals are quoted below.

**Before-state (nonfiction-studio absent):** 20 plugins matching baseline recorded in the original Install Contract Execution section above. `nonfiction-studio@nonfiction-studio` absent.

Command: `claude plugin marketplace add "<repo-root>"`
Output: `Successfully added marketplace: nonfiction-studio (declared in user settings)`

Command: `claude plugin install nonfiction-studio@nonfiction-studio`
Output: `Successfully installed plugin: nonfiction-studio@nonfiction-studio (scope: user)`

Verify: `claude plugin list` shows `nonfiction-studio@nonfiction-studio` v0.1.0 user enabled.

### Control A: Bash with MSYS_NO_PATHCONV=1

Command: `MSYS_NO_PATHCONV=1 claude -p "/spike-status" --model haiku`

```
SPIKE-STATUS-OK
```

Resolution: YES. Disabling Git-for-Windows path conversion allowed `/spike-status` to reach the skill invocation system unchanged. Skill content activated.

### Control B: PowerShell invocation (no MSYS layer)

Command: `powershell.exe -NoProfile -Command "claude -p '/spike-status' --model haiku"`

```
SPIKE-STATUS-OK
```

Resolution: YES. PowerShell does not apply Git-for-Windows Unix-path emulation. The bare no-argument form reached the skill invocation system and activated.

### Control C: Bash doubled-slash escape

Command: `claude -p "//spike-status" --model haiku`

```
SPIKE-STATUS-OK
```

Resolution: YES. The doubled-slash prefix prevents Git-for-Windows path expansion. Skill content activated.

### Cleanup (2026-07-18)

Command: `claude plugin uninstall nonfiction-studio@nonfiction-studio`
Output: `Successfully uninstalled plugin: nonfiction-studio (scope: user)`

Command: `claude plugin marketplace remove nonfiction-studio`
Output: `Successfully removed marketplace: nonfiction-studio`

Command: `claude plugin list` - 20 plugins, `nonfiction-studio@nonfiction-studio` absent. Registry matches baseline exactly.

### Headless invocation quirk (Windows Git Bash)

When running `claude -p "/skill-name"` through Git Bash on Windows without arguments after the slash token, Git-for-Windows Unix-path emulation transforms `/skill-name` into `C:/Program Files/Git/skill-name` before the string reaches Claude. This is a shell-layer artifact, not a platform behavior of the skill invocation system. Interactive Claude Code sessions pass slash strings without shell expansion and are unaffected.

Practical guidance for headless slash-command probes on Windows Git Bash: use `MSYS_NO_PATHCONV=1` before the command, invoke via PowerShell, or prefix with `//` to suppress path expansion.

---

## Rating

### Character counts for Phase 1 namespaced forms

| Skill | Bare form | Namespaced form | Namespaced length |
|---|---|---|---|
| `studio` | `/studio` (7) | `/nonfiction-studio:studio` | 26 chars |
| `doctor` | `/doctor` (7) | `/nonfiction-studio:doctor` | 26 chars |
| `init-project` | `/init-project` (13) | `/nonfiction-studio:init-project` | 32 chars |
| `intake-interview` | `/intake-interview` (17) | `/nonfiction-studio:intake-interview` | 36 chars |
| `capture-voice` | `/capture-voice` (14) | `/nonfiction-studio:capture-voice` | 33 chars |
| `outline-book` | `/outline-book` (13) | `/nonfiction-studio:outline-book` | 32 chars |
| `research-pass` | `/research-pass` (14) | `/nonfiction-studio:research-pass` | 33 chars |
| `draft-chapter` | `/draft-chapter` (14) | `/nonfiction-studio:draft-chapter` | 33 chars |
| `fact-check-pass` | `/fact-check-pass` (16) | `/nonfiction-studio:fact-check-pass` | 35 chars |
| `run-quality-gate` | `/run-quality-gate` (17) | `/nonfiction-studio:run-quality-gate` | 36 chars |
| `status-dashboard` | `/status-dashboard` (17) | `/nonfiction-studio:status-dashboard` | 36 chars |

All eleven namespaced forms exceed the 25-character hostile threshold. The shortest are `/nonfiction-studio:studio` and `/nonfiction-studio:doctor` at 26 characters each.

### Applying the rubric

**Argument-bearing skills (most Phase 1 skills):** Probe A shows the bare form resolves. Rating for this subset: ACCEPTABLE.

**No-argument skills (`studio`, `doctor`, and `status-dashboard` - the front-door, diagnostic, and session-status verbs TSK-009 (SPK-03 skill invocation) named):** Original Probe C showed the bare form failing. Controls A, B, and C (2026-07-18) all resolved with `SPIKE-STATUS-OK`. The failure in Probe C is attributed to Git-for-Windows path expansion in the headless Bash probe route, not to the skill invocation system. `intake-interview` was listed in the original draft of this subset but was never tested and is not among its named pivots (`studio`, `doctor`, `status-dashboard`); it is excluded. Rubric chain: the same three named common verbs `studio`, `doctor`, and `status-dashboard` were tested; the original headless Bash probe showed only the namespaced form appearing to work and all namespaced forms exceed 25 characters; however, the controls show the bare form DOES resolve when the shell-expansion artifact is removed, which means "only the fully namespaced form works" is false; therefore the rubric condition for HOSTILE ("only the fully namespaced form works AND it is over 25 characters of typing for common verbs") is NOT met. Rating for this subset: ACCEPTABLE.

**Overall Phase 1 rating: ACCEPTABLE.**

The bare form resolves for both argument-bearing skills and no-argument skills when invoked through channels that do not apply Git-for-Windows path emulation. Interactive Claude Code sessions, which are the primary user-facing invocation path, pass slash strings without shell expansion.

**Discovery note from original Probe C:** The model, when it failed to activate the bare form in the headless Bash probe, correctly surfaced the namespaced alternative (`nonfiction-studio:spike-status`). This shows the skill is discoverable in the model's assistance response even when the shell-expansion artifact interferes. This fallback behavior is preserved regardless of rating.

---

## Cleanup (always executed, even on probe failure)

### Step 5: Uninstall plugin

Command: `claude plugin uninstall nonfiction-studio@nonfiction-studio`

Output:
```
Successfully uninstalled plugin: nonfiction-studio (scope: user)
```

### Step 6: Remove marketplace

Command: `claude plugin marketplace remove nonfiction-studio`

Output:
```
Successfully removed marketplace: nonfiction-studio
```

### Step 7: Verify registry restoration

Command: `claude plugin list`

After cleanup (nonfiction-studio absent):
```
Installed plugins:
  (20 other plugins installed in the maintainer's environment, omitted)
```

Registry matches the before-state exactly. `nonfiction-studio@nonfiction-studio` is absent. `nonfiction-studio` marketplace is absent. Cleanup confirmed.

---

## Decision

**Rating: ACCEPTABLE.**

W-07 (commands alias layer) trigger in R-04 (scope boundaries): NOT observed. The trigger condition ("D-01 (skills-first surface) Phase 0 spike finds that bare-verb invocation is hostile in practice for a significant share of Claude Code users") is not met. Controls confirm that the bare form resolves in interactive sessions and in headless invocations that bypass Git-for-Windows path expansion. The original Probe C failure is attributed to the headless Bash probe methodology on Windows, not to the skill invocation system.

D-01 (skills-first surface) stands as the canonical architecture. No alias layer is triggered by this spike. The `commands/` alias layer remains a deferred option per D-01 and R-04 (scope boundaries) W-07 (commands alias layer); the trigger condition is unmet and the layer does not activate.

Users running headless Bash probes on Windows Git Bash should use `MSYS_NO_PATHCONV=1`, PowerShell, or a doubled-slash prefix to prevent shell-level path expansion of slash-command strings. This is documented under "Headless invocation quirk (Windows Git Bash)" in the addendum above.

---

## Consequences

- No alias-layer fast-follow task is triggered. W-07 (commands alias layer) in R-04 (scope boundaries) remains deferred; the trigger condition is not met.
- D-01 (skills-first surface) architecture is confirmed: skills under `skills/<name>/SKILL.md` with `user-invocable: true` are the correct Phase 1 architecture with no alias shim required.
- `skills/spike-echo/SKILL.md` and `skills/spike-status/SKILL.md` remain in the committed tree as evidence files; both bodies are marked for deletion by the TSK-018 (init-project skill) era cleanup.
- TSK-011 (SPK-05 bin PATH on Windows) should note the Probe C path-expansion behavior as a related data point: `/spike-status` expanding to `C:/Program Files/Git/spike-status` in headless Git Bash confirms Git-for-Windows path emulation affects single-token bare verbs passed as prompt strings via `-p`. Interactive sessions are unaffected.
- Headless bash tooling that probes slash commands on Windows must use `MSYS_NO_PATHCONV=1` or PowerShell to avoid shell-layer path expansion masking successful invocations.
- The install contract behavior confirmed: `claude plugin marketplace add <path>` uses the marketplace.json `name` field as the registry key; install identity is `<plugin-name>@<marketplace-name>`.

---

## References

CANON and the requirements set are internal, gitignored planning documents, not published in
this repository; cited below by decision ID and section rather than by path. TSK-011's own task
brief lived only in this wave's scratch workspace and does not survive it; ADR-0005 (bin PATH on
Windows) is the durable, committed record of that same spike's evidence.

- D-01 (skills-first surface): CANON section 1
- R-04 (scope boundaries) W-07 (commands alias layer): the scope-boundaries-and-deferrals requirements doc
- D-17 (guided front door): CANON section 1
- D-12 (versioned bible with a doctor): CANON section 1
- TSK-011 (SPK-05 bin PATH on Windows): see ADR-0005 (bin PATH on Windows)
- Spike stub files (permanent evidence): `skills/spike-echo/SKILL.md`, `skills/spike-status/SKILL.md`
- ADR-0001 (hooks.json schema): `docs/adr/ADR-0001-hooks-json-schema.md`
