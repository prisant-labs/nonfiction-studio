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
// guard note:   the clone's committed last-gate.json
//               (examples/sample-book/.studio/gate/last-gate.json) is itself a
//               genuine flat-shape report, so its ts could satisfy the
//               fresh/stale assertions below even if stop-gate.mjs silently
//               stopped writing the file. The test deletes that file before
//               running stop-gate.mjs and asserts the written report's ts is
//               recent (produced this run), so the pass condition can only be
//               satisfied by a real write happening during this test.
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
  readFileSync,
  readdirSync,
  cpSync,
  renameSync,
  unlinkSync,
  existsSync,
  utimesSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { writeSyntheticV5Baseline } from '../lib/synthetic-v5-baseline.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const STOP_GATE_SCRIPT = join(REPO_ROOT, 'hooks', 'stop-gate.mjs');
const SESSION_START_SCRIPT = join(REPO_ROOT, 'hooks', 'session-start.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Helpers (copied/adapted from stop-gate.test.mjs and session-start.test.mjs
// so this file stays self-contained, matching the existing tests/hooks/ convention).
// ---------------------------------------------------------------------------

// examples/sample-book/.studio/config.json now carries a full marker_set_version 5 stylometry
// baseline with a calibration ladder (recaptured in Task 5, ADR-0012 implementation wave); when
// this helper was first written it still carried marker_set_version 4 with no calibration
// ladder, so scoring against it with the v5 computeDrift threw StaleBaselineError, which --
// through the gate's existing, unchanged engine-error handling -- forced the whole gate run's
// exit code to 2. That specific failure mode no longer applies, but this test file's own subject
// is still the Stop-to-SessionStart integration plumbing, not stylometry, so the clone is
// patched with a synthetic, self-consistent v5 baseline by default regardless: it guarantees
// z = 0 on unchanged content, for deterministic isolation independent of whatever margin the
// real captured baseline's calibration ladder carries. Mirrors tests/engines/gate.test.mjs's and
// tests/hooks/stop-gate.test.mjs's own patch (ratified deviation outside Task 4's nominal file
// list; see this implementation wave's own Task 4 review record for "Concerns for the
// coordinator").
function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-w2-int-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  writeSyntheticV5Baseline(dir);
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

  // --- Phase 0: delete the clone's committed last-gate.json before running
  // the real gate. examples/sample-book/.studio/gate/last-gate.json is itself
  // a genuine flat-shape report (repaired by the F-HK-02 fix) whose ts falls
  // between the pinned 2020/2099 mtimes used below; left in place, the
  // fresh/stale assertions could pass even if Phase 1 never ran stop-gate.mjs
  // at all. Deleting it first means ONLY a genuine write by the real
  // stop-gate.mjs can produce a file for session-start.mjs to read.
  const lastGatePath = join(book, '.studio', 'gate', 'last-gate.json');
  if (existsSync(lastGatePath)) unlinkSync(lastGatePath);

  // --- Phase 1: run the REAL stop-gate hook; it spawns bin/ns-gate for real
  // and writes a REAL .studio/gate/last-gate.json (flat shape, verbatim
  // ns-gate stdout). Nothing here is hand-authored.
  const stopResult = runScript(STOP_GATE_SCRIPT, makeStopEvent(book));
  assert.equal(stopResult.status, 0, 'stop-gate hook exits 0');
  assert.equal(
    stopResult.stdout.trim(), '',
    'golden clone gate run is a silent pass (same as stop-gate.test.mjs case c); got stdout: ' + stopResult.stdout
  );

  // --- Phase 1b: prove the write was genuine. last-gate.json was deleted
  // above, so its mere existence now proves stop-gate.mjs wrote it; the ts
  // recency check additionally rules out any stale/leftover value (a
  // regression where stop-gate silently stopped writing last-gate.json would
  // fail the existsSync assertion right here instead of slipping through to
  // Phase 2).
  assert.ok(existsSync(lastGatePath), 'stop-gate wrote a real last-gate.json (it was deleted before Phase 1)');
  const writtenReport = JSON.parse(readFileSync(lastGatePath, 'utf8'));
  assert.ok(typeof writtenReport.ts === 'string', 'written report has a ts field');
  const writtenTsMs = Date.parse(writtenReport.ts);
  assert.ok(Number.isFinite(writtenTsMs), 'written report ts parses as a valid date');
  const reportAgeMs = Date.now() - writtenTsMs;
  assert.ok(
    reportAgeMs >= -5000 && reportAgeMs < 5 * 60 * 1000,
    'written report ts is recent (produced by this run), not a stale or committed value; age_ms=' + reportAgeMs
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
