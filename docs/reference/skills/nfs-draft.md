---
title: "nfs-draft skill reference"
description: "Reference for the nfs-draft skill - the drafting front door that resolves the chapter argument, delegates to drafting-partner and line-editor, and confirms the chapter file via Read checks"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "draft", "chapter", "drafting-partner", "line-editor", "compliance"]
---

# nfs-draft

The `nfs-draft` skill is the studio's drafting front door. It resolves the chapter argument against the slug registry in `structure/chapter-list.md`, checks the evidence ledger, orchestrates the `drafting-partner` and `line-editor` agents, confirms the chapter file via Read checks, and appends compliance records to `.studio/ai-use-log.jsonl` under the verify-then-append rule (Task 5, Wave 1 exit: chat compliance parity) - a count-delta check that appends only when a hook has not already logged the write on the current surface, on any surface. It is a Phase 1 skill specified in S-06 3.6 (skills and invocation surface) and governed by D-06 (single-writer state discipline), D-07 (claim ledger), and D-10 (compliance layer).

## Purpose

`nfs-draft` bridges the chapter outline and the prose file. The `drafting-partner` agent it invokes is the sole writer of `chapters/<slug>.md`: it converts the outline entry and the EV evidence into prose in which every factual assertion carries either a `[claim: EV-nnnn]` anchor (traceable to the ledger) or an `[UNVERIFIED]` tag (awaiting evidence). The `line-editor` agent receives the accepted draft and returns proposal-only sentence-level edits; the author accepts or rejects each proposal before the agent writes the polished file.

The skill orchestrates, confirms, and reports. It writes no chapter files, no `.studio/` machine state, and no ledger files. It additionally appends ai-use-log records under the verify-then-append rule, on whichever surface a hook has not already logged the write; see [Compliance Append](#compliance-append) below.

**Writer alignment.** `drafting-partner` writes new chapter files directly. For an existing chapter it produces diff-proposal blocks; the author accepts each block individually and the agent writes the final merged file. `line-editor` is always proposal-only. The skill's sole write role is the empty-ledger decision log appended to `.studio/logs/` when the author confirms drafting with no evidence entries (see [Step 3](#step-3---evidence-check)).

## Invocation

```
/nonfiction-studio:nfs-draft <chapter>
```

The `<chapter>` argument is required. Supply the chapter slug (for example `03-your-curation-practice`) or the chapter number (for example `3`). Valid slugs are in `structure/chapter-list.md`.

Alternate entry points:
- Via the `nfs-start` dispatcher: routes here from Path 2 (Continue writing) for the next unstarted or in-progress chapter
- Via `nfs-research` Step 5: that skill suggests `nfs-draft` when a chapter is fully evidenced
- Via `nfs-outline` Step 5: that skill suggests `nfs-draft` as a natural next step after the chapter list is confirmed

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `structure/chapter-list.md` | Step 1 (Bash probe + Read) | Confirm the registry is present; resolve the chapter slug or number |
| `structure/outline.md` | Step 2 (Read) | Load the chapter's promise, beats, and evidence-needed list; pass to `drafting-partner` |
| `research/evidence-log.md` | Step 2 (Read) | Identify EV entries relevant to the chapter; count them for the Step 3 evidence check |
| `context/style-profile.md` | Step 2 context; passed to both agents | Voice baseline the agents read at the start of every invocation |
| `context/brief.md` | Step 2 context; passed to `drafting-partner` | Project context for the drafting session |
| `chapters/<prior-slug>.md` | Step 2 (Read, when prior chapter file exists) | Closing passage for continuity context passed to `drafting-partner` |
| `chapters/<slug>.md` | Step 2 (Read check) and Step 6 (Read check) | Determine whether the chapter already exists (new vs. diff-proposal mode); confirm the file after both agent passes |

### Outputs

The chapter file is written by the agents, not by the skill. The skill writes no `.studio/` machine state.

| Path | Written by | Contents |
|---|---|---|
| `chapters/<slug>.md` | `drafting-partner` (new file or accepted diff); `line-editor` (accepted polish) | Voice-matched chapter prose with `[claim: EV-nnnn]` anchors and `[UNVERIFIED]` tags per D-07 (claim ledger anchor discipline) |
| `.studio/logs/<entry>` | skill (Step 3 only, on empty-ledger confirm) | JSONL decision record logging that the author proceeded with an empty evidence ledger |
| `.studio/ai-use-log.jsonl` | PostToolBatch hook, or the skill under the verify-then-append rule when a hook has not already logged the write on the current surface | Compliance records per D-10 (compliance layer) and S-08 section 5 |

**Progress.json and the chapter STATUS lifecycle.** The PostToolBatch hook updates the `word_count` field in `.studio/progress.json` automatically when `drafting-partner` writes the chapter file. See [PostToolBatch hook behavior](#posttoolbatch-hook-behavior-for-new-chapters) below for what the hook does when the chapter slug is new. The chapter `status` field (the lifecycle: `empty`, `outlined`, `drafting`, `drafted`, etc.) currently has no owner in the drafting flow; no skill or agent updates it during a draft pass. This is a queued whole-branch item.

## Flow Summary

The skill runs six steps.

1. **Registry probe and chapter argument resolution (mandatory first tool call).** Uses a Bash tool call to test whether `structure/chapter-list.md` is present. The output is a binary token: `NO_REGISTRY` halts immediately and routes to `nfs-outline`; `HAS_REGISTRY` continues with a Read of the registry to resolve the slug or number argument. An unmatched argument halts with the supplied value, the registry file name, and the list of valid slugs. This is the deterministic-guard convention per S-06 1.1 (skill anatomy and discovery).

2. **Load chapter context.** Reads `structure/outline.md` for the chapter's promise, beats, and evidence-needed list. Reads `research/evidence-log.md` to identify relevant EV entries. Reads the closing passage of the prior chapter from `chapters/<prior-slug>.md` for continuity context (omitted if the prior chapter file is absent). Reads `chapters/<slug>.md` to determine whether the chapter already exists (new-chapter mode or diff-proposal mode).

3. **Evidence check.** Counts EV entries relevant to the chapter from the ledger read in Step 2. If at least one exists, continues to Step 4. If none, alerts the author and waits for explicit confirmation. On confirmation, logs the empty-ledger decision as a JSONL line in `.studio/logs/`. The alert is an asymmetric condition per the `drafting-partner` check-3 design: the author may proceed knowing every factual assertion will carry `[UNVERIFIED]`.

4. **Delegate to drafting-partner.** Spawns `drafting-partner` via the `nfs-draft -> drafting-partner` chain edge with the outline section, EV entries, style profile, brief, prior-chapter continuity passage, and mode flag. The agent runs three pre-flight checks (voice profile present, outline entry present, EV entries present). Checks 1 and 2 are hard halts; check 3 is an alert and is skipped when Step 3 already obtained author confirmation. In new-chapter mode the agent writes `chapters/<slug>.md` directly. In diff-proposal mode the agent presents PROPOSED ADDITION and PROPOSED REPLACEMENT blocks; the author accepts each individually and the agent writes the final file. The skill confirms the file via a Read check after the agent pass.

5. **Delegate to line-editor.** Spawns `line-editor` via the `nfs-draft -> line-editor` chain edge with the chapter slug and the style profile. The agent reads the chapter, then produces PROPOSED REPLACEMENT blocks for sentence clarity, grammar and consistency, and rhythm. Claim markers are never touched. The author accepts or rejects each proposal; the agent applies accepted changes and writes the updated file. The skill does not write the chapter file.

6. **Confirm chapter file, compliance append, and gate close.** Reads `chapters/<slug>.md` to confirm the file is present and non-empty. Runs the verify-then-append check against `.studio/ai-use-log.jsonl` and appends records for `chapters/<slug>.md` only where the count of covering records did not increase since this flow started (see [Compliance Append](#compliance-append)). On all surfaces, closes with an explicit prompt to run `nfs-check-chapter` or `nfs-fact-check`.

## PostToolBatch Hook Behavior for New Chapters

The PostToolBatch hook at `hooks/post-tool-batch.mjs` updates `.studio/progress.json` when it detects a Write or Edit tool call whose file path is inside `chapters/`. For each affected chapter file, it:

1. Reads `progress.json` into memory.
2. Searches the `chapters` array for a matching `slug` field (lines 263-268 of `hooks/post-tool-batch.mjs`):
   ```js
   const ch = chapters.find(c => c.slug === slug);
   if (ch) {
     ch.word_count = newCount;
   }
   ```
3. If a matching entry is found, updates its `word_count` with the recount result and writes atomically.
4. **If no matching entry is found** (a brand-new chapter file whose slug was never inserted into `progress.json`), the `if (ch)` branch is not entered and no new entry is created. The hook only updates existing chapter entries; it does not create new ones.

In practice, NO component currently creates chapter entries in `progress.json`: `nfs-outline` writes only the `structure/chapter-list.md` slug registry (its progress write was voided per D-06 (single-writer state discipline)), and the hook only updates entries that already exist. For a fresh book the first `drafting-partner` write lands on disk while the hook silently skips the progress update for that slug. Entry-creation ownership is being resolved at TSK-050b (progress entry ownership), which extends the PostToolBatch hook to create entries during its recount pass.

## Compliance Append

`nfs-draft` is one of six agent-dispatching skills that share one verify-then-append compliance stanza (Task 5, Wave 1 exit: chat compliance parity; the shared core text is byte-identical across all six, enforced by `scripts/checks/check-compliance-stanza.mjs` in Tier A). The detection rule is a count delta, not a surface check: at the start of the flow (Step 1, once the slug is resolved) the skill reads `.studio/ai-use-log.jsonl` and counts how many records already target `chapters/<slug>.md`; after Step 5's writes complete, it re-reads and re-counts. If the count increased, a hook already logged the write on this surface and the skill appends nothing. If it did not increase, the skill appends its own record or records for `chapters/<slug>.md`, using the S-08 section 5 schema exactly. A record already in the log before the flow started (a stale, prior-session record) does not by itself suppress the append; only an increase observed between the flow's own two reads does.

On CLI and Cowork the PostToolBatch hook normally covers `chapters/<slug>.md` already (it watches every Write and Edit call into `chapters/`), so the count-delta check typically finds no append needed there. On the chat surface hooks do not fire at all, so the count never increases and the skill's append is typically the only record for the write. Both outcomes are the same mechanism, not two different code paths.

```json
{"ts":"2026-07-19T14:32:08Z","agent":"drafting-partner","surface":"chat","scope":"generated","targets":["chapters/03-your-curation-practice.md"],"summary":"Drafted 03-your-curation-practice with claim anchors from the evidence ledger."}
```

`scope` is `generated` when `drafting-partner` wrote a new chapter file (Write tool call) and `assisted` when it revised an existing chapter via accepted diff proposals or when `line-editor` applied accepted polish (both are Edit-class operations). `surface` is set honestly to whichever surface the flow is actually running on (`claude-code`, `cowork`, or `chat`). The skill never appends twice for the same write: once the count-delta check finds an increase for a file, nothing further is appended for it.

## Failure Behavior

**Registry absent or chapter not found.** The Step 1 Bash probe halts on `NO_REGISTRY`. If the registry exists but the argument does not match any row, Step 1 halts with the supplied value, the registry file name (`structure/chapter-list.md`), and the list of valid slugs. No state is written by a halted Step 1.

**Empty evidence ledger, no author confirmation.** If the author does not confirm they want to proceed without evidence, the skill halts cleanly at Step 3. No state is written. The author may run `/nonfiction-studio:nfs-research <slug>` to populate the ledger and re-invoke.

**Empty evidence ledger, author confirms.** The draft carries `[UNVERIFIED]` on every factual assertion. The skill logs the decision as a JSONL line in `.studio/logs/`. `nfs-fact-check` or `nfs-research` followed by a re-draft resolves the markers.

**Drafting-partner pre-flight halts.** If the agent halts on check 1 (voice profile absent) or check 2 (outline entry absent), the skill surfaces the halt message and the suggested remediation step. The line-editor is not invoked while a hard halt is pending.

**Partial draft resume.** A session that ends mid-chapter leaves whatever the agent wrote in `chapters/<slug>.md`. On re-invocation the Step 2 Read check detects the existing file and `drafting-partner` operates in diff-proposal mode to extend or revise from the saved state.

**Line-editor proposals not applied.** If the author accepts no line-editor proposals, the chapter file retains the `drafting-partner` output verbatim. The quality gate accepts this as a valid draft.

## Worked Example

See [nfs-draft.example.md](./nfs-draft.example.md) for a condensed transcript of a `nfs-draft` session on the chat surface for the sample book "The Quiet Network" (see `examples/sample-book/`). The example shows Chapter 3 (Your Curation Practice, slug `03-your-curation-practice`) being drafted for the first time on the chat surface: the registry probe returns `HAS_REGISTRY`, the chapter argument resolves to the slug, two EV entries are found, `drafting-partner` writes the new chapter file with claim anchors and one `[UNVERIFIED]` tag, `line-editor` proposes one rhythm edit that the author accepts, the skill confirms the file, appends the two ai-use-log records on chat, and closes with the quality gate prompt.
