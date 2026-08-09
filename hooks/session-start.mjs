// what-it-is:   SessionStart orientation hook; replaces the TSK-030 stub per TSK-031 (session-start hook)
// what-it-does: reads the platform SessionStart event from stdin, locates the book root via
//               findBookRoot (the sole authority), delegates five-element orientation block
//               assembly to hooks/lib/orientation.mjs (TSK-035 extraction), and emits
//               hookSpecificOutput.additionalContext with sessionTitle.
//               When no book root is found (BibleError code NO_BOOK_ROOT) the script emits a
//               two-sentence D-17 (guided front door) empty-state message instead. When a book
//               root IS found but its bible files are corrupt (META_READ_ERROR, CONFIG_READ_ERROR),
//               the script emits a truthful one-line message naming the real problem, mirroring the
//               TSK-034 (stop-gate hook) error-code discrimination pattern. Fail-open: any read or
//               parse error after root detection appends one JSONL record to .studio/logs/errors.jsonl
//               and the script continues with whatever partial block it has assembled. Exits 0
//               unconditionally.
//
// stdin:  platform SessionStart event (snake_case: session_id, transcript_path, cwd,
//         hook_event_name, source) - verified live by TSK-030 (hooks.json Phase 1 wiring)
// stdout: {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<block>",
//          "sessionTitle":"<book title>"}}  (PF-10 verified surface; no sessionTitle on empty-state path)
//
// NS_HOOK_TRACE: when set, appends one trace line (event, own path, raw stdin) to the named file
//                before any other logic; inert when unset (preserved from TSK-030 stub convention)

import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findBookRoot } from './lib/bible.mjs';
import { buildOrientation } from './lib/orientation.mjs';

// ---------------------------------------------------------------------------
// Drain stdin first - the platform delivers event JSON here on every invocation.
// ---------------------------------------------------------------------------
const raw = readFileSync(0, 'utf8');

// ---------------------------------------------------------------------------
// NS_HOOK_TRACE (opt-in firing proof, preserved from TSK-030 stub convention).
// ---------------------------------------------------------------------------
if (process.env.NS_HOOK_TRACE) {
  const ownPath = fileURLToPath(import.meta.url);
  const record = JSON.stringify({ event: 'SessionStart', script: ownPath, stdinRaw: raw.trim() });
  appendFileSync(process.env.NS_HOOK_TRACE, record + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Parse stdin - snake_case per the TSK-030 resolved field names.
// Tolerate missing or malformed JSON (fail-open: treat as empty event).
// ---------------------------------------------------------------------------
let event = {};
try {
  event = JSON.parse(raw);
} catch {
  // Malformed stdin: proceed with empty event; cwd falls back to process.cwd().
}

// cwd field drives book detection; fall back to process.cwd() when absent.
const cwd = (typeof event.cwd === 'string' && event.cwd) ? event.cwd : process.cwd();

// ---------------------------------------------------------------------------
// Book detection - findBookRoot is the sole authority per TSK-031 controller resolution 3.
// Null root (thrown) means either no book root anywhere in the ancestor chain, or a book
// root was found but its bible files are corrupt. The two are distinguished by BibleError
// code, mirroring the TSK-034 (stop-gate hook) error-code discrimination pattern.
// ---------------------------------------------------------------------------
let bookRoot = null;
let meta = null;
let bibleError = null;
try {
  const found = findBookRoot(cwd);
  bookRoot = found.root;
  meta = found.meta;
} catch (err) {
  bibleError = err;
}

if (!bookRoot) {
  // Error discrimination: BibleError code NO_BOOK_ROOT is normal (no book root
  // anywhere in the ancestor chain); it takes the D-17 empty-state path below.
  // Any other BibleError (META_READ_ERROR, CONFIG_READ_ERROR) means a book root
  // was found but its bible files are corrupt. Emit a truthful one-line message
  // naming the real problem instead of the misleading "no book project" text.
  if (bibleError && bibleError.code && bibleError.code !== 'NO_BOOK_ROOT') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'Book project found, but ' + bibleError.message
        }
      }) + '\n'
    );
    process.exit(0);
  }

  // D-17 (guided front door): exactly two sentences.
  // Sentence 1: states no book project exists here.
  // Sentence 2: names the studio front door by invocation form (D-17), which
  // runs the init-project flow; the test pins two sentences and 'init-project'.
  const emptyMsg =
    'No book project was found in this directory. ' +
    'To start one, invoke the studio front door with /nonfiction-studio:studio, which runs the init-project flow for you.';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: emptyMsg
      }
    }) + '\n'
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Delegate orientation block assembly to the shared builder (TSK-035 extraction).
// All five elements are assembled there with the same fail-open behavior and
// errors.jsonl logging seam; passing 'SessionStart' as hookName preserves the
// error-record hook field that session-start tests assert.
// ---------------------------------------------------------------------------
const { block, bookTitle } = buildOrientation(bookRoot, meta, 'SessionStart');

// ---------------------------------------------------------------------------
// Compose and emit output JSON (PF-10 verified surface: additionalContext + sessionTitle).
// Nothing else may appear on stdout.
// ---------------------------------------------------------------------------
const output = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: block
  }
};

// sessionTitle from meta.json book_title field (fail-open: omit when unreadable or absent).
if (bookTitle !== null) {
  output.hookSpecificOutput.sessionTitle = bookTitle;
}

process.stdout.write(JSON.stringify(output) + '\n');
process.exit(0);
