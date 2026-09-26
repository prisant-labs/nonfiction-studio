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

**Actual log path where the file was found (repo checkout or installed plugin root):**

<!-- fill in the path where spk02-evidence.log was found -->

Note: A file absent at BOTH the repo checkout path and the installed plugin root is the true ABSENT observation for O2.

---

## O3: Subagent execution

**Question:** Did the `spk02-probe-agent` stub agent spawn and reply `SPK02-AGENT-RAN` when asked?

**Result:** <!-- YES or NO -->

**Agent output (paste what the subagent replied, or the error/refusal if it did not run):**

```
<!-- paste agent output here -->
```

---

## Decision outcome

Apply the decision rule from docs/adr/ADR-0002-cowork-hook-execution.md (see Decision rule clarification 2026-07-18):

- O1, O2, and O3 all positive (PRESENT/YES/YES): **SUCCESS PATH** - Cowork column verified full.
- O1 or O2 negative (either hook observation fails): **FAIL BRANCH (hooks)** - AR-05 (surface compatibility matrix) Cowork hook rows downgrade; `nfs-check-chapter` primary gate; chat-first messaging; X-04 (open questions) log entry.
- O3 negative with O1 and O2 positive: **FAIL BRANCH (subagent only)** - Subagent rows only downgrade in AR-05 (surface compatibility matrix); orchestration falls back to single-model degraded flow per S-06 (skills and invocation surface). Hook conclusions unaffected.
- All three negative: Both fail branches fire.

**Outcome:** <!-- SUCCESS PATH or FAIL BRANCH -->

**Notes (optional):** <!-- any observations, error messages, or anomalies worth recording -->

---

## Next action

After recording results, update docs/adr/ADR-0002-cowork-hook-execution.md:
- Change status from "proposed - pending user execution" to "accepted" (success path) or "superseded" (fail branch, new ADR needed for the fail-branch consequences).
- Copy this completed template into the ADR Evidence section.
