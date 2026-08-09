# AI Use Log Format

**Purpose.** This is the normative grammar for `.studio/ai-use-log.jsonl`, the append-only compliance ledger defined in S-08 (schemas and file formats) section 5 and D-10 (compliance layer). The `PostToolBatch` and `SubagentStop` hooks append records; the `disclosure-report` and `publish-readiness` skills read the file. Every field name, value constraint, and structural rule below is authoritative. A parser author must be able to implement a conformant reader without consulting any other document.

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
- Writers are the `PostToolBatch` and `SubagentStop` hooks only. No agent writes to this file directly.
- Each hook call appends exactly one record followed by a newline character. Writers never overwrite or rewrite existing content.
- Readers treat the file as an ordered sequence of independent JSON objects, one per line.
- A partial final line from an interrupted write is silently discarded by readers.
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
- `SubagentStop` hook (TSK-069 (subagent-stop hook)): appends one record when a named subagent completes its turn.
- `disclosure-report` skill (TSK-067 (disclosure-report skill)): reads all records to produce the AI disclosure report for the author.
- `publish-readiness` skill: reads all records to confirm the compliance ledger is present and non-empty before clearing the publish gate.
