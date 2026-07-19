// what-it-is:   PostToolBatch progress writer; replaces the TSK-030 stub per TSK-033
// what-it-does: detects chapter writes and agent dispatches in the tool_calls batch,
//               recounts each affected chapter file with the stylometry word counter
//               (the single counting authority per TSK-028), updates .studio/progress.json
//               atomically via writeProgressAtomic, and appends compliance records to
//               .studio/ai-use-log.jsonl per D-10 (compliance layer is a feature) and
//               S-08 section 5.
//
// stdin:  platform PostToolBatch event (snake_case: session_id, transcript_path, cwd,
//         prompt_id, permission_mode, effort, hook_event_name, tool_calls)
//         - tool_calls: array of {tool_name, tool_input, tool_use_id, tool_response}
//         - field names verified live by TSK-030 (hooks.json Phase 1 wiring)
// stdout: {"hookSpecificOutput":{"hookEventName":"PostToolBatch","additionalContext":"..."}}
//         when at least one chapter write was processed; EMPTY stdout otherwise
//         (dispatch-only batches append ai-use-log lines silently; batches with neither
//         chapter writes nor dispatches write nothing at all).
//
// NS_HOOK_TRACE: when set, appends one trace line (event, own path, raw stdin) to the named
//                file before any other logic; inert when unset (preserved from TSK-030 stub).
//
// Concurrency posture: the platform delivers a whole batch as one event, so multi-write
// coherence is achieved by updating all chapter entries in ONE atomic writeProgressAtomic
// call; cross-process races are out of v1 scope per D-06 (single-writer state discipline).
//
// Failure modes:
//   - Missing or unparseable progress.json: log to errors.jsonl, skip update, exit 0
//     (progress retains last-valid state per the fail-open failure row in S-07)
//   - writeProgressAtomic rename failure: log to errors.jsonl, progress retains
//     last-valid state, exit 0
//   - Chapter file unreadable for recount: log to errors.jsonl, word_count set to 0
//   - ai-use-log append failure: log to errors.jsonl, exit 0
//   - Malformed stdin: exit 0, empty stdout (fail-open, cannot identify writes)

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBookRoot, readProgress, writeProgressAtomic } from './lib/bible.mjs';
import { countWords } from './lib/stylometry-engine.mjs';

// ---------------------------------------------------------------------------
// Drain stdin - the platform delivers event JSON here on every invocation.
// ---------------------------------------------------------------------------
const raw = readFileSync(0, 'utf8');

// ---------------------------------------------------------------------------
// NS_HOOK_TRACE (opt-in firing proof, preserved from TSK-030 stub convention).
// Inert when unset.
// ---------------------------------------------------------------------------
if (process.env.NS_HOOK_TRACE) {
  const ownPath = fileURLToPath(import.meta.url);
  const traceRecord = JSON.stringify({ event: 'PostToolBatch', script: ownPath, stdinRaw: raw.trim() });
  appendFileSync(process.env.NS_HOOK_TRACE, traceRecord + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Parse stdin. Fail-open: malformed JSON exits 0 with empty stdout.
// ---------------------------------------------------------------------------
let event = {};
try {
  event = JSON.parse(raw);
} catch {
  process.exit(0);
}

// Extract snake_case fields resolved live by TSK-030 (hooks.json Phase 1 wiring).
const toolCalls = Array.isArray(event.tool_calls) ? event.tool_calls : [];
const cwd = typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd();

// ---------------------------------------------------------------------------
// Book root detection. No root found: no-op (exit 0, empty stdout).
// ---------------------------------------------------------------------------
let bookRoot = null;
try {
  const found = findBookRoot(cwd);
  bookRoot = found.root;
} catch {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helper: append one JSONL error record to .studio/logs/errors.jsonl (fail-open;
// never throws; used for recount, progress-write, and log-append failures).
// ---------------------------------------------------------------------------
function logError(msg, err) {
  try {
    const logsDir = join(bookRoot, '.studio', 'logs');
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(
      join(logsDir, 'errors.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hook: 'PostToolBatch',
        msg,
        err: String(err)
      }) + '\n',
      'utf8'
    );
  } catch {
    // Cannot write error log; nothing further to do.
  }
}

// ---------------------------------------------------------------------------
// Helper: append one JSONL compliance record to .studio/ai-use-log.jsonl.
// Fail-open: a write failure is logged to errors.jsonl.
// ---------------------------------------------------------------------------
function appendAiUseLog(record) {
  try {
    appendFileSync(
      join(bookRoot, '.studio', 'ai-use-log.jsonl'),
      JSON.stringify(record) + '\n',
      'utf8'
    );
  } catch (err) {
    logError('ai-use-log append failed', err);
  }
}

// ---------------------------------------------------------------------------
// Windows-safe chapter-path helpers.
// chapters/ is the direct child of the book root holding prose files.
// Path comparison is case-insensitive and uses the platform separator so that
// partial-name collisions (e.g. chapters-archive/) are excluded.
// ---------------------------------------------------------------------------
const chaptersDirNorm = resolve(bookRoot, 'chapters').toLowerCase();
const chaptersDirPrefix = chaptersDirNorm + sep;

function isChapterPath(absPath) {
  const norm = absPath.toLowerCase();
  return norm.startsWith(chaptersDirPrefix);
}

// ---------------------------------------------------------------------------
// Scan tool_calls for chapter writes and agent dispatches.
//
// Chapter writes (Write or Edit with file_path inside chapters/):
//   - Deduplicated by resolved abs path; later entries override earlier ones
//     for the same file (last tool call to a file determines the scope logged).
//   - scope: "generated" for Write, "assisted" for Edit.
//
// Dispatches (Task or Agent tool calls):
//   - Each call produces a separate ai-use-log record (no deduplication).
// ---------------------------------------------------------------------------
const WRITE_TOOLS = new Set(['Write', 'Edit']);
const DISPATCH_TOOLS = new Set(['Task', 'Agent']);

// Map: resolved abs path -> { scope: 'generated' | 'assisted' }
const chapterWrites = new Map();
// Array of dispatch descriptors
const dispatches = [];

for (const call of toolCalls) {
  const toolName = typeof call.tool_name === 'string' ? call.tool_name : '';
  const toolInput = (call.tool_input && typeof call.tool_input === 'object')
    ? call.tool_input
    : {};

  if (WRITE_TOOLS.has(toolName)) {
    const rawPath = typeof toolInput.file_path === 'string' ? toolInput.file_path : null;
    if (!rawPath) continue;

    let absPath;
    try {
      absPath = resolve(cwd, rawPath);
    } catch {
      continue;
    }

    if (isChapterPath(absPath)) {
      const scope = toolName === 'Write' ? 'generated' : 'assisted';
      chapterWrites.set(absPath, { scope });
    }
  } else if (DISPATCH_TOOLS.has(toolName)) {
    dispatches.push({ toolName, toolInput });
  }
}

// ---------------------------------------------------------------------------
// No-op: batch with neither chapter writes nor dispatches.
// Empty stdout, nothing written, exit 0.
// ---------------------------------------------------------------------------
if (chapterWrites.size === 0 && dispatches.length === 0) {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Recount each affected chapter file exactly once using countWords, the
// canonical stylometry tokenizer imported above. The TSK-028 adjudication
// makes countWords the SINGLE counting authority: the doctor-engine coherence
// check compares progress.json word counts against this exact tokenizer, so
// any other counter breaks the gate.
// ---------------------------------------------------------------------------

// Single UTC timestamp for all records emitted by this batch run.
const ts = new Date().toISOString();

// Map: absPath -> { slug, newCount, scope, relPath }
const chapterDetails = new Map();

for (const [absPath, { scope }] of chapterWrites.entries()) {
  const fn = basename(absPath);
  const slug = fn.endsWith('.md') ? fn.slice(0, -3) : fn;
  // bible-relative path with forward slashes for platform-neutral log records.
  const relPath = relative(bookRoot, absPath).replace(/\\/g, '/');

  let newCount = 0;
  try {
    const text = readFileSync(absPath, 'utf8');
    newCount = countWords(text);
  } catch (err) {
    logError('word count failed for ' + relPath, err);
  }

  chapterDetails.set(absPath, { slug, newCount, scope, relPath });
}

// ---------------------------------------------------------------------------
// Read progress.json, mutate in-place, and write atomically.
//
// The in-place mutation pattern satisfies S-08 Rule 2 (unknown-field
// round-trip preservation): unknown fields at any level of the object
// returned by readProgress survive because we mutate the object rather
// than rebuilding it, and writeProgressAtomic's shallow-merge preserves
// anything not overridden by the caller.
//
// writeProgressAtomic is the ONLY permitted progress writer per D-06
// (single-writer state discipline). No other code path in this script
// touches progress.json.
// ---------------------------------------------------------------------------

// slug -> previous word_count, populated before mutation for delta computation.
const prevCounts = new Map();
// Per-chapter summary tokens for the additionalContext line.
const summaryParts = [];

if (chapterWrites.size > 0) {
  let progress = null;

  try {
    progress = readProgress(bookRoot);
  } catch (err) {
    // Missing or unparseable: log, skip update, progress retains last-valid state.
    logError('progress.json missing or unparseable; skipping progress update', err);
  }

  if (progress !== null) {
    const chapters = Array.isArray(progress.chapters) ? progress.chapters : [];

    // Record previous word counts before mutation so deltas can be computed.
    for (const { slug } of chapterDetails.values()) {
      const ch = chapters.find(c => c.slug === slug);
      prevCounts.set(slug, ch && typeof ch.word_count === 'number' ? ch.word_count : 0);
    }

    // Mutate chapter entries in-place; unknown per-chapter fields are untouched.
    for (const { slug, newCount } of chapterDetails.values()) {
      const ch = chapters.find(c => c.slug === slug);
      if (ch) {
        ch.word_count = newCount;
      }
    }

    // Recompute derived totals in-place; unknown totals fields are untouched.
    const totals = (progress.totals && typeof progress.totals === 'object')
      ? progress.totals
      : {};
    progress.totals = totals;
    totals.word_count = chapters.reduce(
      (sum, ch) => sum + (typeof ch.word_count === 'number' ? ch.word_count : 0), 0
    );
    totals.open_claim_count = chapters.reduce(
      (sum, ch) => sum + (typeof ch.open_claim_count === 'number' ? ch.open_claim_count : 0), 0
    );
    totals.chapters_final = chapters.filter(ch => ch.status === 'final').length;
    progress.updated = ts;

    // Atomic write: write to progress.tmp.json then rename to progress.json.
    // writeProgressAtomic is the sole writer; grep for writeProgressAtomic in
    // this file confirms no other progress write path exists.
    try {
      writeProgressAtomic(bookRoot, progress);
    } catch (err) {
      // Rename failure: log, progress retains last-valid state per S-07 failure row.
      logError('writeProgressAtomic failed; progress retains last-valid state', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Append one ai-use-log record per chapter write, per S-08 section 5 schema exactly.
// Also build the summaryParts for the output additionalContext line.
//
// surface is the constant "claude-code" with the following deferred resolution note:
//   surface detection for Cowork is unresolved until SPK-02 (Cowork production probe);
//   richer per-agent write attribution is deferred behind OQ-14 (agent identity in hook
//   events) and the Phase 2 SubagentStop hook.
// ---------------------------------------------------------------------------
for (const { slug, newCount, scope, relPath } of chapterDetails.values()) {
  const prev = prevCounts.get(slug) ?? 0;
  const delta = newCount - prev;
  const deltaStr = delta >= 0 ? '+' + delta : String(delta);

  const verb = scope === 'generated' ? 'Wrote' : 'Edited';
  const summary = verb + ' ' + relPath + ': ' + newCount + ' words (delta ' + deltaStr + ').';

  appendAiUseLog({
    ts,
    agent: 'hook:PostToolBatch',
    surface: 'claude-code',
    scope,
    targets: [relPath],
    summary
  });

  summaryParts.push(slug + ' ' + newCount + ' words (' + deltaStr + ')');
}

// ---------------------------------------------------------------------------
// Append one ai-use-log record per agent dispatch in the batch.
// Dispatch-only batches write these records silently (empty stdout).
// ---------------------------------------------------------------------------
for (const { toolName, toolInput } of dispatches) {
  // Prefer subagent_type, then name, then fall back to the hook identity.
  const rawSlug = toolInput.subagent_type || toolInput.name || null;
  const agent = (typeof rawSlug === 'string' && rawSlug) ? rawSlug : 'hook:PostToolBatch';

  // summary: use description when present, else a generic dispatch sentence.
  const rawDesc = typeof toolInput.description === 'string' ? toolInput.description.trim() : '';
  const summary = rawDesc || ('dispatch: ' + toolName + '.');

  appendAiUseLog({
    ts,
    agent,
    surface: 'claude-code',
    scope: 'mechanical',
    targets: [],
    summary
  });
}

// ---------------------------------------------------------------------------
// Output: emit additionalContext when at least one chapter write was processed;
// empty stdout otherwise (dispatch-only batches are intentionally silent here).
// ---------------------------------------------------------------------------
if (chapterWrites.size > 0 && summaryParts.length > 0) {
  const additionalContext = 'Progress updated: ' + summaryParts.join(', ') + '.';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolBatch',
        additionalContext
      }
    }) + '\n'
  );
}

process.exit(0);
