// tests/hooks/pre-tool-use.test.mjs
// what-it-is:   behaviour tests for hooks/pre-tool-use.mjs (TSK-032)
// what-it-does: spawns the real script with crafted snake_case PreToolUse events and
//               imports the exported guard function directly, covering the twelve cases
//               from the TSK-032 brief
// runner:       node --test "tests/hooks/*.test.mjs"
//
// Synthetic events copy the shape captured live in the TSK-030 report (snake_case stdin):
//   { session_id, transcript_path, cwd, prompt_id, permission_mode, effort,
//     hook_event_name, tool_name, tool_input, tool_use_id }
//
// Never mutates committed fixtures. Temp clones are used for write-tool cases.
// The exported checkResearchAgentConstraint is imported directly (top-level await)
// so the isMain guard in pre-tool-use.mjs prevents stdin/exit side-effects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  cpSync,
  unlinkSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'hooks', 'pre-tool-use.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Import the module directly for the exported-function test (case j).
// isMain is false here (process.argv[1] is the test runner, not the hook script)
// so no stdin reads or process.exit() calls happen during import.
// ---------------------------------------------------------------------------
const { checkResearchAgentConstraint } = await import('../../hooks/pre-tool-use.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(label) {
  const dir = join(tmpdir(), 'ns-tsk032-' + label + '-' + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-tsk032-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

/** Spawn the hook with the given stdin string and optional extra env overrides.
 *  NS_HOOK_TRACE is cleared from the parent env by default. */
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

/** Build a synthetic Write/Edit event (snake_case shape per TSK-030 firing proof). */
function makeWriteEvent(cwd, filePath, toolName = 'Write') {
  return JSON.stringify({
    session_id: 'test-session-032',
    transcript_path: '/tmp/t.jsonl',
    cwd,
    prompt_id: 'p-032',
    permission_mode: 'default',
    effort: { level: 'medium' },
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: { file_path: filePath, content: 'test content from tsk-032 test suite' },
    tool_use_id: 'toolu_test032'
  });
}

/** Build a synthetic Bash event. */
function makeBashEvent(cwd, command) {
  return JSON.stringify({
    session_id: 'test-session-032',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: 'toolu_test032'
  });
}

/** Build a synthetic Read event (read-only; should be a no-op). */
function makeReadEvent(cwd) {
  return JSON.stringify({
    session_id: 'test-session-032',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: join(cwd, 'chapters', '01.md') },
    tool_use_id: 'toolu_test032'
  });
}

/** Count snapshot files in .studio/snapshots/ that belong to the given slug. */
function countSnapshots(bookRoot, slug) {
  const dir = join(bookRoot, '.studio', 'snapshots');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.startsWith(slug + '.') && f.endsWith('.md')).length;
}

// ---------------------------------------------------------------------------
// (a) chapter Write on existing file: flag written, snapshot created, allow
// ---------------------------------------------------------------------------
test('(a) chapter Write existing file: flag + snapshot written, empty stdout, exit 0', () => {
  const book = cloneSampleBook('a-existing');
  const target = join(book, 'chapters', '01-listening-before-speaking.md');
  const slug = '01-listening-before-speaking';
  const snapshotsBefore = countSnapshots(book, slug);

  const result = runHook(makeWriteEvent(book, target));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (allow path)');
  assert.equal(result.stderr, '', 'no stderr');

  // Session-write flag must exist and contain an ISO timestamp
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');
  assert.ok(existsSync(flagPath), 'session-write flag was written');
  const flagContent = readFileSync(flagPath, 'utf8').trim();
  assert.ok(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/.test(flagContent),
    'flag content is a bare ISO 8601 UTC timestamp'
  );

  // Exactly one new snapshot must be created
  const snapshotsAfter = countSnapshots(book, slug);
  assert.equal(snapshotsAfter, snapshotsBefore + 1, 'exactly one new snapshot was added');

  // Snapshot name must match <slug>.<YYYYMMDDTHHMMSSZ>.md
  const allSnapshots = readdirSync(join(book, '.studio', 'snapshots'))
    .filter(f => f.startsWith(slug + '.') && f.endsWith('.md'));
  allSnapshots.sort();
  const newestSnapshot = allSnapshots[allSnapshots.length - 1];
  assert.ok(
    /^01-listening-before-speaking\.\d{8}T\d{6}Z\.md$/.test(newestSnapshot),
    'newest snapshot filename matches <slug>.<YYYYMMDDTHHMMSSZ>.md'
  );
});

// ---------------------------------------------------------------------------
// (b) chapter Write on NEW file: flag written, NO snapshot
// ---------------------------------------------------------------------------
test('(b) chapter Write new file: flag written, no snapshot created', () => {
  const book = cloneSampleBook('b-new');
  const target = join(book, 'chapters', '99-new-chapter.md');

  // Confirm the target file does not exist in the clone
  assert.ok(!existsSync(target), 'precondition: target file does not exist before hook run');

  const result = runHook(makeWriteEvent(book, target));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (allow path)');

  // Flag must be written even for a new file
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');
  assert.ok(existsSync(flagPath), 'session-write flag written for new chapter file');

  // No snapshot should exist for the new (never-before-written) file
  assert.equal(
    countSnapshots(book, '99-new-chapter'),
    0,
    'no snapshot created when target file is new (does not exist yet)'
  );
});

// ---------------------------------------------------------------------------
// (c) snapshot prune: seed 10 snapshots, overwrite, newest 10 survive
// ---------------------------------------------------------------------------
test('(c) snapshot prune: 10 seeded + 1 new = 11, prune to newest 10', () => {
  const book = cloneSampleBook('c-prune');
  const slug = '01-listening-before-speaking';
  const snapshotsDir = join(book, '.studio', 'snapshots');
  const target = join(book, 'chapters', slug + '.md');

  // Remove any existing snapshots for this slug from the clone so we start clean
  readdirSync(snapshotsDir)
    .filter(f => f.startsWith(slug + '.') && f.endsWith('.md'))
    .forEach(f => unlinkSync(join(snapshotsDir, f)));

  // Seed 10 snapshots with known past timestamps: t1 (oldest) through t10
  const seedTimestamps = [];
  for (let i = 1; i <= 10; i++) {
    const ts = '20200101T0000' + String(i).padStart(2, '0') + 'Z';
    seedTimestamps.push(ts);
    writeFileSync(join(snapshotsDir, slug + '.' + ts + '.md'), 'seed snapshot ' + i, 'utf8');
  }
  assert.equal(countSnapshots(book, slug), 10, 'precondition: exactly 10 seeded snapshots');

  // Run hook: target exists, so a new snapshot is created (11 total before prune)
  const result = runHook(makeWriteEvent(book, target));
  assert.equal(result.status, 0, 'exit code is 0');

  // After prune: exactly 10 snapshots survive per the S-08 section 10 retention rule
  assert.equal(countSnapshots(book, slug), 10, 'exactly 10 snapshots survive after prune');

  // The oldest seeded snapshot (t1) must have been pruned
  const t1 = join(snapshotsDir, slug + '.' + seedTimestamps[0] + '.md');
  assert.ok(!existsSync(t1), 'oldest seeded snapshot was deleted by prune');

  // The 10th seeded snapshot (t10) must still exist
  const t10 = join(snapshotsDir, slug + '.' + seedTimestamps[9] + '.md');
  assert.ok(existsSync(t10), '10th seeded snapshot survives (newest seeded)');
});

// ---------------------------------------------------------------------------
// (d) write outside root: deny JSON with path-guard reason
// ---------------------------------------------------------------------------
test('(d) write outside root: deny JSON with path-guard reason, exit 0', () => {
  const book = cloneSampleBook('d-outside');
  // Use a path in os.tmpdir() which is guaranteed to be outside the book root
  const outsidePath = join(tmpdir(), 'ns-tsk032-outside-' + Date.now() + '.md');

  const result = runHook(makeWriteEvent(book, outsidePath));

  assert.equal(result.status, 0, 'exit code is 0 even on deny');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PreToolUse', 'hookEventName is PreToolUse');
  assert.equal(hso.permissionDecision, 'deny', 'permissionDecision is deny');
  assert.ok(
    typeof hso.permissionDecisionReason === 'string' && hso.permissionDecisionReason.length > 0,
    'permissionDecisionReason is a non-empty string'
  );
  assert.ok(
    hso.permissionDecisionReason.toLowerCase().includes('outside'),
    'deny reason mentions that target is outside the bible root'
  );
});

// ---------------------------------------------------------------------------
// (e) .studio/ write: allowed (empty stdout), no snapshot, no session-write flag
// ---------------------------------------------------------------------------
test('(e) .studio/ write: empty stdout, no snapshot, no session-write flag', () => {
  const book = cloneSampleBook('e-studio');
  const studioTarget = join(book, '.studio', 'progress.json');
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');

  // Confirm no flag pre-exists in the fresh clone
  const flagBefore = existsSync(flagPath);

  const result = runHook(makeWriteEvent(book, studioTarget));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (allow) for .studio/ write');

  // Flag must not have been written by this hook run
  if (!flagBefore) {
    assert.ok(!existsSync(flagPath), 'session-write flag NOT written for .studio/ target');
  }

  // No snapshot for .studio/ target (progress.json snapshot would be named progress.*.md)
  const studioSnapshots = readdirSync(join(book, '.studio', 'snapshots'))
    .filter(f => f.startsWith('progress.') && f.endsWith('.md'));
  assert.equal(studioSnapshots.length, 0, 'no snapshot created for .studio/ write');
});

// ---------------------------------------------------------------------------
// (f) Read tool: empty stdout, exit 0, nothing written
// ---------------------------------------------------------------------------
test('(f) Read tool: empty stdout, exit 0, no flag written', () => {
  const book = cloneSampleBook('f-read');
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');
  const result = runHook(makeReadEvent(book));

  assert.equal(result.status, 0, 'exit code is 0 for Read tool');
  assert.equal(result.stdout.trim(), '', 'stdout is empty for Read tool');
  assert.ok(!existsSync(flagPath), 'Read tool does not write the session-write flag');
});

// ---------------------------------------------------------------------------
// (g) Bash rm -rf and git reset --hard: additionalContext caution, no decision
// ---------------------------------------------------------------------------
test('(g) Bash rm -rf: additionalContext caution, no permissionDecision', () => {
  const book = cloneSampleBook('g-bash-rmrf');
  const result = runHook(makeBashEvent(book, 'rm -rf /tmp/foo'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PreToolUse', 'hookEventName is PreToolUse');
  assert.ok(
    typeof hso.additionalContext === 'string' && hso.additionalContext.includes('rm -rf'),
    'additionalContext names the rm -rf pattern'
  );
  assert.equal(hso.permissionDecision, undefined, 'no permissionDecision field for caution');
});

test('(g) Bash git reset --hard: additionalContext caution, no permissionDecision', () => {
  const book = cloneSampleBook('g-bash-reset');
  const result = runHook(makeBashEvent(book, 'git reset --hard HEAD~1'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');

  const hso = out.hookSpecificOutput;
  assert.ok(
    typeof hso.additionalContext === 'string' && hso.additionalContext.includes('git reset --hard'),
    'additionalContext names the git reset --hard pattern'
  );
  assert.equal(hso.permissionDecision, undefined, 'no permissionDecision field for caution');
});

// ---------------------------------------------------------------------------
// (h) benign Bash: empty stdout (allow)
// ---------------------------------------------------------------------------
test('(h) benign Bash: empty stdout, exit 0', () => {
  const book = cloneSampleBook('h-bash-benign');
  const result = runHook(makeBashEvent(book, 'ls -la'));

  assert.equal(result.status, 0, 'exit code is 0 for benign Bash');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (allow) for benign Bash');
});

// ---------------------------------------------------------------------------
// (i) no book root: empty stdout, exit 0
// ---------------------------------------------------------------------------
test('(i) no book root: empty stdout, exit 0', () => {
  const emptyDir = makeTmpDir('i-no-root');
  const outsideTarget = join(emptyDir, 'chapters', 'test.md');

  const event = JSON.stringify({
    session_id: 'test-session-032',
    cwd: emptyDir,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: outsideTarget, content: 'x' },
    tool_use_id: 'toolu_test032'
  });

  const result = runHook(event);

  assert.equal(result.status, 0, 'exit code is 0 when no book root is found');
  assert.equal(result.stdout.trim(), '', 'stdout is empty when no book root found (no-op path)');
});

// ---------------------------------------------------------------------------
// (j) exported research-agent guard function: direct call with injected slug
// Tests the dormant OQ-14 seam by driving checkResearchAgentConstraint directly,
// proving the constraint logic is wired even while resolveActiveAgent returns null.
// ---------------------------------------------------------------------------
test('(j) research-agent guard: fact-checker denied chapters/, allowed research/', () => {
  const chaptersTarget = join(SAMPLE_BOOK, 'chapters', '01-listening-before-speaking.md');
  const researchTarget = join(SAMPLE_BOOK, 'research', 'evidence-log.md');
  const studioTarget = join(SAMPLE_BOOK, '.studio', 'progress.json');

  // fact-checker trying to write to chapters/ must be denied
  const denyReason = checkResearchAgentConstraint('fact-checker', chaptersTarget, SAMPLE_BOOK);
  assert.ok(
    typeof denyReason === 'string' && denyReason.length > 0,
    'fact-checker gets a deny reason for chapters/ write'
  );
  assert.ok(denyReason.includes('fact-checker'), 'deny reason names the agent slug');

  // fact-checker writing to research/ must be allowed (null)
  const researchAllow = checkResearchAgentConstraint('fact-checker', researchTarget, SAMPLE_BOOK);
  assert.equal(researchAllow, null, 'fact-checker allowed (null) for research/ write');

  // fact-checker writing to .studio/ must also be allowed (null)
  const studioAllow = checkResearchAgentConstraint('fact-checker', studioTarget, SAMPLE_BOOK);
  assert.equal(studioAllow, null, 'fact-checker allowed (null) for .studio/ write');

  // Non-research agent (drafting-partner) always returns null regardless of target
  const nonResearch = checkResearchAgentConstraint('drafting-partner', chaptersTarget, SAMPLE_BOOK);
  assert.equal(nonResearch, null, 'non-research agent returns null (always allowed)');

  // Null agent slug always returns null
  const nullAgent = checkResearchAgentConstraint(null, chaptersTarget, SAMPLE_BOOK);
  assert.equal(nullAgent, null, 'null agentSlug returns null (always allowed)');

  // citation-manager denied for chapters/ too (all three research agents covered)
  const citationDeny = checkResearchAgentConstraint('citation-manager', chaptersTarget, SAMPLE_BOOK);
  assert.ok(
    typeof citationDeny === 'string' && citationDeny.length > 0,
    'citation-manager also denied for chapters/ write'
  );
});

// ---------------------------------------------------------------------------
// (k) NS_HOOK_TRACE inert when unset, one line written when set
// ---------------------------------------------------------------------------
test('(k) NS_HOOK_TRACE unset: no trace file created', () => {
  const tmpDir = makeTmpDir('k-trace-unset');
  const traceFile = join(tmpDir, 'trace.jsonl');
  // Use a Read event so the hook exits quickly; trace check still fires first
  const result = runHook(makeReadEvent(tmpDir));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(!existsSync(traceFile), 'no trace file created when NS_HOOK_TRACE is unset');
});

test('(k) NS_HOOK_TRACE set: exactly one line written with event PreToolUse', () => {
  const tmpDir = makeTmpDir('k-trace-set');
  const traceFile = join(tmpDir, 'trace.jsonl');

  const result = runHook(makeReadEvent(tmpDir), { NS_HOOK_TRACE: traceFile });
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(existsSync(traceFile), 'trace file created when NS_HOOK_TRACE is set');

  const lines = readFileSync(traceFile, 'utf8').split('\n').filter(l => l.trim());
  assert.equal(lines.length, 1, 'exactly one trace line was written');

  const trace = JSON.parse(lines[0]);
  assert.equal(trace.event, 'PreToolUse', 'trace record event field is PreToolUse');
  assert.ok(typeof trace.script === 'string', 'trace record carries the script path');
  assert.ok(typeof trace.stdinRaw === 'string', 'trace record carries stdinRaw');
});

// ---------------------------------------------------------------------------
// (l) malformed stdin: exit 0, empty stdout (fail-open)
// ---------------------------------------------------------------------------
test('(l) malformed stdin: exit 0, empty stdout', () => {
  const result = runHook('{not valid json {{{{');

  assert.equal(result.status, 0, 'exit code is 0 for malformed stdin (fail-open)');
  assert.equal(result.stdout.trim(), '', 'stdout is empty for malformed stdin');
});
