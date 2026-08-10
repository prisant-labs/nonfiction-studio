// tests/engines/statusline-cli.test.mjs
// what-it-is:   CLI-level tests for bin/ns-statusline (OPP-P03, studio HUD; ADR-0008)
// what-it-does: spawns the real bin/ns-statusline binary against temp clones of the golden
//               sample book, piping stdin JSON exactly as the platform's statusLine and
//               subagentStatusLine contracts document, and asserts eight required cases
//               (OPP-P03, studio HUD) plus a measured-performance case. Never mutates the
//               committed examples/sample-book fixture (temp-clone discipline).
// runner:       node --test "tests/engines/*.test.mjs"
//
// Required cases:
//   1. full render: active chapter, words vs. target, open claims, drift band, gate token
//   2. BLOCK within one refresh
//   3. no book root: exit 0, empty stdout, no error text
//   4. malformed progress.json: exit 0, graceful degradation, no parse error leaked
//   5. project directory comes from stdin JSON, not process.cwd()
//   6. missing last-gate.json: renders without a gate token
//   7. --subagent mode: one JSON line per owned task, nothing for tasks not owned
//   8. performance: generous ceiling assertion + measured figure (also reported separately)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync, unlinkSync, existsSync
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { buildMainStatusLine } from '../../hooks/lib/statusline-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXAMPLES = join(__dirname, '..', '..', 'examples');
const BIN = join(__dirname, '..', '..', 'bin', 'ns-statusline');
const GOLDEN = join(EXAMPLES, 'sample-book');

function makeTempClone(sourceDir) {
  const base = join(os.tmpdir(), 'ns-statusline-cli-test');
  mkdirSync(base, { recursive: true });
  const tmpDir = mkdtempSync(base + '/clone-');
  cpSync(sourceDir, tmpDir, { recursive: true });
  return tmpDir;
}

/** Spawns bin/ns-statusline, piping `event` as stdin JSON. `cwd` is the PROCESS cwd
 *  (deliberately distinct from any `cwd`/`workspace.current_dir` inside `event`, so
 *  tests can prove which one the engine actually reads from). */
function spawnStatusline(processCwd, event, args = []) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: processCwd,
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: process.env,
  });
}

// ---- required case 1: full render -------------------------------------------

test('case 1: full render contains active chapter, words vs target, open claims, drift band, gate token', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    // Add a book-wide word-count target and a per-chapter promise: neither field is
    // populated by any shipped writer yet (see ADR-0008, status HUD and CANON 3.5), but the
    // engine is forward-compatible with both when present, per additionalProperties:
    // true on both schemas. This proves that path with a real fixture.
    const configPath = join(tmp, '.studio', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.targets = { word_count: 30000 };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const progressPath = join(tmp, '.studio', 'progress.json');
    const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
    progress.chapters[0].promise = 'the reader learns to listen before speaking';
    writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');

    const result = spawnStatusline(os.tmpdir(), { cwd: tmp });
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    assert.equal(result.stderr, '', 'no stderr output');

    const line = result.stdout;
    assert.ok(line.includes(progress.chapters[0].slug), 'active chapter slug present; got: ' + line);
    assert.ok(line.includes('the reader learns to listen before speaking'), 'chapter promise present; got: ' + line);
    assert.ok(line.includes(progress.totals.word_count + '/30000w'), 'words vs target present; got: ' + line);
    assert.ok(line.includes('claims:' + progress.totals.open_claim_count), 'open claims present; got: ' + line);
    assert.ok(line.includes('drift:'), 'drift band present; got: ' + line);
    assert.ok(line.includes('gate:'), 'gate token present; got: ' + line);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('case 1b: as-shipped golden book (no target, no promise) still renders the required fields gracefully', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const progress = JSON.parse(readFileSync(join(tmp, '.studio', 'progress.json'), 'utf8'));
    const result = spawnStatusline(os.tmpdir(), { cwd: tmp });
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);

    const line = result.stdout;
    assert.ok(line.includes(progress.chapters[0].slug), 'active chapter present; got: ' + line);
    assert.ok(line.includes(progress.totals.word_count + 'w'), 'word count present with no target suffix; got: ' + line);
    assert.ok(!/\d+\/\d+w/.test(line), 'no target fraction rendered when config carries none; got: ' + line);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- required case 2: BLOCK within one refresh -------------------------------

test('case 2: a block verdict in last-gate.json renders the literal token BLOCK', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const lastGatePath = join(tmp, '.studio', 'gate', 'last-gate.json');
    const lastGate = JSON.parse(readFileSync(lastGatePath, 'utf8'));
    lastGate.verdict = 'block';
    writeFileSync(lastGatePath, JSON.stringify(lastGate, null, 2), 'utf8');

    const result = spawnStatusline(os.tmpdir(), { cwd: tmp });
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    assert.ok(result.stdout.includes('BLOCK'), 'BLOCK token present; got: ' + result.stdout);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- required case 3: no book root -------------------------------------------

test('case 3: no book root anywhere: exit 0, empty stdout, no error text', () => {
  const bareDir = mkdtempSync(join(os.tmpdir(), 'ns-statusline-bare-'));
  try {
    const result = spawnStatusline(os.tmpdir(), { cwd: bareDir });
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    assert.equal(result.stdout, '', 'stdout must be empty outside a book project');
    assert.equal(result.stderr, '', 'stderr must be empty outside a book project');
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
  }
});

// ---- required case 4: malformed progress.json --------------------------------

test('case 4: malformed progress.json degrades gracefully: exit 0, no parse error text, no crash', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    writeFileSync(join(tmp, '.studio', 'progress.json'), '{ this is not valid JSON', 'utf8');

    const result = spawnStatusline(os.tmpdir(), { cwd: tmp });
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    assert.equal(result.stderr, '', 'no stderr output on malformed progress.json');
    assert.ok(!/syntaxerror/i.test(result.stdout), 'no JSON parse error text leaked; got: ' + result.stdout);
    assert.ok(!/at Object|at Module|\.mjs:\d+/.test(result.stdout), 'no stack-trace-shaped text leaked; got: ' + result.stdout);
    // The book title (from meta.json, read independently of progress.json) and the gate
    // token (from last-gate.json) still render: only the progress-sourced segments are lost.
    assert.ok(result.stdout.includes('The Quiet Network'), 'title still renders from meta.json; got: ' + result.stdout);
    assert.ok(!result.stdout.includes('claims:'), 'claims segment is dropped, not guessed; got: ' + result.stdout);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- required case 5: stdin cwd wins over process.cwd() ----------------------

test('case 5: the project directory comes from the stdin JSON, not from process.cwd()', () => {
  const tmp = makeTempClone(GOLDEN);
  const elsewhere = mkdtempSync(join(os.tmpdir(), 'ns-statusline-elsewhere-'));
  try {
    // Process cwd is a directory with NO book root; stdin cwd is the real book clone.
    // If the engine ever fell back to process.cwd(), this would render nothing.
    const result = spawnStatusline(elsewhere, { cwd: tmp });
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    assert.ok(result.stdout.includes('The Quiet Network'), 'book found via stdin cwd, not process cwd; got: ' + result.stdout);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('case 5b: workspace.current_dir is honored the same way as top-level cwd', () => {
  const tmp = makeTempClone(GOLDEN);
  const elsewhere = mkdtempSync(join(os.tmpdir(), 'ns-statusline-elsewhere2-'));
  try {
    const result = spawnStatusline(elsewhere, { cwd: elsewhere, workspace: { current_dir: tmp } });
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    assert.ok(result.stdout.includes('The Quiet Network'), 'book found via workspace.current_dir; got: ' + result.stdout);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

// ---- required case 6: missing last-gate.json ----------------------------------

test('case 6: a project that has never gated (no last-gate.json) renders without a gate token', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    unlinkSync(join(tmp, '.studio', 'gate', 'last-gate.json'));
    assert.ok(!existsSync(join(tmp, '.studio', 'gate', 'last-gate.json')), 'precondition: file removed');

    const result = spawnStatusline(os.tmpdir(), { cwd: tmp });
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    assert.equal(result.stderr, '', 'no stderr output');
    assert.ok(!result.stdout.includes('gate:'), 'no gate token when last-gate.json is absent; got: ' + result.stdout);
    assert.ok(!result.stdout.includes('drift:'), 'no drift band when last-gate.json is absent; got: ' + result.stdout);
    // The rest of the line still renders.
    assert.ok(result.stdout.includes('The Quiet Network'), 'title still renders; got: ' + result.stdout);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- required case 7: --subagent mode ------------------------------------------

test('case 7: --subagent mode emits one JSON line per owned task and nothing for tasks it does not own', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const event = {
      columns: 80,
      tasks: [
        { id: 'task-ours', type: 'nonfiction-studio:drafting-partner', cwd: tmp },
        { id: 'task-generic', type: 'general-purpose', cwd: tmp },
        { id: 'task-other-plugin', type: 'some-other-plugin:agent', cwd: tmp },
      ],
    };
    const result = spawnStatusline(os.tmpdir(), event, ['--subagent']);
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);

    const lines = result.stdout.split('\n').filter(l => l.trim().length > 0);
    assert.equal(lines.length, 1, 'exactly one row emitted; got stdout: ' + result.stdout);

    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.id, 'task-ours');
    assert.equal(typeof parsed.content, 'string');
    assert.ok(parsed.content.length > 0);
    assert.ok(!('id' in parsed) || parsed.id !== 'task-generic', 'no row for the unnamespaced task');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('case 7b: --subagent mode with no tasks emits no output', () => {
  const result = spawnStatusline(os.tmpdir(), { columns: 80, tasks: [] }, ['--subagent']);
  assert.equal(result.status, 0, 'stderr: ' + result.stderr);
  assert.equal(result.stdout, '');
});

// ---- required case 8: performance -----------------------------------------------

test('case 8: renders well under a generous ceiling with no subprocess spawned', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    // Warm-up run (first Node process start on some runners is slower, and the point
    // is a generous ceiling that tolerates normal variance, not a cold-start
    // measurement), then five measured runs, reporting the median.
    spawnStatusline(os.tmpdir(), { cwd: tmp });

    const samples = [];
    for (let i = 0; i < 5; i++) {
      const start = process.hrtime.bigint();
      const result = spawnStatusline(os.tmpdir(), { cwd: tmp });
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      assert.equal(result.status, 0, 'stderr: ' + result.stderr);
      samples.push(elapsedMs);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];

    // eslint-disable-next-line no-console
    console.log('[statusline-cli.test.mjs] measured wall-clock samples (ms, includes node process ' +
      'startup, spawnSync overhead, and stdin pipe): ' + samples.map(s => s.toFixed(1)).join(', ') +
      '; median=' + median.toFixed(1) + 'ms');

    // Generous ceiling, deliberately: this measures a full `node <script>` process
    // spawn plus stdin pipe plus three small file reads, NOT the in-process engine cost
    // alone, so it must tolerate real OS process-start variance on a loaded CI runner.
    // It is sized to catch a pathological regression (an accidental subprocess spawn
    // chain, a full-tree walk, a network call) while never flaking on ordinary variance.
    assert.ok(median < 2000, 'median wall-clock time must stay under 2000ms; got ' + median.toFixed(1) + 'ms');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('case 8b: in-process buildMainStatusLine call (no subprocess) measures tight against a low ceiling', () => {
  // Item 7 (fix wave): case 8 above measures a full `node <script>` process spawn, so its
  // 2000ms ceiling has to tolerate real OS process-start variance and is loose against the
  // 42.7-67.5ms wall-clock range that spawn actually measures at. This test calls the engine
  // function directly in this same process instead, which has no process-start variance to
  // tolerate, so its ceiling can and should be tight. Kept alongside case 8's loose wall-clock
  // assertion, not instead of it: case 8 still proves the real CLI path (subprocess, stdin
  // pipe, argv) stays fast; this test proves the engine computation itself stays fast,
  // independent of process-start noise.
  const tmp = makeTempClone(GOLDEN);
  try {
    // Warm-up call (first-call module/JIT variance is not what this measures).
    buildMainStatusLine({ cwd: tmp });

    const samples = [];
    for (let i = 0; i < 5; i++) {
      const start = process.hrtime.bigint();
      const line = buildMainStatusLine({ cwd: tmp });
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(typeof line === 'string' && line.length > 0, 'engine must return a non-empty line');
      samples.push(elapsedMs);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];

    // eslint-disable-next-line no-console
    console.log('[statusline-cli.test.mjs] in-process buildMainStatusLine samples (ms, no subprocess ' +
      'spawn, no process-start variance): ' + samples.map(s => s.toFixed(3)).join(', ') +
      '; median=' + median.toFixed(3) + 'ms');

    // Tight ceiling, deliberately: measured median on a development machine is well under 1ms
    // (sub-millisecond string assembly over three small already-parsed JSON reads). 50ms is
    // generous against that measurement (roughly two orders of magnitude of headroom for a
    // loaded CI runner) while still catching a real regression case 8's 2000ms ceiling would
    // not notice: an accidental full-tree walk, a synchronous network call, or an N+1 file-read
    // loop introduced into the engine.
    assert.ok(median < 50, 'median in-process engine time must stay under 50ms; got ' + median.toFixed(3) + 'ms');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
