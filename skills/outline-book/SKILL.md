---
name: outline-book
user-invocable: true
argument-hint: "[scope: full | chapters | thesis]"
description: "Produces a structured chapter-by-chapter outline grounded in the confirmed thesis and project brief. Confirms the brief, optionally invokes thesis-architect to produce or sharpen the controlling idea, delegates chapter architecture to structure-architect, presents the outline for author review, and confirms the written structure files via Read checks. Scope argument controls which phases run: full (default), thesis (thesis flow only), or chapters (structure-architect only, requires existing thesis)."
when_to_use: "Use when the author types the legacy /outline verb, completes intake-interview and wants to structure the book, or studio routes here from Path 2. Do not invoke when context/brief.md is missing or unconfirmed (the skill halts and routes to intake-interview in that case), or for unrelated queries."
---

This skill is the outline front door. It confirms the project brief via a deterministic Bash guard, optionally invokes `thesis-architect` when the controlling idea is absent, delegates all chapter architecture to `structure-architect`, presents the draft outline for author review, and confirms the written structure files via Read checks. The agents perform all structure file writes; the skill orchestrates, confirms, and reports.

**Scope argument** (default: `full` when omitted):
- `full` - runs all steps: brief probe, thesis flow, structure-architect, review, acceptance
- `thesis` - runs the brief probe and thesis flow only; ends after the thesis is confirmed with the outline suggested as the next step
- `chapters` - requires an existing `structure/thesis.md`; skips the thesis flow and runs structure-architect, review, and acceptance steps

Skill inputs read:
- `context/brief.md` (confirmed brief, read via the Step 1 probe)
- `structure/thesis.md` (checked at Step 2; read and passed to structure-architect at Step 3)
- `research/evidence-log.md` (if it exists; read at Step 3 and passed to structure-architect for evidence hooks)

Skill chain edges:
- `outline-book -> thesis-architect` (conditional: invoked when `structure/thesis.md` is absent on `full` or `thesis` scopes, per `agents/_chain-permitted.yaml`)
- `outline-book -> structure-architect` (invoked on `full` and `chapters` scopes, per `agents/_chain-permitted.yaml`)

---

## Step 1 - Confirmed-brief probe (mandatory first tool call, all scopes)

Use the Bash tool to run:
```
if [ ! -f context/brief.md ] || grep -q '<!-- DRAFT' context/brief.md; then echo UNCONFIRMED; else echo CONFIRMED; fi
```

The output is a binary token:
- `UNCONFIRMED` (absent file or any DRAFT-block marker found): halt immediately. State that the project brief is missing or not yet confirmed and direct the author to complete it first: "Run `/nonfiction-studio:intake-interview` to complete or confirm the project brief before outlining."
- `CONFIRMED`: continue to Step 2.

Do not proceed past Step 1 on `UNCONFIRMED`. Do not attempt to infer brief content from conversation context.

---

## Step 2 - Thesis check (full and thesis scopes) / Thesis guard (chapters scope)

### For `full` and `thesis` scopes

Use the Read tool on `structure/thesis.md`.

- **File exists and is non-empty:** present the thesis to the author. Ask whether to proceed with the existing thesis or re-invoke `thesis-architect` to revise it before structuring the outline.
  - If the author wants to revise: invoke `thesis-architect` via the `outline-book -> thesis-architect` chain edge. Apply the two-revision-pass cap below.
  - If the author accepts the existing thesis: continue to Step 3 (`full` scope) or close (`thesis` scope).

- **File is absent or empty:** invoke `thesis-architect` via the `outline-book -> thesis-architect` chain edge to produce the controlling idea.

**Two-revision-pass cap.** After each thesis-architect run, present the produced thesis to the author for confirmation.
- If the author accepts: continue to Step 3 (`full`) or close (`thesis`).
- If the author rejects: note this as revision pass 1 and re-invoke `thesis-architect` with the rejection rationale.
- If the author rejects again: note this as revision pass 2 and re-invoke `thesis-architect` once more.
- If the author rejects after the second revision pass: halt. State: "The thesis has not reached consensus after two revision passes. Edit `structure/thesis.md` directly to state the controlling idea, then re-invoke with `/nonfiction-studio:outline-book`."

### Thesis scope close

For `thesis` scope: after the thesis is confirmed (author accepts or `thesis-architect` produces an accepted thesis), close this session. State that the thesis is confirmed and suggest running the full or chapters scope next:

> The thesis is confirmed. To build the chapter outline, run:
> `/nonfiction-studio:outline-book` (full scope) or `/nonfiction-studio:outline-book chapters`

Do not continue to Steps 3-5 in `thesis` scope.

### For `chapters` scope only

Use the Read tool on `structure/thesis.md`.

- **File exists and is non-empty:** continue to Step 3.
- **File is absent or empty:** halt. State: "The `chapters` scope requires a confirmed `structure/thesis.md`. Run `/nonfiction-studio:outline-book thesis` to produce the controlling idea first."

---

## Step 3 - Invoke structure-architect (full and chapters scopes)

Use the Read tool on `research/evidence-log.md`. If the file exists and contains evidence entries, note this for the agent context. If the file is absent or empty, note the absence.

Spawn `structure-architect` via the `outline-book -> structure-architect` chain edge, passing:
- The content of `context/brief.md`
- The content of `structure/thesis.md`
- Any evidence entries from `research/evidence-log.md`, or a note that the log is absent

The agent performs all structure file writes:
- `structure/outline.md` (the chapter-by-chapter architecture per the agent's format contract)
- `structure/chapter-list.md` (the slug registry per the agent's format contract)
- Appends evidence-needed items to `research/open-questions.md` in the same invocation

Do not instruct the agent to write `.studio/progress.json` or any other `.studio/` path. Craft-model selection questions belong to `structure-architect`; the skill does not present model options.

---

## Step 4 - Review and amendments (full and chapters scopes)

After `structure-architect` completes, present the outline to the author and ask whether they accept the plan or want amendments.

**If the author requests amendments:** route the request back to `structure-architect` by re-invoking the chain edge with the author's change notes and the existing `structure/outline.md` as context. The agent's revision-diff-and-summarize guardrail governs the re-invocation; do not edit `structure/outline.md` or `structure/chapter-list.md` directly. All structure writes belong to the agent.

**If the author accepts:** continue to Step 5.

---

## Step 5 - Confirm outputs and close (full and chapters scopes)

Use the Read tool on `structure/outline.md` and `structure/chapter-list.md` to confirm both files are present and non-empty.

- If either file is missing or empty: report the gap clearly. Name the missing file and ask the author to re-run from Step 3.
- If both files are present: continue.

State: "The chapter list in `structure/chapter-list.md` is the locked chapter registry. The slug rows in that file are the authoritative identifiers for all downstream work: drafting, fact-checking, and the quality gate all resolve chapters by slug. The skill writes no `.studio/` state; the PostToolBatch hook creates progress entries the first time each chapter file is written."

Offer optional next steps:
- If `context/style-profile.md` is absent: suggest `capture-voice` to build the voice baseline before drafting.
- In all cases: suggest `research-pass` or `draft-chapter` as the natural continuation.

Name the invocation paths:
- `/nonfiction-studio:research-pass`
- `/nonfiction-studio:draft-chapter <chapter-slug>`

Neither suggestion is mandatory or sequential.

---

## Failure behavior

**Brief missing or unconfirmed.** The Step 1 Bash probe halts on `UNCONFIRMED` and routes to `intake-interview`. No inference is made from conversation context; the check is deterministic.

**Thesis revision cap reached.** After two revision passes on a rejected thesis, the skill halts and directs the author to edit `structure/thesis.md` manually. The file retains the last thesis-architect output; the author amends it directly rather than through another agent cycle.

**Chapters scope with missing thesis.** The thesis guard at Step 2 halts with a clear message naming the missing file and the command to produce it. The skill does not silently proceed with an absent thesis.

**Structure-architect does not write.** If the Read checks at Step 5 find either output file missing or empty after the agent completes, the skill reports the gap and offers a clean restart from Step 3. No partial state is declared accepted.

**Amendments routing.** All post-review amendments go back to `structure-architect`. The skill never writes or patches `structure/outline.md` or `structure/chapter-list.md` directly.
