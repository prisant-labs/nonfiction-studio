# ADR-0003: Skill Invocation Ergonomics - Bare Verb Invocation is HOSTILE for No-Argument Skills on Windows

**TL;DR:** Bare-verb invocation (`/spike-echo hello`) resolves to skill content when an argument follows. Bare-verb invocation without an argument (`/spike-status`) fails on Windows: the CLI/model interprets `/spike-status` as a Unix path via Git-for-Windows path emulation, not as a skill name. All eleven Phase 1 namespaced forms exceed 25 characters. The no-argument failure covers the pivot skills `studio`, `doctor`, and `status-dashboard`. Rating: HOSTILE. The W-07 alias layer trigger in R-04 (scope boundaries) is met; a thin `commands/` layer is scheduled as a fast-follow per D-01 (skills-first surface).

- Status: Accepted
- Date: 2026-07-18
- Spike: SPK-03 (skill invocation)
- Task: TSK-009 (SPK-03 skill invocation)
- Decision: HOSTILE - alias layer activates per W-07 (commands alias layer) in R-04 (scope boundaries)
- Unblocks: alias-layer fast-follow task (W-07 trigger observation recorded)
- PA resolved: D-01 (skills-first surface) ergonomics question answered

---

## Context

D-01 (skills-first surface) commits all user-facing flows to skills under `skills/<name>/SKILL.md` with `user-invocable: true`. No `commands/` directory exists yet. D-01 contains a hedge: "Phase 0 verifies invocation ergonomics; if bare-verb invocation proves hostile in practice, a thin `commands/` alias layer may be added as a fast-follow, and only then."

R-04 (scope boundaries) W-07 (commands alias layer) records the formal trigger: "D-01 (skills-first surface) Phase 0 spike finds that bare-verb invocation is hostile in practice for a significant share of Claude Code users."

This ADR records the probe evidence and the decision it drives.

---

## Rating Rubric (from task brief, applied to evidence)

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

**No-argument skills (`studio`, `doctor`, `status-dashboard`, and `intake-interview` as commonly invoked without arguments):** Probe C shows the bare form fails on Windows, expanding to a Unix path. These skills require the namespaced form, which is 26-36 characters. Rubric condition: "only the fully namespaced form works AND it is over 25 characters of typing for common verbs." Condition met. Rating for this subset: HOSTILE.

**Overall Phase 1 rating: HOSTILE.**

The no-argument failure covers the three most frequently invoked onboarding and navigation skills:
- `studio` (D-17 (guided front door): the primary dispatcher and first command most new authors type)
- `doctor` (D-12 (versioned bible with a doctor): the diagnostic entry point)
- `status-dashboard` (the session-status verb from the original `/status` command)

A design where the front door and the diagnostic cannot be bare-invoked reliably is hostile to the user, regardless of the acceptable behavior for argument-bearing verbs. The Windows-specific cause (Git-for-Windows path emulation of `/name` without a following argument) means this failure affects all Windows users using the Git Bash shell or a shell that forwards Git-for-Windows path expansion. TSK-011 (SPK-05 bin PATH on Windows) may illuminate the platform interaction further.

**Discovery note:** The model, when it failed to activate the bare form, correctly surfaced the namespaced alternative (`nonfiction-studio:spike-status`). This shows the skill is discoverable in the model's assistance response, but the invocation is not fluent: users must type the namespaced form manually after seeing the fallback.

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

**Rating: HOSTILE.**

The W-07 (commands alias layer) trigger in R-04 (scope boundaries) is observed: "D-01 (skills-first surface) Phase 0 spike finds that bare-verb invocation is hostile in practice for a significant share of Claude Code users." The finding is specific to no-argument invocations on Windows via Git-for-Windows path emulation, but the affected skills are the most critical onboarding and navigation verbs (`studio`, `doctor`, `status-dashboard`).

**The `commands/` alias layer is activated as a fast-follow.** A thin alias layer under `commands/` will provide short, reliable, platform-safe entry points for the eleven Phase 1 skill names. The alias layer must be recorded in CANON with a new D-ID or a D-01 amendment per the R-04 (scope boundaries) change-control rule, and a decision entry in X-04 (open questions and decision log).

D-01 (skills-first surface) remains the canonical architecture: skills are the components; the alias layer is a thin shim that invokes them. The alias layer does not duplicate skill logic.

---

## Consequences

- A fast-follow task (scope: thin `commands/` alias layer for the eleven Phase 1 skill names) is added to the execution queue, referencing this ADR and W-07 (alias layer trigger).
- The alias layer must be documented in CANON (D-01 amendment or new D-ID) and X-04 (decision log) before it ships.
- `skills/spike-echo/SKILL.md` and `skills/spike-status/SKILL.md` remain in the committed tree as evidence files; both bodies are marked for deletion by the TSK-018 (init-project skill) era cleanup.
- TSK-011 (SPK-05 bin PATH on Windows) should note the Probe C path-expansion behavior as a related data point: `/spike-status` expanding to `C:/Program Files/Git/spike-status` indicates Git-for-Windows path emulation affects single-token bare verbs passed as prompt strings.
- The install contract behavior confirmed: `claude plugin marketplace add <path>` uses the marketplace.json `name` field as the registry key; install identity is `<plugin-name>@<marketplace-name>`.

---

## References

- D-01 (skills-first surface): `(local working notes, not published)` section 1
- R-04 (scope boundaries) W-07 (commands alias layer): `(local working notes, not published)`
- D-17 (guided front door): `(local working notes, not published)` section 1
- D-12 (versioned bible with a doctor): `(local working notes, not published)` section 1
- TSK-011 (SPK-05 bin PATH on Windows): `(local working notes, not published)`
- Spike stub files (permanent evidence): `skills/spike-echo/SKILL.md`, `skills/spike-status/SKILL.md`
- ADR-0001 (hooks.json schema): `docs/adr/ADR-0001-hooks-json-schema.md`
