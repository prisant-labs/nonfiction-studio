# ADR-0002: Cowork Session Hook and Subagent Execution

**TL;DR:** SPK-02 (Cowork execution probe) tests whether SessionStart hooks and declared agents actually fire in a Cowork session. The probe artifacts and user protocol are built; execution is deferred to a human with Cowork access. The decision rule is pre-committed: all three observations positive means Cowork column verified full; any hook observation negative (whether or not the subagent fires) or any other shortfall means the fail branch fires.

- Status: proposed - pending user execution
- Date: 2026-07-18
- Spike: SPK-02 (Cowork execution)
- Task: TSK-008 (SPK-02 Cowork execution)
- Contracts: A-02 (platform baseline), PF-12 (surface support matrix), D-14 (three surfaces)
- PA resolved: none yet (pending execution results)

---

## Context

D-14 (three surfaces) marks Cowork as "likely" for hook support and agent spawning, but that cell is unverified. PF-12 (surface support matrix) records the current evidence state as "assumed - unconfirmed." Two unknowns drive this spike:

1. Does a SessionStart command hook actually fire in a Cowork session when the plugin is installed?
2. Can Claude running in Cowork spawn an agent declared in the plugin manifest?

The build session cannot drive the Cowork desktop application. SPK-02 therefore produces a probe hooks.json, a numbered user protocol, and a results template, then defers execution to a human executor.

### Prior art used in probe design

- ADR-0001 (hooks.json schema): the wrapper-object form (`{"hooks": {"EventName": [...]}}`) is confirmed by official docs. The probe hooks.json uses Form A (wrapper) exclusively.
- ADR-0005 (bin PATH on Windows): bare CLI invocation fails in Bash tool on Windows; hook commands must use `node ${CLAUDE_PLUGIN_ROOT}/...` or inline `-e` forms. The probe hook uses `node -e` with a `${CLAUDE_PLUGIN_ROOT}`-interpolated log path, not a bare CLI name.
- TSK-010 (SPK-04 memory and skills preload): the `spike-memory` agent is still in tree at `agents/spike-memory.md`. The protocol uses it as the subagent execution target. (Superseded 2026-09-25: that stub was removed on 2026-08-08; see "Probe corrections (2026-09-25)" below.)

---

## Probe artifacts

All probe artifacts live under `examples/spikes/spk-02/` and are not wired into production. TSK-030 (hooks.json Phase 1 wiring) owns the first production hooks.json.

| File | Purpose |
|------|---------|
| `examples/spikes/spk-02/hooks.json` | Probe hooks file in ADR-0001 Form A (wrapper). One SessionStart command hook: appends `SPK02-SESSIONSTART-FIRED` to the evidence log and echoes `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"SPK02-CONTEXT-INJECTED"}}` to stdout. |
| `examples/spikes/spk-02/spk02-probe-agent.md` | Stub agent, the O3 target. Copied into `agents/` for the probe's duration only; replies with the fixed line `SPK02-AGENT-RAN`. |
| `examples/spikes/spk-02/README.md` | Numbered user protocol (15 steps including cleanup). |
| `examples/spikes/spk-02/RESULTS-TEMPLATE.md` | Fill-in template for all three observations plus execution metadata. |

### Probe hook command (verbatim from hooks.json)

```
node -e "const fs=require('fs');const ts=new Date().toISOString();fs.appendFileSync('${CLAUDE_PLUGIN_ROOT}/examples/spikes/spk-02/spk02-evidence.log',ts+' SPK02-SESSIONSTART-FIRED\n');process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'SPK02-CONTEXT-INJECTED'}})+'\n');"
```

`${CLAUDE_PLUGIN_ROOT}` is plugin-system interpolation, substituted before the command reaches the shell (per ADR-0005 analysis).

---

## Protocol summary

Full protocol: `examples/spikes/spk-02/README.md`.

Steps at a glance:
1. Create a temporary branch (`spike/cowork-probe`) from `main`.
2. Copy probe hooks.json to `hooks/hooks.json` and the stub agent to `agents/spk02-probe-agent.md` (do not commit either).
3. Add the repo as a Cowork plugin marketplace.
4. Install the nonfiction-studio plugin in Cowork.
5. Open a new Cowork session on any folder.
6. Send "what context markers do you see in your context?" and record O1.
7. Ask Claude to spawn the `spk02-probe-agent` agent and record O3.
8. Check `examples/spikes/spk-02/spk02-evidence.log` and record O2.
9. Fill in RESULTS-TEMPLATE.md.
10. Uninstall the plugin and remove the marketplace in Cowork.
11. Restore the tracked `hooks/hooks.json` from git, delete the stub agent copy, switch back to `main`, delete the test branch.

---

## Three observations (to be recorded)

| ID | Label | Evidence source | Positive value |
|----|-------|----------------|---------------|
| O1 | Hook context injection | Claude response to context-marker query | `SPK02-CONTEXT-INJECTED` present |
| O2 | Hook command execution | `examples/spikes/spk-02/spk02-evidence.log` | `SPK02-SESSIONSTART-FIRED` line present |
| O3 | Subagent execution | Claude response to spawn request | `spk02-probe-agent` ran and replied `SPK02-AGENT-RAN` |

---

## Decision rule (pre-committed)

> **Original text preserved; superseded in scope by the "Decision rule clarification (2026-07-18)" section below.**

**This rule is binding. It does not change based on partial results.**

- **All three positive (O1, O2, O3):** Cowork column in AR-05 (surface matrix) stays verified full. Hook-driven quality gates are confirmed viable on this surface. Update this ADR to "accepted."
- **Any observation not positive** (any of: O1 absent, O2 absent, O3 absent): the fail branch fires exactly as stated in TSK-008 (SPK-02 Cowork execution):
  - AR-05 (surface matrix) Cowork column downgrades to skills-plus-verify.
  - `run-quality-gate` becomes the primary Cowork gate.
  - Messaging strategy becomes chat-first.
  - The downgrade is logged in X-04 (open questions).
  - Update this ADR to "superseded" and create ADR-0002b or an addendum documenting the fail-branch consequence.

The fail branch fires regardless of whether the subagent works if hook observations are negative. Hooks and subagents are independent capabilities; a partial result (hooks fire, subagent does not, or vice versa) is not the success path.

---

## Decision rule clarification (2026-07-18)

**The pre-committed binding character of the rule is unchanged. This clarification maps each observation to the correct remediation scope and does not soften any trigger.**

Handle distinction: PF-12 (surface support fact) is the A-02 (platform baseline) evidence entry recording the current confirmed evidence state. AR-05 (surface compatibility matrix) is the requirements document whose cells the outcome updates. They are distinct artifacts.

O1 (context marker) and O2 (log evidence) are the HOOK observations. O3 (subagent spawn) is the SUBAGENT observation.

- **O1 and O2 both positive:** Hooks verified on Cowork. Hook conclusions are sound regardless of O3.
- **O1 or O2 negative (either hook observation fails):** The hooks fail branch fires exactly as originally stated above:
  - AR-05 (surface compatibility matrix) Cowork hook rows downgrade to skills-plus-verify.
  - `run-quality-gate` becomes the primary Cowork gate.
  - Messaging strategy becomes chat-first.
  - The downgrade is logged in X-04 (open questions).
  - This ADR updates to "superseded"; create ADR-0002b or an addendum documenting the fail-branch consequence.
- **O3 negative with O1 and O2 both positive:** Subagent rows only downgrade in AR-05 (surface compatibility matrix). Orchestration falls back to the single-model degraded flow already specified in S-06 (skills and invocation surface) surface notes. Hook conclusions are unaffected.
- **All three negative (O1, O2, and O3):** Both branches fire.

---

## Probe corrections (2026-09-25)

The decision rule and its clarification above are unchanged. Before the probe's first execution, three defects were found that would each have produced a false negative, firing a fail branch for reasons unrelated to Cowork. The probe artifacts were corrected, and the original versions remain in git history.

1. **O1 output shape.** The probe hook printed `{"additionalContext":...}` at the top level of its JSON output. Claude Code reads SessionStart context only from `hookSpecificOutput.additionalContext` and silently ignores the top-level form; the plugin's production `hooks/session-start.mjs` already uses the nested form, and ADR-0013 (wave 1 exit surfaces) records the live probe that found a top-level SessionStart field silently ignored. A Claude Code CLI run of the original probe (loaded with `--plugin-dir`, 2026-09-25) confirmed the defect: the hook ran and wrote its log line, but the injected context was empty, so O1 would have read ABSENT on every surface. The probe now prints `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"SPK02-CONTEXT-INJECTED"}}`.
2. **O3 target.** The `spike-memory` agent this ADR named was removed with the other Phase 0 spike stubs on 2026-08-08, so O3 would have read NO regardless of the surface. A dedicated stub now lives with the other probe artifacts at `examples/spikes/spk-02/spk02-probe-agent.md`. The protocol copies it into `agents/` for the probe's duration and deletes it at cleanup. It replies with the fixed line `SPK02-AGENT-RAN`, a marker as unambiguous as O1's and O2's.
3. **Branch.** The protocol branched from `build/phase-1`, and this ADR's summary from `build/phase-0`; neither exists in the published repository. Both now use `main`, and cleanup restores the tracked `hooks/hooks.json` from git instead of deleting it (it has been a production file since the Phase 1 wiring).

After the corrections, the same CLI run showed all three observations positive: the injected context carried `SPK02-CONTEXT-INJECTED`, the log gained a `SPK02-SESSIONSTART-FIRED` line, and `nonfiction-studio:spk02-probe-agent` spawned and replied `SPK02-AGENT-RAN`. This proves the probe works where hooks and plugin agents are known to work. It says nothing yet about Cowork, which is what the protocol is for.

---

## Evidence

*To be filled in by the human executor after completing the protocol.*

See `examples/spikes/spk-02/RESULTS-TEMPLATE.md` for the fill-in format.

```
<!-- paste completed RESULTS-TEMPLATE.md contents here -->
```

---

## Consequences

### If success path (all three positive)

- D-14 (three surfaces) "likely" cell for Cowork hooks is confirmed and upgraded to "verified."
- PF-12 (surface support matrix) evidence state for Cowork updated to "confirmed via SPK-02."
- TSK-030 (hooks.json Phase 1 wiring) proceeds with confidence that hooks fire in Cowork sessions.
- Agent spawning in Cowork is confirmed viable; TSK-010 (SPK-04) result for Cowork surface can be marked confirmed.

### If fail branch

- AR-05 (surface matrix) Cowork column: skills-plus-verify.
- Primary Cowork quality gate: `run-quality-gate` skill invocation.
- Messaging strategy: chat-first (Claude reads context from session, not from hook-injected additionalContext).
- TSK-030 (hooks.json Phase 1 wiring) scope: hooks wired for CLI sessions only, not Cowork.
- X-04 (open questions): receives a new entry noting Cowork as hook-inert surface and the resulting constraint on Nonfiction Studio's cross-surface parity.

---

## References

- `examples/spikes/spk-02/hooks.json` - probe hooks file (Form A wrapper, SessionStart command hook)
- `examples/spikes/spk-02/README.md` - user protocol (15 steps)
- `examples/spikes/spk-02/RESULTS-TEMPLATE.md` - results fill-in template
- `examples/spikes/spk-02/spk02-evidence.log` - created at runtime if hook fires
- `examples/spikes/spk-02/spk02-probe-agent.md` - subagent execution target, copied into `agents/` for the probe's duration (replaced `agents/spike-memory.md`, the SPK-04 stub, on 2026-09-25)
- `docs/adr/ADR-0001-hooks-json-schema.md` - confirms Form A (wrapper) hooks.json schema
- `docs/adr/ADR-0005-bin-path-windows.md` - confirms `node ${CLAUDE_PLUGIN_ROOT}/...` form required; bare invocation fails
- Task text: TSK-008 (SPK-02 Cowork execution) in the task catalog (X-02)
