# SPK-02: Cowork Execution Probe - User Protocol

**Task:** TSK-008 (SPK-02 Cowork execution)
**ADR:** docs/adr/ADR-0002-cowork-hook-execution.md
**Results template:** examples/spikes/spk-02/RESULTS-TEMPLATE.md
**Probe corrections:** 2026-09-25, before the first execution - see the "Probe corrections (2026-09-25)" section of ADR-0002 (Cowork hook execution).

This protocol is executed by a human with access to the Cowork desktop app. It takes roughly 10 minutes. Fill in RESULTS-TEMPLATE.md as you go, then paste the completed template into the ADR to update its status.

---

## What this tests

Three observations, each recorded in RESULTS-TEMPLATE.md:

- **Hook context injection (O1):** Whether `SPK02-CONTEXT-INJECTED` appears in the Claude response when you ask about context markers. This tests whether the SessionStart hook's `hookSpecificOutput.additionalContext` is injected into the session context.
- **Hook command execution (O2):** Whether `SPK02-SESSIONSTART-FIRED` was appended to `examples/spikes/spk-02/spk02-evidence.log`. This tests whether the hook command itself ran.
- **Subagent execution (O3):** Whether the `spk02-probe-agent` stub agent spawned and replied `SPK02-AGENT-RAN`. This tests whether agents declared in the plugin are spawnable in Cowork.

The three probes were checked in the Claude Code CLI on 2026-09-25 (all three positive there), so a negative result in Cowork reflects Cowork, not a broken probe.

---

## Protocol (15 steps)

**Before you start:** Note the Cowork version (visible in the Cowork app titlebar or About panel) for the results template. Also check `examples/spikes/spk-02/spk02-evidence.log` for content left over from an earlier run - the probe hook appends to this file rather than overwriting it, so a stale line survives until someone clears it. Delete the file (or note its exact current contents) now, before Step 3, so a leftover line is never mistaken for fresh evidence when you reach Step 13.

**Step 1 - Open a terminal and navigate to the repo.**

```
cd <path-to-your-clone>
```

**Step 2 - Create a temporary test branch.**

Create this branch from an up-to-date `main`, so the installed plugin is the current release.

```
git checkout main
git pull
git checkout -b spike/cowork-probe
```

**Step 3 - Copy the probe hooks file and the probe agent into place.**

Windows (PowerShell or CMD):
```
copy examples\spikes\spk-02\hooks.json hooks\hooks.json
copy examples\spikes\spk-02\spk02-probe-agent.md agents\spk02-probe-agent.md
```

Git Bash:
```
cp examples/spikes/spk-02/hooks.json hooks/hooks.json
cp examples/spikes/spk-02/spk02-probe-agent.md agents/spk02-probe-agent.md
```

Do NOT commit either file. They are temporary spike copies only.

The probe hooks file replaces the plugin's production hooks for the whole probe. That is deliberate, and it is also why the stub agent needs no entry in `agents/_chain-permitted.yaml`: the production routing hook that reads that file is not wired while the probe is in place. Do not add one.

**Step 4 - Open Cowork.**

Launch the Cowork desktop application.

**Step 5 - Add the repo as a plugin marketplace.**

In Cowork's plugin panel (Settings or Plugin Manager; panel names vary by Cowork version):
- Add a local marketplace pointing to: `<path-to-your-clone>`
- The marketplace name should appear as `nonfiction-studio`.

**Step 6 - Install the nonfiction-studio plugin.**

In the plugin panel (panel names vary by Cowork version), find `nonfiction-studio` in the marketplace you just added and install it.

**Step 7 - Open a new Cowork session on any folder.**

Create a new session. Any folder works (for example, a temp folder). The SessionStart hook fires when the session opens.

**Step 8 - Send the context-marker query.**

In the new session, send this message exactly:

> what context markers do you see in your context?

**Step 9 - Record O1 (context injection).**

Read the response. Note in RESULTS-TEMPLATE.md:
- Whether `SPK02-CONTEXT-INJECTED` appears in the response or in any displayed context block.
- PRESENT or ABSENT.

**Step 10 - Ask Claude to spawn the probe agent.**

In the same session, send:

> Please spawn the spk02-probe-agent agent (it is declared in the nonfiction-studio plugin) and report exactly what it says.

**Step 11 - Record O3 (subagent execution).**

Note in RESULTS-TEMPLATE.md:
- Whether the subagent spawned (YES or NO).
- If YES, paste what the subagent replied. The expected reply is the single line `SPK02-AGENT-RAN`.

**Step 12 - Check the evidence log.**

Back in your terminal (do not close the Cowork session yet):

```
cat examples/spikes/spk-02/spk02-evidence.log
```

If the file is not found at that path, the hook may have written to the installed plugin root instead (a versioned cache directory, not the repo checkout), since the hook command resolves its write path through the hooks.json plugin-root interpolation variable (ADR-0005, bin PATH on Windows). To find that root, run `claude plugin list` or check the Cowork plugin panel for the installed path of `nonfiction-studio`, then look for `examples/spikes/spk-02/spk02-evidence.log` beneath it. If you cannot reach that folder from your terminal, ask Claude in the Cowork session to print the file instead. Record whichever path held the file when filling in O2.

Because the hook appends rather than overwrites, this file only counts as fresh evidence if you cleared or noted it in "Before you start." If you skipped that step, check the timestamp on each line against the time you ran Step 7 (session open) before treating a `SPK02-SESSIONSTART-FIRED` line as this run's result.

**Step 13 - Record O2 (hook command execution).**

Note in RESULTS-TEMPLATE.md:
- Whether `SPK02-SESSIONSTART-FIRED` appears in the log (YES or NO).
- Paste the full log file contents.

**Step 14 - Cleanup: uninstall the plugin.**

In Cowork (panel names vary by Cowork version):
- Uninstall the `nonfiction-studio` plugin.
- Remove the local marketplace (the `<path-to-your-clone>` entry).

Close the Cowork session.

**Step 15 - Cleanup: restore the hooks file, remove the probe agent, restore the branch.**

`hooks/hooks.json` is a tracked production file that wires the plugin's real hooks (confirm with `git ls-files hooks/`). Step 3 overwrote it in the working tree with the temporary spike copy but never committed that change, so cleanup restores the tracked version from git. Do NOT delete it.

`agents/spk02-probe-agent.md` is untracked, so `git checkout --` does not remove it. Delete it explicitly.

In the terminal:

PowerShell:
```
git checkout -- hooks/hooks.json
Remove-Item agents\spk02-probe-agent.md
git checkout main
git branch -d spike/cowork-probe
```

Git Bash:
```
git checkout -- hooks/hooks.json
rm agents/spk02-probe-agent.md
git checkout main
git branch -d spike/cowork-probe
```

Verify the working tree is clean (no modified `hooks/hooks.json`, no untracked `agents/spk02-probe-agent.md`) and that `hooks/` still contains the full set of production hook files, not just `.gitkeep`:
```
git status
ls hooks/
```

---

## After the protocol

Open `examples/spikes/spk-02/RESULTS-TEMPLATE.md`, fill in all fields, and update `docs/adr/ADR-0002-cowork-hook-execution.md` status from "proposed - pending user execution" to "accepted" or "superseded" based on the decision rule stated in that ADR.
