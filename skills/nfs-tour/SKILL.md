---
name: nfs-tour
user-invocable: true
argument-hint: "[destination folder]"
description: "Runs a guided walkthrough of the bundled sample book in a disposable copy per OPP-D17 (five-minute first win): shows the quality gate pass with real margins, plants a realistic AI-residue defect, shows the gate block with a named reason, then fixes it and shows the gate pass again, all without touching the shipped example or requiring a project. Use when the author wants to see what the quality gate actually catches before starting their own book, asks for a demo or a tour, or is new to the plugin and wants proof before committing to the intake interview."
when_to_use: "Use when the author asks for a tour, demo, or walkthrough of the plugin, wants to see the quality gate catch a real problem before trusting it, or is newly installed and was pointed here from quick-scan or the README quickstart. Do not invoke inside an existing book project as a substitute for run-quality-gate; this skill only ever operates on a disposable copy of the bundled sample book, never the author's own project."
---

This skill is the guided-demonstration half of the five-minute first win per OPP-D17 (five-minute first win). It walks the author through `examples/sample-book` in a **disposable copy**, ending with the quality gate visibly failing on a planted defect and then passing again. **It never requires an initialized book project** and never modifies the shipped example; every write in this skill happens inside a fresh copy created in Step 2, never in `<plugin-root>/examples/`.

**Hard constraint.** `scripts/test-fixtures.mjs` asserts that the shipped `examples/` tree is byte-for-byte clean. Every step below that writes anything writes only inside `<tour-dir>` (the copy created in Step 2). Never edit, plant, or clean up inside `<plugin-root>/examples/sample-book` directly.

Skill inputs read: `<plugin-root>/examples/sample-book` (read-only, as the source `fs.cpSync` copies from; never opened for writing).

---

## Step 1 - Resolve the plugin root

Use the Bash tool to run the primary lookup:
```
node -e "const s=require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8');const m=JSON.parse(s).extraKnownMarketplaces;const ns=m&&m['nonfiction-studio'];console.log(ns&&ns.source&&ns.source.path||'not-found')"
```

If it prints `not-found`, run the platform cache fallback:
```
find "$HOME/.claude/plugins/cache" -maxdepth 3 -type d -name "nonfiction-studio*" 2>/dev/null | head -1
```

If that also returns nothing, run the dev-mode fallback:
```
test -d examples/sample-book && pwd || echo not-found
```

If all three fail: halt. Report the settings.json and cache paths attempted. Do not create any copy. Ask the author to verify the plugin installation.

Carry the resolved path forward as `<plugin-root>`.

---

## Step 2 - Copy the sample book to a disposable location

**2a - Choose the destination parent.** If the author supplied a destination folder as an argument, use it as `<dest-parent>`. Otherwise get the OS temp directory:
```
node -e "console.log(require('os').tmpdir())"
```

**2b - Get a timestamp for a fresh, collision-free folder name.**
```
node -e "console.log(Date.now())"
```
Compute `<tour-dir>` as `<dest-parent>/nonfiction-studio-tour-<timestamp>`.

**2c - Copy (one Bash call, source never opened for writing).** This mirrors the temp-clone pattern in `scripts/test-fixtures.mjs`, the house model for doing this safely:
```
node -e "require('fs').cpSync(process.argv[1], process.argv[2], {recursive:true})" "<plugin-root>/examples/sample-book" "<tour-dir>"
```

**2d - State the guarantee plainly:**

> The sample book is copied to `<tour-dir>`. The plugin's shipped copy at `<plugin-root>/examples/sample-book` is untouched, and everything from here happens only in this disposable copy. Delete `<tour-dir>` any time; nothing about it is tracked by the plugin.

If the copy fails for any reason (unwritable destination, disk error): halt. Report the exact error. Do not proceed to Step 3.

---

## Step 3 - Opt the copy into block mode

The shipped default (`gate.mode: "warn"` in `.studio/config.json`) means the gate always reports every check but never actually stops a session until an author opts in; that is why the same finding that would print `BLOCK` in an opted-in project only prints `warn` by default. To make the block in Step 6 real (not merely a warning), opt this disposable copy into block mode:

Use the Read tool on `<tour-dir>/.studio/config.json`, then the Edit tool to change the top-level gate mode line (the one immediately inside `"gate": {`, not any of the per-check `"mode"` entries below it) from:
```
"mode": "warn",
```
to:
```
"mode": "block",
```

State to the author: "This copy now runs in block mode, the same setting you can choose for your own project's `.studio/config.json` any time you want the gate to actually stop a session instead of only warning."

---

## Step 4 - Run the gate and watch it pass

Use the Bash tool for the full gate, no chapter or check scoping:
```
node "<plugin-root>/bin/ns-gate" --project="<tour-dir>"
```

Present the result as a genuine pass, in block mode, with real margins: report the top-level verdict and each check's one-line detail (claim coverage, quote fidelity, stylometry drift score against its threshold, prompt scrub, continuity, state coherence, session write flag). Call out the stylometry line specifically, since "passes with a real margin" is a verified property of this book, not an aspiration: both chapters pass their own individual stylometry check, not merely the combined book average.

---

## Step 5 - Plant a realistic defect

Use the Edit tool on `<tour-dir>/chapters/02-finding-your-network.md` to append, at the end of the file:
```

Here is a draft of this paragraph for the author to revise.
```

Explain why this specific line: it is drawn from the same fixed phrase lexicon `bin/ns-scrub`'s prompt-scrub check matches against, and it represents a completely realistic mistake, an AI-assisted drafting pass that left its own scaffolding in the manuscript, exactly the class of defect the check exists to catch.

---

## Step 6 - Run the gate again and watch it block

Use the Bash tool, scoped to the chapter and check just planted, so the demonstration stays focused on the one problem introduced rather than the incidental voice and word-count drift a direct file edit (bypassing the plugin's normal drafting flow) also produces:
```
node "<plugin-root>/bin/ns-gate" --project="<tour-dir>" --chapter=02-finding-your-network --check=scrub
```

Present the result as a genuine block: top-level `verdict: block`, exit code 1, the `prompt_scrub` check entry printed as `BLOCK` with its detail (`scrub.agent-self-reference`) and its `next` field verbatim. Name the reason plainly: this stops on one specific, nameable line, not a vague inconvenience. Note that on CLI and Cowork this same check runs automatically at the end of every AI-assisted session via the Stop hook; running it by hand here is only for the demonstration.

If the author asks what the other checks would have shown, mention (without re-running) that a full unscoped run at this point would also show a word-count and voice-metric mismatch, both accurate and both explained by editing a chapter file directly outside the normal drafting flow, which is why Step 4 and Step 8 use the full unscoped gate while this step scopes narrowly to the one check being demonstrated.

---

## Step 7 - Fix it

Use the Edit tool on `<tour-dir>/chapters/02-finding-your-network.md` to remove exactly the two lines added in Step 5 (the blank line and the planted sentence), restoring the chapter to its original content.

---

## Step 8 - Run the gate one more time and watch it pass again

Use the Bash tool for the full gate again, same invocation as Step 4:
```
node "<plugin-root>/bin/ns-gate" --project="<tour-dir>"
```

Present the result as a pass again, confirming recovery: the block is gone because the specific problem that caused it is gone, and the margins match Step 4's numbers because the chapter is back to its original content.

---

## Step 9 - Close

Summarize in a few lines what the gate's seven checks cover (claim coverage, quote fidelity, prompt scrub, stylometry drift, continuity, state coherence, session write flag), and that a block is informative rather than annoying: it names the exact line and the exact reason, the way Step 6 just did, rather than issuing a vague warning.

Restate that `<tour-dir>` is disposable and can be deleted any time, and that the shipped `examples/sample-book` was never opened for writing during this walkthrough.

Point to a concrete next step:
- **`/nonfiction-studio:nfs-quick-scan`** if the author has not tried it yet - paste their own prose for a voice and claim read.
- **Starting a real project** - `/nonfiction-studio:nfs-start` (or `/nonfiction-studio:nfs-new-book` directly), followed by `/nonfiction-studio:nfs-interview` when ready. State honestly that the intake interview is a real 45 to 90 minute session per D-16 (honest, resumable interview); this tour is a demonstration, not a substitute for it.

---

## Failure behavior

**Plugin root cannot be resolved.** Step 1 halts before any copy is created. The author is told which paths were attempted.

**Copy fails (Step 2).** Halt immediately with the exact error. No gate is run. `<plugin-root>/examples/sample-book` is never at risk since `fs.cpSync` only ever reads from it.

**`ns-gate` exits 2 at any point (Steps 4, 6, or 8).** Surface the stderr and halt at that step. State that `<tour-dir>` is left in place for inspection and can be deleted any time; do not present a partial or guessed verdict.

**Author wants to keep exploring the copy afterward.** That is fine; nothing requires deleting `<tour-dir>` immediately. State it is entirely disposable and outside the plugin's own tracked state, so nothing else in the plugin depends on it existing or not.
