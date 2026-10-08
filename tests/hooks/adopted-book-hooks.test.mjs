// tests/hooks/adopted-book-hooks.test.mjs
// what-it-is:   hook behavior in an adopted book, per ADR-0016 (adopting an existing book)
// what-it-does: spawns the real PreToolUse, PostToolBatch and SessionStart hooks against a temp
//               copy of examples/fixtures/adopted-book/, adopted the way nfs-adopt adopts it,
//               and asserts what works on the day of adoption: word counts measured on prose
//               only, the AI-use log, snapshots and the session-write flag for the book's own
//               chapters folder, the narrowed research-librarian scope, the orientation block's
//               "not adopted" line, and the front door's message before adoption
// runner:       node --test "tests/hooks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { countWords } from '../../hooks/lib/stylometry-engine.mjs';
import {
  REPO_ROOT,
  adoptFixture,
  copyFixture,
  FIXTURE_BOUNDARY,
  FIXTURE_CHAPTERS_DIR,
} from '../lib/adopted-books.mjs';

const HOOKS = join(REPO_ROOT, 'hooks');
const STATE = '_nonfiction-studio';

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const track = (root) => {
  made.push(dirname(root));
  return root;
};

function runHook(script, event) {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;
  const result = spawnSync('node', [join(HOOKS, script)], { input: JSON.stringify(event), encoding: 'utf8', env });
  assert.equal(result.status, 0, script + ' exits 0; stderr: ' + result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
}

const base = (cwd, name) => ({ session_id: 'adopt-test', transcript_path: '/tmp/t.jsonl', cwd, hook_event_name: name });

function preWrite(root, filePath, agentType = null) {
  const event = Object.assign(base(root, 'PreToolUse'), {
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: 'x' },
    tool_use_id: 'toolu_adopt',
  });
  if (agentType) {
    event.agent_id = 'atest0000adopted';
    event.agent_type = agentType;
  }
  return runHook('pre-tool-use.mjs', event);
}

function batchWrite(root, filePath) {
  return runHook('post-tool-batch.mjs', Object.assign(base(root, 'PostToolBatch'), {
    tool_calls: [{ tool_name: 'Write', tool_input: { file_path: filePath, content: 'x' }, tool_use_id: 'toolu_b', tool_response: 'ok' }],
  }));
}

/** The boundary cut, spelled out here so this suite does not depend on the module it tests. */
function proseWords(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.replace(/\s+$/, '') === FIXTURE_BOUNDARY);
  return countWords(at === -1 ? text : lines.slice(0, at).join('\n') + '\n');
}

const denied = (out) => Boolean(out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision === 'deny');

// ---- PostToolBatch --------------------------------------------------------------------------

test('a chapter write in the book\'s own chapters folder updates its word count, measured on prose only', () => {
  const root = track(adoptFixture('hk-count'));
  const file = join(root, FIXTURE_CHAPTERS_DIR, 'ch01-the-first-question.md');
  const text = readFileSync(file, 'utf8');
  batchWrite(root, file);
  const progress = JSON.parse(readFileSync(join(root, STATE, 'progress.json'), 'utf8'));
  const entry = progress.chapters.find((c) => c.slug === 'ch01-the-first-question');
  assert.ok(entry, 'the seeded entry is kept');
  assert.equal(entry.word_count, proseWords(text), 'the apparatus table is not counted');
  assert.ok(entry.word_count < countWords(text), 'the boundary removed words');
});

test('a chapter write in the book\'s own chapters folder is logged in the AI-use log', () => {
  const root = track(adoptFixture('hk-log'));
  batchWrite(root, join(root, FIXTURE_CHAPTERS_DIR, 'introduction.md'));
  const lines = readFileSync(join(root, STATE, 'ai-use-log.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.ok(JSON.parse(lines[0]).targets[0].includes('introduction'), lines[0]);
});

test('a write to the author\'s research files is not a chapter write', () => {
  const root = track(adoptFixture('hk-not-chapter'));
  batchWrite(root, join(root, 'research', 'interview-guide.md'));
  assert.equal(readFileSync(join(root, STATE, 'ai-use-log.jsonl'), 'utf8'), '');
});

test('a chapter whose name has a space and an apostrophe gets its own progress entry', () => {
  const root = track(adoptFixture('hk-free-slug'));
  const file = join(root, FIXTURE_CHAPTERS_DIR, "Author's Afterword.md");
  writeFileSync(file, '# Afterword\n\nA few closing words for the reader.\n');
  batchWrite(root, file);
  const progress = JSON.parse(readFileSync(join(root, STATE, 'progress.json'), 'utf8'));
  const entry = progress.chapters.find((c) => c.slug === "Author's Afterword");
  assert.ok(entry, JSON.stringify(progress.chapters.map((c) => c.slug)));
  assert.equal(entry.word_count, countWords('# Afterword\n\nA few closing words for the reader.\n'));
});

// ---- PreToolUse -----------------------------------------------------------------------------

test('overwriting a chapter in the book\'s own chapters folder takes a snapshot and sets the session-write flag', () => {
  const root = track(adoptFixture('hk-snapshot'));
  const out = preWrite(root, join(root, FIXTURE_CHAPTERS_DIR, 'ch02-what-the-numbers-hid.md'));
  assert.ok(!denied(out), JSON.stringify(out));
  const snaps = readdirSync(join(root, STATE, 'snapshots')).filter((f) => f.startsWith('ch02-what-the-numbers-hid.'));
  assert.equal(snaps.length, 1, 'one snapshot of the raw file');
  assert.ok(existsSync(join(root, STATE, 'gate', '.session-write-flag')));
});

test('a snapshot of a chapter with a free-form name keeps the name', () => {
  const root = track(adoptFixture('hk-snapshot-name'));
  const file = join(root, FIXTURE_CHAPTERS_DIR, "Author's Afterword.md");
  writeFileSync(file, '# Afterword\n');
  preWrite(root, file);
  const snaps = readdirSync(join(root, STATE, 'snapshots')).filter((f) => f.endsWith('.md'));
  assert.equal(snaps.length, 1);
  assert.ok(snaps[0].startsWith("Author's Afterword."), snaps[0]);
});

test('research-librarian may not write the author\'s files in a shared research/ folder', () => {
  const root = track(adoptFixture('hk-librarian'));
  const out = preWrite(root, join(root, 'research', 'ethics-protocol.md'), 'nonfiction-studio:research-librarian');
  assert.ok(denied(out), 'denied: ' + JSON.stringify(out));
  const ok = preWrite(root, join(root, 'research', 'evidence-log.md'), 'nonfiction-studio:research-librarian');
  assert.ok(!denied(ok), 'the plugin\'s own ledger stays writable');
});

test('drafting-partner may write the book\'s own chapters and nothing outside them', () => {
  const root = track(adoptFixture('hk-drafter'));
  const out = preWrite(root, join(root, FIXTURE_CHAPTERS_DIR, 'ch03-the-busy-teams.md'), 'nonfiction-studio:drafting-partner');
  assert.ok(!denied(out), JSON.stringify(out));
  const outside = preWrite(root, join(root, 'evidence', 'claim-ledger.md'), 'nonfiction-studio:drafting-partner');
  assert.ok(denied(outside), 'the author\'s ledger is out of scope: ' + JSON.stringify(outside));
});

// ---- SessionStart ---------------------------------------------------------------------------

test('the orientation block names the unadopted elements and logs no read errors for them', () => {
  const root = track(adoptFixture('hk-orient'));
  const out = runHook('session-start.mjs', base(root, 'SessionStart'));
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /Not adopted: style, brief, structure, claims/);
  assert.equal(out.hookSpecificOutput.sessionTitle, 'Counting What Matters');
  assert.ok(!existsSync(join(root, STATE, 'logs', 'errors.jsonl')), 'an unadopted element is not a read failure');
});

test('the orientation block reports gate debt from the book\'s own chapters folder', () => {
  const root = track(adoptFixture('hk-debt'));
  const ctx = runHook('session-start.mjs', base(root, 'SessionStart')).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Gate debt/, 'no gate has run, and the manuscript holds chapters');
});

test('before adoption, the front door names nfs-adopt and still never names the new-book flow', () => {
  const root = track(copyFixture('hk-front-door'));
  const ctx = runHook('session-start.mjs', base(root, 'SessionStart')).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('/nonfiction-studio:nfs-adopt'), ctx);
  assert.ok(!ctx.includes('nfs-new-book'), ctx);
});
