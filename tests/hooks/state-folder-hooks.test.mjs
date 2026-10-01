// tests/hooks/state-folder-hooks.test.mjs
// what-it-is:   hook, CLI, and settings tests for the configurable state folder (ADR-0015)
// what-it-does: drives the real hook scripts and CLIs against books whose state folder is
//               custom-named, unpointed, or behind a bad pointer, and pins the settings
//               reader's refusal of a state_dir key
// runner:       node --test tests/hooks/state-folder-hooks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadSettings } from '../../hooks/lib/settings.mjs';
import {
  REPO_ROOT,
  POINTER_FILE,
  makeTmpDir,
  writePointer,
  cloneSampleBookWithStateDir,
} from '../lib/state-folder-books.mjs';

const SESSION_START = join(REPO_ROOT, 'hooks', 'session-start.mjs');
const PRE_TOOL_USE = join(REPO_ROOT, 'hooks', 'pre-tool-use.mjs');
const NS_DOCTOR = join(REPO_ROOT, 'bin', 'ns-doctor');
const NS_GATE = join(REPO_ROOT, 'bin', 'ns-gate');
const CHAPTER = join('chapters', '01-listening-before-speaking.md');

function cleanEnv() {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;
  return env;
}

function runSessionStart(cwd) {
  const input = JSON.stringify({
    session_id: 'state-folder-test',
    transcript_path: '/tmp/t.jsonl',
    cwd,
    hook_event_name: 'SessionStart',
    source: 'startup',
  });
  const r = spawnSync('node', [SESSION_START], { input, encoding: 'utf8', env: cleanEnv() });
  assert.equal(r.status, 0, 'session-start exits 0; stderr: ' + r.stderr);
  return JSON.parse(r.stdout.trim()).hookSpecificOutput;
}

function runWrite(cwd, filePath) {
  const input = JSON.stringify({
    session_id: 'state-folder-test',
    transcript_path: '/tmp/t.jsonl',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: 'state folder test content' },
    tool_use_id: 'toolu_state_folder',
  });
  const r = spawnSync('node', [PRE_TOOL_USE], { input, encoding: 'utf8', env: cleanEnv() });
  assert.equal(r.status, 0, 'pre-tool-use exits 0; stderr: ' + r.stderr);
  const out = r.stdout.trim();
  return out ? JSON.parse(out).hookSpecificOutput : null;
}

function runCli(script, args) {
  return spawnSync('node', [script, ...args], { encoding: 'utf8', env: cleanEnv() });
}

// ---- a custom-named state folder behind a valid pointer ------------------------------------

test('session start orients a book whose state folder is custom-named', () => {
  const book = cloneSampleBookWithStateDir('ss-custom', 'records');
  const out = runSessionStart(book);
  assert.ok(
    !String(out.additionalContext).includes('No book project was found'),
    'the book is found, not treated as empty: ' + out.additionalContext
  );
});

test('a chapter overwrite snapshots into the custom state folder and sets its session-write flag', () => {
  const book = cloneSampleBookWithStateDir('ptu-custom', 'records');
  const out = runWrite(book, join(book, CHAPTER));
  assert.ok(!out || out.permissionDecision !== 'deny', 'the write is allowed: ' + JSON.stringify(out));
  const snapshots = join(book, 'records', 'snapshots');
  assert.ok(
    existsSync(snapshots) && readdirSync(snapshots).some((f) => f.startsWith('01-listening-before-speaking.')),
    'a snapshot of the chapter landed in records/snapshots/'
  );
  assert.ok(existsSync(join(book, 'records', 'gate', '.session-write-flag')), 'the flag landed in records/gate/');
});

test('ns-gate writes its report into the custom state folder', () => {
  const book = cloneSampleBookWithStateDir('gate-custom', 'records');
  const r = runCli(NS_GATE, ['--project=' + book, '--json']);
  assert.ok(r.status === 0 || r.status === 1, 'ns-gate ran (exit 0 or 1), got ' + r.status + '; stderr: ' + r.stderr);
  const gateDir = join(book, 'records', 'gate');
  assert.ok(existsSync(gateDir) && readdirSync(gateDir).some((f) => f.endsWith('.json')), 'a gate report is in records/gate/');
});

test('ns-doctor checks a custom-named state folder and finds it valid', () => {
  const book = cloneSampleBookWithStateDir('doctor-custom', 'records');
  const r = runCli(NS_DOCTOR, ['--project=' + book]);
  assert.equal(r.status, 0, 'ns-doctor passes; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
});

// ---- a bad pointer --------------------------------------------------------------------------

test('a bad pointer denies a chapter write and names the pointer file', () => {
  const book = cloneSampleBookWithStateDir('ptu-bad', 'records', { pointer: false });
  writePointer(book, 'not valid json {{');
  const out = runWrite(book, join(book, CHAPTER));
  assert.ok(out, 'the hook produced a decision');
  assert.equal(out.permissionDecision, 'deny', 'writes are denied while the pointer is bad');
  assert.ok(out.permissionDecisionReason.includes(POINTER_FILE), 'the reason names the pointer: ' + out.permissionDecisionReason);
});

test('a bad pointer still lets the author repair the pointer file itself', () => {
  const book = cloneSampleBookWithStateDir('ptu-repair', 'records', { pointer: false });
  writePointer(book, 'not valid json {{');
  const out = runWrite(book, join(book, POINTER_FILE));
  assert.ok(!out || out.permissionDecision !== 'deny', 'the repair write is not denied: ' + JSON.stringify(out));
});

test('session start reports a bad pointer instead of an empty directory', () => {
  const book = cloneSampleBookWithStateDir('ss-bad', 'records', { pointer: false });
  writePointer(book, { state_dir: 'chapters' });
  const out = runSessionStart(book);
  assert.ok(String(out.additionalContext).includes(POINTER_FILE), 'names the pointer: ' + out.additionalContext);
  assert.ok(!String(out.additionalContext).includes('nfs-new-book'), 'never points at the new-book flow');
});

test('ns-doctor reports a bad pointer as a finding and exits 2', () => {
  const book = cloneSampleBookWithStateDir('doctor-bad', 'records', { pointer: false });
  writePointer(book, '{}');
  const r = runCli(NS_DOCTOR, ['--project=' + book]);
  assert.equal(r.status, 2, 'exit 2');
  assert.ok(r.stdout.includes('state.pointer-invalid'), 'the finding type is reported: ' + r.stdout + r.stderr);
});

// ---- an unpointed state folder ----------------------------------------------------------------

test('session start names an unpointed state folder and routes to nfs-doctor, never to the new-book flow', () => {
  const book = cloneSampleBookWithStateDir('ss-unpointed', 'records', { pointer: false });
  const out = runSessionStart(book);
  const text = String(out.additionalContext);
  assert.ok(text.includes('records'), 'names the folder: ' + text);
  assert.ok(text.includes('nfs-doctor'), 'names the fix: ' + text);
  assert.ok(!text.includes('nfs-new-book'), 'never points at the new-book flow: ' + text);
  assert.equal(out.initialUserMessage, undefined, 'does not open the dispatcher');
});

test('ns-doctor reports an unpointed state folder as a finding and exits 2', () => {
  const book = cloneSampleBookWithStateDir('doctor-unpointed', 'records', { pointer: false });
  const r = runCli(NS_DOCTOR, ['--project=' + book]);
  assert.equal(r.status, 2, 'exit 2');
  assert.ok(r.stdout.includes('state.unpointed-folder'), 'the finding type is reported: ' + r.stdout + r.stderr);
  assert.ok(r.stdout.includes('records'), 'the folder is named');
});

test('ns-doctor --json reports an unpointed state folder with a machine-readable status', () => {
  const book = cloneSampleBookWithStateDir('doctor-unpointed-json', 'records', { pointer: false });
  const r = runCli(NS_DOCTOR, ['--project=' + book, '--json']);
  assert.equal(r.status, 2, 'exit 2');
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'state-folder-unpointed');
  assert.deepEqual(json.findings.map((f) => f.type), ['state.unpointed-folder']);
  assert.equal(json.findings[0].path, 'records/');
});

// ---- the personal settings file cannot move the records ---------------------------------------

test('the personal settings file drops a state_dir key with a warning that names the pointer file', () => {
  const dir = makeTmpDir('settings-state-dir');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'nonfiction-studio.local.md'), '---\nstate_dir: records\n---\n', 'utf8');
  const result = loadSettings(dir);
  assert.equal(result.settings.state_dir, undefined, 'the key is not passed through');
  assert.ok(result.droppedKeys.includes('state_dir'), 'the key is reported as dropped');
  assert.ok(String(result.warning).includes(POINTER_FILE), 'the warning names the pointer file: ' + result.warning);
});
