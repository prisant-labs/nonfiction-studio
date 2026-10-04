// tests/hooks/hooks-json.test.mjs
// what-it-is:   wrapper tests for scripts/check-hooks-schema.mjs
// what-it-does: asserts the checker exits 0 for the committed hooks/hooks.json, and runs a copy
//               of the checker inside a temp tree to prove its command-string rule: an unquoted
//               ${CLAUDE_PLUGIN_ROOT} is a finding, and a quoted one passes even when the plugin
//               root's path contains a space.
// why:          all hook-schema logic lives in scripts/check-hooks-schema.mjs per TSK-055
//               (Tier A check scripts) resolution 1 (single source of logic). The temp-tree
//               cases are the mutation proof for the quoting rule, which exists because the
//               platform's strict validator rejects an unquoted placeholder: an install path
//               with a space would split the command into several words.
// runner:       node --test "tests/hooks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-hooks-schema.mjs');
const HOOKS_JSON = join(REPO_ROOT, 'hooks', 'hooks.json');

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function runChecker(script, cwd) {
  const result = spawnSync('node', [script], { encoding: 'utf8', cwd, env: process.env });
  if (result.error) throw result.error;
  return result;
}

/**
 * Builds a temp plugin tree whose root path contains a space: a copy of the checker under
 * scripts/, an empty stub for every hook script the committed hooks.json names, and a
 * hooks.json produced by `transform` from the committed one. Returns the checker's path.
 */
function treeWith(label, transform) {
  const root = join(mkdtempSync(join(tmpdir(), 'ns-hooks-json-')), 'plugin root ' + label);
  made.push(dirname(root));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'hooks'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts', 'check-hooks-schema.mjs'));
  const committed = readFileSync(HOOKS_JSON, 'utf8');
  for (const m of committed.matchAll(/hooks\/([a-z-]+\.mjs)/g)) {
    writeFileSync(join(root, 'hooks', m[1]), '// stub\n');
  }
  writeFileSync(join(root, 'hooks', 'hooks.json'), transform(committed));
  return join(root, 'scripts', 'check-hooks-schema.mjs');
}

const unquote = (text) => text.replace(/"node \\"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\\]+)\\""/g, '"node ${CLAUDE_PLUGIN_ROOT}/$1"');

test('check-hooks-schema.mjs exits 0 for the committed hooks/hooks.json', () => {
  const result = runChecker(SCRIPT, REPO_ROOT);
  assert.equal(
    result.status,
    0,
    'check-hooks-schema.mjs must exit 0; stderr: ' + (result.stderr || '').trim()
  );
});

test('a quoted ${CLAUDE_PLUGIN_ROOT} passes when the plugin root path contains a space', () => {
  const script = treeWith('quoted', (text) => text);
  const result = runChecker(script, dirname(dirname(script)));
  assert.equal(result.status, 0, 'stderr: ' + (result.stderr || '').trim());
});

test('an unquoted ${CLAUDE_PLUGIN_ROOT} is a finding for every command [mutation-proof: accepting the unquoted form turns this red]', () => {
  const script = treeWith('unquoted', unquote);
  const hooksJson = readFileSync(join(dirname(dirname(script)), 'hooks', 'hooks.json'), 'utf8');
  assert.match(hooksJson, /"node \$\{CLAUDE_PLUGIN_ROOT\}\/hooks\//, 'the fixture really is unquoted');
  const result = runChecker(script, dirname(dirname(script)));
  assert.equal(result.status, 1, 'stdout: ' + result.stdout + '\nstderr: ' + result.stderr);
  const commandFindings = (result.stdout + result.stderr).split('\n').filter((l) => l.includes('does not match required pattern'));
  assert.equal(commandFindings.length, 6, 'one finding per command entry:\n' + commandFindings.join('\n'));
});
