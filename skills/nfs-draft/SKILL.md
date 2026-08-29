---
name: nfs-draft
user-invocable: true
argument-hint: "<chapter: slug or number>"
description: "Produces a voice-matched, evidence-grounded chapter draft using drafting-partner and line-editor. Resolves the chapter argument against structure/chapter-list.md, checks EV entries and alerts on an empty ledger, delegates new-chapter writing or diff proposals to drafting-partner, passes the accepted output to line-editor for proposal-only polish, confirms the chapter file via a Read check, and on chat appends compliance records that the PostToolBatch hook writes automatically on CLI and Cowork. Use when the author says 'write chapter 3,' 'draft this chapter,' or wants to keep going on a chapter already in progress."
when_to_use: "Use when the author types the /draft <ch> verb alias, says 'write chapter N,' or studio routes here from Path 2. Do not invoke when the chapter argument is missing (the skill halts if the chapter is not found in structure/chapter-list.md), or for unrelated queries."
chain:
  - drafting-partner
  - line-editor
---

This skill is the drafting front door. It resolves the chapter argument against the slug registry, loads the chapter's outline entry and evidence set, alerts on an empty ledger and waits for explicit author confirmation before proceeding, orchestrates `drafting-partner` then `line-editor`, and confirms the final file via a Read check. The agents are the sole writers of `chapters/<slug>.md`; the skill orchestrates, confirms, and reports.

**Writer alignment.** `drafting-partner` writes new chapter files directly and produces diff-proposal blocks for existing chapters (the author accepts or rejects each block individually; the agent then applies accepted changes and writes the updated file). `line-editor` always operates proposal-only; the author's acceptance completes the agent's write pass. The skill confirms the chapter file exists after each agent pass via a Read check. The PostToolBatch hook owns all `.studio/progress.json` writes; the skill writes no `.studio/` machine state.

Skill inputs read:
- `structure/chapter-list.md` (slug registry; probed at Step 1, read to resolve the chapter argument)
- `structure/outline.md` (chapter promise, beats, and evidence-needed list; read at Step 2)
- `research/evidence-log.md` (EV entries relevant to the chapter; read at Step 2)
- `context/style-profile.md` (operational voice profile; passed to both agents)
- `context/brief.md` (project context; passed to `drafting-partner`)
- `chapters/<prior-slug>.md` (closing passage of the preceding chapter for continuity context; read at Step 2 when a prior chapter file exists)
- `chapters/<slug>.md` (checked at Step 2 to determine whether the chapter already exists)

Skill chain edges:
- `draft-chapter -> drafting-partner` (new draft or diff-proposal, per `agents/_chain-permitted.yaml`)
- `draft-chapter -> line-editor` (proposal-only polish, per `agents/_chain-permitted.yaml`)

---

## Step 1 - Registry probe and chapter argument resolution (mandatory first tool call)

Use the Bash tool to run:
```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```

The output is a binary token:
- `NO_REGISTRY`: halt immediately. State: "The chapter registry `structure/chapter-list.md` does not exist. Run `/nonfiction-studio:outline-book` to produce the chapter list before drafting."
- `HAS_REGISTRY`: continue.

Use the Read tool on `structure/chapter-list.md` to load the slug registry. Resolve the supplied argument:
- **Slug match** (for example `03-your-curation-practice`): locate the row whose slug column matches exactly. Carry the slug, chapter number, and working title forward to Step 2.
- **Number match** (for example `3` or `03`): locate the row whose chapter number matches. Carry the slug, chapter number, and working title forward.
- **No match:** halt with a clear error. State: "Chapter `[supplied value]` was not found in the chapter registry. Check `structure/chapter-list.md` for the valid slugs." List the available slugs.

A chapter argument is required. Do not proceed without a resolved slug. Do not infer a chapter from conversation context.

---

## Step 2 - Load chapter context

Use the Read tool on `structure/outline.md` to load the target chapter's promise, beats, and evidence-needed list.

Use the Read tool on `research/evidence-log.md` to identify EV entries relevant to the chapter's evidence-needed list.

**Prior chapter continuity.** Identify the preceding chapter from registry order. If a prior chapter exists and its file is present at `chapters/<prior-slug>.md`, use the Read tool to extract the closing passage (approximately the last three paragraphs) and carry it forward to Step 4. If the preceding chapter file is absent, note the absence without halting.

**Existing chapter detection.** Use the Read tool on `chapters/<slug>.md` to determine whether a chapter file already exists. A successful read means existing prose is present and `drafting-partner` will operate in diff-proposal mode. An absent file means a first draft and the agent will write a new file.

---

## Step 3 - Evidence check

Count the EV entries relevant to the chapter from the `research/evidence-log.md` read in Step 2.

**If one or more relevant EV entries exist:** continue to Step 4.

**If no relevant EV entries exist:** alert the author. State:

> No evidence ledger entries were found for this chapter. `drafting-partner` will mark every factual assertion `[UNVERIFIED]` throughout the draft. Run `/nonfiction-studio:research-pass <slug>` first to populate the ledger, or confirm you want to proceed now and resolve claims after drafting.

Wait for explicit author confirmation before proceeding. If the author confirms, log the decision to `.studio/logs/` as a JSONL line before continuing:

```json
{"ts":"<RFC 3339 UTC>","event":"empty-ledger-proceed","chapter":"<slug>","decision":"author confirmed drafting with empty evidence ledger; draft will carry [UNVERIFIED] throughout"}
```

Create `.studio/logs/` if it does not exist. Then continue to Step 4. If the author does not confirm, halt cleanly at Step 3. No state is written by a halted Step 3.

---

## Step 4 - Delegate to drafting-partner

Spawn `drafting-partner` via the `draft-chapter -> drafting-partner` chain edge, passing:
- The chapter outline section from `structure/outline.md` (promise, beats, evidence-needed list)
- The relevant EV entries from `research/evidence-log.md` (or a note that the ledger is empty if the author confirmed an empty-ledger proceed in Step 3)
- The content of `context/style-profile.md`
- The content of `context/brief.md`
- The closing passage of the prior chapter for continuity context, or a note that no prior chapter file is present
- Whether the chapter file already exists (determines mode)

The agent runs three mandatory pre-flight checks before producing any prose: voice profile present (hard halt if absent), outline entry present (hard halt if absent), and EV entries present (alert only, not a hard halt per the agent's check-3 asymmetry). If the author already confirmed an empty-ledger proceed in Step 3, pass that confirmation to the agent so it proceeds directly to drafting.

**New chapter mode (file absent):** `drafting-partner` writes `chapters/<slug>.md` with every factual assertion carrying either a `[claim: EV-nnnn]` anchor referencing an existing evidence log entry or an `[UNVERIFIED]` tag per D-07 (claim ledger anchor discipline). After the agent completes, use the Read tool on `chapters/<slug>.md` to confirm the file is present and non-empty. Present the draft to the author and ask them to accept it as structurally ready or request revisions: per `line-editor`'s Phase 1 invocation rule, the author's acceptance is the structural clearance that stands in for `developmental-editor` (not yet in the Phase 1 pipeline). Proceed to Step 5 only after the author accepts; if the author requests revisions, address them before proceeding.

**Existing chapter mode (file present):** `drafting-partner` produces PROPOSED ADDITION and PROPOSED REPLACEMENT blocks. Present each block to the author for individual acceptance or rejection. After the author accepts the proposals they want applied, the agent writes the updated `chapters/<slug>.md`. Use the Read tool to confirm the file.

If `drafting-partner` halts on check 1 (voice profile absent) or check 2 (outline entry absent), surface the agent's halt message and the suggested remediation step. Do not proceed to Step 5 while a hard halt is pending.

---

## Step 5 - Delegate to line-editor

Spawn `line-editor` via the `draft-chapter -> line-editor` chain edge, passing:
- The chapter slug and the current content of `chapters/<slug>.md` confirmed at the end of Step 4
- The content of `context/style-profile.md`

The `line-editor` reads the style profile first, then reads the chapter, then produces PROPOSED REPLACEMENT blocks for sentence clarity, grammar and consistency, and rhythm. Claim markers (`[claim: EV-nnnn]`, `[UNVERIFIED]`, `[SOURCE-UNVERIFIABLE]`) are never removed or altered. Meaning-altering changes are prefixed with `[MEANING CHANGE: <reason>]`.

Present the proposals to the author for review. The author accepts or rejects each proposal individually. When the author accepts proposals, the agent applies the accepted changes and writes the updated `chapters/<slug>.md`. The skill does not write the chapter file directly.

---

## Step 6 - Confirm chapter file, chat compliance, and gate close

Use the Read tool on `chapters/<slug>.md` to confirm the file is present and non-empty after both agent passes complete.

- If the file is missing or empty: report the gap, name the last successful step, and offer to re-run from Step 4.
- If the file is present: continue.

**Chat compliance append (on chat only).** The PostToolBatch hook appends `.studio/ai-use-log.jsonl` records automatically on CLI and Cowork. On the chat surface no hooks fire; the skill performs this append. On chat, append records to `.studio/ai-use-log.jsonl` using the S-08 section 5 shape, one per agent that touched `chapters/<slug>.md`:

For a new chapter (drafting-partner wrote the file):
```json
{"ts":"<RFC 3339 UTC>","agent":"drafting-partner","surface":"chat","scope":"generated","targets":["chapters/<slug>.md"],"summary":"Drafted <slug> with claim anchors from the evidence ledger."}
```

For an existing chapter revised via diff proposals:
```json
{"ts":"<RFC 3339 UTC>","agent":"drafting-partner","surface":"chat","scope":"assisted","targets":["chapters/<slug>.md"],"summary":"Revised <slug> via diff proposals accepted by the author."}
```

For a line-editor pass where the author accepted at least one proposal:
```json
{"ts":"<RFC 3339 UTC>","agent":"line-editor","surface":"chat","scope":"assisted","targets":["chapters/<slug>.md"],"summary":"Applied sentence-level polish proposals to <slug>."}
```

Do not append these records on CLI or Cowork. The PostToolBatch hook owns the log on those surfaces; double-append corrupts the compliance ledger. Omit the line-editor record when the author accepted no proposals.

**Quality gate prompt (all surfaces).** On all surfaces, close with an explicit prompt:

> The draft of `chapters/<slug>.md` is complete. Run the quality gate to check claim coverage, voice drift, and prompt scrub:
> `/nonfiction-studio:run-quality-gate <slug>`
>
> Or advance the EV entries from `status: pending` to verified first:
> `/nonfiction-studio:fact-check-pass <slug>`

On CLI and Cowork the Stop hook gate fires automatically at session end. On chat the explicit prompt above is the substitute per S-06 1.3 (gate closure compensation).

The skill writes no `.studio/progress.json` and no other `.studio/` machine state. Word counts and derived totals arrive via the PostToolBatch hook when the agents write the chapter file.

---

## Failure behavior

**Registry absent or chapter not found.** The Step 1 Bash probe halts on `NO_REGISTRY`. If the registry exists but the supplied argument does not match any slug or number, Step 1 halts with the supplied value, the registry file name (`structure/chapter-list.md`), and the list of valid slugs. No state is written by a halted Step 1.

**Empty evidence ledger, no author confirmation.** If the author does not confirm they want to proceed with an empty ledger, the skill halts cleanly at Step 3. No state is written. The author may run `/nonfiction-studio:research-pass <slug>` to populate the ledger and then re-invoke.

**Empty evidence ledger, author confirms.** The entire draft carries `[UNVERIFIED]` on every factual assertion per the `drafting-partner` check-3 alert asymmetry. The skill logs the author's decision as a JSONL line in `.studio/logs/`. This write to the logs path is distinct from the progress path and is permitted per S-06 3.6.

**Drafting-partner pre-flight halts.** If the agent halts on check 1 (voice profile absent) or check 2 (outline entry absent), the skill surfaces the agent's halt message and the suggested next step. Step 5 is not triggered while a hard halt is pending. The author resolves the issue and re-invokes the skill.

**Partial draft resume.** If the session ends mid-chapter after the agent has written content to `chapters/<slug>.md`, the partial draft persists on disk. On re-invocation the Step 2 Read check detects the existing file and `drafting-partner` runs in diff-proposal mode to extend or revise from the saved state.

**Line-editor proposals not applied.** If the author accepts no line-editor proposals, the chapter file retains the drafting-partner output verbatim. This is a valid outcome. The quality gate accepts the drafting-partner output without requiring a line-editor pass.
