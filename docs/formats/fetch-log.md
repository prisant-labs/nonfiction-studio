# Fetch Log Format

**Purpose.** This is the normative grammar for `.studio/logs/fetches.jsonl`, the append-only record of every WebFetch and WebSearch call the `PostToolUse` hook wraps. It exists per OPP-P04 (untrusted-source envelope): AR-07 (security, privacy and safety) and D-13 (security posture) treat fetched web content as untrusted data, and this log is the audit trail proving every fetch was scanned and wrapped before Claude saw it. D-06 (single-writer state discipline) is satisfied by construction: the hook only ever appends one JSON line per fetch with a single `appendFileSync` call, never a read-modify-write.

**The `flagged`/`signatures` fields are advisory defense in depth, not a security boundary.** They record the output of a pattern-matching scanner (below); pattern matching cannot enumerate every phrasing an injection attempt could take, so a `flagged: false` record is not a guarantee the fetched body was safe, only that the scanner recognized nothing. The actual defense against a hostile fetched page is the wrapping and fencing the `PostToolUse` hook applies to the payload itself (a preamble stating the content is data, not instructions, and a per-fetch random-nonce boundary a hostile body cannot forge), applied unconditionally to every fetch regardless of what the scanner finds. This log is a signal for a human auditing fetch history, never a gate; the hook never blocks a fetch on the scanner's result.

**This hook does not attempt instruction-override injection detection, by deliberate decision, not oversight.** A second scanner, `scanPromptInjection`, was built, adversarially tested, and removed across four review rounds. It targeted a different question than the scanner that remains: instruction-override phrasing directed at an assistant ("ignore your instructions and...") rather than AI-editorial-residue phrasing left in manuscript prose. Every narrowing tried, down to its tightest form (a category match plus an assistant-directed referent such as "your instructions" required in the same sentence, the one pattern with a clean record through three rounds of adversarial testing), was shown to false-positive on realistic content in the exact domains this hook scans: support FAQs, changelogs, security blogs, and, the case that closed the question, ordinary developer documentation where "your prompt" means a shell prompt, not an AI one. Four rounds of fix-then-fresh-adversarial-break established that the failure mode was not any one lexicon or corroboration choice; it was pattern matching's inability to distinguish an imperative addressed to an assistant from the same words used to describe, report, or instruct a human reader, at any level of narrowing tried. Per the standing rule that a flag nobody should trust is worse than no flag, the detector was deleted rather than shipped narrower still. **Consequence for a reader of this log:** `flagged: true` and `signatures` only ever report AI-editorial-residue findings (below); no record in this file will ever carry an `injection.prompt-override.*` signature, and a fetched page containing real instruction-override phrasing produces `flagged: false` exactly like benign content. The wrap and fence still apply unconditionally regardless. See `hooks/lib/scrub-engine.mjs`'s file header and git history for the four-round record, if it is ever useful to a future attempt.

## Record structure

`fetches.jsonl` is a newline-delimited JSON file (JSONL). Each line is a self-contained JSON object. The file is strictly append-only; no line is ever edited or deleted. A partial final line from an interrupted write is discarded by every reader; the file is never parsed as a single JSON document.

Each record carries six fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `ts` | string | required | RFC 3339 UTC timestamp of the fetch or search call |
| `tool` | enum | required | One of `WebFetch`, `WebSearch` |
| `source` | string | required | The fetched URL (`WebFetch`) or the search query (`WebSearch`); the join key for future reconciliation against `research/sources.md` entries |
| `bytes` | number | required | UTF-8 byte length of the original, unwrapped body that was scanned |
| `flagged` | boolean | required | Whether the shared scanner found any signature in the body (see below; advisory only) |
| `signatures` | array of strings | required | The distinct finding types the scanner returned; an empty array when `flagged` is `false` |

One scanner runs, from `hooks/lib/scrub-engine.mjs`, over the fetched body:

- `scanInjection(text)` detects AI-editorial-residue phrasing (finding types `injection.pattern-match`, `scrub.template-marker`, `scrub.agent-self-reference`). It is tuned against manuscript prose, not fetched content, but the same pattern classes can appear in a fetched page.

A second scanner, `scanPromptInjection(text)`, targeting instruction-override phrasing directed at an assistant, was built and removed; see the disclosure above and `hooks/lib/scrub-engine.mjs`'s file header for why. No signature beginning `injection.prompt-override.` will appear in this file.

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

A record for a fetch `scanInjection` flagged:

```json
{"ts":"2026-08-09T14:35:01Z","tool":"WebFetch","source":"https://evil.example.com/planted","bytes":120,"flagged":true,"signatures":["injection.pattern-match"]}
```

A record for a search:

```json
{"ts":"2026-08-09T14:36:44Z","tool":"WebSearch","source":"lighthouse keeper history Sable Point","bytes":210,"flagged":false,"signatures":[]}
```

## Consumed by

- Nothing yet reads this file. OPP-P04 (untrusted-source envelope) names a future reconciliation against `research/sources.md` entries (the `source` field is the join key) as follow-on work; this format is written to make that reconciliation possible, not to perform it.
