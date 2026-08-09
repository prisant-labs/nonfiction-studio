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
//
// Error discrimination (F-HK-01; mirrors hooks/stop-gate.mjs and
// hooks/session-start.mjs): BibleError code NO_BOOK_ROOT is normal (no book
// project anywhere in the ancestor chain) and stays silent. Any other code
// (CONFIG_READ_ERROR, META_READ_ERROR, ...) means a book root WAS found but
// its bible files are corrupt. This hook cannot deny post-hoc (the tool call
// already happened), so it emits one visible additionalContext line naming
// the problem and that progress/log updates were skipped, then still exits 0
// (fail-open).
// ---------------------------------------------------------------------------
let bookRoot = null;
try {
  const found = findBookRoot(cwd);
  bookRoot = found.root;
} catch (err) {
  if (err && err.code && err.code !== 'NO_BOOK_ROOT') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolBatch',
          additionalContext:
            'Book project found, but ' + err.message +
            '; progress and log updates were skipped for this batch.'
        }
      }) + '\n'
    );
  }
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
// Path comparison uses the platform separator so that partial-name collisions
// (e.g. chapters-archive/) are excluded.
//
// F-HK-13: case folding is applied only on win32 (case-insensitive
// filesystem). Folding unconditionally would WIDEN what counts as a chapter
// path on a case-sensitive filesystem (POSIX) - the wrong direction for a
// check that feeds the progress/compliance-log write path.
// ---------------------------------------------------------------------------
function foldForCompare(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

const chaptersDirNorm = foldForCompare(resolve(bookRoot, 'chapters'));
const chaptersDirPrefix = chaptersDirNorm + sep;

function isChapterPath(absPath) {
  const norm = foldForCompare(absPath);
  return norm.startsWith(chaptersDirPrefix);
}

// ---------------------------------------------------------------------------
// Chapter-list registry helpers (TSK-050b create-if-absent).
//
// The registry at structure/chapter-list.md provides ordered slug/title
// mappings used when creating new chapter entries. All three helpers below
// are used only inside the progress-write block (chapterWrites.size > 0).
// ---------------------------------------------------------------------------

/** Parse structure/chapter-list.md into an ordered [{slug, title}] array.
 *  Returns null when the file is absent, unreadable, or has no data rows. */
function loadRegistryOrder(rootDir) {
  try {
    const text = readFileSync(join(rootDir, 'structure', 'chapter-list.md'), 'utf8');
    const rows = [];
    for (const line of text.split('\n')) {
      // Match table data rows: | N | 01-slug-here | Title Here | ... |
      const m = line.match(/^\|\s*\d+\s*\|\s*([0-9]{2}-[a-z0-9-]+)\s*\|\s*([^|]+?)\s*\|/);
      if (m) rows.push({ slug: m[1], title: m[2].trim() });
    }
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

/** Derive a human-readable title from a slug when the registry is absent.
 *  Strips the two-digit ordinal prefix, replaces hyphens with spaces,
 *  and applies title case.
 *  Example: '03-your-curation-practice' -> 'Your Curation Practice'. */
function slugToTitle(slug) {
  return slug
    .replace(/^[0-9]+-/, '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Count open claim markers ([UNVERIFIED] and [SOURCE-UNVERIFIABLE]) in text.
 *  These are the two open forms per docs/formats/claim-markers.md.
 *
 *  Mechanism for open_claim_count maintenance: the schema (progress.schema.json)
 *  defines open_claim_count as a required field on every chapter entry, so
 *  per-entry storage exists. During each recount the count for the recounted
 *  file is stored on its chapter entry. totals.open_claim_count is then derived
 *  as the sum over ALL chapter entries, so entries not touched this batch retain
 *  their stored counts and still contribute correctly to the total. */
function countOpenMarkers(text) {
  return (text.match(/\[UNVERIFIED\]/g) || []).length
    + (text.match(/\[SOURCE-UNVERIFIABLE\]/g) || []).length;
}

/** Insert newEntry into chapters maintaining registry order.
 *  Finds the first existing entry whose registry index exceeds newEntry's and
 *  inserts before it; falls back to appending when no such entry exists or
 *  when registry is null or does not contain the slug. */
function insertAtRegistryPosition(chapters, newEntry, registry) {
  if (!registry) {
    chapters.push(newEntry);
    return;
  }
  const regIdx = registry.findIndex(r => r.slug === newEntry.slug);
  if (regIdx === -1) {
    chapters.push(newEntry);
    return;
  }
  for (let i = 0; i < chapters.length; i++) {
    const existingRegIdx = registry.findIndex(r => r.slug === chapters[i].slug);
    if (existingRegIdx > regIdx) {
      chapters.splice(i, 0, newEntry);
      return;
    }
  }
  chapters.push(newEntry);
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
// Used for per-file dedup: each unique file is recounted exactly once.
const chapterWrites = new Map();
// Array: per-call chapter write descriptors in tool_calls order.
// Kept separate from the Map so that two calls to the same file (e.g. Write
// then Edit) each produce their own ai-use-log record per S-08 section 5
// ("one JSONL line each") while the Map still deduplicates the recount.
const chapterCallLog = [];
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
      chapterCallLog.push({ absPath, scope });
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

// Map: absPath -> { slug, newCount, markerCount, scope, relPath }
const chapterDetails = new Map();

for (const [absPath, { scope }] of chapterWrites.entries()) {
  const fn = basename(absPath);
  const slug = fn.endsWith('.md') ? fn.slice(0, -3) : fn;
  // bible-relative path with forward slashes for platform-neutral log records.
  const relPath = relative(bookRoot, absPath).replace(/\\/g, '/');

  let newCount = 0;
  let markerCount = 0;
  try {
    const text = readFileSync(absPath, 'utf8');
    newCount = countWords(text);
    markerCount = countOpenMarkers(text);
  } catch (err) {
    logError('word count failed for ' + relPath, err);
  }

  chapterDetails.set(absPath, { slug, newCount, markerCount, scope, relPath });
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

    // Load the chapter registry for title resolution and insertion order.
    // Returns null when structure/chapter-list.md is absent or empty.
    const registry = loadRegistryOrder(bookRoot);

    // Record previous word counts before mutation so deltas can be computed.
    for (const { slug } of chapterDetails.values()) {
      const ch = chapters.find(c => c.slug === slug);
      prevCounts.set(slug, ch && typeof ch.word_count === 'number' ? ch.word_count : 0);
    }

    // Mutate existing chapter entries in-place; create new entries when absent
    // (TSK-050b create-if-absent per D-06 single-writer state discipline).
    //
    // open_claim_count mechanism: per-entry storage exists in the schema (required
    // field), so each recounted file's count is written to its entry. The totals
    // recompute below sums ALL entries, so untouched entries retain their stored
    // counts. See countOpenMarkers above for the open-marker definition.
    //
    // Status boundary: status is set ONLY when CREATING a new entry; the hook
    // never transitions an existing status (e.g. drafting -> drafted). Final-pass
    // transitions remain future authorial scope outside this hook.
    for (const { slug, newCount, markerCount } of chapterDetails.values()) {
      const ch = chapters.find(c => c.slug === slug);
      if (ch) {
        // Existing entry: update word_count and open_claim_count from this recount.
        // All other fields including status are untouched (unknown-field round-trip
        // per S-08 Rule 2; status boundary per the comment above).
        ch.word_count = newCount;
        ch.open_claim_count = markerCount;
      } else {
        // Create-if-absent: build a new chapter entry with the required schema
        // fields (slug, status, word_count, open_claim_count) plus title.
        // title: from the registry when the slug is listed, else slug-derived.
        // status: 'drafting' (schema-valid initial for a chapter being written;
        //   note: the controller brief uses the shorthand 'draft' which is not
        //   in the schema enum; 'drafting' is the closest schema-valid value).
        const registryEntry = registry ? registry.find(r => r.slug === slug) : null;
        const title = registryEntry ? registryEntry.title : slugToTitle(slug);
        const newEntry = { slug, title, status: 'drafting', word_count: newCount, open_claim_count: markerCount };
        insertAtRegistryPosition(chapters, newEntry, registry);
      }
    }
    // Ensure progress.chapters always points to the (possibly extended) array.
    progress.chapters = chapters;

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
// Build summaryParts for the additionalContext output line.
// One entry per unique chapter file (chapterDetails is keyed by abs path).
//
// surface is the constant "claude-code" with the following deferred resolution note:
//   surface detection for Cowork is unresolved until SPK-02 (Cowork production probe);
//   richer per-agent write attribution is deferred behind OQ-14 (agent identity in hook
//   events) and the Phase 2 SubagentStop hook.
// ---------------------------------------------------------------------------
for (const { slug, newCount, relPath } of chapterDetails.values()) {
  const prev = prevCounts.get(slug) ?? 0;
  const delta = newCount - prev;
  const deltaStr = delta >= 0 ? '+' + delta : String(delta);
  summaryParts.push(slug + ' ' + newCount + ' words (' + deltaStr + ')');
}

// ---------------------------------------------------------------------------
// Append one ai-use-log record per chapter tool call, in tool_calls order,
// per S-08 section 5 schema exactly.
//
// chapterCallLog preserves the per-call sequence so that two calls targeting
// the same file (e.g. Write then Edit) each produce their own record
// ("generated" then "assisted") rather than a single deduplicated entry.
// The recount/progress update above uses chapterWrites (the Map) and is
// unaffected: each unique file is still recounted exactly once.
// ---------------------------------------------------------------------------
for (const { absPath, scope } of chapterCallLog) {
  const detail = chapterDetails.get(absPath);
  if (!detail) continue;
  const { slug, newCount, relPath } = detail;
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
