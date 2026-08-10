# Fetch Log Format

**Purpose.** This is the normative grammar for `.studio/logs/fetches.jsonl`, the append-only record of every WebFetch and WebSearch call the `PostToolUse` hook wraps. It exists per OPP-P04 (untrusted-source envelope): AR-07 (security, privacy and safety) and D-13 (security posture) treat fetched web content as untrusted data, and this log is the audit trail proving every fetch was scanned and wrapped before Claude saw it. D-06 (single-writer state discipline) is satisfied by construction: the hook only ever appends one JSON line per fetch with a single `appendFileSync` call, never a read-modify-write.

## Record structure

`fetches.jsonl` is a newline-delimited JSON file (JSONL). Each line is a self-contained JSON object. The file is strictly append-only; no line is ever edited or deleted. A partial final line from an interrupted write is discarded by every reader; the file is never parsed as a single JSON document.

Each record carries six fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `ts` | string | required | RFC 3339 UTC timestamp of the fetch or search call |
| `tool` | enum | required | One of `WebFetch`, `WebSearch` |
| `source` | string | required | The fetched URL (`WebFetch`) or the search query (`WebSearch`); the join key for future reconciliation against `research/sources.md` entries |
| `bytes` | number | required | UTF-8 byte length of the original, unwrapped body that was scanned |
| `flagged` | boolean | required | Whether `hooks/lib/scrub-engine.mjs`'s `scanInjection(text)` found any signature in the body |
| `signatures` | array of strings | required | The distinct finding types `scanInjection` returned; an empty array when `flagged` is `false` |

## Placement and append rules

- The directory `.studio/logs/` is created on demand (`mkdirSync` with `recursive: true`) on the first fetch; it is not pre-seeded at scaffold time.
- The writer is the `PostToolUse` hook only. No agent writes to this file directly.
- Each hook invocation appends at most one record, followed by a newline character. Writers never overwrite or rewrite existing content.
- Logging is best-effort and book-root-dependent: when no book root can be found, or the book root's bible files are corrupt, the append is skipped silently. This does not affect the wrap-and-flag behavior the hook applies to the fetch itself, which is unconditional and does not depend on a book project being scaffolded.
- A `fetches.jsonl` append failure after a successful wrap is recorded in `.studio/logs/errors.jsonl`; it never un-does the already-emitted wrapped output.

## Example

A record for a benign fetch:

```json
{"ts":"2026-08-09T14:32:08Z","tool":"WebFetch","source":"https://example.org/lighthouse-history","bytes":842,"flagged":false,"signatures":[]}
```

A record for a fetch the shared scanner flagged:

```json
{"ts":"2026-08-09T14:35:01Z","tool":"WebFetch","source":"https://evil.example.com/planted","bytes":120,"flagged":true,"signatures":["injection.pattern-match"]}
```

A record for a search:

```json
{"ts":"2026-08-09T14:36:44Z","tool":"WebSearch","source":"lighthouse keeper history Sable Point","bytes":210,"flagged":false,"signatures":[]}
```

## Consumed by

- Nothing yet reads this file. OPP-P04 (untrusted-source envelope) names a future reconciliation against `research/sources.md` entries (the `source` field is the join key) as follow-on work; this format is written to make that reconciliation possible, not to perform it.
