---
name: nfs-start
user-invocable: true
argument-hint: ""
description: "Guided front door dispatcher per D-17 (guided front door): presents six numbered paths (start a new book, continue writing, research and verify, review quality and status, troubleshoot or get help, quick preview) and routes to the matching skill. The sixth path, quick preview, needs no project and routes to nfs-quick-scan or nfs-tour. Use when the author starts a session without a clear intent, types /nfs-start, or is directed here by the SessionStart orientation message."
when_to_use: "Use when the author wants to know what to do next, types /nfs-start, starts a chat session without naming a specific skill, or is directed here by the SessionStart message. Do not invoke when the author already names a specific skill or action (use that skill directly instead); do not invoke for surface-level questions that any skill can answer without routing."
---

This skill is the guided front door and dispatcher for the Nonfiction Studio plugin per D-17 (guided front door). It reads project state, presents six numbered paths, confirms the author's choice, and routes to the matching skill. The skill writes nothing directly; all output is produced by the target skill. No chain edges exist for this skill in `agents/_chain-permitted.yaml`; the dispatcher routes to skills only.

**Skills routed to (by path).** Path 1: `nfs-new-book`, then `nfs-interview`. Path 2: `nfs-outline` (no chapter-list) or `nfs-draft` (chapter in progress or next unstarted). Path 3: `nfs-research` or `nfs-fact-check`. Path 4: `nfs-status-dashboard`, then `nfs-check-chapter`. Path 5: `nfs-doctor` (structural problems) or direct answer from inline-loaded bible context (general questions). Path 6: `nfs-quick-scan` or `nfs-tour`, neither of which reads or requires a project. No skill or agent is invoked for Path 5 general questions.

Skill inputs read:
- `.studio/progress.json` (project state; required for project-exists probe and chapter inspection)
- `.studio/meta.json` (book title for greeting; read after project presence is confirmed)
- `structure/chapter-list.md` (chapter registry; read in Path 2 chapter inspection)
- Bible context files as needed for Path 5 general questions: `context/brief.md`, `context/style-profile.md`, `structure/thesis.md`, `structure/outline.md`

---

## Step 1 - Progress file probe (mandatory first tool call)

Use the Bash tool to check whether a project exists in this directory:

```
test -f .studio/progress.json && echo HAS_PROGRESS || echo NO_PROGRESS
```

**NO_PROGRESS:** A project does not exist here. Paths 2 through 5 all assume an existing project and do not apply yet; only Path 1 (start a new book) and Path 6 (quick preview) work without one. Present both, leading with the lower-commitment option since a first-time arrival is most likely to be standing at exactly this prompt, then skip straight to Step 4 for whichever the author picks (skip Step 3's full six-path greeting; it does not apply here):

> It looks like you have no active project in this directory. If you'd like a fast, no-commitment preview first, paste some writing for `nfs-quick-scan` (a voice and claims read) or take a guided `nfs-tour` of the sample book - neither needs a project. If you're ready to start a new book, the next step is `nfs-new-book` (Path 1). Which would you like?

**HAS_PROGRESS:** Continue to Step 2.

---

## Step 2 - Parse progress.json and read book title

Use the Read tool on `.studio/progress.json`. If the file is present but unreadable or the JSON is malformed, route directly to Path 5 without loading further context. Name `nfs-doctor` as the recommended tool:

> The project state file (`.studio/progress.json`) could not be read or parsed. This is a structural problem. The `nfs-doctor` skill can diagnose and repair it (Path 5).

Then confirm and proceed with Path 5.

If the file parses successfully, use the Read tool on `.studio/meta.json` to obtain `book_title` for the greeting. If `meta.json` is absent or `book_title` is missing, use the label "your book" as a fallback.

Continue to Step 3.

---

## Step 3 - Greet and present six paths

Greet the author by book title and present all six paths as numbered choices:

> Welcome back to **[book title]**. What do you want to work on?
>
> 1. **Start a new book** - scaffold the bible tree and conduct the intake interview
> 2. **Continue writing** - pick up where you left off or start the next chapter
> 3. **Research and verify** - gather new sources or check existing claims in a chapter
> 4. **Review quality and status** - see the project dashboard and run the quality gate
> 5. **Troubleshoot or get help** - diagnose a project problem or ask a general question
> 6. **Quick preview** - paste writing for a fast voice-and-claims read, or take a guided tour of the sample book; neither needs a project

Wait for the author to choose a number or describe their intent. Map the described intent to one of the six paths if unambiguous. Continue to Step 4 based on the choice.

---

## Step 4 - Route based on choice

### Path 1 - Start a new book

Confirm with the author: "Starting a new book will scaffold the bible tree and begin the intake interview. Ready to proceed with `nfs-new-book`?"

On confirmation, proceed with `nfs-new-book`. When `nfs-new-book` completes, chain directly to `nfs-interview` as the natural next step (as the `nfs-new-book` closing prompt indicates). The Path 1 chain is: `nfs-new-book` then `nfs-interview`.

### Path 2 - Continue writing

**Step 4.2a - Chapter-list registry probe.**

Use the Bash tool to check whether the chapter-list registry exists:

```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```

**NO_REGISTRY:** No chapter list has been produced yet. The outline step has not been completed.

> No chapter-list registry was found (`structure/chapter-list.md`). The next step is `nfs-outline` to produce the chapter registry and outline. Ready to proceed?

On confirmation, proceed with `nfs-outline`.

**HAS_REGISTRY:** Continue to Step 4.2b.

**Step 4.2b - Chapter state inspection.**

Inspect the `chapters` array already read from `.studio/progress.json` (the alive progress layer) and the chapter-list registry at `structure/chapter-list.md`:

1. Scan the `progress.json` chapters array for any entry with status `drafting`. If found, that chapter is in progress. Offer to continue it with `nfs-draft <slug>`.
2. If no chapter is `drafting`, use the Read tool on `structure/chapter-list.md` to find the first chapter with status `empty` or `outlined` (not yet drafted). Offer to start it with `nfs-draft <slug>`.
3. If all chapters in the registry are at status `drafted`, `revised`, `gated`, or `final`, the book is fully drafted. Offer `nfs-check-chapter` for any chapter without a recent gate report. Note: revision passes (`revise-pass`) are a Phase 2 skill and are not available in v1.

The committed status enum values (from S-08 section 3) are: `empty`, `outlined`, `drafting`, `drafted`, `revised`, `gated`, `final`. Use these values verbatim when reading and describing chapter states.

**Confirm-before-handoff:** State the chapter and skill you are about to invoke: "Ready to proceed with `nfs-draft <slug>` for chapter N ([title]). Confirm?"

On confirmation, proceed with `nfs-draft <slug>`.

### Path 3 - Research and verify

Ask the author to clarify:

> Would you like to gather new research (`nfs-research`) or verify existing claims in a chapter (`nfs-fact-check`)?

For `nfs-fact-check`, also ask for the chapter slug or number if the author has not provided one.

**Confirm-before-handoff:** State the skill and any argument: "Ready to proceed with `[skill] [argument]`. Confirm?"

On confirmation, proceed with the named skill.

### Path 4 - Review quality and status

Confirm: "Proceeding with `nfs-status-dashboard` to show the current project state."

Proceed with `nfs-status-dashboard`. After the dashboard is presented, inspect the output for chapters with no gate report (Gate cell is "-") or a `block` verdict. For each such chapter, offer:

> Would you like to run `nfs-check-chapter [slug]` for chapter N ([title])?

**Confirm-before-handoff** before each gate run.

### Path 5 - Troubleshoot or get help

Ask the author to clarify:

> Is this a structural or schema problem with the project files (the `nfs-doctor` skill can diagnose and repair these), or do you have a general question about the studio?

**Structural problem:** Confirm: "Ready to proceed with `nfs-doctor`. Confirm?"

On confirmation, proceed with `nfs-doctor`. Note: `nfs-doctor` is a Phase 1 skill that arrives with TSK-054 (doctor skill). Its invocation form is `/nonfiction-studio:nfs-doctor`.

**General question:** Use the Read tool to load the relevant bible files inline (`context/brief.md`, `context/style-profile.md`, `structure/thesis.md`, `structure/outline.md` as applicable). Answer directly from that context. Do not invoke any skill or agent.

### Path 6 - Quick preview

Ask the author to clarify:

> Would you like to paste some writing for a quick voice-and-claims read (`nfs-quick-scan`), or see a guided tour of the quality gate using the bundled sample book (`nfs-tour`)?

**Confirm-before-handoff:** State the skill: "Ready to proceed with `[nfs-quick-scan|nfs-tour]`. Confirm?"

On confirmation, proceed with the named skill. Neither skill reads or requires `.studio/progress.json`, `.studio/meta.json`, or any other project file; both work identically whether or not a project exists in this directory, which is why this path is also offered directly from Step 1's `NO_PROGRESS` branch before any project exists.

---

## Step 5 - Confirm before handoff

This step applies to all paths where a target skill is about to be invoked. Before fully transitioning to the target skill's flow, confirm the author is ready:

> Ready to proceed with `[skill name]`[and argument if any]. Confirm? (Reply "yes" to continue or "no" to return to the path menu.)

On confirmation, proceed. On cancellation, return to Step 3.

**Surface note.** This confirm step is appropriate for chat and Cowork sessions where authors navigate through the dispatcher. On CLI, experienced authors skip `nfs-start` entirely and invoke skills directly by name; they do not see this prompt.

---

## Failure behavior

**Corrupted or unreadable `progress.json`.** Step 2 detects this condition and routes directly to Path 5 naming `nfs-doctor`. Never proceed silently with stale or missing context.

**Missing `meta.json` or absent `book_title`.** Use "your book" as the fallback greeting label and continue normally.

**No chapter-list registry (Path 2).** If `structure/chapter-list.md` is absent, route to `nfs-outline` with an explanation. Do not infer chapters from any other source.

**All chapters fully drafted with no Phase 2 (Path 2).** Offer `nfs-check-chapter` for ungated chapters. State that `revise-pass` is a Phase 2 skill and is not available in v1.

**Path 5 general questions with missing bible files.** If the relevant bible files are absent, state which files are missing and answer from whatever context is available. Name the skill that produces each missing file.
