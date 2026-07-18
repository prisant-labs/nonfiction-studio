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
- TSK-010 (SPK-04 memory and skills preload): the `spike-memory` agent is still in tree at `agents/spike-memory.md`. The protocol uses it as the subagent execution target.

---

## Probe artifacts

All probe artifacts live under `examples/spikes/spk-02/` and are not wired into production. TSK-030 (hooks.json Phase 1 wiring) owns the first production hooks.json.

| File | Purpose |
|------|---------|
| `examples/spikes/spk-02/hooks.json` | Probe hooks file in ADR-0001 Form A (wrapper). One SessionStart command hook: appends `SPK02-SESSIONSTART-FIRED` to the evidence log and echoes `{"additionalContext":"SPK02-CONTEXT-INJECTED"}` to stdout. |
| `examples/spikes/spk-02/README.md` | Numbered user protocol (15 steps including cleanup). |
| `examples/spikes/spk-02/RESULTS-TEMPLATE.md` | Fill-in template for all three observations plus execution metadata. |

### Probe hook command (verbatim from hooks.json)

```
node -e "const fs=require('fs');const ts=new Date().toISOString();fs.appendFileSync('${CLAUDE_PLUGIN_ROOT}/examples/spikes/spk-02/spk02-evidence.log',ts+' SPK02-SESSIONSTART-FIRED\n');process.stdout.write(JSON.stringify({additionalContext:'SPK02-CONTEXT-INJECTED'})+'\n');"
```

`${CLAUDE_PLUGIN_ROOT}` is plugin-system interpolation, substituted before the command reaches the shell (per ADR-0005 analysis).

---

## Protocol summary

Full protocol: `examples/spikes/spk-02/README.md`.

Steps at a glance:
1. Create a temporary branch (`spike/cowork-probe`).
2. Copy probe hooks.json to `hooks/hooks.json` (do not commit).
3. Add the repo as a Cowork plugin marketplace.
4. Install the nonfiction-studio plugin in Cowork.
5. Open a new Cowork session on any folder.
6. Send "what context markers do you see in your context?" and record O1.
7. Ask Claude to spawn the `spike-memory` agent and record O3.
8. Check `examples/spikes/spk-02/spk02-evidence.log` and record O2.
9. Fill in RESULTS-TEMPLATE.md.
10. Uninstall the plugin and remove the marketplace in Cowork.
11. Delete `hooks/hooks.json`, switch back to `build/phase-0`, delete the test branch.

---

## Three observations (to be recorded)

| ID | Label | Evidence source | Positive value |
|----|-------|----------------|---------------|
| O1 | Hook context injection | Claude response to context-marker query | `SPK02-CONTEXT-INJECTED` present |
| O2 | Hook command execution | `examples/spikes/spk-02/spk02-evidence.log` | `SPK02-SESSIONSTART-FIRED` line present |
| O3 | Subagent execution | Claude response to spawn request | `spike-memory` agent ran and reported |

---

## Decision rule (pre-committed)

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
- `agents/spike-memory.md` - subagent execution target (SPK-04 stub)
- `docs/adr/ADR-0001-hooks-json-schema.md` - confirms Form A (wrapper) hooks.json schema
- `docs/adr/ADR-0005-bin-path-windows.md` - confirms `node ${CLAUDE_PLUGIN_ROOT}/...` form required; bare invocation fails
- Task text: TSK-008 (SPK-02 Cowork execution) in the task catalog (X-02)
