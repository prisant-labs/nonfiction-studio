// tests/hooks/session-start.test.mjs
// what-it-is:   behaviour tests for hooks/session-start.mjs (TSK-031)
// what-it-does: spawns the real script with crafted snake_case SessionStart events and
//               asserts the six cases from the TSK-031 brief
// runner:       node --test "tests/hooks/*.test.mjs"
//
// Synthetic events copy the shape captured live in the TSK-030 report (snake_case stdin):
//   { session_id, transcript_path, cwd, hook_event_name, source }
//
// Never mutates committed fixtures. Temp clones are used for destructive cases (c, d, e).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  cpSync,
  existsSync,
  readFileSync,
  utimesSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'hooks', 'session-start.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a synthetic SessionStart event with the given cwd (snake_case shape
 * matching the live-captured platform event from the TSK-030 report).
 */
function makeEvent(cwd) {
  return JSON.stringify({
    session_id: 'test-session-001',
    transcript_path: '/tmp/transcript.jsonl',
    cwd,
    hook_event_name: 'SessionStart',
    source: 'startup'
  });
}

/**
 * Spawns the hook with the given cwd and optional extra env overrides.
 * NS_HOOK_TRACE is cleared from the parent env by default so tests do not
 * inherit a trace path from the developer environment.
 */
function runHook(cwd, extraEnv = {}) {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;

  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined || v === '') {
      delete env[k];
    } else {
      env[k] = String(v);
    }
  }

  return spawnSync('node', [SCRIPT], {
    input: makeEvent(cwd),
    encoding: 'utf8',
    env
  });
}

/**
 * Creates a fresh temp directory with a unique name.
 */
function makeTmpDir(label) {
  const dir = join(tmpdir(), 'ns-tsk031-' + label + '-' + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Deep-copies the sample book into a new temp path and returns it.
 * The dest path does not pre-exist so cpSync creates it as a mirror of SAMPLE_BOOK.
 */
function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-tsk031-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Case (a): golden fixture cwd
// ---------------------------------------------------------------------------
test('(a) golden fixture: exit 0, five elements present, correct sessionTitle', () => {
  const result = runHook(SAMPLE_BOOK);

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stderr, '', 'no stderr');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const hso = out.hookSpecificOutput;
  assert.ok(hso, 'output has hookSpecificOutput');
  assert.equal(hso.hookEventName, 'SessionStart', 'hookEventName is SessionStart');

  // sessionTitle from meta.json book_title
  assert.equal(hso.sessionTitle, 'The Quiet Network', 'sessionTitle matches fixture book_title');

  const ctx = hso.additionalContext;
  assert.equal(typeof ctx, 'string', 'additionalContext is a string');

  // Thesis: exact text from context/brief.md section 2 heading
  assert.ok(
    ctx.includes('Building a personal learning network is a deliberate'),
    'additionalContext includes thesis text from brief.md'
  );

  // Active chapter slug from progress.json (last working-status chapter in the fixture)
  assert.ok(
    ctx.includes('02-finding-your-network'),
    'additionalContext includes the active chapter slug'
  );

  // Style rule: first bullet under "## Do" in style-profile.md
  assert.ok(
    ctx.includes('open sections with a concrete question'),
    'additionalContext includes a style rule from the Do section'
  );

  // Open-claims count: all 10 fixture entries have status verified or interpretation = 0 open
  assert.ok(
    ctx.includes('Open claims: 0'),
    'additionalContext includes open-claims count of 0 matching the fixture ledger'
  );
});

// ---------------------------------------------------------------------------
// Case (b): empty scratch directory
// ---------------------------------------------------------------------------
test('(b) empty scratch dir: exit 0, exactly two-sentence empty-state, no sessionTitle', () => {
  const tmpDir = makeTmpDir('empty');
  const result = runHook(tmpDir);

  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const hso = out.hookSpecificOutput;
  const ctx = hso.additionalContext;

  assert.equal(typeof ctx, 'string', 'additionalContext is a string');

  // Sentence count: split on ". " gives exactly two parts
  const parts = ctx.split('. ');
  assert.equal(parts.length, 2, 'empty-state contains exactly two sentences (split on ". ")');
  assert.ok(ctx.endsWith('.'), 'empty-state ends with a period');

  // Content: first sentence mentions no book project; second names nfs-new-book
  assert.ok(ctx.includes('No book project'), 'first sentence mentions no book project');
  assert.ok(ctx.includes('nfs-new-book'), 'second sentence names the nfs-new-book flow');

  // No sessionTitle on empty-state path
  assert.equal(hso.sessionTitle, undefined, 'sessionTitle is absent on empty-state path');
});

// ---------------------------------------------------------------------------
// Case (c): stale last-gate (ts older than a touched chapter)
// ---------------------------------------------------------------------------
test('(c) stale last-gate: gate-debt line is present', () => {
  const cloneDir = cloneSampleBook('stale-gate');

  // Overwrite last-gate.json with a ts in the distant past.
  // Flat shape (F-HK-02): {version, chapter, ts, verdict, checks} is the real
  // S-08 section 11 report shape written verbatim by hooks/stop-gate.mjs -
  // NOT a per-chapter map keyed by slug.
  const gateDir = join(cloneDir, '_nonfiction-studio', 'gate');
  writeFileSync(
    join(gateDir, 'last-gate.json'),
    JSON.stringify({
      version: 2,
      chapter: '01-listening-before-speaking',
      ts: '2020-01-01T00:00:00Z',
      verdict: 'pass',
      checks: []
    }),
    'utf8'
  );

  // Touch a chapter file to make its mtime definitively newer than the stale gate ts.
  const chapterFile = join(cloneDir, 'chapters', '01-listening-before-speaking.md');
  const now = new Date();
  utimesSync(chapterFile, now, now);

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('Gate debt'), 'orientation block contains a gate-debt line');
  assert.ok(ctx.includes('nfs-check-chapter'), 'gate-debt line points at nfs-check-chapter');
});

// ---------------------------------------------------------------------------
// Case (d): fresh last-gate (ts far in the future, newer than all chapters)
// ---------------------------------------------------------------------------
test('(d) fresh last-gate: no gate-debt line', () => {
  const cloneDir = cloneSampleBook('fresh-gate');

  // Overwrite last-gate.json with a ts far in the future.
  // Flat shape (F-HK-02): see the case (c) comment above.
  const gateDir = join(cloneDir, '_nonfiction-studio', 'gate');
  writeFileSync(
    join(gateDir, 'last-gate.json'),
    JSON.stringify({
      version: 2,
      chapter: '01-listening-before-speaking',
      ts: '2099-12-31T23:59:59Z',
      verdict: 'pass',
      checks: []
    }),
    'utf8'
  );

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(!ctx.includes('Gate debt'), 'no gate-debt line when last-gate is newer than all chapters');
});

// ---------------------------------------------------------------------------
// Case (e): malformed progress.json
// ---------------------------------------------------------------------------
test('(e) malformed progress.json: exit 0, partial block, exactly one error line', () => {
  const cloneDir = cloneSampleBook('malformed-progress');

  // Corrupt progress.json with non-JSON content.
  writeFileSync(join(cloneDir, '_nonfiction-studio', 'progress.json'), 'not valid json {{', 'utf8');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0 despite malformed progress.json');

  // stdout must still parse as valid JSON
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const ctx = out.hookSpecificOutput.additionalContext;

  // Thesis should still be present (brief.md is intact in the clone)
  assert.ok(
    ctx.includes('Building a personal learning network is a deliberate'),
    'thesis is still present in the partial orientation block'
  );

  // Errors log must be created with exactly one entry (the progress.json failure).
  const errorsPath = join(cloneDir, '_nonfiction-studio', 'logs', 'errors.jsonl');
  assert.ok(existsSync(errorsPath), 'errors.jsonl was created by the fail-open handler');

  const errLines = readFileSync(errorsPath, 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '');
  assert.equal(errLines.length, 1, 'exactly one error line was appended to errors.jsonl');

  const errRecord = JSON.parse(errLines[0]);
  assert.equal(errRecord.hook, 'SessionStart', 'error record identifies hook: SessionStart');
  assert.ok(typeof errRecord.msg === 'string', 'error record carries a msg string');
  assert.ok(typeof errRecord.err === 'string', 'error record carries an err string');
});

// ---------------------------------------------------------------------------
// Case (g): corrupt meta.json - TSK-034 (stop-gate hook) error-code discrimination
// ---------------------------------------------------------------------------
test('(g) corrupt meta.json: exit 0, truthful one-line message, no sessionTitle', () => {
  const cloneDir = cloneSampleBook('corrupt-meta');

  writeFileSync(join(cloneDir, '_nonfiction-studio', 'meta.json'), 'not valid json {{', 'utf8');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0 despite corrupt meta.json');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'SessionStart', 'hookEventName is SessionStart');

  const ctx = hso.additionalContext;
  assert.equal(typeof ctx, 'string', 'additionalContext is a string');

  // Truthful: names the real problem, not the misleading "no book project" text.
  assert.ok(!ctx.includes('No book project'), 'message does not claim no book project exists');
  assert.ok(ctx.includes('meta.json'), 'message names meta.json as the real problem');

  // No sessionTitle on this path (meta could not be read).
  assert.equal(hso.sessionTitle, undefined, 'sessionTitle is absent when meta.json is corrupt');
});

// ---------------------------------------------------------------------------
// Case (h): corrupt config.json - TSK-034 (stop-gate hook) error-code discrimination
// ---------------------------------------------------------------------------
test('(h) corrupt config.json: exit 0, truthful one-line message, no sessionTitle', () => {
  const cloneDir = cloneSampleBook('corrupt-config');

  writeFileSync(join(cloneDir, '_nonfiction-studio', 'config.json'), 'not valid json {{', 'utf8');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0 despite corrupt config.json');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'SessionStart', 'hookEventName is SessionStart');

  const ctx = hso.additionalContext;
  assert.equal(typeof ctx, 'string', 'additionalContext is a string');

  // Truthful: names the real problem, not the misleading "no book project" text.
  assert.ok(!ctx.includes('No book project'), 'message does not claim no book project exists');
  assert.ok(ctx.includes('config.json'), 'message names config.json as the real problem');

  // No sessionTitle on this path (root detection threw before orientation ran).
  assert.equal(hso.sessionTitle, undefined, 'sessionTitle is absent when config.json is corrupt');
});

// ---------------------------------------------------------------------------
// Wave 1 exit Task 2: house-notes pointer line
// ---------------------------------------------------------------------------

const HOUSE_NOTES_LINE =
  'House notes: .claude/nonfiction-studio.local.md carries standing author instructions; ' +
  'read and honor them.';

function writeSettingsFile(dir, text) {
  const settingsDir = join(dir, '.claude');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, 'nonfiction-studio.local.md'), text, 'utf8');
}

test('(i) settings file with a non-empty body: the house-notes pointer line is appended', () => {
  const cloneDir = cloneSampleBook('house-notes-present');
  writeSettingsFile(cloneDir, '---\ngate_mode: warn\n---\nAlways cite page numbers.\n');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes(HOUSE_NOTES_LINE), 'orientation block includes the house-notes pointer line');
});

test('(j) no settings file: the house-notes pointer line is absent', () => {
  const cloneDir = cloneSampleBook('house-notes-absent');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(!ctx.includes(HOUSE_NOTES_LINE), 'no pointer line when no settings file exists');
});

test('(k) settings file present but body is empty (frontmatter only): the pointer line is absent', () => {
  const cloneDir = cloneSampleBook('house-notes-empty-body');
  writeSettingsFile(cloneDir, '---\ngate_mode: warn\n---\n');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(!ctx.includes(HOUSE_NOTES_LINE), 'no pointer line when the settings body is empty');
});

test('(l) unreadable settings path (a directory in place of the file): fail-open -- orientation block still emitted, no pointer line, no throw', () => {
  const cloneDir = cloneSampleBook('house-notes-unreadable');
  // A directory where the settings file should be: existsSync is true, readFileSync throws.
  mkdirSync(join(cloneDir, '.claude', 'nonfiction-studio.local.md'), { recursive: true });

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0 even when the settings path is unreadable');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout still parses as JSON');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(
    ctx.includes('Building a personal learning network is a deliberate'),
    'the rest of the orientation block still comes through (fail-open)'
  );
  assert.ok(!ctx.includes(HOUSE_NOTES_LINE), 'no pointer line when the settings file could not be read');
});

// ---------------------------------------------------------------------------
// Case (f): NS_HOOK_TRACE unset vs set
// ---------------------------------------------------------------------------
test('(f) NS_HOOK_TRACE unset: no trace file written', () => {
  const tmpDir = makeTmpDir('trace-unset');
  const traceFile = join(tmpDir, 'trace.jsonl');

  // runHook clears NS_HOOK_TRACE by default; empty dir gives empty-state path, which is fine.
  const result = runHook(tmpDir);
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(!existsSync(traceFile), 'no trace file exists when NS_HOOK_TRACE is unset');
});

test('(f) NS_HOOK_TRACE set: exactly one trace line written with correct event name', () => {
  const tmpDir = makeTmpDir('trace-set');
  const traceFile = join(tmpDir, 'trace.jsonl');

  const result = runHook(tmpDir, { NS_HOOK_TRACE: traceFile });
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(existsSync(traceFile), 'trace file was created when NS_HOOK_TRACE is set');

  const lines = readFileSync(traceFile, 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '');
  assert.equal(lines.length, 1, 'exactly one trace line was written');

  const trace = JSON.parse(lines[0]);
  assert.equal(trace.event, 'SessionStart', 'trace record has event: SessionStart');
  assert.ok(typeof trace.script === 'string', 'trace record carries the script path');
  assert.ok(typeof trace.stdinRaw === 'string', 'trace record carries stdinRaw');
});

// ---------------------------------------------------------------------------
// Wave 1 exit Task 4: zero-friction first session (initialUserMessage, reloadSkills)
// ---------------------------------------------------------------------------
//
// Platform placement per the Task 1 probe: both fields are read from
// hookSpecificOutput.* only - top-level placement is silently ignored by the platform.
// initialUserMessage fires ONLY when NO_BOOK_ROOT fires AND the directory is truly empty
// (no entries beyond the allowlist: .claude, .git, .gitignore, .DS_Store, Thumbs.db).
// NO_BOOK_ROOT alone is not sufficient - it fires in every non-book directory, including an
// unrelated repo with the plugin installed at user scope, and hijacking the first turn there
// would be a regression (case (o) below is that regression guard).

test('(m) truly-empty scratch dir: initialUserMessage is emitted, additionalContext prose survives', () => {
  const tmpDir = makeTmpDir('truly-empty-initmsg');
  const result = runHook(tmpDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');
  const hso = out.hookSpecificOutput;

  assert.equal(
    hso.initialUserMessage,
    '/nonfiction-studio:nfs-start',
    'initialUserMessage names the studio front door, nested under hookSpecificOutput'
  );
  assert.ok(hso.additionalContext.includes('No book project'), 'additionalContext prose survives (first sentence)');
  assert.ok(hso.additionalContext.includes('nfs-new-book'), 'additionalContext prose survives (second sentence)');
});

test('(n) dir containing only allowlisted entries (.git, .claude, .gitignore): still counts as truly empty', () => {
  const tmpDir = makeTmpDir('allowlist-only');
  mkdirSync(join(tmpDir, '.git'));
  mkdirSync(join(tmpDir, '.claude'));
  writeFileSync(join(tmpDir, '.gitignore'), '', 'utf8');

  const result = runHook(tmpDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');
  const hso = out.hookSpecificOutput;

  assert.equal(
    hso.initialUserMessage,
    '/nonfiction-studio:nfs-start',
    'allowlisted-only entries still count as truly empty'
  );
  assert.ok(hso.additionalContext.includes('No book project'), 'additionalContext prose survives');
});

test('(o) non-empty non-book dir (unrelated-repo regression guard): no initialUserMessage, additionalContext prose survives', () => {
  const tmpDir = makeTmpDir('non-empty-non-book');
  writeFileSync(join(tmpDir, 'README.md'), '# Some unrelated repo\n', 'utf8');

  const result = runHook(tmpDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');
  const hso = out.hookSpecificOutput;

  assert.equal(
    hso.initialUserMessage,
    undefined,
    'initialUserMessage is absent for a non-empty non-book directory (NO_BOOK_ROOT alone is not sufficient)'
  );
  assert.ok(hso.additionalContext.includes('No book project'), 'additionalContext prose survives (first sentence)');
  assert.ok(hso.additionalContext.includes('nfs-new-book'), 'additionalContext prose survives (second sentence)');
});

test('(p) corrupt meta.json branch: no initialUserMessage, truthful message still present', () => {
  const cloneDir = cloneSampleBook('corrupt-meta-initmsg');
  writeFileSync(join(cloneDir, '_nonfiction-studio', 'meta.json'), 'not valid json {{', 'utf8');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');
  const hso = out.hookSpecificOutput;

  assert.equal(hso.initialUserMessage, undefined, 'initialUserMessage is absent on the corrupt-bible branch');
  assert.ok(hso.additionalContext.includes('meta.json'), 'additionalContext prose survives (names the real problem)');
});

test('(q) normal-book branch (golden fixture): no initialUserMessage is emitted [mutation-proof: emitting initialUserMessage on the normal-book branch turns this test red]', () => {
  const result = runHook(SAMPLE_BOOK);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');
  const hso = out.hookSpecificOutput;

  assert.equal(hso.initialUserMessage, undefined, 'initialUserMessage is absent on the normal-book branch');
  assert.ok(
    hso.additionalContext.includes('Building a personal learning network is a deliberate'),
    'orientation block prose survives'
  );
});

test('(r) book-context skill present: reloadSkills is true on the normal-book branch', () => {
  const cloneDir = cloneSampleBook('book-context-present');
  const skillDir = join(cloneDir, '.claude', 'skills', 'book-context');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: book-context\nuser-invocable: true\ndescription: "test"\n---\n\nBody.\n',
    'utf8'
  );

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');
  assert.equal(
    out.hookSpecificOutput.reloadSkills,
    true,
    'reloadSkills is true when .claude/skills/book-context/SKILL.md exists'
  );
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes('Building a personal learning network is a deliberate'),
    'orientation block prose survives'
  );
});

test('(s) book-context skill absent: reloadSkills is absent on the normal-book branch (golden fixture has no such file)', () => {
  const result = runHook(SAMPLE_BOOK);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');
  assert.equal(out.hookSpecificOutput.reloadSkills, undefined, 'reloadSkills is absent when no book-context skill exists');
});

test('(t) unreadable .claude/skills (a file in place of the directory): fail-open -- normal orientation output still yields, no throw, no reloadSkills', () => {
  const cloneDir = cloneSampleBook('book-context-unreadable');
  // A file where the skills directory should be: existsSync-style checks alone would just
  // silently return false, so this instead forces a genuine throw (ENOTDIR) inside the new
  // reloadSkills-existence check, proving the fail-open wrapper actually catches something
  // rather than merely never being exercised.
  mkdirSync(join(cloneDir, '.claude'), { recursive: true });
  writeFileSync(join(cloneDir, '.claude', 'skills'), 'not a directory', 'utf8');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0 even when .claude/skills is unreadable as a directory');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout still parses as JSON');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(
    ctx.includes('Building a personal learning network is a deliberate'),
    'the orientation block still comes through (fail-open)'
  );
  assert.equal(
    out.hookSpecificOutput.reloadSkills,
    undefined,
    'reloadSkills is absent when the existence check could not complete'
  );
});

// ---------------------------------------------------------------------------
// Existing writing (ADR-0016, adopting an existing book): a directory with no book root that
// already holds Markdown beyond a top-level README.md is somebody's manuscript. Pointing it at
// the new-book flow would stamp an empty project beside that manuscript, so this path names
// only what works without a project and never opens the front door unprompted.
// ---------------------------------------------------------------------------

/** Writes each relative path in `files` under `root` with placeholder Markdown. */
function writeFilesUnder(root, files) {
  for (const rel of files) {
    const path = join(root, ...rel.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '# x\n', 'utf8');
  }
}

test('(u) existing writing: never names the new-book flow or the front door, names nfs-adopt, no initialUserMessage', () => {
  const tmpDir = makeTmpDir('existing-writing');
  writeFilesUnder(tmpDir, ['README.md', 'manuscript/ch01.md']);

  const result = runHook(tmpDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');
  const hso = out.hookSpecificOutput;

  assert.ok(hso.additionalContext.includes('No book project was found'), 'states that no book project exists');
  assert.ok(hso.additionalContext.includes('already holds writing'), 'names the existing writing');
  assert.ok(!hso.additionalContext.includes('nfs-new-book'), 'never points at the new-book flow');
  assert.ok(!hso.additionalContext.includes('nfs-start'), 'never points at the front door, which offers the new-book flow');
  assert.ok(hso.additionalContext.includes('/nonfiction-studio:nfs-adopt'), 'names the skill that adopts the writing in place (ADR-0016)');
  assert.equal(hso.initialUserMessage, undefined, 'never opens the front door unprompted');
  assert.equal(hso.sessionTitle, undefined, 'no sessionTitle without a book');
});

test('(x) Markdown only in hidden tool folders such as .github/ and .cursor/: still the two-sentence D-17 message [mutation-proof: walking hidden folders turns this red]', () => {
  const tmpDir = makeTmpDir('hidden-tool-markdown');
  writeFilesUnder(tmpDir, ['.github/PULL_REQUEST_TEMPLATE.md', '.cursor/rules/style.md']);

  const ctx = JSON.parse(runHook(tmpDir).stdout.trim()).hookSpecificOutput.additionalContext;
  assert.equal(ctx.split('. ').length, 2, 'the D-17 message keeps exactly two sentences');
  assert.ok(ctx.includes('nfs-new-book'), 'a folder whose only Markdown is tool state still points at the new-book flow');
});

test('(v) Markdown only under .git/ and .claude/: still the two-sentence D-17 message [mutation-proof: counting either folder turns this red]', () => {
  const tmpDir = makeTmpDir('tooling-markdown');
  writeFilesUnder(tmpDir, ['.git/description.md', '.claude/skills/x/SKILL.md']);

  const out = JSON.parse(runHook(tmpDir).stdout.trim());
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.equal(ctx.split('. ').length, 2, 'the D-17 message keeps exactly two sentences');
  assert.ok(ctx.includes('nfs-new-book'), 'a folder with no writing still points at the new-book flow');
  assert.equal(
    out.hookSpecificOutput.initialUserMessage,
    '/nonfiction-studio:nfs-start',
    'allowlisted entries alone still count as truly empty'
  );
});

test('(w) a README.md below the top level counts as existing writing', () => {
  const tmpDir = makeTmpDir('nested-readme');
  writeFilesUnder(tmpDir, ['README.md', 'notes/README.md']);

  const ctx = JSON.parse(runHook(tmpDir).stdout.trim()).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('already holds writing'), 'only the top-level README.md is exempt');
  assert.ok(!ctx.includes('nfs-new-book'), 'never points at the new-book flow');
});
