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
//               Wave 1 exit Task 4 (zero-friction first session) adds two fields, both nested
//               under hookSpecificOutput per the platform probe's verified placement (a
//               top-level placement is silently ignored): on the empty-state path, when the
//               directory is truly empty (no entries beyond EMPTY_DIR_ALLOWLIST),
//               initialUserMessage opens the studio dispatcher unprompted; on the normal-book
//               path, reloadSkills is true exactly when the nfs-new-book-generated
//               .claude/skills/book-context/SKILL.md exists.
//
// stdin:  platform SessionStart event (snake_case: session_id, transcript_path, cwd,
//         hook_event_name, source) - verified live by TSK-030 (hooks.json Phase 1 wiring)
// stdout: {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<block>",
//          "sessionTitle":"<book title>","reloadSkills":true}}  (PF-10 verified surface; no
//          sessionTitle on the empty-state or corrupt-bible paths; reloadSkills only on the
//          normal-book path when the book-context skill exists)
//         empty-state path: {"hookSpecificOutput":{"hookEventName":"SessionStart",
//          "additionalContext":"<two sentences>","initialUserMessage":"/nonfiction-studio:nfs-start"}}
//          (initialUserMessage only when the directory is truly empty)
//
// NS_HOOK_TRACE: when set, appends one trace line (event, own path, raw stdin) to the named file
//                before any other logic; inert when unset (preserved from TSK-030 stub convention)

import { readFileSync, appendFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBookRoot } from './lib/bible.mjs';
import { buildOrientation } from './lib/orientation.mjs';
import { loadSettings } from './lib/settings.mjs';

// Wave 1 exit Task 4 (zero-friction first session): entries tolerated in an otherwise-empty
// directory before the initialUserMessage front-door nudge is withheld. NO_BOOK_ROOT alone is
// not sufficient to open the studio dispatcher unprompted - it fires in every non-book
// directory, including an unrelated repo with the plugin installed at user scope, and
// hijacking the first turn there would be a regression. This allowlist is the platform-probe
// task's pinned entry set: anything else present means this is somebody's real (non-book)
// directory, not a fresh empty one.
const EMPTY_DIR_ALLOWLIST = new Set(['.claude', '.git', '.gitignore', '.DS_Store', 'Thumbs.db']);

/**
 * True when dir contains no entries beyond EMPTY_DIR_ALLOWLIST. Throws on an unreadable dir;
 * the call site treats that as fail-open (default to "not empty" - the safer, non-hijacking
 * choice when the directory's contents cannot be determined).
 */
function isTrulyEmptyDir(dir) {
  return readdirSync(dir).every((entry) => EMPTY_DIR_ALLOWLIST.has(entry));
}

// House-notes pointer line (Wave 1 exit Task 2): emitted after the five-element orientation
// block, exactly once, only when the resolved settings file carries a non-empty Markdown body.
// loadSettings never throws (fail-open by construction), but the call is still wrapped below so
// an unforeseen error here can never suppress the orientation block itself.
const HOUSE_NOTES_LINE =
  'House notes: .claude/nonfiction-studio.local.md carries standing author instructions; ' +
  'read and honor them.';

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
  // runs the nfs-new-book flow; the test pins two sentences and 'nfs-new-book'.
  const emptyMsg =
    'No book project was found in this directory. ' +
    'To start one, invoke the studio front door with /nonfiction-studio:nfs-start, which runs the nfs-new-book flow for you.';

  const emptyOutput = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: emptyMsg
    }
  };

  // Wave 1 exit Task 4 (zero-friction first session): a truly empty directory (no entries
  // beyond EMPTY_DIR_ALLOWLIST) gets the studio dispatcher opened for it unprompted, via
  // initialUserMessage nested under hookSpecificOutput per the platform probe's verified
  // placement - the platform silently ignores a top-level initialUserMessage. The probe
  // confirmed this becomes a genuine first user turn in headless mode. Fail-open: an
  // unreadable cwd defaults to "not empty" (no hijack of the first turn) and never suppresses
  // the two-sentence additionalContext already built above.
  try {
    if (isTrulyEmptyDir(cwd)) {
      emptyOutput.hookSpecificOutput.initialUserMessage = '/nonfiction-studio:nfs-start';
    }
  } catch {
    // Unreadable cwd: leave initialUserMessage unset.
  }

  process.stdout.write(JSON.stringify(emptyOutput) + '\n');
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
// House-notes pointer line (Wave 1 exit Task 2): appended after the five-element block, only
// when the resolved settings file's Markdown body is non-empty. Fail-open: any error here is
// logged and swallowed so it can never suppress the orientation block already assembled above.
// ---------------------------------------------------------------------------
let finalBlock = block;
try {
  const { body } = loadSettings(bookRoot);
  if (body && body.trim().length > 0) {
    finalBlock = block ? block + '\n' + HOUSE_NOTES_LINE : HOUSE_NOTES_LINE;
  }
} catch (err) {
  try {
    const logsDir = join(bookRoot, '.studio', 'logs');
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(
      join(logsDir, 'errors.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hook: 'SessionStart',
        msg: 'house-notes settings read failed',
        err: String(err)
      }) + '\n',
      'utf8'
    );
  } catch {
    // Cannot write the error log; nothing further to do.
  }
}

// ---------------------------------------------------------------------------
// Compose and emit output JSON (PF-10 verified surface: additionalContext + sessionTitle).
// Nothing else may appear on stdout.
// ---------------------------------------------------------------------------
const output = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: finalBlock
  }
};

// sessionTitle from meta.json book_title field (fail-open: omit when unreadable or absent).
if (bookTitle !== null) {
  output.hookSpecificOutput.sessionTitle = bookTitle;
}

// Wave 1 exit Task 4 (zero-friction first session): reloadSkills is emitted exactly when the
// nfs-new-book-generated book-context skill exists under the project root, nested under
// hookSpecificOutput per the platform probe's verified placement. The probe also found
// reloadSkills does NOT grant same-session liveness for a skill file written mid-session -
// it only affects the scan the platform performs at the moment THIS SessionStart hook runs -
// so this only ever helps a skill that was already on disk before this session started.
// Fail-open: any error checking existence (for example .claude/skills existing as a file
// rather than a directory) defaults to false and never suppresses the orientation block
// already assembled above.
try {
  const bookContextSkillPath = join(bookRoot, '.claude', 'skills', 'book-context', 'SKILL.md');
  if (statSync(bookContextSkillPath).isFile()) {
    output.hookSpecificOutput.reloadSkills = true;
  }
} catch {
  // Absent (the common case - no book-context skill generated yet) or unreadable: leave
  // reloadSkills unset.
}

process.stdout.write(JSON.stringify(output) + '\n');
process.exit(0);
