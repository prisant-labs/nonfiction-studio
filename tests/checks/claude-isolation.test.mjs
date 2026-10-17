// tests/checks/claude-isolation.test.mjs
// what-it-is:   unit tests for scripts/lib/claude-isolation.mjs, the isolation flags and child
//               environment that both Tier B runners pass to every live `claude -p` call
// what-it-does: pins every isolation flag in both shapes (plugin hooks on, for the integration
//               runner; plugin hooks off, for the eval runner), pins that the caller must choose
//               the shape, and pins the child environment. Zero model calls.
// why:          ADR-0018 (Tier B eval harness contract) and issue #24 (run-integration.mjs runs
//               with the caller's configuration): the two runners share one module so their
//               isolation cannot drift apart.
// runner:       node --test tests/checks/claude-isolation.test.mjs (or node --test tests/checks/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isolationArgs, isolatedChildEnv } from '../../scripts/lib/claude-isolation.mjs';

const ROOT = '/repo root';

test('with plugin hooks on: the plugin loads, user settings are left out, nothing is saved, and hooks are not disabled', () => {
  assert.deepEqual(isolationArgs({ repoRoot: ROOT, pluginHooks: true }), [
    '--plugin-dir', ROOT,
    '--setting-sources', 'project',
    '--no-session-persistence',
  ]);
});

test('with plugin hooks off: the same flags, plus every hook disabled', () => {
  assert.deepEqual(isolationArgs({ repoRoot: ROOT, pluginHooks: false }), [
    '--plugin-dir', ROOT,
    '--setting-sources', 'project',
    '--settings', JSON.stringify({ disableAllHooks: true }),
    '--no-session-persistence',
  ]);
});

test('the caller must choose whether plugin hooks run, and must name the plugin root', () => {
  assert.throws(() => isolationArgs({ repoRoot: ROOT }), /pluginHooks/);
  assert.throws(() => isolationArgs({ pluginHooks: true }), /repoRoot/);
});

test('the child environment turns off every CLAUDE.md, keeps the credential and PATH, and leaves the base untouched', () => {
  const base = { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'tok' };
  const env = isolatedChildEnv(base);
  assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'tok');
  assert.equal(env.PATH, '/bin');
  assert.equal(base.CLAUDE_CODE_DISABLE_CLAUDE_MDS, undefined, 'the base environment is not mutated');
});
