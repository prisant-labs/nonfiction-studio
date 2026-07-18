# SPK-02 Results: Cowork Execution Probe

Fill in this template during or immediately after executing the protocol in examples/spikes/spk-02/README.md.

---

## Execution metadata

| Field | Value |
|-------|-------|
| Date | <!-- e.g. 2026-07-20 --> |
| Cowork version | <!-- e.g. 1.2.3 - visible in titlebar or About panel --> |
| Repo branch | spike/cowork-probe |
| Executor | <!-- your name or initials --> |

---

## O1: Hook context injection

**Question:** Did `SPK02-CONTEXT-INJECTED` appear in the Cowork session response when you asked "what context markers do you see in your context?"

**Result:** <!-- PRESENT or ABSENT -->

**Full response (paste here):**

```
<!-- paste the Claude response to the context-marker query -->
```

---

## O2: Hook command execution

**Question:** Did the SessionStart hook command run? Does `examples/spikes/spk-02/spk02-evidence.log` contain a `SPK02-SESSIONSTART-FIRED` line?

**Result:** <!-- YES or NO -->

**Log file contents (paste full output of `cat examples/spikes/spk-02/spk02-evidence.log`):**

```
<!-- paste log file contents here, or "file not found" if absent -->
```

---

## O3: Subagent execution

**Question:** Did the `spike-memory` agent spawn and report results when asked?

**Result:** <!-- YES or NO -->

**Agent output (paste the two-line report the subagent produced, or error/refusal if it did not run):**

```
<!-- paste agent output here -->
```

---

## Decision outcome

Apply the decision rule from docs/adr/ADR-0002-cowork-hook-execution.md:

- O1, O2, and O3 all positive (PRESENT/YES/YES): **SUCCESS PATH** - Cowork column verified full.
- Any observation negative: **FAIL BRANCH** - Cowork column downgrades per ADR-0002.

**Outcome:** <!-- SUCCESS PATH or FAIL BRANCH -->

**Notes (optional):** <!-- any observations, error messages, or anomalies worth recording -->

---

## Next action

After recording results, update docs/adr/ADR-0002-cowork-hook-execution.md:
- Change status from "proposed - pending user execution" to "accepted" (success path) or "superseded" (fail branch, new ADR needed for the fail-branch consequences).
- Copy this completed template into the ADR Evidence section.
