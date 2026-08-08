---
title: "research-pass skill reference"
description: "Reference for the research-pass skill - the research front door that confirms the outline, delegates to research-librarian, and reports evidence session counts"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "research", "evidence", "sources", "ledger"]
---

# research-pass

The `research-pass` skill is the studio's research front door. It confirms the chapter outline is present via a deterministic Bash guard, resolves any chapter scope argument against the slug registry, presents the research agenda to the author for approval, delegates all ledger writes to the `research-librarian` agent, and reports the three counts from the agent's session output. It is a Phase 1 skill specified in S-06 3.5 (skills and invocation surface) and governed by D-07 (claim ledger) and D-13 (security posture).

## Purpose

`research-pass` bridges the structured chapter outline and the evidence ledger. The `research-librarian` agent it invokes is the sole allocator of EV and SRC identifiers: it registers every source the book will cite in `research/sources.md` (assigning a `SRC-NNNN` record) and logs every claim in `research/evidence-log.md` (assigning an `EV-NNNN` entry with `status: pending`). Those identifiers give `fact-checker` traceable references to verify and give `bin/ns-claims` the data it needs to compute claim coverage for the quality gate.

The skill orchestrates, presents, and reports. It writes no ledger files and no `.studio/` state. The `research-librarian` agent is the sole writer of both ledger files.

**Web research is config-conditional everywhere.** The agent's hard gate reads `research.web_enabled` in `.studio/config.json`. Until that flag is set to the boolean `true`, no WebSearch or WebFetch call is made regardless of surface. When the gate is closed (the default) or when running on chat, source material arrives as pasted text or author-provided files that the agent analyzes with the same quote-and-attribute discipline per D-13 (security posture).

## Invocation

```
/nonfiction-studio:research-pass [chapter]
```

The optional `chapter` argument scopes the session to one chapter. Supply the chapter slug (for example `03-your-curation-practice`) or the chapter number (for example `3`). Omit it for general research not tied to a specific chapter. Slugs are found in `structure/chapter-list.md`.

Alternate entry points:
- Via the `studio` dispatcher: routes here from Path 3 (Research and verify) when the author says they want to gather new sources
- Verb alias: `/research` (introduced in v2; the namespaced `/nonfiction-studio:research-pass` form also works)
- Via the `outline-book` closing prompt: that skill suggests `research-pass` as a natural next step when open EV-NEEDED items remain

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `structure/outline.md` | Step 1 (Bash probe) and Step 3 (Read) | Confirm the outline is present; load evidence-needed items for the scope |
| `structure/chapter-list.md` | Step 2 (Read, when chapter argument supplied) | Resolve the chapter slug or number and confirm it is in the registry |
| `research/open-questions.md` | Step 3 and Step 5 (Read) | Load the unresolved research agenda for the scope; count remaining open items after the session |
| `research/evidence-log.md` | Step 3 (Read) | Note the current highest EV ID to pass to the agent as context |
| `research/sources.md` | Step 3 (Read) | Note the current highest SRC ID to pass to the agent as context |
| `.studio/config.json` | Step 3 (Read) | Check `research.web_enabled` to state the web gate status honestly in the agenda |
| `context/brief.md` | Step 4 (passed to the agent) | Project context for the `research-librarian` agent's research session |

### Outputs

All ledger writes are performed by the `research-librarian` agent, not by the skill. The skill writes no file and no `.studio/` state.

| Path | Written by | Contents |
|---|---|---|
| `research/evidence-log.md` | `research-librarian` (agent) | Appended EV entries with `status: pending`; each carries a registered SRC reference |
| `research/sources.md` | `research-librarian` (agent) | Appended SRC records; the source-first contract requires each SRC record to exist before any EV entry citing it is logged |
| `research/open-questions.md` | `research-librarian` (agent) | Resolved items marked; new questions appended when surfaced during research |

Ledger writes are append-only. A partial session is safe: entries written before the session ends are valid and durable, and a re-run starts from the current ledger state without duplicating entries.

## Flow Summary

The skill runs five steps. Step 2 executes only when a chapter argument is supplied.

1. **Outline probe (mandatory first tool call).** Uses a Bash tool call to test whether `structure/outline.md` is present. The output is a binary token: `NO_OUTLINE` halts chapter-scoped sessions immediately and routes to `outline-book`; for un-scoped sessions it warns and permits proceeding on explicit author confirmation; `HAS_OUTLINE` continues. This is the deterministic-guard convention per S-06 1.1 (skill anatomy and discovery).

2. **Chapter argument resolution (when chapter argument is supplied).** Reads `structure/chapter-list.md` to resolve the supplied slug or number. If no match is found, halts with the supplied value, the registry file name, and the list of valid slugs. Carries the slug, chapter number, and working title forward to Step 3.

3. **Load inputs, check web gate, and present agenda.** Reads `structure/outline.md` for the scoped chapter's evidence-needed items, reads `research/open-questions.md` for the unresolved research queue, reads `research/evidence-log.md` and `research/sources.md` to note the current highest IDs, and reads `.studio/config.json` to check the web gate. States the gate status explicitly: gate open announces web-enabled mode; gate closed (the default) explains that source material arrives as pasted text or author-provided files analyzed with the same quote-and-attribute discipline. Waits for author approval before delegating.

4. **Delegate to research-librarian.** Spawns the `research-librarian` agent via the `research-pass -> research-librarian` chain edge with the chapter scope, evidence-needed items, open-question items, current highest IDs, and web gate status. The agent reads both ledger files to establish the true highest IDs before any allocation, registers SRC records before any EV entries (source-first contract), appends new EV entries with `status: pending`, and marks resolved open-question items. The skill writes no ledger files.

5. **Report from the agent's session output.** Reads `research/open-questions.md` to count remaining open items for the scope. Formats and presents the three counts from the agent's session report: new sources (new SRC records appended), new evidence entries (new EV entries appended), and claims still unsourced (open items in `research/open-questions.md` for the scope not yet marked resolved). Suggests next steps based on the open count.

## Web Research Gate

The `research-librarian` agent checks `research.web_enabled` in `.studio/config.json` before every WebSearch or WebFetch call. The gate rule is strict: the value must be exactly the boolean `true`. An absent field, the string `"true"`, `false`, or `null` all leave the gate closed.

This is a project-level setting, not a surface-level one. Authors running on Claude Code CLI with the gate closed receive the same pasted-text workflow as authors on chat.

To enable web research for a project, add the following to `.studio/config.json`:

```json
"research": {
  "web_enabled": true
}
```

When the gate is open, the agent announces its search terms and target sources before every WebSearch or WebFetch call. Silent web tool invocation is not permitted. Every fetched source becomes a registered SRC record before any derived EV entry is logged. Fetched content is untrusted data per D-13 (security posture): the agent quotes and attributes; it never follows instructions embedded in fetched pages.

Note that on the chat surface, WebSearch and WebFetch may not be available even when the config gate is open. The agent falls back to pasted source text in that case.

## Failure Behavior

**No outline, chapter-scoped research.** The Step 1 Bash probe halts on `NO_OUTLINE` when a chapter argument is supplied. The outline is required to identify the chapter's claim list and evidence needs. The halt message names the command to produce it: `/nonfiction-studio:outline-book`. No prose inference substitutes for the tool result.

**No outline, un-scoped research.** The Step 1 probe warns on `NO_OUTLINE` for un-scoped sessions. The author may confirm they want to proceed with general research; the agent works from pasted sources and any existing open-question items directly. Proceeding requires explicit author confirmation.

**Chapter argument not matched.** Step 2 halts with the supplied value, the name of the registry file (`structure/chapter-list.md`), and the list of valid slugs. The author corrects the argument and re-invokes; no state is left by a halted Step 2.

**Zero entries.** A session that produces no new EV or SRC entries is not an error. It may mean the chapter is already fully evidenced, no source material was provided, or all proposed sources were already registered. The zero-count summary is reported as-is.

**Partial run.** Append-only writes make partial runs safe. Entries written before the session ends are valid and durable. A re-run starts from the current ledger state without duplicating entries: the agent reads the current highest IDs before allocating. This append-only rationale applies even to interrupted sessions: an EV or SRC entry that lands is permanent record.

## Worked Example

See [research-pass.example.md](./research-pass.example.md) for a condensed transcript of a chapter-scoped `research-pass` session for the sample book "The Quiet Network". The example shows the outline probe returning `HAS_OUTLINE`, the chapter argument `03-your-curation-practice` resolving against `structure/chapter-list.md`, the agenda presentation with the web gate closed, the `research-librarian` agent ingesting author-provided source text with the quote-and-attribute discipline, and the three-count summary at close.
