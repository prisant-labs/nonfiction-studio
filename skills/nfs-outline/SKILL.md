---
name: nfs-outline
user-invocable: true
argument-hint: "[scope: full | chapters | thesis]"
description: "Produces a structured chapter-by-chapter outline grounded in the confirmed thesis and project brief. Confirms the brief, optionally invokes thesis-architect to produce or sharpen the controlling idea, delegates chapter architecture to structure-architect, presents the outline for author review, and confirms the written structure files via Read checks. Scope argument controls which phases run: full (default), thesis (thesis flow only), or chapters (structure-architect only, requires existing thesis). Use when the author says 'help me outline,' wants to 'structure my book,' or needs to 'sharpen my thesis' before chapters are drafted."
when_to_use: "Use when the author completes nfs-interview and wants to structure the book, or nfs-start routes here from Path 2. Do not invoke when context/brief.md is missing or unconfirmed (the skill halts and routes to nfs-interview in that case), or for unrelated queries."
chain:
  - thesis-architect
  - structure-architect
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
- `nfs-outline -> thesis-architect` (conditional: invoked when `structure/thesis.md` is absent on `full` or `thesis` scopes, per `agents/_chain-permitted.yaml`)
- `nfs-outline -> structure-architect` (invoked on `full` and `chapters` scopes, per `agents/_chain-permitted.yaml`)

---

## Step 1 - Confirmed-brief probe (mandatory first tool call, all scopes)

Use the Bash tool to run:
```
if [ ! -f context/brief.md ] || grep -q '<!-- DRAFT' context/brief.md; then echo UNCONFIRMED; else echo CONFIRMED; fi
```

The output is a binary token:
- `UNCONFIRMED` (absent file or any DRAFT-block marker found): halt immediately. State that the project brief is missing or not yet confirmed and direct the author to complete it first: "Run `/nonfiction-studio:nfs-interview` to complete or confirm the project brief before outlining."
- `CONFIRMED`: continue to Step 2.

Do not proceed past Step 1 on `UNCONFIRMED`. Do not attempt to infer brief content from conversation context.

Before this flow's first write, take the ai-use-log.jsonl count snapshot described in Step 5's Compliance append section for `structure/thesis.md`, `structure/outline.md`, `structure/chapter-list.md`, and `research/open-questions.md` (whichever of these this invocation's scope will actually write).

---

## Step 2 - Thesis check (full and thesis scopes) / Thesis guard (chapters scope)

### For `full` and `thesis` scopes

Use the Read tool on `structure/thesis.md`.

- **File exists and is non-empty:** present the thesis to the author. Ask whether to proceed with the existing thesis or re-invoke `thesis-architect` to revise it before structuring the outline.
  - If the author wants to revise: invoke `thesis-architect` via the `nfs-outline -> thesis-architect` chain edge. Apply the two-revision-pass cap below.
  - If the author accepts the existing thesis: continue to Step 3 (`full` scope) or close (`thesis` scope).

- **File is absent or empty:** invoke `thesis-architect` via the `nfs-outline -> thesis-architect` chain edge to produce the controlling idea.

**Two-revision-pass cap.** After each thesis-architect run, present the produced thesis to the author for confirmation.
- If the author accepts: continue to Step 3 (`full`) or close (`thesis`).
- If the author rejects: note this as revision pass 1 and re-invoke `thesis-architect` with the rejection rationale.
- If the author rejects again: note this as revision pass 2 and re-invoke `thesis-architect` once more.
- If the author rejects after the second revision pass: halt. State: "The thesis has not reached consensus after two revision passes. Edit `structure/thesis.md` directly to state the controlling idea, then re-invoke with `/nonfiction-studio:nfs-outline`."

### Thesis scope close

For `thesis` scope: after the thesis is confirmed (author accepts or `thesis-architect` produces an accepted thesis), close this session. State that the thesis is confirmed and suggest running the full or chapters scope next:

> The thesis is confirmed. To build the chapter outline, run:
> `/nonfiction-studio:nfs-outline` (full scope) or `/nonfiction-studio:nfs-outline chapters`

Before closing, perform Step 5's Compliance append procedure for `structure/thesis.md` (the only file this scope wrote).

Do not continue to Steps 3-5 in `thesis` scope.

### For `chapters` scope only

Use the Read tool on `structure/thesis.md`.

- **File exists and is non-empty:** continue to Step 3.
- **File is absent or empty:** halt. State: "The `chapters` scope requires a confirmed `structure/thesis.md`. Run `/nonfiction-studio:nfs-outline thesis` to produce the controlling idea first."

---

## Step 3 - Invoke structure-architect (full and chapters scopes)

Use the Read tool on `research/evidence-log.md`. If the file exists and contains evidence entries, note this for the agent context. If the file is absent or empty, note the absence.

Spawn `structure-architect` via the `nfs-outline -> structure-architect` chain edge, passing:
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

## Step 5 - Compliance append, confirm outputs, and close (full and chapters scopes)

### Compliance append (verify-then-append)

This flow's writes may already be logged automatically by a hook on this surface; this skill never assumes which surfaces do or do not fire that hook, and it never assumes the flow is running on any particular surface. Before this flow's first write, read `.studio/ai-use-log.jsonl` and count how many records currently target each file this flow is about to write (the file's path appearing in that record's `targets` array). Hold that starting count per file. After this flow's writes complete, re-read `.studio/ai-use-log.jsonl` and count the records targeting each of those files again. For each file: if the count increased between the two reads, a hook already appended a record for this write on this surface, and this skill appends nothing further for that file. If the count did not increase, append the flow's record or records for that file to `.studio/ai-use-log.jsonl`, per the record template below, using the six-field shape in `docs/formats/ai-use-log.md` (S-08 section 5): `ts`, `agent`, `surface`, `scope`, `targets`, `summary` - with `surface` set honestly to the surface this flow is actually running on. A record already sitting in the log before this flow started, from an earlier session, does not by itself suppress the append; only a count increase observed between this flow's own two reads does. This skill never appends twice for the same write.

**Record template for this flow.** One record per agent that wrote in this invocation (per the count-delta check above):

When `thesis-architect` produced or revised the controlling idea in this run:
```json
{"ts":"<RFC 3339 UTC>","agent":"thesis-architect","surface":"<actual surface>","scope":"mechanical","targets":["structure/thesis.md"],"summary":"Produced or revised the confirmed controlling idea."}
```

When `structure-architect` ran (full and chapters scopes):
```json
{"ts":"<RFC 3339 UTC>","agent":"structure-architect","surface":"<actual surface>","scope":"mechanical","targets":["structure/outline.md","structure/chapter-list.md","research/open-questions.md"],"summary":"Produced the chapter-by-chapter outline, the slug registry, and any new open-question items."}
```

`surface` is `claude-code`, `cowork`, or `chat` per `docs/formats/ai-use-log.md` - whichever this flow is actually running on. None of these files is watched by the PostToolBatch hook (it watches only `chapters/`), so the count-delta check above finds no prior coverage on any surface and this skill appends the applicable record every time.

Use the Read tool on `structure/outline.md` and `structure/chapter-list.md` to confirm both files are present and non-empty.

- If either file is missing or empty: report the gap clearly. Name the missing file and ask the author to re-run from Step 3.
- If both files are present: continue.

State: "The chapter list in `structure/chapter-list.md` is the locked chapter registry. The slug rows in that file are the authoritative identifiers for all downstream work: drafting, fact-checking, and the quality gate all resolve chapters by slug. The skill writes no `.studio/` state; the PostToolBatch hook creates progress entries the first time each chapter file is written."

Offer optional next steps:
- If `context/style-profile.md` is absent: suggest `nfs-capture-voice` to build the voice baseline before drafting.
- In all cases: suggest `nfs-research` or `nfs-draft` as the natural continuation.

Name the invocation paths:
- `/nonfiction-studio:nfs-research`
- `/nonfiction-studio:nfs-draft <chapter-slug>`

Neither suggestion is mandatory or sequential.

---

## Failure behavior

**Brief missing or unconfirmed.** The Step 1 Bash probe halts on `UNCONFIRMED` and routes to `nfs-interview`. No inference is made from conversation context; the check is deterministic.

**Thesis revision cap reached.** After two revision passes on a rejected thesis, the skill halts and directs the author to edit `structure/thesis.md` manually. The file retains the last thesis-architect output; the author amends it directly rather than through another agent cycle.

**Chapters scope with missing thesis.** The thesis guard at Step 2 halts with a clear message naming the missing file and the command to produce it. The skill does not silently proceed with an absent thesis.

**Structure-architect does not write.** If the Read checks at Step 5 find either output file missing or empty after the agent completes, the skill reports the gap and offers a clean restart from Step 3. No partial state is declared accepted.

**Amendments routing.** All post-review amendments go back to `structure-architect`. The skill never writes or patches `structure/outline.md` or `structure/chapter-list.md` directly.
