// tests/hooks/post-tool-batch.test.mjs
// what-it-is:   behaviour tests for hooks/post-tool-batch.mjs (TSK-033)
// what-it-does: spawns the real script with crafted snake_case PostToolBatch events
//               against temp clones of the sample-book, covering the ten cases
//               from the TSK-033 brief
// runner:       node --test "tests/hooks/*.test.mjs"
//
// Synthetic events copy the shape captured live in the TSK-030 report (snake_case stdin):
//   { session_id, transcript_path, cwd, prompt_id, permission_mode, effort,
//     hook_event_name, tool_calls: [{tool_name, tool_input, tool_use_id, tool_response}] }
//
// Never mutates committed fixtures. Temp clones are used throughout.
// countWords is imported directly to verify the single-tokenizer invariant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  cpSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { countWords } from '../../hooks/lib/stylometry-engine.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'hooks', 'post-tool-batch.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(label) {
  const dir = join(tmpdir(), 'ns-tsk033-' + label + '-' + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-tsk033-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

/** Spawn the hook with the given stdin JSON string. NS_HOOK_TRACE cleared by default. */
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

/** Build a synthetic PostToolBatch event (snake_case shape per TSK-030 firing proof). */
function makeBatchEvent(cwd, toolCalls) {
  return JSON.stringify({
    session_id: 'test-session-033',
    transcript_path: '/tmp/t.jsonl',
    cwd,
    prompt_id: 'p-033',
    permission_mode: 'default',
    effort: { level: 'medium' },
    hook_event_name: 'PostToolBatch',
    tool_calls: toolCalls
  });
}

/** Count JSONL lines in a file (filters blank trailing line). */
function readJsonlLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
}

// ---------------------------------------------------------------------------
// (a) one chapter Write: recorded count equals stylometry counter, no tmp file,
//     exactly one generated log line appended, additionalContext present, exit 0
// ---------------------------------------------------------------------------
test('(a) one chapter Write: count matches stylometry, no tmp.json, one new generated log line, additionalContext, exit 0', () => {
  const book = cloneSampleBook('a-write');
  const ch1Path = join(book, 'chapters', '01-listening-before-speaking.md');
  const logPath = join(book, '.studio', 'ai-use-log.jsonl');
  const tmpPath = join(book, '.studio', 'progress.tmp.json');

  // Write specific content to the chapter so the count is known.
  const newContent = 'Learning to listen requires patience and daily practice.\n';
  writeFileSync(ch1Path, newContent, 'utf8');
  const expectedCount = countWords(newContent);

  const logLinesBefore = readJsonlLines(logPath).length;

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Write',
      tool_input: { file_path: ch1Path, content: newContent },
      tool_use_id: 'toolu_a1',
      tool_response: 'Written successfully.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0');

  // progress.json: ch1 word_count matches the stylometry counter on the on-disk file.
  const progress = JSON.parse(readFileSync(join(book, '.studio', 'progress.json'), 'utf8'));
  const ch1 = progress.chapters.find(ch => ch.slug === '01-listening-before-speaking');
  assert.ok(ch1, 'chapter 01 entry exists in progress.json');
  assert.equal(ch1.word_count, expectedCount, 'word_count equals countWords result for the on-disk file');

  // progress.tmp.json must be absent (rename completed).
  assert.ok(!existsSync(tmpPath), 'progress.tmp.json absent after successful atomic write');

  // Exactly one new log line with scope "generated".
  const logLinesAfter = readJsonlLines(logPath);
  assert.equal(
    logLinesAfter.length, logLinesBefore + 1,
    'exactly one new log line appended'
  );
  const logRecord = JSON.parse(logLinesAfter[logLinesAfter.length - 1]);
  assert.equal(logRecord.scope, 'generated', 'scope is "generated" for Write');
  assert.equal(logRecord.agent, 'hook:PostToolBatch', 'agent is hook:PostToolBatch');
  assert.equal(logRecord.surface, 'claude-code', 'surface is claude-code');
  assert.ok(Array.isArray(logRecord.targets) && logRecord.targets.length === 1, 'targets has one entry');
  assert.ok(
    logRecord.targets[0].includes('01-listening-before-speaking'),
    'target path includes the chapter slug'
  );
  assert.ok(typeof logRecord.summary === 'string' && logRecord.summary.length > 0, 'summary is non-empty');
  assert.ok(typeof logRecord.ts === 'string', 'ts is a string');

  // stdout: valid JSON with hookEventName and additionalContext.
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolBatch', 'hookEventName is PostToolBatch');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'additionalContext is a non-empty string'
  );
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes('01-listening-before-speaking'),
    'additionalContext names the touched chapter'
  );
});

// ---------------------------------------------------------------------------
// (b) two chapter writes in one tool_calls array: both entries updated coherently,
//     neither write lost, totals correct, two log lines appended
// ---------------------------------------------------------------------------
test('(b) two chapter writes: both entries updated in one atomic write, totals correct, two log lines', () => {
  const book = cloneSampleBook('b-two');
  const ch1Path = join(book, 'chapters', '01-listening-before-speaking.md');
  const ch2Path = join(book, 'chapters', '02-finding-your-network.md');
  const logPath = join(book, '.studio', 'ai-use-log.jsonl');

  const ch1Content = 'Brief chapter one content for testing.\n';
  const ch2Content = 'Chapter two has slightly more content than chapter one here.\n';
  writeFileSync(ch1Path, ch1Content, 'utf8');
  writeFileSync(ch2Path, ch2Content, 'utf8');
  const expectedCh1 = countWords(ch1Content);
  const expectedCh2 = countWords(ch2Content);

  const logLinesBefore = readJsonlLines(logPath).length;

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Write',
      tool_input: { file_path: ch1Path, content: ch1Content },
      tool_use_id: 'toolu_b1',
      tool_response: 'Written.'
    },
    {
      tool_name: 'Write',
      tool_input: { file_path: ch2Path, content: ch2Content },
      tool_use_id: 'toolu_b2',
      tool_response: 'Written.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0');

  const progress = JSON.parse(readFileSync(join(book, '.studio', 'progress.json'), 'utf8'));
  const ch1 = progress.chapters.find(ch => ch.slug === '01-listening-before-speaking');
  const ch2 = progress.chapters.find(ch => ch.slug === '02-finding-your-network');

  assert.ok(ch1, 'ch1 entry present');
  assert.ok(ch2, 'ch2 entry present');
  assert.equal(ch1.word_count, expectedCh1, 'ch1 word_count correct');
  assert.equal(ch2.word_count, expectedCh2, 'ch2 word_count correct');
  assert.equal(
    progress.totals.word_count, expectedCh1 + expectedCh2,
    'totals.word_count is the sum of both chapters'
  );

  // Two new log lines, both "generated".
  const logLinesAfter = readJsonlLines(logPath);
  assert.equal(logLinesAfter.length, logLinesBefore + 2, 'exactly two new log lines');
  const newLines = logLinesAfter.slice(logLinesBefore);
  for (const line of newLines) {
    const rec = JSON.parse(line);
    assert.equal(rec.scope, 'generated', 'both records have scope "generated"');
  }
});

// ---------------------------------------------------------------------------
// (c) Edit call: scope "assisted" in ai-use-log
// ---------------------------------------------------------------------------
test('(c) Edit call: scope is "assisted" in ai-use-log', () => {
  const book = cloneSampleBook('c-edit');
  const ch1Path = join(book, 'chapters', '01-listening-before-speaking.md');
  const logPath = join(book, '.studio', 'ai-use-log.jsonl');
  const logLinesBefore = readJsonlLines(logPath).length;

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: ch1Path,
        old_string: 'Listening',
        new_string: 'Listening carefully'
      },
      tool_use_id: 'toolu_c',
      tool_response: 'Edited.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0');

  const logLinesAfter = readJsonlLines(logPath);
  assert.equal(logLinesAfter.length, logLinesBefore + 1, 'one new log line');
  const rec = JSON.parse(logLinesAfter[logLinesAfter.length - 1]);
  assert.equal(rec.scope, 'assisted', 'Edit produces scope "assisted"');
  assert.equal(rec.agent, 'hook:PostToolBatch', 'agent is hook:PostToolBatch');
});

// ---------------------------------------------------------------------------
// (c2) Write then Edit same chapter in one batch: two log records in tool_calls
//      order (generated then assisted), one recount, one chapter update.
//      Covers the per-call log requirement from the TSK-033 review (Risk 3 /
//      brief resolution 4): "two records" for Write+Edit to the same file.
// ---------------------------------------------------------------------------
test('(c2) Write then Edit same chapter: two log records in order, one recount, one progress update', () => {
  const book = cloneSampleBook('c2-same-file');
  const ch1Path = join(book, 'chapters', '01-listening-before-speaking.md');
  const logPath = join(book, '.studio', 'ai-use-log.jsonl');

  const ch1Content = 'New content written then edited in same batch.\n';
  writeFileSync(ch1Path, ch1Content, 'utf8');
  const expectedCount = countWords(ch1Content);

  const logLinesBefore = readJsonlLines(logPath).length;

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Write',
      tool_input: { file_path: ch1Path, content: ch1Content },
      tool_use_id: 'toolu_c2a',
      tool_response: 'Written.'
    },
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: ch1Path,
        old_string: 'written',
        new_string: 'written and edited'
      },
      tool_use_id: 'toolu_c2b',
      tool_response: 'Edited.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0');

  // Exactly two new log records.
  const logLinesAfter = readJsonlLines(logPath);
  assert.equal(logLinesAfter.length, logLinesBefore + 2, 'exactly two new log records for Write+Edit same file');

  // Records appear in tool_calls order: generated (Write) then assisted (Edit).
  const rec1 = JSON.parse(logLinesAfter[logLinesBefore]);
  const rec2 = JSON.parse(logLinesAfter[logLinesBefore + 1]);

  assert.equal(rec1.scope, 'generated', 'first record scope is "generated" (Write)');
  assert.equal(rec2.scope, 'assisted', 'second record scope is "assisted" (Edit)');

  // Both records target the same chapter.
  assert.ok(rec1.targets[0].includes('01-listening-before-speaking'), 'first record targets ch1');
  assert.ok(rec2.targets[0].includes('01-listening-before-speaking'), 'second record targets ch1');

  // Both records have the required S-08 section 5 fields.
  for (const rec of [rec1, rec2]) {
    assert.ok(typeof rec.ts === 'string', 'ts present');
    assert.equal(rec.agent, 'hook:PostToolBatch', 'agent is hook:PostToolBatch');
    assert.equal(rec.surface, 'claude-code', 'surface is claude-code');
    assert.ok(Array.isArray(rec.targets) && rec.targets.length === 1, 'targets has one entry');
    assert.ok(typeof rec.summary === 'string' && rec.summary.length > 0, 'summary is non-empty');
  }

  // One recount: progress.json word_count updated to the expected value exactly once.
  const progressAfter = JSON.parse(readFileSync(join(book, '.studio', 'progress.json'), 'utf8'));
  const ch1After = progressAfter.chapters.find(ch => ch.slug === '01-listening-before-speaking');
  assert.ok(ch1After, 'chapter 01 entry exists in progress.json');
  assert.equal(ch1After.word_count, expectedCount, 'word_count updated once to expected count');

  // additionalContext present (chapter write was processed).
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolBatch', 'hookEventName is PostToolBatch');
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes('01-listening-before-speaking'),
    'additionalContext names the touched chapter'
  );
});

// ---------------------------------------------------------------------------
// (d) dispatch (Agent) call: one "mechanical" log line, dispatched slug as agent,
//     empty targets, description as summary, empty stdout
// ---------------------------------------------------------------------------
test('(d) Agent dispatch: one mechanical log line, dispatched slug, empty targets, empty stdout', () => {
  const book = cloneSampleBook('d-dispatch');
  const logPath = join(book, '.studio', 'ai-use-log.jsonl');
  const logLinesBefore = readJsonlLines(logPath).length;

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'drafting-partner',
        description: 'Draft section 2 of chapter one using EV-0003.',
        prompt: 'Write 200 words for section 2.'
      },
      tool_use_id: 'toolu_d',
      tool_response: 'Agent dispatched.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0');
  // Dispatch-only batch: stdout must be empty.
  assert.equal(result.stdout.trim(), '', 'dispatch-only batch emits empty stdout');

  const logLinesAfter = readJsonlLines(logPath);
  assert.equal(logLinesAfter.length, logLinesBefore + 1, 'one new log line for dispatch');
  const rec = JSON.parse(logLinesAfter[logLinesAfter.length - 1]);
  assert.equal(rec.scope, 'mechanical', 'dispatch scope is "mechanical"');
  assert.equal(rec.agent, 'drafting-partner', 'agent is the dispatched subagent_type slug');
  assert.deepEqual(rec.targets, [], 'targets is empty array for dispatch');
  assert.ok(
    rec.summary.includes('Draft section 2'),
    'summary includes the description text'
  );
});

// ---------------------------------------------------------------------------
// (e) non-chapter batch (Write to context/): empty stdout, no progress or log changes
// ---------------------------------------------------------------------------
test('(e) non-chapter Write (context/): empty stdout, progress unchanged, log unchanged', () => {
  const book = cloneSampleBook('e-non-chapter');
  const outsidePath = join(book, 'context', 'brief.md');
  const logPath = join(book, '.studio', 'ai-use-log.jsonl');

  const progressBefore = readFileSync(join(book, '.studio', 'progress.json'), 'utf8');
  const logLinesBefore = readJsonlLines(logPath).length;

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Write',
      tool_input: { file_path: outsidePath, content: 'updated brief' },
      tool_use_id: 'toolu_e',
      tool_response: 'Written.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'empty stdout for non-chapter write');

  const progressAfter = readFileSync(join(book, '.studio', 'progress.json'), 'utf8');
  assert.equal(progressBefore, progressAfter, 'progress.json content unchanged');

  const logLinesAfter = readJsonlLines(logPath).length;
  assert.equal(logLinesAfter, logLinesBefore, 'ai-use-log.jsonl unchanged');
});

// ---------------------------------------------------------------------------
// (f) corrupt progress.json: exit 0, one errors.jsonl line, progress byte-identical
// ---------------------------------------------------------------------------
test('(f) corrupt progress.json: exit 0, one errors.jsonl line, progress byte-identical', () => {
  const book = cloneSampleBook('f-corrupt');
  const progressPath = join(book, '.studio', 'progress.json');
  const ch1Path = join(book, 'chapters', '01-listening-before-speaking.md');
  const errorsPath = join(book, '.studio', 'logs', 'errors.jsonl');

  // Record how many errors.jsonl lines exist before (may already have some).
  const errLinesBefore = existsSync(errorsPath) ? readJsonlLines(errorsPath).length : 0;

  // Corrupt progress.json.
  const corruptContent = 'not valid json {{ intentionally corrupt';
  writeFileSync(progressPath, corruptContent, 'utf8');

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Write',
      tool_input: { file_path: ch1Path, content: 'some new content' },
      tool_use_id: 'toolu_f',
      tool_response: 'Written.'
    }
  ]));

  assert.equal(result.status, 0, 'exit 0 even with corrupt progress.json (fail-open)');

  // progress.json is byte-identical to the corrupt version (hook skipped the write).
  const progressAfter = readFileSync(progressPath, 'utf8');
  assert.equal(progressAfter, corruptContent, 'progress.json byte-identical; hook did not overwrite it');

  // At least one new errors.jsonl line.
  assert.ok(existsSync(errorsPath), 'errors.jsonl was created');
  const errLinesAfter = readJsonlLines(errorsPath);
  assert.ok(errLinesAfter.length > errLinesBefore, 'at least one new error line logged');
  const errRec = JSON.parse(errLinesAfter[errLinesBefore]);
  assert.equal(errRec.hook, 'PostToolBatch', 'error record identifies PostToolBatch hook');
  assert.ok(typeof errRec.msg === 'string' && errRec.msg.length > 0, 'error record has a message');
});

// ---------------------------------------------------------------------------
// (g) unknown top-level, per-chapter, and per-totals fields survive the update
// ---------------------------------------------------------------------------
test('(g) unknown fields at top-level, per-chapter, and per-totals survive round-trip', () => {
  const book = cloneSampleBook('g-unknown-fields');
  const progressPath = join(book, '.studio', 'progress.json');
  const ch1Path = join(book, 'chapters', '01-listening-before-speaking.md');

  // Inject unknown fields at every level.
  const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
  progress.futureMeta = 'alpha-field-for-schema-v3';
  progress.chapters[0].proofreadAt = '2026-07-18T10:00:00Z';
  progress.totals.extraMetric = 42;
  writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n', 'utf8');

  // Write new content so word_count will actually change (proves the update ran).
  const newContent = 'Updated content with known word count.\n';
  writeFileSync(ch1Path, newContent, 'utf8');

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Write',
      tool_input: { file_path: ch1Path, content: newContent },
      tool_use_id: 'toolu_g',
      tool_response: 'Written.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0');

  // Verify word_count was actually updated (confirms the hook ran its update path).
  const after = JSON.parse(readFileSync(progressPath, 'utf8'));
  assert.equal(after.chapters[0].word_count, countWords(newContent), 'word_count was updated');

  // Unknown fields survive at all levels.
  assert.equal(after.futureMeta, 'alpha-field-for-schema-v3', 'top-level unknown field survived');
  assert.equal(after.chapters[0].proofreadAt, '2026-07-18T10:00:00Z', 'per-chapter unknown field survived');
  assert.equal(after.totals.extraMetric, 42, 'per-totals unknown field survived');
});

// ---------------------------------------------------------------------------
// (h) no book root: empty stdout, exit 0
// ---------------------------------------------------------------------------
test('(h) no book root: empty stdout, exit 0', () => {
  const emptyDir = makeTmpDir('h-no-root');
  const fakePath = join(emptyDir, 'chapters', 'test.md');

  const event = JSON.stringify({
    session_id: 'test-session-033',
    cwd: emptyDir,
    hook_event_name: 'PostToolBatch',
    tool_calls: [
      {
        tool_name: 'Write',
        tool_input: { file_path: fakePath, content: 'x' },
        tool_use_id: 'toolu_h',
        tool_response: 'Written.'
      }
    ]
  });

  const result = runHook(event);

  assert.equal(result.status, 0, 'exit code is 0 when no book root found');
  assert.equal(result.stdout.trim(), '', 'empty stdout when no book root');
});

// ---------------------------------------------------------------------------
// (i) NS_HOOK_TRACE: inert when unset, one line when set
// ---------------------------------------------------------------------------
test('(i) NS_HOOK_TRACE unset: no trace file created', () => {
  const tmpDir = makeTmpDir('i-trace-unset');
  const traceFile = join(tmpDir, 'trace.jsonl');

  const event = JSON.stringify({
    session_id: 'test',
    hook_event_name: 'PostToolBatch',
    tool_calls: []
  });

  const result = runHook(event);

  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(!existsSync(traceFile), 'no trace file created when NS_HOOK_TRACE is unset');
});

test('(i) NS_HOOK_TRACE set: exactly one line written with event PostToolBatch', () => {
  const tmpDir = makeTmpDir('i-trace-set');
  const traceFile = join(tmpDir, 'trace.jsonl');

  const event = JSON.stringify({
    session_id: 'test',
    hook_event_name: 'PostToolBatch',
    tool_calls: []
  });

  const result = runHook(event, { NS_HOOK_TRACE: traceFile });

  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(existsSync(traceFile), 'trace file created when NS_HOOK_TRACE is set');

  const lines = readFileSync(traceFile, 'utf8').split('\n').filter(l => l.trim());
  assert.equal(lines.length, 1, 'exactly one trace line');

  const trace = JSON.parse(lines[0]);
  assert.equal(trace.event, 'PostToolBatch', 'trace event field is PostToolBatch');
  assert.ok(typeof trace.script === 'string' && trace.script.length > 0, 'trace carries script path');
  assert.ok(typeof trace.stdinRaw === 'string', 'trace carries stdinRaw');
});

// ---------------------------------------------------------------------------
// (j) malformed stdin: exit 0, empty stdout
// ---------------------------------------------------------------------------
test('(j) malformed stdin: exit 0, empty stdout', () => {
  const result = runHook('{not valid json {{{{');

  assert.equal(result.status, 0, 'exit code is 0 for malformed stdin (fail-open)');
  assert.equal(result.stdout.trim(), '', 'empty stdout for malformed stdin');
});
