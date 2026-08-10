// tests/hooks/stop-gate.test.mjs
// what-it-is:   behaviour tests for hooks/stop-gate.mjs (TSK-034)
// what-it-does: spawns the real script with crafted snake_case Stop events against temp clones
//               of the sample-book and broken fixtures, covering eleven cases; never mutates
//               committed fixtures
// runner:       node --test "tests/hooks/*.test.mjs"
//
// Cases:
//   (a) stop_hook_active true + flag present: exit 0, empty stdout, gate not run, flag not consumed
//   (b) flag absent: exit 0, empty stdout, no last-gate.json change
//   (c) golden clone + flag: pass path, empty stdout, last-gate.json byte-identical to newest
//       timestamped report, flag consumed
//   (d) block-mode ai-injection clone + flag: block decision JSON, hook exit 0, last-gate
//       written, flag consumed
//   (e) warn-mode ai-injection clone (default config) + flag: additionalContext warn summary
//   (f) corrupt-config clone + flag: one errors.jsonl line, one-line additionalContext, exit 0
//   (g) second event with stop_hook_active true after (c)-style run: last-gate.json unchanged
//   (h) no book root: exit 0, empty stdout
//   (i) malformed stdin: exit 0, empty stdout
//   (j) NS_HOOK_TRACE inert when unset; one line appended when set
//   (k) syntactically invalid config.json + flag: exit 0, additionalContext starts with
//       "Gate skipped:", no new report file in .studio/gate/, flag NOT consumed
//
// Synthetic events copy the snake_case shape captured live in the TSK-030 report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  cpSync,
  unlinkSync,
  readdirSync,
  renameSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'hooks', 'stop-gate.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');
const AI_INJECTION = join(REPO_ROOT, 'examples', 'fixtures', 'ai-injection');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-tsk034-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

function cloneFixture(fixturePath, label) {
  const dir = join(tmpdir(), 'ns-tsk034-' + label + '-' + Date.now());
  cpSync(fixturePath, dir, { recursive: true });
  return dir;
}

/** Write the session-write flag atomically to <bookDir>/.studio/gate/.session-write-flag */
function setFlag(bookDir) {
  const gateDir = join(bookDir, '.studio', 'gate');
  mkdirSync(gateDir, { recursive: true });
  const tmp = join(gateDir, '.session-write-flag.tmp');
  writeFileSync(tmp, new Date().toISOString() + '\n', 'utf8');
  renameSync(tmp, join(gateDir, '.session-write-flag'));
}

/** Build a synthetic Stop event (snake_case shape per TSK-030 firing proof). */
function makeStopEvent(cwd, extras = {}) {
  return JSON.stringify({
    session_id: 'test-session-034',
    transcript_path: '/tmp/t.jsonl',
    cwd,
    prompt_id: 'p-034',
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

/** Spawn the hook with the given stdin string. NS_HOOK_TRACE is cleared by default. */
function runHook(input, extraEnv = {}) {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined || v === '') {
      delete env[k];
    } else {
      env[k] = String(v);
    }
  }
  return spawnSync('node', [SCRIPT], { input, encoding: 'utf8', env });
}

/** Returns all non-hidden .json files in .studio/gate/ excluding last-gate.json */
function listGateReports(bookDir) {
  const gateDir = join(bookDir, '.studio', 'gate');
  if (!existsSync(gateDir)) return [];
  return readdirSync(gateDir).filter(
    f => f.endsWith('.json') && !f.startsWith('.') && f !== 'last-gate.json'
  );
}

/** Returns the content of the newest timestamped gate report in .studio/gate/, or null. */
function readNewestGateReport(bookDir) {
  const files = listGateReports(bookDir).sort();
  if (files.length === 0) return null;
  const newest = files[files.length - 1];
  return readFileSync(join(bookDir, '.studio', 'gate', newest), 'utf8');
}

/** Read JSONL lines from a file, filtering blank lines. Returns empty array if file absent. */
function readJsonlLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
}

/**
 * Overlay a block-mode gate config onto a cloned fixture.
 * Sets gate.mode=block and all four deterministic checks to mode=block,
 * preserving the source config's thresholds and baseline (mirrors the gate.test.mjs pattern).
 */
function writeBlockConfig(dir) {
  const configPath = join(dir, '.studio', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.gate = config.gate || {};
  config.gate.mode = 'block';
  config.gate.checks = config.gate.checks || {};
  for (const check of ['claim_coverage', 'prompt_scrub', 'stylometry', 'continuity']) {
    config.gate.checks[check] = Object.assign(
      {}, config.gate.checks[check] || {}, { enabled: true, mode: 'block' }
    );
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// (a) stop_hook_active true + flag present: exit 0, empty stdout, gate not run, flag not consumed
// ---------------------------------------------------------------------------
test('(a) stop_hook_active true: exit 0, empty stdout, gate not run, flag not consumed', () => {
  const book = cloneSampleBook('a');
  setFlag(book);

  const gateDir = join(book, '.studio', 'gate');
  const flagPath = join(gateDir, '.session-write-flag');
  const reportsBefore = listGateReports(book).length;

  const result = runHook(makeStopEvent(book, { stop_hook_active: true }));

  assert.strictEqual(result.status, 0, 'exit 0');
  assert.strictEqual(result.stdout.trim(), '', 'empty stdout');

  // Gate was NOT run: no new timestamped report files
  const reportsAfter = listGateReports(book).length;
  assert.strictEqual(reportsAfter, reportsBefore, 'gate not run: no new timestamped reports');

  // Flag NOT consumed: still present
  assert.ok(existsSync(flagPath), 'session-write flag still present (not consumed on re-fire)');
});

// ---------------------------------------------------------------------------
// (b) flag absent: exit 0, empty stdout, last-gate.json unchanged
// ---------------------------------------------------------------------------
test('(b) flag absent: exit 0, empty stdout, last-gate.json unchanged', () => {
  const book = cloneSampleBook('b');

  // Ensure the flag is absent
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');
  if (existsSync(flagPath)) unlinkSync(flagPath);

  // Snapshot last-gate.json content before the run
  const lastGatePath = join(book, '.studio', 'gate', 'last-gate.json');
  const lastGateBefore = existsSync(lastGatePath) ? readFileSync(lastGatePath, 'utf8') : null;
  const reportsBefore = listGateReports(book).length;

  const result = runHook(makeStopEvent(book));

  assert.strictEqual(result.status, 0, 'exit 0');
  assert.strictEqual(result.stdout.trim(), '', 'empty stdout');

  // No new timestamped reports created
  assert.strictEqual(listGateReports(book).length, reportsBefore, 'gate not run: no new timestamped reports');

  // last-gate.json unchanged
  const lastGateAfter = existsSync(lastGatePath) ? readFileSync(lastGatePath, 'utf8') : null;
  assert.deepStrictEqual(lastGateAfter, lastGateBefore, 'last-gate.json unchanged when flag absent');
});

// ---------------------------------------------------------------------------
// (c) golden clone + flag: pass path, empty stdout, last-gate byte-identical, flag consumed
// ---------------------------------------------------------------------------
test('(c) golden clone + flag: gate runs, empty stdout (pass), last-gate byte-identical to newest report, flag consumed', () => {
  const book = cloneSampleBook('c');
  setFlag(book);

  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');

  const result = runHook(makeStopEvent(book));

  assert.strictEqual(result.status, 0, 'hook exit 0');
  assert.strictEqual(result.stdout.trim(), '', 'pass path: empty stdout');
  // The key invariant is last-gate.json being byte-identical to the newest timestamped report.

  // last-gate.json must have been written
  const lastGatePath = join(book, '.studio', 'gate', 'last-gate.json');
  assert.ok(existsSync(lastGatePath), 'last-gate.json written after gate run');

  // The newest timestamped gate report must exist and be byte-identical to last-gate.json
  const newestContent = readNewestGateReport(book);
  assert.ok(newestContent !== null, 'at least one timestamped gate report written by ns-gate');

  const lastGateContent = readFileSync(lastGatePath, 'utf8');
  assert.strictEqual(
    lastGateContent,
    newestContent,
    'last-gate.json is byte-identical to the newest timestamped gate report'
  );

  // Flag consumed
  assert.ok(!existsSync(flagPath), 'session-write flag consumed after gate run');

  // Also verify last-gate.json is valid JSON with expected fields
  const report = JSON.parse(lastGateContent);
  assert.ok(typeof report.ts === 'string', 'last-gate.json has ts field');
  assert.ok(typeof report.verdict === 'string', 'last-gate.json has verdict field');
  assert.ok(Array.isArray(report.checks), 'last-gate.json has checks array');
});

// ---------------------------------------------------------------------------
// (c2) The Stop hook's --check list must match hooks/lib/gate-engine.mjs's own
// CHECK_REGISTRY (roadmap row 1.5, quote fidelity and source packets), not a second,
// independently-hardcoded list. Before this fix, stop-gate.mjs:169 hardcoded
// "claims,stylometry,scrub,continuity-quick,coherence" and omitted "quotes", so the
// quote_fidelity check registered in CHECK_REGISTRY never appeared in a Stop-hook-driven
// gate report even though `bin/ns-gate` (invoked directly, with no --check flag) always
// included it. Asserted against the real hook and the real gate-engine registry, not a
// mock: this fails RED if either list is ever hand-edited out of sync with the other again.
// ---------------------------------------------------------------------------
test('(c2) Stop-hook-driven gate report includes quote_fidelity (the Stop hook derives its check list from gate-engine.mjs, not a second hardcoded list)', async () => {
  const book = cloneSampleBook('c2-quote-fidelity');
  setFlag(book);

  const result = runHook(makeStopEvent(book));
  assert.strictEqual(result.status, 0, 'hook exit 0');

  const lastGatePath = join(book, '.studio', 'gate', 'last-gate.json');
  assert.ok(existsSync(lastGatePath), 'last-gate.json written after gate run');
  const report = JSON.parse(readFileSync(lastGatePath, 'utf8'));

  const checkNames = report.checks.map((c) => c.check);
  assert.ok(
    checkNames.includes('quote_fidelity'),
    'Stop-hook-driven report checks include quote_fidelity; got: ' + checkNames.join(', ')
  );

  // Cross-check against the gate engine's own registry rather than a second hand
  // written list, so this test cannot itself drift the way the hook did.
  const { ALL_FLAGS } = await import('../../hooks/lib/gate-engine.mjs');
  const { CHECK_REGISTRY } = await import('../../hooks/lib/gate-engine.mjs');
  const expectedReportNames = CHECK_REGISTRY
    .filter((r) => ALL_FLAGS.includes(r.flag))
    .map((r) => r.reportName)
    .concat('session_write_flag');
  for (const name of expectedReportNames) {
    assert.ok(checkNames.includes(name), 'report is missing check "' + name + '" that gate-engine.mjs registers; got: ' + checkNames.join(', '));
  }
});

// ---------------------------------------------------------------------------
// (d) block-mode ai-injection clone + flag: block decision JSON, exit 0, last-gate written, flag consumed
// ---------------------------------------------------------------------------
test('(d) block-mode ai-injection + flag: block decision JSON, exit 0, last-gate written, flag consumed', () => {
  const book = cloneFixture(AI_INJECTION, 'd');
  writeBlockConfig(book);
  setFlag(book);

  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');

  const result = runHook(makeStopEvent(book));

  assert.strictEqual(result.status, 0, 'hook always exits 0 (blocking via JSON, not exit code)');

  // Stdout must be a valid JSON block decision
  let out;
  try {
    out = JSON.parse(result.stdout.trim());
  } catch {
    assert.fail('stdout is not valid JSON: ' + result.stdout);
  }

  const hookOut = out.hookSpecificOutput;
  assert.ok(hookOut, 'hookSpecificOutput present');
  assert.strictEqual(hookOut.hookEventName, 'Stop', 'hookEventName is Stop');
  assert.strictEqual(hookOut.decision, 'block', 'decision is block');
  assert.ok(typeof hookOut.reason === 'string' && hookOut.reason.length > 0, 'reason is a non-empty string');

  // The blocking check (prompt_scrub has an injection finding in the ai-injection fixture)
  assert.ok(
    hookOut.reason.includes('prompt_scrub'),
    'reason includes the blocking check name "prompt_scrub"; got: ' + hookOut.reason
  );

  // last-gate.json written on block path
  const lastGatePath = join(book, '.studio', 'gate', 'last-gate.json');
  assert.ok(existsSync(lastGatePath), 'last-gate.json written on block path');

  // last-gate.json is byte-identical to the newest timestamped report
  const newestContent = readNewestGateReport(book);
  assert.ok(newestContent !== null, 'timestamped gate report exists');
  assert.strictEqual(readFileSync(lastGatePath, 'utf8'), newestContent, 'last-gate.json byte-identical to newest report');

  // Flag consumed
  assert.ok(!existsSync(flagPath), 'session-write flag consumed on block path');
});

// ---------------------------------------------------------------------------
// (e) warn-mode ai-injection clone (default config) + flag: additionalContext warn summary
// ---------------------------------------------------------------------------
test('(e) warn-mode ai-injection + flag: additionalContext warn summary, exit 0', () => {
  const book = cloneFixture(AI_INJECTION, 'e');
  // Default config has gate.mode: "warn" - no block config overlay needed
  setFlag(book);

  const result = runHook(makeStopEvent(book));

  assert.strictEqual(result.status, 0, 'hook exit 0');

  // Stdout must be non-empty (warn path emits additionalContext)
  assert.ok(result.stdout.trim().length > 0, 'stdout non-empty on warn path');

  let out;
  try {
    out = JSON.parse(result.stdout.trim());
  } catch {
    assert.fail('stdout is not valid JSON: ' + result.stdout);
  }

  const hookOut = out.hookSpecificOutput;
  assert.ok(hookOut, 'hookSpecificOutput present');
  assert.strictEqual(hookOut.hookEventName, 'Stop', 'hookEventName is Stop');
  assert.ok(
    typeof hookOut.additionalContext === 'string' && hookOut.additionalContext.length > 0,
    'additionalContext is present and non-empty'
  );
  // Warn path does not set decision: "block"
  assert.ok(hookOut.decision === undefined, 'warn path does not set decision field');

  // The warn summary should mention the check that has findings (prompt_scrub)
  assert.ok(
    hookOut.additionalContext.includes('prompt_scrub'),
    'warn summary mentions the finding check "prompt_scrub"; got: ' + hookOut.additionalContext
  );
});

// ---------------------------------------------------------------------------
// (f) missing-baseline clone + flag: one errors.jsonl line, one-line additionalContext, exit 0
//
// Approach: remove stylometry.baseline.markers from config.json (keeps valid JSON so
// findBookRoot succeeds) but causes ns-gate's stylometry engine to throw an error
// (hasEngineError=true -> exitCode=2). ns-gate still produces a gate report on stdout;
// the hook logs the error, emits additionalContext, and exits 0.
// ---------------------------------------------------------------------------
test('(f) missing-baseline config + flag: one errors.jsonl line, one-line additionalContext, exit 0', () => {
  const book = cloneSampleBook('f');
  setFlag(book);

  // Remove the stylometry baseline markers to trigger an engine error in ns-gate (exit 2).
  // config.json remains valid JSON so findBookRoot succeeds, but the stylometry check throws.
  const configPath = join(book, '.studio', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (config.stylometry && config.stylometry.baseline) {
    delete config.stylometry.baseline.markers;
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  const errorsPath = join(book, '.studio', 'logs', 'errors.jsonl');
  const linesBefore = readJsonlLines(errorsPath).length;

  const result = runHook(makeStopEvent(book));

  assert.strictEqual(result.status, 0, 'hook exits 0 on gate error (fail-open)');

  // Exactly one new line in errors.jsonl
  const linesAfter = readJsonlLines(errorsPath).length;
  assert.strictEqual(linesAfter - linesBefore, 1, 'exactly one errors.jsonl line added');

  // The error line must be parseable JSONL with the expected hook field
  const allLines = readJsonlLines(errorsPath);
  const newLine = allLines[allLines.length - 1];
  let errRecord;
  try {
    errRecord = JSON.parse(newLine);
  } catch {
    assert.fail('errors.jsonl new line is not valid JSON: ' + newLine);
  }
  assert.strictEqual(errRecord.hook, 'StopGate', 'error record hook field is StopGate');

  // Stdout must have additionalContext naming the gate error
  assert.ok(result.stdout.trim().length > 0, 'stdout non-empty on exit-2 path');
  let out;
  try {
    out = JSON.parse(result.stdout.trim());
  } catch {
    assert.fail('stdout is not valid JSON: ' + result.stdout);
  }

  const hookOut = out.hookSpecificOutput;
  assert.ok(hookOut, 'hookSpecificOutput present');
  assert.strictEqual(hookOut.hookEventName, 'Stop', 'hookEventName is Stop');
  assert.ok(
    typeof hookOut.additionalContext === 'string' && hookOut.additionalContext.includes('Gate error'),
    'additionalContext mentions "Gate error"; got: ' + hookOut.additionalContext
  );
  // One-line: must not span multiple lines
  assert.ok(
    !hookOut.additionalContext.includes('\n'),
    'additionalContext is a single line on exit-2 path'
  );
  // No block decision on error path
  assert.ok(hookOut.decision === undefined, 'exit-2 path does not set decision field');
});

// ---------------------------------------------------------------------------
// (g) second event with stop_hook_active true: last-gate.json unchanged (byte-compare)
//
// This case also stands as the OQ-14 Stop re-fire confirmation (a 19-turn headless
// session recorded 26 Stop events; a watch item, not a finding). It exercises both
// properties: (1) hooks/stop-gate.mjs's stop_hook_active === true short-circuit (the
// unconditional `if (event.stop_hook_active === true) { process.exit(0); }` placed before
// cwd/root resolution, the gate spawn, and the flag check) holds on a SECOND firing that
// follows a real gate run, not only in isolation; and (2) no duplicate gate report is
// written under re-fire, proven directly by last-gate.json's byte-identical before/after
// content across the second call. No dedup guard exists in the source, and none is added
// here: the short-circuit is unconditional and reads no persisted state across separate
// process invocations, so it cannot behave differently on a third, fourth, or Nth re-fire
// than it does on this second one - there is no counter or memory for "repeated" to act on
// beyond the on-disk state this test already covers. Verified by inspection per OPP-P04
// (untrusted-source envelope); no additional test was added because this one already
// proves both properties.
// ---------------------------------------------------------------------------
test('(g) re-fire after gate run: last-gate.json unchanged on second stop_hook_active:true event', () => {
  const book = cloneSampleBook('g');
  setFlag(book);

  const lastGatePath = join(book, '.studio', 'gate', 'last-gate.json');

  // First run: stop_hook_active: false -> gate runs, last-gate.json written
  const firstResult = runHook(makeStopEvent(book, { stop_hook_active: false }));
  assert.strictEqual(firstResult.status, 0, 'first run exits 0');
  assert.ok(existsSync(lastGatePath), 'last-gate.json written on first run');

  const contentAfterFirst = readFileSync(lastGatePath, 'utf8');

  // Second run: stop_hook_active: true -> re-fire short-circuit, last-gate.json unchanged
  const secondResult = runHook(makeStopEvent(book, { stop_hook_active: true }));
  assert.strictEqual(secondResult.status, 0, 'second run exits 0');
  assert.strictEqual(secondResult.stdout.trim(), '', 'second run produces empty stdout');

  const contentAfterSecond = readFileSync(lastGatePath, 'utf8');
  assert.strictEqual(
    contentAfterSecond,
    contentAfterFirst,
    'last-gate.json byte-identical: re-fire short-circuit did not modify it'
  );
});

// ---------------------------------------------------------------------------
// (h) no book root: exit 0, empty stdout
// ---------------------------------------------------------------------------
test('(h) no book root: exit 0, empty stdout', () => {
  // Use a temp directory that is NOT a book root (no .studio/meta.json)
  const emptyDir = join(tmpdir(), 'ns-tsk034-h-' + Date.now());
  mkdirSync(emptyDir, { recursive: true });

  const result = runHook(makeStopEvent(emptyDir));

  assert.strictEqual(result.status, 0, 'exit 0');
  assert.strictEqual(result.stdout.trim(), '', 'empty stdout when no book root');
});

// ---------------------------------------------------------------------------
// (i) malformed stdin: exit 0, empty stdout
// ---------------------------------------------------------------------------
test('(i) malformed stdin: exit 0, empty stdout', () => {
  const result = runHook('{ this is not valid JSON }');

  assert.strictEqual(result.status, 0, 'exit 0');
  assert.strictEqual(result.stdout.trim(), '', 'empty stdout on malformed stdin');
});

// ---------------------------------------------------------------------------
// (j) NS_HOOK_TRACE: inert when unset, one line appended when set
// ---------------------------------------------------------------------------
test('(j) NS_HOOK_TRACE: inert when unset, one line when set', () => {
  const book = cloneSampleBook('j');
  const traceFile = join(tmpdir(), 'ns-tsk034-j-trace-' + Date.now() + '.jsonl');

  // Use stop_hook_active:true to keep the test fast (short-circuit path, no gate spawn)
  const input = makeStopEvent(book, { stop_hook_active: true });

  // Without NS_HOOK_TRACE: no trace file created
  const resultNoTrace = runHook(input);
  assert.strictEqual(resultNoTrace.status, 0, 'exit 0 without trace');
  assert.ok(!existsSync(traceFile), 'trace file not created when NS_HOOK_TRACE unset');

  // With NS_HOOK_TRACE set: one line appended to the trace file
  const resultWithTrace = runHook(input, { NS_HOOK_TRACE: traceFile });
  assert.strictEqual(resultWithTrace.status, 0, 'exit 0 with trace');
  assert.ok(existsSync(traceFile), 'trace file created when NS_HOOK_TRACE set');

  const traceLines = readJsonlLines(traceFile);
  assert.strictEqual(traceLines.length, 1, 'exactly one trace line appended');

  let traceRecord;
  try {
    traceRecord = JSON.parse(traceLines[0]);
  } catch {
    assert.fail('trace line is not valid JSON: ' + traceLines[0]);
  }
  assert.strictEqual(traceRecord.event, 'Stop', 'trace event field is Stop');
  assert.ok(typeof traceRecord.script === 'string', 'trace script field is a string');
  assert.ok(typeof traceRecord.stdinRaw === 'string', 'trace stdinRaw field is a string');
});

// ---------------------------------------------------------------------------
// (k) syntactically invalid config.json + flag present: exit 0, visible additionalContext
//     starting with "Gate skipped:", no new report file, flag NOT consumed.
//
// Rationale: findBookRoot walks the ancestor chain, detects a valid book root via
// isBookRoot (meta.json + context/ + chapters/ present), then calls loadBible which
// attempts JSON.parse on config.json. Invalid JSON throws BibleError with code
// CONFIG_READ_ERROR. The fixed catch block distinguishes this from NO_BOOK_ROOT and
// emits one additionalContext line, stays fail-open, never runs the gate, never
// consumes the flag.
// ---------------------------------------------------------------------------
test('(k) invalid config.json + flag: exit 0, Gate-skipped additionalContext, no report, flag not consumed', () => {
  const book = cloneSampleBook('k');
  setFlag(book);

  // Corrupt config.json with syntactically invalid JSON so findBookRoot throws CONFIG_READ_ERROR.
  const configPath = join(book, '.studio', 'config.json');
  writeFileSync(configPath, '{ this is not valid JSON }', 'utf8');

  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');
  const reportsBefore = listGateReports(book).length;

  const result = runHook(makeStopEvent(book));

  assert.strictEqual(result.status, 0, 'exit 0 (fail-open on corrupt config)');

  // Stdout must be exactly one JSON object with additionalContext starting "Gate skipped:"
  assert.ok(result.stdout.trim().length > 0, 'stdout is non-empty on corrupt-config path');
  let out;
  try {
    out = JSON.parse(result.stdout.trim());
  } catch {
    assert.fail('stdout is not valid JSON: ' + result.stdout);
  }
  const hookOut = out.hookSpecificOutput;
  assert.ok(hookOut, 'hookSpecificOutput present');
  assert.strictEqual(hookOut.hookEventName, 'Stop', 'hookEventName is Stop');
  assert.ok(
    typeof hookOut.additionalContext === 'string' &&
      hookOut.additionalContext.startsWith('Gate skipped:'),
    'additionalContext starts with "Gate skipped:"; got: ' + hookOut.additionalContext
  );
  assert.ok(hookOut.decision === undefined, 'no block decision on corrupt-config path');

  // No new report file in .studio/gate/ (gate never ran)
  const reportsAfter = listGateReports(book).length;
  assert.strictEqual(reportsAfter, reportsBefore, 'no new report file: gate never ran');

  // Flag NOT consumed (gate never answered)
  assert.ok(existsSync(flagPath), 'session-write flag NOT consumed on corrupt-config path');
});
