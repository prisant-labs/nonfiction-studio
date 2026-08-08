// tests/hooks/stop-to-session-integration.test.mjs
// what-it-is:   producer/consumer integration test for F-HK-02 (gate-debt shape)
// what-it-does: spawns the REAL hooks/stop-gate.mjs against a temp clone of
//               examples/sample-book to produce a REAL last-gate.json (never
//               hand-authored), then spawns the REAL hooks/session-start.mjs
//               against the same clone and asserts the gate-debt line tracks
//               the genuine report: absent right after a passing gate run,
//               present once a chapter file is edited after that run.
// why:          hooks/lib/orientation.mjs used to iterate Object.values() of
//               last-gate.json looking for an entry.ts, but the real file is a
//               FLAT object ({version, chapter, ts, verdict, checks}) written
//               verbatim by hooks/stop-gate.mjs from the ns-gate report, so
//               gateTsMs was always 0 and the gate-debt line fired forever.
//               A hand-authored fixture can accidentally paper over a shape
//               bug (see the flattened cases in session-start.test.mjs); this
//               test consumes only real producer output, never hand-authored
//               JSON - that is the point.
// runner:       node --test "tests/hooks/*.test.mjs"
//
// Envelope shapes copied from the existing suites:
//   Stop event: tests/hooks/stop-gate.test.mjs makeStopEvent
//   SessionStart event: tests/hooks/session-start.test.mjs makeEvent
//
// Never mutates committed fixtures. A fresh temp clone is used throughout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  cpSync,
  renameSync,
  utimesSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const STOP_GATE_SCRIPT = join(REPO_ROOT, 'hooks', 'stop-gate.mjs');
const SESSION_START_SCRIPT = join(REPO_ROOT, 'hooks', 'session-start.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Helpers (copied/adapted from stop-gate.test.mjs and session-start.test.mjs
// so this file stays self-contained, matching the existing tests/hooks/ convention).
// ---------------------------------------------------------------------------

function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-w2-int-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

/** Write the session-write flag atomically, as pre-tool-use.mjs would for a chapter write. */
function setFlag(bookDir) {
  const gateDir = join(bookDir, '.studio', 'gate');
  mkdirSync(gateDir, { recursive: true });
  const tmp = join(gateDir, '.session-write-flag.tmp');
  writeFileSync(tmp, new Date().toISOString() + '\n', 'utf8');
  renameSync(tmp, join(gateDir, '.session-write-flag'));
}

/** Build a real Stop event (snake_case shape copied from stop-gate.test.mjs). */
function makeStopEvent(cwd, extras = {}) {
  return JSON.stringify({
    session_id: 'test-session-w2-int',
    transcript_path: '/tmp/t.jsonl',
    cwd,
    prompt_id: 'p-w2-int',
    permission_mode: 'default',
    effort: { level: 'medium' },
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'test',
    background_tasks: [],
    session_crons: [],
    ...extras
  });
}

/** Build a real SessionStart event (snake_case shape copied from session-start.test.mjs). */
function makeSessionStartEvent(cwd) {
  return JSON.stringify({
    session_id: 'test-session-w2-int-ss',
    transcript_path: '/tmp/transcript.jsonl',
    cwd,
    hook_event_name: 'SessionStart',
    source: 'startup'
  });
}

/** Spawn a hook script with the given stdin. NS_HOOK_TRACE cleared by default. */
function runScript(scriptPath, input, extraEnv = {}) {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined || v === '') {
      delete env[k];
    } else {
      env[k] = String(v);
    }
  }
  return spawnSync('node', [scriptPath], { input, encoding: 'utf8', env });
}

/** Set the mtime of every chapters/*.md file in the clone to a fixed instant.
 *  Used to pin the gate-debt comparison deterministically (no wall-clock races
 *  against the real gate's ts, which is second-precision UTC "now"). */
function setAllChapterMtimes(bookDir, when) {
  const chaptersDir = join(bookDir, 'chapters');
  for (const f of readdirSync(chaptersDir).filter(n => n.endsWith('.md'))) {
    utimesSync(join(chaptersDir, f), when, when);
  }
}

// ---------------------------------------------------------------------------
// F-HK-02: real producer (stop-gate) -> real consumer (session-start)
// ---------------------------------------------------------------------------
test('F-HK-02 real stop-gate output -> session-start gate-debt tracks it: absent fresh, present once stale', () => {
  const book = cloneSampleBook('flow');

  // Pin all chapter mtimes safely in the past so the gate run below is
  // unambiguously "fresher" than every chapter, regardless of clone timing.
  setAllChapterMtimes(book, new Date('2020-01-01T00:00:00Z'));

  setFlag(book);

  // --- Phase 1: run the REAL stop-gate hook; it spawns bin/ns-gate for real
  // and writes a REAL .studio/gate/last-gate.json (flat shape, verbatim
  // ns-gate stdout). Nothing here is hand-authored.
  const stopResult = runScript(STOP_GATE_SCRIPT, makeStopEvent(book));
  assert.equal(stopResult.status, 0, 'stop-gate hook exits 0');
  assert.equal(
    stopResult.stdout.trim(), '',
    'golden clone gate run is a silent pass (same as stop-gate.test.mjs case c); got stdout: ' + stopResult.stdout
  );

  // --- Phase 2: run the REAL session-start hook against the same clone.
  // The gate that just ran is newer than every chapter, so NO gate-debt line
  // should appear. Under the F-HK-02 bug (nested-shape read on a flat file),
  // gateTsMs is always 0, so this assertion fails (RED) before the fix.
  const freshResult = runScript(SESSION_START_SCRIPT, makeSessionStartEvent(book));
  assert.equal(freshResult.status, 0, 'session-start exits 0');

  let freshOut;
  assert.doesNotThrow(
    () => { freshOut = JSON.parse(freshResult.stdout.trim()); },
    'session-start stdout parses as JSON'
  );
  const freshCtx = freshOut.hookSpecificOutput.additionalContext;
  assert.ok(
    !freshCtx.includes('Gate debt'),
    'no gate-debt line right after a fresh, real, passing gate run; got: ' + freshCtx
  );

  // --- Phase 3: make the report stale by editing a chapter after the gate ran
  // (brief's first stale option: chapter mtime newer than the report ts).
  // A fixed far-future date keeps this deterministic against the real "now" ts.
  setAllChapterMtimes(book, new Date('2099-01-01T00:00:00Z'));

  const staleResult = runScript(SESSION_START_SCRIPT, makeSessionStartEvent(book));
  assert.equal(staleResult.status, 0, 'session-start exits 0 on the stale re-check');

  let staleOut;
  assert.doesNotThrow(
    () => { staleOut = JSON.parse(staleResult.stdout.trim()); },
    'session-start stdout parses as JSON on the stale re-check'
  );
  const staleCtx = staleOut.hookSpecificOutput.additionalContext;
  assert.ok(
    staleCtx.includes('Gate debt'),
    'gate-debt line appears once a chapter is edited after the recorded gate run; got: ' + staleCtx
  );
});
