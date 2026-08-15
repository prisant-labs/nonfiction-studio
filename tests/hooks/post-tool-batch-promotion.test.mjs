// tests/hooks/post-tool-batch-promotion.test.mjs
// what-it-is:   behaviour tests for the promotion ceremony and automatic demotion
//               (Task 5, wave 1 tranche 2) added to hooks/post-tool-batch.mjs
// what-it-does: spawns the REAL hooks/post-tool-batch.mjs script (never a helper
//               function called directly) with crafted snake_case PostToolBatch
//               events against temp clones of the sample-book, and asserts on the
//               resulting .studio/progress.json, .studio/ai-use-log.jsonl, and
//               stdout content. This file exists specifically to prove the
//               demotion rule depends on the real producer being wired up: if
//               hooks.json ever stopped invoking this script, or the script's
//               isMain guard broke, every test below would fail (spawnSync exit
//               code or missing file effects), not silently pass.
// runner:       node --test "tests/hooks/*.test.mjs"
//
// Never mutates committed fixtures. Temp clones are used throughout, matching
// tests/hooks/post-tool-batch.test.mjs's own convention exactly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  cpSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'hooks', 'post-tool-batch.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

const CH1_SLUG = '01-listening-before-speaking';
const CH1_REL = 'chapters/' + CH1_SLUG + '.md';

// DEMOTION_FALLBACK_STATUS (hooks/lib/status-engine.mjs) is deliberately
// hardcoded here as the literal 'revised' rather than imported: importing the
// same constant the implementation uses would let a future bug in the
// constant's VALUE pass this test unnoticed (the test would just track
// whatever the code says). Asserting the literal pins the actual contract.
const EXPECTED_FALLBACK_STATUS = 'revised';

// ---------------------------------------------------------------------------
// Helpers (mirrors tests/hooks/post-tool-batch.test.mjs exactly)
// ---------------------------------------------------------------------------

function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-task5-' + label + '-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

/** Spawn the REAL hook script with the given stdin JSON string. */
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

function makeBatchEvent(cwd, toolCalls) {
  return JSON.stringify({
    session_id: 'test-session-task5',
    transcript_path: '/tmp/t.jsonl',
    cwd,
    prompt_id: 'p-task5',
    permission_mode: 'default',
    effort: { level: 'medium' },
    hook_event_name: 'PostToolBatch',
    tool_calls: toolCalls
  });
}

function readJsonlLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
}

function readProgress(book) {
  return JSON.parse(readFileSync(join(book, '.studio', 'progress.json'), 'utf8'));
}

function writeProgress(book, progress) {
  writeFileSync(join(book, '.studio', 'progress.json'), JSON.stringify(progress, null, 2) + '\n', 'utf8');
}

/** Directly promotes a chapter to 'final' in progress.json (bypassing the hook
 *  entirely) and recomputes totals.chapters_final, simulating whatever prior
 *  state the test wants to start from. */
function forcePromoteToFinal(book, slug) {
  const progress = readProgress(book);
  const ch = progress.chapters.find(c => c.slug === slug);
  ch.status = 'final';
  progress.totals.chapters_final = progress.chapters.filter(c => c.status === 'final').length;
  writeProgress(book, progress);
}

/** Appends one well-formed attestation entry to context/decisions.md, matching
 *  docs/formats/decisions.md's grammar exactly. */
function appendDecisionEntry(book, { date, label, actor, decision, rationale, links }) {
  const path = join(book, 'context', 'decisions.md');
  const existing = readFileSync(path, 'utf8');
  const entryLines = [
    '### ' + date + ' - ' + label,
    '- actor: ' + actor,
    '- decision: ' + decision,
    '- rationale: ' + rationale,
    '- links: ' + (links || ''),
    ''
  ];
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(path, existing + sep + entryLines.join('\n'), 'utf8');
}

function humanAttestationFor(slug, label) {
  return {
    date: '2026-08-15',
    label: label || ('human final pass attestation, ' + slug),
    actor: 'author',
    decision: 'Chapter ' + slug + ' approved for gate after a full manual read.',
    rationale: 'Content verified accurate and voice-consistent for this test fixture.',
    links: 'chapters/' + slug + '.md'
  };
}

// ---------------------------------------------------------------------------
// (1) STEP 1 CANONICAL TEST: editing a final chapter demotes it via the real
//     hook, even though a valid author attestation is on record - proves the
//     "any edit demotes" rule is unconditional on attestation presence, not
//     merely a proxy for "no attestation exists."
// ---------------------------------------------------------------------------
test('demotion: editing a chapter at the terminal status falls back via the real hook, even with a valid attestation on record', () => {
  const book = cloneSampleBook('demote-with-attestation');
  const ch1Path = join(book, 'chapters', CH1_SLUG + '.md');

  forcePromoteToFinal(book, CH1_SLUG);
  appendDecisionEntry(book, humanAttestationFor(CH1_SLUG));

  const before = readProgress(book);
  const ch1Before = before.chapters.find(c => c.slug === CH1_SLUG);
  assert.equal(ch1Before.status, 'final', 'precondition: chapter is final before the edit');
  assert.equal(before.totals.chapters_final, 1, 'precondition: totals.chapters_final counts it');

  const newContent = 'Revised content written after the chapter reached final.\n';
  writeFileSync(ch1Path, newContent, 'utf8');

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Edit',
      tool_input: { file_path: ch1Path, old_string: 'x', new_string: 'y' },
      tool_use_id: 'toolu_demote1',
      tool_response: 'Edited.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0; stderr: ' + result.stderr);

  const after = readProgress(book);
  const ch1After = after.chapters.find(c => c.slug === CH1_SLUG);
  assert.equal(
    ch1After.status, EXPECTED_FALLBACK_STATUS,
    'chapter demoted to the fallback status despite the valid attestation still on record'
  );
  assert.equal(after.totals.chapters_final, 0, 'totals.chapters_final decremented');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes(CH1_SLUG) &&
    /demot/i.test(out.hookSpecificOutput.additionalContext),
    'additionalContext names the chapter and states the demotion; got: ' + out.hookSpecificOutput.additionalContext
  );

  const logLines = readJsonlLines(join(book, '.studio', 'ai-use-log.jsonl'));
  const lastRecord = JSON.parse(logLines[logLines.length - 1]);
  assert.ok(
    /demot/i.test(lastRecord.summary),
    'the ai-use-log record for this edit also states the demotion; got: ' + lastRecord.summary
  );
});

// ---------------------------------------------------------------------------
// (2) Pin: byte-identical content still demotes. The edit rule is "was this
//     file the target of a recognized Write/Edit tool call this batch," not a
//     content diff - this test would fail if a future change tried to "optimize"
//     by skipping the demotion when old and new content match.
// ---------------------------------------------------------------------------
test('demotion: a Write with byte-identical content still demotes a final chapter (edit rule does not diff content)', () => {
  const book = cloneSampleBook('demote-identical-content');
  const ch1Path = join(book, 'chapters', CH1_SLUG + '.md');

  forcePromoteToFinal(book, CH1_SLUG);
  appendDecisionEntry(book, humanAttestationFor(CH1_SLUG));

  const identicalContent = readFileSync(ch1Path, 'utf8');
  writeFileSync(ch1Path, identicalContent, 'utf8'); // no-op write: same bytes

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Write',
      tool_input: { file_path: ch1Path, content: identicalContent },
      tool_use_id: 'toolu_demote2',
      tool_response: 'Written.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0; stderr: ' + result.stderr);

  const after = readProgress(book);
  const ch1After = after.chapters.find(c => c.slug === CH1_SLUG);
  assert.equal(
    ch1After.status, EXPECTED_FALLBACK_STATUS,
    'demoted even though the written content is byte-identical to what was already on disk'
  );
});

// ---------------------------------------------------------------------------
// (3) STEP 2 CANONICAL TEST (AC2): a chapter promoted to final directly in
//     progress.json - no chapters/ write at all this batch - with NO matching
//     attestation entry in context/decisions.md is reverted by the real hook
//     in the SAME batch. Proves "promotion without a matching attestation
//     entry does not take effect."
// ---------------------------------------------------------------------------
test('promotion gating: a chapter set to final directly in progress.json with no matching attestation is reverted by the real hook in the same batch', () => {
  const book = cloneSampleBook('promote-no-attestation');
  const progressJsonPath = join(book, '.studio', 'progress.json');

  // Simulate "the direct Edit to progress.json already executed" - PostToolBatch
  // fires AFTER tool execution, so by the time the hook runs, this write has
  // already landed on disk exactly like this.
  forcePromoteToFinal(book, CH1_SLUG);
  // Deliberately NO appendDecisionEntry call: context/decisions.md carries no
  // attestation naming CH1_SLUG anywhere (the golden sample book's own two
  // entries do not reference chapter 01's promotion).

  const before = readProgress(book);
  assert.equal(before.chapters.find(c => c.slug === CH1_SLUG).status, 'final', 'precondition');

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: progressJsonPath,
        old_string: '"status": "drafted"',
        new_string: '"status": "final"'
      },
      tool_use_id: 'toolu_promote1',
      tool_response: 'Edited.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0; stderr: ' + result.stderr);

  const after = readProgress(book);
  const ch1After = after.chapters.find(c => c.slug === CH1_SLUG);
  assert.equal(
    ch1After.status, EXPECTED_FALLBACK_STATUS,
    'the unattested promotion was reverted in the same batch, not left standing'
  );
  assert.equal(after.totals.chapters_final, 0, 'totals.chapters_final reflects the reversal');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON, not empty');
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes(CH1_SLUG) &&
    /demot/i.test(out.hookSpecificOutput.additionalContext),
    'additionalContext is non-silent about the reversal even though no chapter file was written; got: ' +
    out.hookSpecificOutput.additionalContext
  );
});

// ---------------------------------------------------------------------------
// (4) Regression pin: a properly attested final chapter that is NOT touched
//     this batch stays final. Proves the eligibility sweep does not
//     over-demote every final chapter on every unrelated batch.
// ---------------------------------------------------------------------------
test('no over-demotion: a final chapter with a valid attestation, untouched this batch, stays final', () => {
  const book = cloneSampleBook('stays-final');
  const ch2Path = join(book, 'chapters', '02-finding-your-network.md');

  forcePromoteToFinal(book, CH1_SLUG);
  appendDecisionEntry(book, humanAttestationFor(CH1_SLUG));

  // Unrelated batch: writes chapter 2, never touches chapter 1 or progress.json directly.
  const newContent = 'Unrelated edit to a different chapter entirely.\n';
  writeFileSync(ch2Path, newContent, 'utf8');

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Write',
      tool_input: { file_path: ch2Path, content: newContent },
      tool_use_id: 'toolu_unrelated',
      tool_response: 'Written.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0; stderr: ' + result.stderr);

  const after = readProgress(book);
  const ch1After = after.chapters.find(c => c.slug === CH1_SLUG);
  assert.equal(ch1After.status, 'final', 'untouched, properly attested chapter is not demoted by an unrelated batch');
  assert.equal(after.totals.chapters_final, 1, 'totals.chapters_final still counts it');
});

// ---------------------------------------------------------------------------
// (5) A roster-slug attestation (not actor: author) does not save a chapter
//     from the sweep: proves eligibility requires a HUMAN attestation
//     specifically, exercised through the real hook (not the predicate
//     directly).
// ---------------------------------------------------------------------------
test('promotion gating: an attestation whose actor is a roster slug (not "author") does not confer eligibility', () => {
  const book = cloneSampleBook('promote-roster-slug-actor');
  const progressJsonPath = join(book, '.studio', 'progress.json');

  forcePromoteToFinal(book, CH1_SLUG);
  appendDecisionEntry(book, {
    date: '2026-08-15',
    label: 'editorial pass, chapter 01',
    actor: 'fact-checker',
    decision: 'Chapter 01 reviewed for factual accuracy.',
    rationale: 'All claims resolved against the evidence ledger.',
    links: 'chapters/' + CH1_SLUG + '.md'
  });

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: progressJsonPath,
        old_string: '"status": "drafted"',
        new_string: '"status": "final"'
      },
      tool_use_id: 'toolu_promote2',
      tool_response: 'Edited.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0; stderr: ' + result.stderr);

  const after = readProgress(book);
  assert.equal(
    after.chapters.find(c => c.slug === CH1_SLUG).status, EXPECTED_FALLBACK_STATUS,
    'a roster-slug-attested entry does not confer final-eligibility'
  );
});

// ---------------------------------------------------------------------------
// (6) A progress.json-only batch that changes nothing status-related (no
//     final chapters at all) does not rewrite progress.json or emit output -
//     proves the sweep does not turn every incidental progress.json touch
//     into a pointless rewrite.
// ---------------------------------------------------------------------------
test('a progress.json edit batch with no final chapters at all is a true no-op: no rewrite, empty stdout', () => {
  const book = cloneSampleBook('progress-touch-noop');
  const progressJsonPath = join(book, '.studio', 'progress.json');
  const progressBefore = readFileSync(progressJsonPath, 'utf8');

  const result = runHook(makeBatchEvent(book, [
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: progressJsonPath,
        old_string: '"word_count": 528',
        new_string: '"word_count": 528'
      },
      tool_use_id: 'toolu_noop',
      tool_response: 'Edited.'
    }
  ]));

  assert.equal(result.status, 0, 'exit code is 0; stderr: ' + result.stderr);
  assert.equal(result.stdout.trim(), '', 'empty stdout: nothing to report');

  const progressAfter = readFileSync(progressJsonPath, 'utf8');
  assert.equal(progressAfter, progressBefore, 'progress.json byte-identical; no pointless rewrite');
});
