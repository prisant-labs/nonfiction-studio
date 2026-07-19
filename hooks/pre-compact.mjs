// what-it-is:   PreCompact orientation re-injection hook; replaces the TSK-030 stub per TSK-035
// what-it-does: reads the platform PreCompact event from stdin, locates the book root, applies
//               the stricter no-op (no book root OR no active chapter resolvable), then delegates
//               the same five-element orientation block assembly used by session-start.mjs to
//               hooks/lib/orientation.mjs and emits the block as additionalContext so the
//               compacted context retains the studio state snapshot.
//
// stdin:  expected: common snake_case envelope (session_id, transcript_path, cwd, hook_event_name)
//         plus possible compaction metadata; UNOBSERVED live (PreCompact did not fire in the
//         TSK-030 probe), so parse defensively with fallbacks. Malformed stdin exits 0 silently.
// stdout: {"hookSpecificOutput":{"hookEventName":"PreCompact","additionalContext":"<block>"}}
//         on the active path; EMPTY stdout on every no-op path.
//         NO sessionTitle field - that field is SessionStart-only per PF-10.
//
// No-op conditions (stricter than SessionStart; asymmetry noted):
//   - No book root found: empty stdout, exit 0.
//   - No active chapter resolvable from .studio/progress.json: empty stdout, exit 0.
//     Rationale: a compaction with no active chapter has no studio state worth re-injecting;
//     SessionStart emits a guided message instead of going silent in the no-root case.
//   - Malformed stdin: empty stdout, exit 0 (unlike SessionStart which continues with fallbacks).
//
// Fail-open: any read or parse error after root and chapter detection is handled inside
//            buildOrientation; this script never exits non-zero.
//
// NS_HOOK_TRACE: when set, appends one trace line (event, own path, raw stdin) to the named file
//                before any other logic; inert when unset (preserved from TSK-030 stub convention)

import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findBookRoot } from './lib/bible.mjs';
import { buildOrientation } from './lib/orientation.mjs';

// ---------------------------------------------------------------------------
// Drain stdin - the platform delivers event JSON here on every hook invocation.
// ---------------------------------------------------------------------------
const raw = readFileSync(0, 'utf8');

// ---------------------------------------------------------------------------
// NS_HOOK_TRACE (opt-in firing proof, preserved from TSK-030 stub convention).
// Inert when unset.
// ---------------------------------------------------------------------------
if (process.env.NS_HOOK_TRACE) {
  const ownPath = fileURLToPath(import.meta.url);
  const record = JSON.stringify({ event: 'PreCompact', script: ownPath, stdinRaw: raw.trim() });
  appendFileSync(process.env.NS_HOOK_TRACE, record + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Parse stdin. Malformed JSON: empty-stdout no-op (stricter than SessionStart, which
// continues with process.cwd() fallback; PreCompact has no guided front-door message).
// ---------------------------------------------------------------------------
let event = {};
try {
  event = JSON.parse(raw);
} catch {
  // Malformed stdin: exit 0, empty stdout.
  process.exit(0);
}

// cwd field with process.cwd() fallback per TSK-035 controller resolution 3.
const cwd = (typeof event.cwd === 'string' && event.cwd) ? event.cwd : process.cwd();

// ---------------------------------------------------------------------------
// Book detection - findBookRoot is the sole authority.
// No book root: empty stdout, exit 0 (no guided message; see no-op conditions comment above).
// ---------------------------------------------------------------------------
let bookRoot = null;
let meta = null;
try {
  const found = findBookRoot(cwd);
  bookRoot = found.root;
  meta = found.meta;
} catch {
  // No book root (or corrupt config): exit 0, empty stdout.
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Delegate orientation block assembly to the shared builder.
// buildOrientation returns hasActiveChapter alongside the block so the
// stricter no-op check (pre-compact only) does not duplicate the active-chapter
// resolution logic. Asymmetry with SessionStart: SessionStart always emits a block
// when a book root is found; PreCompact additionally requires a resolvable active
// chapter (compaction with no active chapter has no studio state worth re-injecting).
// ---------------------------------------------------------------------------
const { block, hasActiveChapter } = buildOrientation(bookRoot, meta, 'PreCompact');

if (!hasActiveChapter) {
  // Empty stdout no-op: no studio state to re-inject.
  // (Asymmetry with SessionStart noted: session-start emits a guided front-door
  //  message in its no-root case; pre-compact is silent on both no-op paths.)
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Emit output JSON. NO sessionTitle - that field is SessionStart-only per PF-10.
// Empty stdout only on no-op paths above; the active path always emits here.
// ---------------------------------------------------------------------------
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      additionalContext: block
    }
  }) + '\n'
);
process.exit(0);
