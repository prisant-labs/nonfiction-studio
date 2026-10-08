---
name: nfs-draft
user-invocable: true
argument-hint: "<chapter: slug or number>"
description: "Produces a voice-matched, evidence-grounded chapter draft using drafting-partner and line-editor. Resolves the chapter argument against structure/chapter-list.md, checks EV entries and alerts on an empty ledger, delegates new-chapter writing or diff proposals to drafting-partner, passes the accepted output to line-editor for proposal-only polish, confirms the chapter file via a Read check, and appends compliance records to the AI-use log in the state folder on any surface where a hook has not already logged the write. Use when the author says 'write chapter 3,' 'draft this chapter,' or wants to keep going on a chapter already in progress."
when_to_use: "Use when the author says 'write chapter N,' or studio routes here from Path 2. Do not invoke when the chapter argument is missing (the skill halts if the chapter is not found in structure/chapter-list.md), or for unrelated queries."
chain:
  - drafting-partner
  - line-editor
---

This skill is the drafting front door. It resolves the chapter argument against the slug registry, loads the chapter's outline entry and evidence set, alerts on an empty ledger and waits for explicit author confirmation before proceeding, orchestrates `drafting-partner` then `line-editor`, and confirms the final file via a Read check. The agents are the sole writers of `<chapters-dir>/<slug>.md`; the skill orchestrates, confirms, and reports.

**Writer alignment.** `drafting-partner` writes new chapter files directly and produces diff-proposal blocks for existing chapters (the author accepts or rejects each block individually; the agent then applies accepted changes and writes the updated file). `line-editor` always operates proposal-only; the author's acceptance completes the agent's write pass. The skill confirms the chapter file exists after each agent pass via a Read check. The PostToolBatch hook owns all `<state-dir>/progress.json` writes; the skill writes no `<state-dir>/` machine state.

Skill inputs read:
- `structure/chapter-list.md` (slug registry; probed at Step 1, read to resolve the chapter argument)
- `structure/outline.md` (chapter promise, beats, and evidence-needed list; read at Step 2)
- `research/evidence-log.md` (EV entries relevant to the chapter; read at Step 2)
- `context/style-profile.md` (operational voice profile; passed to both agents)
- `context/brief.md` (project context; passed to `drafting-partner`)
- `<chapters-dir>/<prior-slug>.md` (closing passage of the preceding chapter for continuity context; read at Step 2 when a prior chapter file exists)
- `<chapters-dir>/<slug>.md` (checked at Step 2 to determine whether the chapter already exists)

Skill chain edges:
- `nfs-draft -> drafting-partner` (new draft or diff-proposal, per `agents/_chain-permitted.yaml`)
- `nfs-draft -> line-editor` (proposal-only polish, per `agents/_chain-permitted.yaml`)

---

Elements this skill needs: style, brief, structure, claims

## Locate the state folder

This book keeps its machine-managed records in one state folder at the book root. The book root is the folder that holds `nonfiction-studio.json`, or else the folder that holds `context/` and `chapters/`. In this skill, `<state-dir>` stands for the state folder's name, and `<chapters-dir>` stands for the name of the folder that holds the chapters. Resolve both once, before any step below.

1. Use the Read tool on `nonfiction-studio.json` at the book root. This Read is the skill's first tool call. If the file does not exist, `<state-dir>` is `_nonfiction-studio` and `<chapters-dir>` is `chapters`; continue at item 4.
2. If the file exists, it must hold a JSON object with a `state_dir` key, a `chapters_dir` key, or both. Each value must be a string that matches `^[A-Za-z0-9._-]{1,64}$`, and neither may be `.` or `..`. The `state_dir` value may not be `context`, `structure`, `research`, `chapters`, `production`, `.git` or `.claude`. The `chapters_dir` value may not be `context`, `structure`, `research`, `production`, `.git`, `.claude` or the state folder's name. On Windows, compare these names without regard to case. The state folder must exist at the book root and hold `meta.json`, and a folder that `chapters_dir` names must exist at the book root. When every condition holds, `<state-dir>` is the `state_dir` value, or `_nonfiction-studio` when that key is absent, and `<chapters-dir>` is the `chapters_dir` value, or `chapters` when that key is absent.
3. If the file exists but any condition in item 2 fails, stop. Tell the author which condition failed, write nothing, and name `/nonfiction-studio:nfs-doctor` as the fix. Never fall back to `_nonfiction-studio`.
4. If the file does not exist and `_nonfiction-studio/meta.json` does not exist either, list the folders at the book root, hidden folders included. If one of them holds both `meta.json` and `progress.json`, stop. Name that folder, write nothing, and name `/nonfiction-studio:nfs-doctor` as the fix. Never create a second state folder beside it.
5. When `<state-dir>/meta.json` exists, use the Read tool on it. If it has an `adoption` object, the book is an adopted one, and an element counts as adopted only when its entry under `adoption.elements` is exactly `"adopted"`. A book without the object counts as having adopted all five elements: `chapters`, `style`, `brief`, `structure` and `claims`. So does a folder that has no state folder yet.
6. The line `Elements this skill needs:` above names the elements this skill cannot run without. If any of them is not adopted, stop before your first write. Name the element, write nothing, and name `/nonfiction-studio:nfs-adopt <element>` as the way to adopt it. For `claims`, say instead that adopting claims is not available yet.
7. Treat the files of every other element that is not adopted as absent. Never read, create or edit them, even when a file of that name exists, because in an adopted book such a file is the author's own. The `style` files are `context/style-profile.md` and the voice baseline in `<state-dir>/config.json`. The `brief` files are `context/brief.md`, `context/audience.md` and `context/decisions.md`. The `structure` files are those under `structure/`, plus `research/open-questions.md`. The `claims` files are `research/evidence-log.md`, `research/sources.md` and `research/packets/`.

Before you run a command or open a path below, replace `<state-dir>` and `<chapters-dir>` with the resolved names. When this skill dispatches an agent, name both resolved folders in the dispatch brief, because agents never resolve them themselves.

---

## Step 1 - Registry probe and chapter argument resolution (first tool call after the state folder is located)

Use the Bash tool to run:
```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```

The output is a binary token:
- `NO_REGISTRY`: halt immediately. State: "The chapter registry `structure/chapter-list.md` does not exist. Run `/nonfiction-studio:nfs-outline` to produce the chapter list before drafting."
- `HAS_REGISTRY`: continue.

Use the Read tool on `structure/chapter-list.md` to load the slug registry. Resolve the supplied argument:
- **Slug match** (for example `03-your-curation-practice`): locate the row whose slug column matches exactly. Carry the slug, chapter number, and working title forward to Step 2.
- **Number match** (for example `3` or `03`): locate the row whose chapter number matches. Carry the slug, chapter number, and working title forward.
- **No match:** halt with a clear error. State: "Chapter `[supplied value]` was not found in the chapter registry. Check `structure/chapter-list.md` for the valid slugs." List the available slugs.

A chapter argument is required. Do not proceed without a resolved slug. Do not infer a chapter from conversation context.

Once the slug is resolved, take the ai-use-log.jsonl count snapshot described in Step 6's Compliance append section for `<chapters-dir>/<slug>.md`, before this flow's first write.

---

## Step 2 - Load chapter context

Use the Read tool on `structure/outline.md` to load the target chapter's promise, beats, and evidence-needed list.

Use the Read tool on `research/evidence-log.md` to identify EV entries relevant to the chapter's evidence-needed list.

**Prior chapter continuity.** Identify the preceding chapter from registry order. If a prior chapter exists and its file is present at `<chapters-dir>/<prior-slug>.md`, use the Read tool to extract the closing passage (approximately the last three paragraphs) and carry it forward to Step 4. If the preceding chapter file is absent, note the absence without halting.

**Existing chapter detection.** Use the Read tool on `<chapters-dir>/<slug>.md` to determine whether a chapter file already exists. A successful read means existing prose is present and `drafting-partner` will operate in diff-proposal mode. An absent file means a first draft and the agent will write a new file.

---

## Step 3 - Evidence check

Count the EV entries relevant to the chapter from the `research/evidence-log.md` read in Step 2.

**If one or more relevant EV entries exist:** continue to Step 4.

**If no relevant EV entries exist:** alert the author. State:

> No evidence ledger entries were found for this chapter. `drafting-partner` will mark every factual assertion `[UNVERIFIED]` throughout the draft. Run `/nonfiction-studio:nfs-research <slug>` first to populate the ledger, or confirm you want to proceed now and resolve claims after drafting.

Wait for explicit author confirmation before proceeding. If the author confirms, log the decision to `<state-dir>/logs/` as a JSONL line before continuing:

```json
{"ts":"<RFC 3339 UTC>","event":"empty-ledger-proceed","chapter":"<slug>","decision":"author confirmed drafting with empty evidence ledger; draft will carry [UNVERIFIED] throughout"}
```

Create `<state-dir>/logs/` if it does not exist. Then continue to Step 4. If the author does not confirm, halt cleanly at Step 3. No state is written by a halted Step 3.

---

## Step 4 - Delegate to drafting-partner

Spawn `drafting-partner` via the `nfs-draft -> drafting-partner` chain edge, passing:
- The chapter outline section from `structure/outline.md` (promise, beats, evidence-needed list)
- The relevant EV entries from `research/evidence-log.md` (or a note that the ledger is empty if the author confirmed an empty-ledger proceed in Step 3)
- The content of `context/style-profile.md`
- The content of `context/brief.md`
- The closing passage of the prior chapter for continuity context, or a note that no prior chapter file is present
- Whether the chapter file already exists (determines mode)

The agent runs three mandatory pre-flight checks before producing any prose: voice profile present (hard halt if absent), outline entry present (hard halt if absent), and EV entries present (alert only, not a hard halt per the agent's check-3 asymmetry). If the author already confirmed an empty-ledger proceed in Step 3, pass that confirmation to the agent so it proceeds directly to drafting.

**New chapter mode (file absent):** `drafting-partner` writes `<chapters-dir>/<slug>.md` with every factual assertion carrying either a `[claim: EV-nnnn]` anchor referencing an existing evidence log entry or an `[UNVERIFIED]` tag per D-07 (claim ledger anchor discipline). After the agent completes, use the Read tool on `<chapters-dir>/<slug>.md` to confirm the file is present and non-empty. Present the draft to the author and ask them to accept it as structurally ready or request revisions: per `line-editor`'s Phase 1 invocation rule, the author's acceptance is the structural clearance that stands in for `developmental-editor` (not yet in the Phase 1 pipeline). Proceed to Step 5 only after the author accepts; if the author requests revisions, address them before proceeding.

**Existing chapter mode (file present):** `drafting-partner` produces PROPOSED ADDITION and PROPOSED REPLACEMENT blocks. Present each block to the author for individual acceptance or rejection. After the author accepts the proposals they want applied, the agent writes the updated `<chapters-dir>/<slug>.md`. Use the Read tool to confirm the file.

If `drafting-partner` halts on check 1 (voice profile absent) or check 2 (outline entry absent), surface the agent's halt message and the suggested remediation step. Do not proceed to Step 5 while a hard halt is pending.

---

## Step 5 - Delegate to line-editor

Spawn `line-editor` via the `nfs-draft -> line-editor` chain edge, passing:
- The chapter slug and the current content of `<chapters-dir>/<slug>.md` confirmed at the end of Step 4
- The content of `context/style-profile.md`

The `line-editor` reads the style profile first, then reads the chapter, then produces PROPOSED REPLACEMENT blocks for sentence clarity, grammar and consistency, and rhythm. Claim markers (`[claim: EV-nnnn]`, `[UNVERIFIED]`, `[SOURCE-UNVERIFIABLE]`) are never removed or altered. Meaning-altering changes are prefixed with `[MEANING CHANGE: <reason>]`.

Present the proposals to the author for review. The author accepts or rejects each proposal individually. When the author accepts proposals, the agent applies the accepted changes and writes the updated `<chapters-dir>/<slug>.md`. The skill does not write the chapter file directly.

---

## Step 6 - Confirm chapter file, chat compliance, and gate close

Use the Read tool on `<chapters-dir>/<slug>.md` to confirm the file is present and non-empty after both agent passes complete.

- If the file is missing or empty: report the gap, name the last successful step, and offer to re-run from Step 4.
- If the file is present: continue.

### Compliance append (verify-then-append)

This flow's writes may already be logged automatically by a hook on this surface; this skill never assumes which surfaces do or do not fire that hook, and it never assumes the flow is running on any particular surface. Before this flow's first write, read `<state-dir>/ai-use-log.jsonl` and count how many records currently target each file this flow is about to write (the file's path appearing in that record's `targets` array). Hold that starting count per file. After this flow's writes complete, re-read `<state-dir>/ai-use-log.jsonl` and count the records targeting each of those files again. For each file: if the count increased between the two reads, a hook already appended a record for this write on this surface, and this skill appends nothing further for that file. If the count did not increase, append the flow's record or records for that file to `<state-dir>/ai-use-log.jsonl`, per the record template below, using the six-field shape in `docs/formats/ai-use-log.md` (S-08 section 5): `ts`, `agent`, `surface`, `scope`, `targets`, `summary` - with `surface` set honestly to the surface this flow is actually running on. A record already sitting in the log before this flow started, from an earlier session, does not by itself suppress the append; only a count increase observed between this flow's own two reads does. This skill never appends twice for the same write.

**Record template for this flow.** One record per agent that touched `<chapters-dir>/<slug>.md` and needed the append (per the count-delta check above):

For a new chapter (drafting-partner wrote the file):
```json
{"ts":"<RFC 3339 UTC>","agent":"drafting-partner","surface":"<actual surface>","scope":"generated","targets":["<chapters-dir>/<slug>.md"],"summary":"Drafted <slug> with claim anchors from the evidence ledger."}
```

For an existing chapter revised via diff proposals:
```json
{"ts":"<RFC 3339 UTC>","agent":"drafting-partner","surface":"<actual surface>","scope":"assisted","targets":["<chapters-dir>/<slug>.md"],"summary":"Revised <slug> via diff proposals accepted by the author."}
```

For a line-editor pass where the author accepted at least one proposal:
```json
{"ts":"<RFC 3339 UTC>","agent":"line-editor","surface":"<actual surface>","scope":"assisted","targets":["<chapters-dir>/<slug>.md"],"summary":"Applied sentence-level polish proposals to <slug>."}
```

`surface` is `claude-code`, `cowork`, or `chat` per `docs/formats/ai-use-log.md` - whichever this flow is actually running on. On CLI and Cowork the PostToolBatch hook normally covers `<chapters-dir>/<slug>.md` already, so the count-delta check above typically finds no append needed there; on chat it typically does. Omit the line-editor record when the author accepted no proposals.

**Quality gate prompt (all surfaces).** On all surfaces, close with an explicit prompt:

> The draft of `<chapters-dir>/<slug>.md` is complete. Run the quality gate to check claim coverage, voice drift, and prompt scrub:
> `/nonfiction-studio:nfs-check-chapter <slug>`
>
> Or advance the EV entries from `status: pending` to verified first:
> `/nonfiction-studio:nfs-fact-check <slug>`

On CLI and Cowork the Stop hook gate fires automatically at session end. On chat the explicit prompt above is the substitute per S-06 1.3 (gate closure compensation).

The skill writes no `<state-dir>/progress.json` and no other `<state-dir>/` machine state. Word counts and derived totals arrive via the PostToolBatch hook when the agents write the chapter file.

---

## Failure behavior

**Registry absent or chapter not found.** The Step 1 Bash probe halts on `NO_REGISTRY`. If the registry exists but the supplied argument does not match any slug or number, Step 1 halts with the supplied value, the registry file name (`structure/chapter-list.md`), and the list of valid slugs. No state is written by a halted Step 1.

**Empty evidence ledger, no author confirmation.** If the author does not confirm they want to proceed with an empty ledger, the skill halts cleanly at Step 3. No state is written. The author may run `/nonfiction-studio:nfs-research <slug>` to populate the ledger and then re-invoke.

**Empty evidence ledger, author confirms.** The entire draft carries `[UNVERIFIED]` on every factual assertion per the `drafting-partner` check-3 alert asymmetry. The skill logs the author's decision as a JSONL line in `<state-dir>/logs/`. This write to the logs path is distinct from the progress path and is permitted per S-06 3.6.

**Drafting-partner pre-flight halts.** If the agent halts on check 1 (voice profile absent) or check 2 (outline entry absent), the skill surfaces the agent's halt message and the suggested next step. Step 5 is not triggered while a hard halt is pending. The author resolves the issue and re-invokes the skill.

**Partial draft resume.** If the session ends mid-chapter after the agent has written content to `<chapters-dir>/<slug>.md`, the partial draft persists on disk. On re-invocation the Step 2 Read check detects the existing file and `drafting-partner` runs in diff-proposal mode to extend or revise from the saved state.

**Line-editor proposals not applied.** If the author accepts no line-editor proposals, the chapter file retains the drafting-partner output verbatim. This is a valid outcome. The quality gate accepts the drafting-partner output without requiring a line-editor pass.
