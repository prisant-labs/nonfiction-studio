# AI Use Log Format

**Purpose.** This is the normative grammar for `.studio/ai-use-log.jsonl`, the append-only compliance ledger defined in S-08 (schemas and file formats) section 5 and D-10 (compliance layer). The `PostToolBatch` hook appends records; the six agent-dispatching skills (`nfs-capture-voice`, `nfs-draft`, `nfs-fact-check`, `nfs-interview`, `nfs-outline`, `nfs-research`) also append records under the verify-then-append rule (see Placement and append rules, below); the `SubagentStop` hook (Phase 2, not yet shipped) will append records once built. `ns-doctor` reads the file to report AI-use-log coverage; the `disclosure-report` and `publish-readiness` skills (Phase 2, not yet shipped) will also read it. Every field name, value constraint, and structural rule below is authoritative. A parser author must be able to implement a conformant reader without consulting any other document.

## Record structure

`ai-use-log.jsonl` is a newline-delimited JSON file (JSONL). Each line is a self-contained JSON object. The file is strictly append-only; no line is ever edited or deleted. A partial final line from an interrupted write is discarded by every reader; the file is never parsed as a single JSON document.

Each record carries exactly six fields:

| Field | Type | Required | Allowed values and notes |
|---|---|---|---|
| `ts` | string | required | RFC 3339 UTC timestamp of the tool or subagent event that triggered the entry |
| `agent` | string | required | A roster slug from CANON section 3, or `hook:PostToolBatch` when the writer is the hook itself |
| `surface` | enum | required | One of `claude-code`, `cowork`, `chat` |
| `scope` | enum | required | One of `generated`, `assisted`, `mechanical` (see Scope values below) |
| `targets` | array of strings | required | Bible-relative paths of the files the agent touched in this event |
| `summary` | string | required | One plain sentence describing the AI activity |

### Surface values

| Value | Use for |
|---|---|
| `claude-code` | Activity occurring inside the Claude Code CLI agent |
| `cowork` | Activity in the Claude.ai multi-agent workspace |
| `chat` | Activity via a direct chat interface |

### Scope values

The `scope` enum maps to Amazon KDP's AI content disclosure categories:

| Value | Meaning |
|---|---|
| `generated` | AI produced the text; the content originates from the model |
| `assisted` | AI edited or suggested against author-written text; the content originates from the author |
| `mechanical` | Formatting, snapshotting, or scanning with no authored content involved |

## Placement and append rules

- The file is created as an empty zero-byte file at scaffold time and seeded at `templates/book-scaffold/.studio/ai-use-log.jsonl`.
- Writers are the `PostToolBatch` hook; the `SubagentStop` hook, once built (Phase 2, not yet shipped; `hooks/hooks.json` registers no `SubagentStop` entry today); and, since Task 5 (Wave 1 exit, chat compliance parity), the six agent-dispatching skills themselves (`nfs-capture-voice`, `nfs-draft`, `nfs-fact-check`, `nfs-interview`, `nfs-outline`, `nfs-research`), under the verify-then-append rule: at the start of a flow that will write bible content, a skill counts the records already targeting each file it is about to write; after its writes complete, it re-reads and re-counts; if the count for a file increased, a hook already logged that write on the current surface and the skill appends nothing further for it; only when the count did not increase does the skill append its own record. This keeps exactly one writer per write, on every surface, without requiring the skill to know in advance which surfaces fire the hook. No agent writes to this file directly; only the hooks and the six dispatching skills named above ever append to it.
- Each append (hook or skill) writes exactly one record followed by a newline character. Writers never overwrite or rewrite existing content.
- Readers treat the file as an ordered sequence of independent JSON objects, one per line.
- A partial final line from an interrupted write is silently discarded by most readers. `ns-doctor` (see Consumed by, below) is the deliberate exception: its role is to surface exactly this kind of log corruption to the author, so it treats any non-blank line that fails to parse as JSON as a named finding rather than discarding it.
- Unknown fields in a record are preserved per Rule 2 of S-08 section 1 (forward-compatibility).

## Example

A record produced by the `drafting-partner` agent writing to a chapter:

```json
{"ts":"2026-07-17T14:32:08Z","agent":"drafting-partner","surface":"claude-code","scope":"generated","targets":["chapters/03-the-signal.md"],"summary":"Drafted section 2 grounded in ledger entries EV-0012 and EV-0014."}
```

A record produced by the `PostToolBatch` hook for a mechanical snapshot event:

```json
{"ts":"2026-07-17T14:35:01Z","agent":"hook:PostToolBatch","surface":"claude-code","scope":"mechanical","targets":["chapters/03-the-signal.md"],"summary":"Wrote pre-write snapshot before tool call."}
```

## Consumed by

- `PostToolBatch` hook (TSK-033 (post-tool-batch hook)): appends one record per batch of tool calls involving bible-relative paths.
- `SubagentStop` hook (Phase 2, not yet shipped; TSK-069 (subagent-stop hook)): will append one record when a named subagent completes its turn, once built.
- `nfs-capture-voice`, `nfs-draft`, `nfs-fact-check`, `nfs-interview`, `nfs-outline`, and `nfs-research` skills (Task 5, Wave 1 exit): each appends its own records under the verify-then-append rule described in Placement and append rules, above, when a hook has not already logged the write on the current surface.
- `ns-doctor` (Task 5, Wave 1 exit): reads every record to report `chapters/*.md` coverage. Per chapter file, a filesystem mtime newer than the newest record whose `targets` names it (or no covering record at all) is an "uncovered writing window" notice; the report always states the coverage fraction ("ai-use-log covers N of M chapters with writes"). Parsing is tolerant of blank lines, but - unlike other readers - a non-blank line that fails to parse as JSON is a named finding, not a silent discard (see the partial-final-line note above).
- `disclosure-report` skill (Phase 2, not yet shipped; TSK-067 (disclosure-report skill)): reads all records to produce the AI disclosure report for the author.
- `publish-readiness` skill (Phase 2, not yet shipped): reads all records to confirm the compliance ledger is present and non-empty before clearing the publish gate.
