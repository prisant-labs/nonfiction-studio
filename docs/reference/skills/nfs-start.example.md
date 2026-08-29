---
title: "nfs-start worked example"
description: "Condensed transcript of a studio Path 2 session over the committed two-chapter sample book The Quiet Network - shows the progress probe, five-path menu, chapter-list registry probe, chapter inspection, and route offer; other paths sketched briefly"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "studio", "dispatcher", "front-door", "routing", "example"]
---

# nfs-start - worked example

This is a condensed transcript of a `studio` session over the committed two-chapter sample book "The Quiet Network" (see `examples/sample-book/`). The primary scenario is Path 2 (Continue writing), which demonstrates the full five-path presentation, the chapter-list registry probe, the chapter state inspection, and the confirm-before-handoff step. The example follows the flow specified in S-06 3.10 (skills and invocation surface) and the controller resolutions recorded in TSK-053 (studio skill).

**Session provenance note.** All values are read directly from the committed fixtures:

- `examples/sample-book/.studio/progress.json` - two drafted chapters, totals showing 6 chapters total
- `examples/sample-book/.studio/meta.json` - `book_title: "The Quiet Network"`
- `examples/sample-book/structure/chapter-list.md` - six-chapter registry; chapters 01-02 drafted, 03-06 outlined

No files are written during this session. Any scenario leaving the committed state (starting a new book, running a gate) is explicitly synthetic.

---

## Setup: what was already in place

**`.studio/meta.json`** (committed):
```json
{
  "schema_version": "2",
  "created": "2026-07-18T09:00:00Z",
  "plugin_version_at_creation": "0.1.0",
  "book_title": "The Quiet Network"
}
```

**`.studio/progress.json`** (committed, relevant sections):
```json
{
  "version": 2,
  "updated": "2026-08-10T09:10:00Z",
  "chapters": [
    {
      "slug": "01-listening-before-speaking",
      "title": "Listening Before Speaking",
      "status": "drafted",
      "word_count": 528,
      "drift_score": 10.86,
      "open_claim_count": 0,
      "last_gate": { "ts": "2026-08-10T09:10:00Z", "verdict": "pass", "report": ".studio/gate/01-listening-before-speaking.20260810T091000Z.json" }
    },
    {
      "slug": "02-finding-your-network",
      "title": "Finding Your Network",
      "status": "drafted",
      "word_count": 527,
      "drift_score": 10.75,
      "open_claim_count": 0,
      "last_gate": null
    }
  ],
  "totals": {
    "word_count": 1055,
    "open_claim_count": 0,
    "chapters_final": 0,
    "chapters_total": 6
  }
}
```

**`structure/chapter-list.md`** (committed, quoted in full):
```
# Chapter List

| # | Slug | Title | Status | Word count |
|---|---|---|---|---|
| 1 | 01-listening-before-speaking | Listening Before Speaking | drafted | 528 |
| 2 | 02-finding-your-network | Finding Your Network | drafted | 527 |
| 3 | 03-your-curation-practice | Your Curation Practice | outlined | 0 |
| 4 | 04-making-connections | Making Connections | outlined | 0 |
| 5 | 05-contributing-value | Contributing Value | outlined | 0 |
| 6 | 06-the-compounding-effect | The Compounding Effect | outlined | 0 |

**Total drafted:** 1055 words across 2 chapters.
**Open claims:** 0 (all markers in drafted chapters resolve to verified or interpretation-status ledger entries).
```

---

## Session: Path 2 - Continue writing

**Author:** `/nonfiction-studio:studio`

**Studio (Step 1 - Progress file probe):**

The skill uses the Bash tool:

```
test -f .studio/progress.json && echo HAS_PROGRESS || echo NO_PROGRESS
```

Output: `HAS_PROGRESS`

A project exists in this directory. Continue to Step 2.

**Studio (Step 2 - Parse progress.json and read book title):**

The skill uses the Read tool on `.studio/progress.json`. Parse confirms: `version: 2`, `chapters` array with 2 entries, `totals` object present. No parse error.

The skill uses the Read tool on `.studio/meta.json`. `book_title`: `"The Quiet Network"`.

Continue to Step 3.

**Studio (Step 3 - Greet and present five paths):**

> Welcome back to **The Quiet Network**. What do you want to work on?
>
> 1. **Start a new book** - scaffold the bible tree and conduct the intake interview
> 2. **Continue writing** - pick up where you left off or start the next chapter
> 3. **Research and verify** - gather new sources or check existing claims in a chapter
> 4. **Review quality and status** - see the project dashboard and run the quality gate
> 5. **Troubleshoot or get help** - diagnose a project problem or ask a general question

**Author:** `2`

**Studio (Step 4 - Route: Path 2):**

**Step 4.2a - Chapter-list registry probe:**

The skill uses the Bash tool:

```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```

Output: `HAS_REGISTRY`

The chapter-list registry exists. Continue to Step 4.2b.

**Step 4.2b - Chapter state inspection:**

Scan the `progress.json` chapters array for any entry with status `drafting`:

- `01-listening-before-speaking`: status `drafted` - not in progress
- `02-finding-your-network`: status `drafted` - not in progress

No `drafting` chapter found.

The skill uses the Read tool on `structure/chapter-list.md`. Scan for the first chapter with status `empty` or `outlined`:

- Chapter 01 (`01-listening-before-speaking`): status `drafted` - skip
- Chapter 02 (`02-finding-your-network`): status `drafted` - skip
- Chapter 03 (`03-your-curation-practice`): status `outlined` - this is the next unstarted chapter

Offer: chapter 03, "Your Curation Practice", slug `03-your-curation-practice`, via `draft-chapter`.

**Studio:**

> The next unstarted chapter is **Chapter 3: Your Curation Practice** (`03-your-curation-practice`). Both drafted chapters (01 and 02) are at status `drafted`; no chapter is currently in progress.
>
> Ready to proceed with `draft-chapter 03-your-curation-practice`? Confirm?

**Author:** `yes`

**Studio (Step 5 - Confirm before handoff):**

Confirmed. Proceeding with `draft-chapter 03-your-curation-practice`.

At this point the `draft-chapter` skill takes over. The `studio` dispatcher has completed its role.

---

## Key assertions from this transcript

- **Step 1 is always the first tool call.** The Bash probe runs before any Read call. The `HAS_PROGRESS`/`NO_PROGRESS` token drives all subsequent routing.

- **Both the progress layer and the chapter registry are read in Path 2.** The progress.json chapters array is the alive layer (hook-maintained truth for `drafted` and in-progress chapters). The chapter-list.md is the full registry including outlined chapters not yet in progress. Both are needed: progress.json to find any `drafting` chapter; chapter-list.md to find the next `outlined` or `empty` chapter when none is in progress.

- **No `drafting` chapter was found, so the next `outlined` chapter was offered.** The skill scanned progress.json first, found no `drafting` entry, then read chapter-list.md and selected the first `outlined` row (chapter 03).

- **The committed status enum is used verbatim.** The status values `drafted` and `outlined` come directly from the data; no mapping or display transformation is applied.

- **Confirm-before-handoff ran before proceeding.** The skill stated the target skill and chapter slug and waited for author confirmation before transitioning.

- **The skill wrote nothing.** No file was created, modified, or appended at any step.

- **`revise-pass` was not offered.** Although the S-06 3.10 flowchart shows `revise-pass` as a Path 2 option for a chapter with status `drafted`, that path is a Phase 2 arrival and is not available in v1. The v1 action for drafted-but-ungated chapters is `run-quality-gate`.

---

## Synthetic sketches: other paths

These sketches are explicitly synthetic. None reflects the committed fixture state.

### Path 1 - No project found (synthetic)

If Step 1 returns `NO_PROGRESS`:

> It looks like you have no active project in this directory. Would you like to start a new book? If so, the next step is `init-project` (Path 1).

On confirmation the skill proceeds with `init-project`. When `init-project` completes, it chains to `intake-interview` as the natural next step.

### Path 3 - Verify claims in Chapter 2 (synthetic)

If the author chooses Path 3, the skill asks:

> Would you like to gather new research (`research-pass`) or verify existing claims in a chapter (`fact-check-pass`)?

Author answers "verify chapter 2." The skill confirms:

> Ready to proceed with `fact-check-pass 02-finding-your-network`. Confirm?

On confirmation the `fact-check-pass` skill takes over.

### Path 4 - Review quality and status (synthetic)

If the author chooses Path 4:

> Proceeding with `status-dashboard` to show the current project state.

After `status-dashboard` renders the table, the skill inspects for chapters with no gate report. Chapter 02 has no gate report in the committed fixture. The skill offers:

> Would you like to run `run-quality-gate 02-finding-your-network` for Chapter 2 (Finding Your Network)?

### Path 5 - Structural problem (synthetic)

If `progress.json` were malformed, Step 2 would route to Path 5 before presenting the five-path menu:

> The project state file (`.studio/progress.json`) could not be read or parsed. This is a structural problem. The `doctor` skill can diagnose and repair it (Path 5).

The author confirms, and the skill proceeds with `doctor`.

### Path 5 - General question (synthetic)

If the author chooses Path 5 and describes a general question ("what is the thesis of this book?"), the skill loads `structure/thesis.md` and `context/brief.md` inline via the Read tool and answers directly. No skill or agent is invoked.
