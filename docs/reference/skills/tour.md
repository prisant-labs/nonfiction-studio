---
title: "tour skill reference"
description: "Reference for the tour skill - a guided walkthrough of the bundled sample book in a disposable copy, ending with the quality gate visibly blocking on a planted defect and then passing again, with the shipped example untouched"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "tour", "gate", "demo", "onboarding", "getting-started"]
---

# tour

The `tour` skill is the guided-demonstration half of the five-minute first win per OPP-D17 (five-minute first win). It walks the author through `examples/sample-book` in a disposable copy, showing the quality gate pass, then block on a planted realistic defect with a named reason, then pass again once the defect is fixed.

## Purpose

An author who has never seen the quality gate fire has no reason to trust it. `tour` builds that trust directly: it plants a real, realistic defect into a private copy of the bundled sample book and lets the author watch the gate catch it, name the exact reason, and stop. Then it fixes the defect and shows the gate pass again, ending with a plain-language recap of what each check covers.

**It never requires an initialized book project and never modifies the shipped example.** Every write in this skill happens inside a fresh copy created in its own Step 2; `<plugin-root>/examples/sample-book` is only ever read (as the source `fs.cpSync` copies from), never opened for writing.

**No agents invoked.** This is a deterministic-CLI-and-file-editing skill; every gate run wraps `bin/ns-gate`. No chain edges exist in `agents/_chain-permitted.yaml`.

## Invocation

```
/nonfiction-studio:tour [destination folder]
```

The destination folder argument is optional. If omitted, the copy is created under the operating system's own temp directory. If supplied, the copy is created there instead, for an author who wants to keep exploring it afterward.

Alternate entry points:
- The `studio` dispatcher, Path 6 (Quick preview), including directly from the `NO_PROGRESS` branch before any project exists
- The README quickstart and `docs/quickstart.md`, typically after `quick-scan`

## Inputs and Outputs

### Inputs

| Input | Source | Why |
|---|---|---|
| `<plugin-root>/examples/sample-book` | The plugin's own shipped example | Copy source only; `fs.cpSync` never writes to its source argument |

### Outputs

| Path | Written by | Notes |
|---|---|---|
| `<tour-dir>/.studio/config.json` | The skill (Edit tool) | Flips the top-level `gate.mode` from `warn` to `block` inside the copy only, so the planted defect produces a real block rather than a warning |
| `<tour-dir>/chapters/02-finding-your-network.md` | The skill (Edit tool) | The planted defect (an AI self-reference line) is appended, then removed, inside the copy only |
| `<tour-dir>/.studio/gate/*.json` | `bin/ns-gate` itself | Timestamped gate reports, written by the gate exactly as it would in any project |
| `<plugin-root>/examples/sample-book` | Never | Read-only for the entire skill; the hard constraint this skill exists to prove |

## Flow Summary

The skill runs nine steps:

1. **Resolve the plugin root.** The same three-tier lookup every skill in this plugin uses, needed here to locate both `examples/sample-book` and `bin/ns-gate`.
2. **Copy the sample book to a disposable location.** Chooses a destination (temp directory by default, or the author's supplied folder), appends a timestamp for a fresh collision-free name, and copies with `fs.cpSync`, mirroring the temp-clone pattern in `scripts/test-fixtures.mjs`. States plainly where the copy is and that the shipped example is untouched.
3. **Opt the copy into block mode.** Edits the copy's `.studio/config.json` top-level `gate.mode` from `warn` to `block`, explaining why: the shipped default only warns, and this is the same setting any author can choose for their own project.
4. **Run the gate and watch it pass.** A full, unscoped `ns-gate` run against the copy, in block mode, with nothing planted yet; presents a genuine pass with real margins.
5. **Plant a realistic defect.** Appends a line drawn from the prompt-scrub check's own fixed phrase lexicon to a chapter in the copy, representing a plausible leftover from an AI-assisted drafting pass.
6. **Run the gate again and watch it block.** A `ns-gate` run scoped to the chapter and check just planted (`--check=scrub`), keeping the demonstration focused on the one problem introduced; presents the block verdict, exit code 1, and the named reason.
7. **Fix it.** Removes exactly the planted lines, restoring the chapter to its original content.
8. **Run the gate one more time and watch it pass again.** The same full, unscoped run as step 4; confirms recovery and that the margins match.
9. **Close.** Recaps what the gate's seven checks cover, restates that the copy is disposable and the shipped example was never touched, and points to a next step.

## Why Block Mode

The shipped `examples/sample-book/.studio/config.json` sets the top-level `gate.mode` to `warn`. Under that setting, `ns-gate`'s own D-03 (layered Stop gate) Invariant 2 caps every check's verdict at `warn`, even a check individually configured to `mode: "block"`, so the CLI always exits 0. This is intentional default behavior, not a defect: it means the gate never silently stops an author who has not opted in. To make Step 6's block genuine rather than a capped warning, `tour` opts the disposable copy into `gate.mode: "block"` in Step 3, exactly the setting an author can choose for their own project's `.studio/config.json` at any time. See the [ns-gate CLI reference](../cli/ns-gate.md) for the full mode-capping contract.

## The Planted Defect

The line `Here is a draft of this paragraph for the author to revise.` is appended to `chapters/02-finding-your-network.md` inside the copy. `here is a draft` is one of the fixed phrases in `bin/ns-scrub`'s agent-self-reference lexicon (`scrub.agent-self-reference`), so it reliably fires the `prompt_scrub` check, which is `mode: "block"` by default in the sample book's own configuration. Step 6 scopes the gate run to `--check=scrub` so the demonstration shows exactly one named reason; a full unscoped run at that point would also show incidental word-count and voice-metric warnings from editing a chapter file directly, outside the plugin's normal drafting flow, which is honest but would blur the single clean reason the demonstration is making.

## Failure Behavior

**Plugin root cannot be resolved.** The skill halts before any copy is created; the paths attempted are named.

**Copy fails.** The skill halts immediately with the exact error; no gate is run. `examples/sample-book` is never at risk, since `fs.cpSync` only ever reads from it.

**`ns-gate` exits 2 at any point.** The skill surfaces the stderr and halts at that step; the copy is left in place for inspection and can be deleted at any time. No partial or guessed verdict is presented.

## Relationship to Other Skills

`tour` pairs with [`quick-scan`](./quick-scan.md): together they are the try-before-you-commit path per OPP-D17 (five-minute first win), reachable from `studio`'s Path 6 (Quick preview). `tour` invokes [`bin/ns-gate`](../cli/ns-gate.md) exactly as [`run-quality-gate`](./run-quality-gate.md) does against a real project, so what an author sees here is representative of what the gate does everywhere else in the plugin, not a simplified simulation.

## See also

- [quick-scan skill reference](./quick-scan.md) - the paired five-minute measurement path
- [ns-gate CLI reference](../cli/ns-gate.md) - the orchestrator this skill demonstrates
- [run-quality-gate skill reference](./run-quality-gate.md) - the same gate, invoked against a real project
- [studio skill reference](./studio.md) - the dispatcher's Path 6 routes here
