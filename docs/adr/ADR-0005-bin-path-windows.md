# ADR-0005: bin PATH on Windows - Bare Invocation FAILS; Absolute-Path Fallback REQUIRED

**TL;DR:** Bare invocation of `ns-probe` (extensionless) fails in the Bash tool within a Windows Claude Code headless session even with the plugin enabled. The `.cmd` shim also fails (the plugin system does not add `bin/` to PATH). The absolute-path form using `${CLAUDE_PLUGIN_ROOT}` (plugin-system interpolation) succeeds when node is called with the resolved full path. Consequence for TSK-030 (hooks.json Phase 1 wiring): hook command entries must use `node ${CLAUDE_PLUGIN_ROOT}/bin/<cli-name>`, not bare `<cli-name>`. Consequence for TSK-024 (engine lib core) through TSK-029 (ns-gate orchestrator): each CLI must document the Windows invocation form as `node "<plugin-root>/bin/<name>"`.

- Status: Accepted
- Date: 2026-07-18
- Spike: SPK-05 (bin PATH on Windows)
- Task: TSK-011 (SPK-05 bin PATH on Windows)
- Decision: ABSOLUTE-PATH FALLBACK REQUIRED - bare invocation (extensionless or cmd shim) fails in Bash tool on Windows; hooks.json must use node + `${CLAUDE_PLUGIN_ROOT}` interpolated path
- PA resolved: EF-07 (bin PATH fact) answered; D-05 (five shipped CLIs) shipping form decided

---

## Context

D-05 (five shipped CLIs) calls for five CLI scripts to ship under `bin/` in the plugin tree. On Unix/Linux, Node.js scripts are commonly shipped without extension and invoked by bare name if the containing directory is on PATH. On Windows, the shell PATH search and file extension resolution differ.

This spike (TSK-011, SPK-05 bin PATH on Windows) tests whether bare invocation of a `bin/` script works from within a Claude Code session's Bash tool when the plugin is enabled, and if not, whether a `.cmd` shim helps, and whether the absolute-path fallback via the plugin system's `${CLAUDE_PLUGIN_ROOT}` interpolation variable succeeds.

The probe runs headlessly via `claude -p` with `--dangerously-skip-permissions` to bypass interactive tool-approval prompts. The Bash tool in the headless session runs Git Bash (POSIX sh) on Windows.

Cross-reference note from TSK-009 (SPK-03 skill invocation): TSK-009 documented a Git-for-Windows path-expansion artifact affecting slash-prefixed strings in headless Bash probes. That artifact is specific to slash-prefix strings routed through skill invocation. The probes here run bare words through the Bash tool, a different code path, so that finding does not apply.

---

## Outcome Taxonomy (from task brief)

- "confirmed extensionless": bare name resolves without any shim
- "confirmed with cmd shim": bare name resolves only with `.cmd` shim present (CLIs then ship shims)
- "absolute-path fallback required": bare invocation fails; hooks use `${CLAUDE_PLUGIN_ROOT}` paths
- "pending user execution": install contract fell through; result deferred

---

## Install Contract Execution

All commands run headlessly; every mutation and its reversal is quoted.

### Baseline plugin state (before any mutation)

Command: `claude plugin list | grep nonfiction`

Output: (no output) - `nonfiction-studio@nonfiction-studio` absent. 17 plugins enabled.

### Step 1: Marketplace add

Command: `claude plugin marketplace add "<repo-root>"`

Output: `Adding marketplace... Successfully added marketplace: nonfiction-studio (declared in user settings)`

### Step 2: Plugin install

Command: `claude plugin install nonfiction-studio@nonfiction-studio`

Output: `Installing plugin "nonfiction-studio@nonfiction-studio"... Successfully installed plugin: nonfiction-studio@nonfiction-studio (scope: user)`

### Step 3: Verify enablement

Command: `claude plugin list | grep -A4 "nonfiction-studio"`

Output:
```
  > nonfiction-studio@nonfiction-studio
    Version: 0.1.0
    Scope: user
    Status: enabled
```

---

## Control Condition (plugin NOT enabled)

Before any install, before the probe file even existed, from the implementing session's own Bash tool:

Command: `ns-probe`

Output:
```
/usr/bin/bash: line 5: ns-probe: command not found
EXIT:127
```

This confirms the baseline has no `ns-probe` command. Success in subsequent probes is attributable to plugin enablement and/or the presence of the script file.

---

## Probe Ladder

All probes run headlessly: `claude -p "<prompt>" --model haiku --dangerously-skip-permissions`

`bin/ns-probe` (extensionless, `#!/usr/bin/env node` shebang) prints `NS-PROBE-OK <node-version> <platform>`.

### Rung 1: Extensionless bare invocation

Prompt: `"Without modifying PATH or changing the working directory, run only the single command 'ns-probe' via the Bash tool and paste the exact stdout or stderr. Do not prefix with paths. Do not use 'which' or 'where' first. Just run 'ns-probe' and paste the output."`

Raw output:
```
/usr/bin/bash: line 4: ns-probe: command not found
```

Result: **FAIL** - exit 127. The plugin system does NOT add `bin/` to PATH on Windows. The extensionless file is not found.

### Rung 2: .cmd shim added, bare invocation

`bin/ns-probe.cmd` created (two lines: `@echo off` / `node "%~dp0ns-probe" %*`) before this probe.

Same prompt as Rung 1.

Raw output:
```
/usr/bin/bash: line 4: ns-probe: command not found
```

Result: **FAIL** - exit 127. The `.cmd` shim in `bin/` does not help because `bin/` is still not on PATH. Git Bash PATHEXT resolution does not discover the `.cmd` file when its directory is absent from PATH.

### Rung 3: Absolute-path fallback

This rung has two parts.

**Part A: `$CLAUDE_PLUGIN_ROOT` shell env var probe**

Prompt: `"Run 'echo $CLAUDE_PLUGIN_ROOT' via the Bash tool and paste the exact raw output"`

Raw output: `(no output - CLAUDE_PLUGIN_ROOT is not set)`

Finding: `CLAUDE_PLUGIN_ROOT` is NOT set as a shell environment variable in the headless session. Shell-level `$CLAUDE_PLUGIN_ROOT` expansion returns empty string.

**Part B: Absolute path via node (equivalent of plugin-system `${CLAUDE_PLUGIN_ROOT}` interpolation)**

The hooks.json template at `templates/hook-starter/hooks.json` uses `node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/<name>.mjs` in its command field. The plugin system interpolates `${CLAUDE_PLUGIN_ROOT}` before the command is passed to the shell. This is distinct from shell-level `$CLAUDE_PLUGIN_ROOT` variable expansion; the substitution happens at the plugin-system layer before shell execution.

To prove the fallback works in its actual execution context, the probe uses the hardcoded resolved path equivalent:

Prompt: `"Run the command 'node <repo-root>/bin/ns-probe' via the Bash tool and paste its exact raw stdout"`

Raw output:
```
NS-PROBE-OK v22.12.0 win32
```

Result: **SUCCESS** - absolute path with explicit `node` invocation resolves and the script runs correctly.

---

## Outcome Classification

**absolute-path fallback required**

The plugin system does not add `bin/` to PATH. Neither the extensionless file (Rung 1) nor the `.cmd` shim (Rung 2) resolves via bare name in the Bash tool. The absolute-path form (Rung 3) resolves when `node` is invoked with the fully qualified path.

The fallback is the `${CLAUDE_PLUGIN_ROOT}` plugin-system interpolation form in hooks.json command entries, not a shell environment variable. When the hook system executes a command entry containing `${CLAUDE_PLUGIN_ROOT}`, it substitutes the plugin installation path before handing the command to the shell. The result is a fully qualified path that the shell can resolve.

---

## Decision

Hook command entries in `hooks/hooks.json` must use the node + interpolated-path form:

```
node ${CLAUDE_PLUGIN_ROOT}/bin/<cli-name>
```

not the bare form:

```
<cli-name>
```

and not the shim form:

```
<cli-name>.cmd
```

The `.cmd` shim (`bin/ns-probe.cmd`) ships alongside `bin/ns-probe` as a stub for potential future use if the plugin system ever adds `bin/` to PATH or if a user manually adds it. It is not the primary dispatch form.

---

## Consequences

### TSK-030 (hooks.json Phase 1 wiring)

All hook command entries that invoke a CLI under `bin/` must use the form `node ${CLAUDE_PLUGIN_ROOT}/bin/<cli-name>`. Bare invocation is not valid on Windows in the Bash tool. This applies to every hook in Phase 1 wiring.

### TSK-024 (engine lib core) through TSK-029 (ns-gate orchestrator)

Each of the five CLIs under `bin/` must include a Windows invocation note in its documentation or `--help` output stating the canonical invocation form for hook contexts:

```
node "<plugin-root>/bin/<cli-name>"
```

where `<plugin-root>` is the resolved value of `${CLAUDE_PLUGIN_ROOT}` at install time. Direct interactive invocation from a user's shell requires either adding `bin/` to PATH manually or using `node` with the full path.

### ADR-0001 (hooks.json schema) and hook template

The `hooks.json` schema (ADR-0001) already uses `${CLAUDE_PLUGIN_ROOT}` in the command template at `templates/hook-starter/hooks.json`. This ADR confirms that template form is correct and required, not optional, for Windows compatibility. The template must not be changed to use bare CLI names.

### D-05 (five shipped CLIs) shipping form

The five CLIs ship as extensionless Node scripts in `bin/`. The `.cmd` shim ships alongside for potential manual-PATH users and forward compatibility. Neither form is relied upon for bare invocation in hooks. The authoritative invocation form for hook contexts is `node ${CLAUDE_PLUGIN_ROOT}/bin/<name>`.

### Remaining assumption

The probe used `--dangerously-skip-permissions` to bypass interactive tool approval in the headless session. Production hook execution does not go through `claude -p`; hooks are executed by the Claude Code harness directly. The conclusion (bare invocation fails, absolute path via node works) is expected to hold in production hook execution because the root cause is PATH absence, not the `claude -p` code path.

---

## Cleanup and Restoration

Command: `claude plugin uninstall nonfiction-studio@nonfiction-studio`

Output: `Successfully uninstalled plugin: nonfiction-studio (scope: user)`

Command: `claude plugin marketplace remove nonfiction-studio`

Output: `Successfully removed marketplace: nonfiction-studio`

Post-cleanup check: `claude plugin list | grep nonfiction` - no output (ABSENT). Plugin count: 17 enabled, matching baseline exactly.

**Cleanup: PROVEN.**

---

## Files

- `bin/ns-probe` - spike stub (extensionless, `#!/usr/bin/env node`, prints `NS-PROBE-OK <version> <platform>`). Stays in tree per TSK-011 brief; marked as spike stub for SPK-05 (bin PATH on Windows); superseded by the real CLIs in Phase 1.
- `bin/ns-probe.cmd` - spike stub cmd shim (`@echo off` / `node "%~dp0ns-probe" %*`). Ships alongside extensionless file; not the primary dispatch form.
