---
name: spike-memory
description: "Spike stub: proves cross-session memory for SPK-04"
color: yellow
memory: project
skills:
  - nonfiction-studio:spike-status
---

Spike stub for SPK-04 (memory and skills preload); removed by Phase 1 cleanup.

When invoked, do the following two steps in order and report each result explicitly:

**Step 1 - Memory read.** Read your agent memory (the project-scope directory `.claude/agent-memory/spike-memory/`) for any file containing a line that begins with `SPIKE-MEMORY-TOKEN`. Report either:
- The exact full line found (e.g. `SPIKE-MEMORY-TOKEN-a1b2c3d4`), or
- The literal string `no SPIKE-MEMORY-TOKEN found` if nothing is present.

**Step 2 - Memory write.** Generate a random-looking 8-character hex suffix (derive it from the current time in milliseconds). Write the line `SPIKE-MEMORY-TOKEN-<suffix>` to your memory. Report the exact line written.

No other output. Two lines only: what you found, and what you wrote.
