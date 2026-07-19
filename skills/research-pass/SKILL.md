---
name: research-pass
user-invocable: true
argument-hint: "[chapter: slug or number]"
description: "Runs a structured research session that populates the evidence ledger with EV entries and SRC references per D-07 (claim ledger). Confirms the outline is present via a deterministic guard, presents the research agenda for author approval, delegates all ledger writes to research-librarian, and reports new sources, new evidence entries, and remaining open claims for the scope."
when_to_use: "Use when the author wants to gather sources before drafting, types the legacy /research verb, or studio routes here from Path 3 (Research and verify). Do not invoke to verify existing claims (use fact-check-pass for that), or for unrelated queries."
chain:
  - research-librarian
---

This skill is the research front door. It confirms the chapter outline is present via a deterministic Bash guard, resolves any chapter scope argument against the slug registry, presents the research agenda with the web gate status, delegates all ledger writes to the `research-librarian` agent, and reports the three counts from the agent's session output. The `research-librarian` agent is the sole allocator of EV and SRC identifiers and the sole writer of the ledger files; the skill writes no ledger files and no `.studio/` state.

**Web gate.** Web research is config-conditional everywhere, not a surface-level limitation. The agent checks `research.web_enabled` in `.studio/config.json` before every WebSearch or WebFetch call. When the gate is closed (the default) or when running on chat, source material arrives as pasted text or author-provided files. The agent applies the same quote-and-attribute discipline per D-13 (security posture) in both modes.

Skill inputs read:
- `structure/outline.md` (chapter evidence requirements; presence probed at Step 1, content read at Step 3)
- `structure/chapter-list.md` (slug registry; read at Step 2 when a chapter argument is supplied)
- `research/open-questions.md` (unresolved research items for the scope; read at Steps 3 and 5)
- `research/evidence-log.md` (current highest EV ID noted at Step 3 and passed to the agent)
- `research/sources.md` (current highest SRC ID noted at Step 3 and passed to the agent)
- `.studio/config.json` (web gate check at Step 3)
- `context/brief.md` (project context passed to the agent at Step 4)

Skill chain edge: `research-pass -> research-librarian` per `agents/_chain-permitted.yaml`.

## Step 1 - Outline probe (mandatory first tool call)

Use the Bash tool to run:
```
test -f structure/outline.md && echo HAS_OUTLINE || echo NO_OUTLINE
```

The output is a binary token:
- `HAS_OUTLINE`: continue to Step 2.
- `NO_OUTLINE`: the outline is absent.
  - **Chapter-scoped (chapter argument supplied):** halt immediately. State: "Chapter-scoped research requires `structure/outline.md` to resolve the chapter's evidence needs. Run `/nonfiction-studio:outline-book` first." Do not proceed.
  - **Un-scoped (no chapter argument):** warn that the research agenda is normally grounded in the chapter outline. Offer `/nonfiction-studio:outline-book` as the recommended next step. State that un-scoped research can proceed without an outline - the agent will work from pasted sources and any items in `research/open-questions.md` directly. Proceed only on explicit author confirmation.

Do not proceed past Step 1 in chapter-scoped mode on `NO_OUTLINE`. Do not infer evidence requirements from conversation context.

## Step 2 - Chapter argument resolution (chapter argument supplied only)

Use the Read tool on `structure/chapter-list.md` to load the slug registry.

Resolve the supplied argument:
- **Slug match** (for example `03-your-curation-practice`): locate the row whose slug column matches exactly. Carry the slug, chapter number, and working title forward to Step 3.
- **Number match** (for example `3` or `03`): locate the row whose chapter number matches. Carry the slug, chapter number, and working title forward.
- **No match:** halt with a clear error. State: "Chapter `[supplied value]` was not found in the chapter registry. Check `structure/chapter-list.md` for the valid slugs." List the available slugs.

If no chapter argument was supplied, skip Step 2 and continue to Step 3 with general research scope.

## Step 3 - Load inputs, check web gate, and present agenda

Use the Read tool on `structure/outline.md` to load the evidence-needed items for the scoped chapter (or the full evidence agenda for general scope). Use the Read tool on `research/open-questions.md` to load the unresolved research items for the scope.

Use the Read tool on `research/evidence-log.md` to note the current highest EV ID. Use the Read tool on `research/sources.md` to note the current highest SRC ID. These are passed to the agent in Step 4 as informational context; the agent reads both files again before any allocation.

**Web gate check.** Use the Read tool on `.studio/config.json` to check whether `research.web_enabled` is exactly the boolean `true`. State the gate status explicitly as part of the agenda:

- **Gate open** (`research.web_enabled: true`, running on CLI or Cowork): "Web research is enabled. The agent will search for and fetch sources, announcing search terms before every call."
- **Gate closed** (field absent, `false`, or any other value): "Web research is not enabled for this project. Paste the text of any sources you want registered. The agent will analyze pasted content with the same quote-and-attribute discipline it applies to fetched content."
- **On chat** (even when gate is open): "WebSearch and WebFetch may not be available on this surface. The agent will work with pasted source text."

Present the research agenda to the author: the chapter scope (or general scope label), the open-question items to resolve, the source and evidence high-water marks, and the web gate status. Wait for author approval before delegating.

## Step 4 - Delegate to research-librarian

Spawn `research-librarian` via the `research-pass -> research-librarian` chain edge, passing:
- The chapter scope and its evidence-needed items and claim list from `structure/outline.md` (or the label "general research, no chapter scope" if omitted)
- The open-question items from `research/open-questions.md` for the scope
- The current highest EV ID and SRC ID from Step 3 (informational; the agent re-reads for allocation)
- The web gate status and any author-pasted source text or file paths

The `research-librarian` agent:
- Reads `research/evidence-log.md` and `research/sources.md` at session start to establish the true highest IDs
- Confirms no duplicate before allocating a new SRC ID
- Registers SRC records before logging any EV entries (source-first contract)
- Appends new EV entries with `status: pending`
- Marks resolved items and may append new questions in `research/open-questions.md`
- Applies the quote-and-attribute discipline to all source material, whether fetched or pasted, per D-13 (security posture)

The skill writes no ledger files. The `research-librarian` agent is the sole writer of `research/evidence-log.md`, `research/sources.md`, and `research/open-questions.md` in this flow. Ledger writes are append-only; if the session ends early, all entries written so far are valid and durable, and a re-run starts from the current ledger state.

## Step 5 - Report from the agent's session output

Use the Read tool on `research/open-questions.md` to count the items for the scope that are not marked `Status: resolved`.

Present the three counts, taking the source and evidence totals from the agent's session report:
- **New sources:** the count of new SRC records the agent appended in this session
- **New evidence entries:** the count of new EV entries the agent appended in this session (all at `status: pending`)
- **Claims still unsourced:** the count of open items in `research/open-questions.md` for the scoped chapters not yet marked resolved

The three counts come from the agent's report. The skill formats them; it does not independently recount the ledger files.

Suggest next steps:
- If open claims remain: run `research-pass` again with additional source material, or run `fact-check-pass` to advance what is already logged.
- If the chapter scope is now fully evidenced: run `draft-chapter` for that chapter.

Name the invocation paths:
- `/nonfiction-studio:research-pass [chapter]`
- `/nonfiction-studio:fact-check-pass <chapter>`
- `/nonfiction-studio:draft-chapter <chapter-slug>`

The skill writes no `.studio/` state.

---

## Failure behavior

**No outline, chapter-scoped research.** The Step 1 Bash probe halts on `NO_OUTLINE` when a chapter argument is supplied. The outline is required to resolve the chapter's evidence needs. The halt message names the command to produce it. No inference substitutes for the tool result.

**No outline, un-scoped research.** The Step 1 probe warns on `NO_OUTLINE` for un-scoped sessions. The author may confirm they want to proceed without an outline; the agent works from pasted sources and any existing open-question items. Proceeding requires explicit author confirmation.

**Chapter argument not matched.** Step 2 halts with the supplied value, the registry file name (`structure/chapter-list.md`), and the list of valid slugs. The author corrects the argument and re-invokes. No state is left by a halted Step 2.

**Zero entries.** A session that produces no new EV or SRC entries is not an error. It may mean the chapter is already fully evidenced, no source material was provided, or all proposed sources were already registered. The zero-count summary is reported as-is.

**Partial run.** The agent's append-only writes make partial runs safe. Entries written before a session ends are valid and durable. A re-run starts from the current ledger state without duplicating entries: the agent reads the current highest IDs before allocating, so re-running after a partial session is always safe. The append-only rationale: once an EV or SRC entry lands in the ledger, it is permanent record regardless of whether the session that produced it completed.
