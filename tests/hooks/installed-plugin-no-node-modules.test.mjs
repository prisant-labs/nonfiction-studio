// tests/hooks/installed-plugin-no-node-modules.test.mjs
// what-it-is:   regression test for C1 (Wave 1 exit final review) - the hook path required
//               node_modules/yaml, which an installed plugin never has
// what-it-does: copies the real, current hooks/lib/settings.mjs, hooks/lib/routing.mjs, and
//               hooks/lib/mini-yaml.mjs (byte for byte, straight off disk, not a fixture written
//               by this test) into a fresh OS-temp directory that shares no ancestor with this
//               repo's own node_modules tree, together with a small agents/ fixture. First proves
//               the isolation is real (a bare `require('yaml')` from the copied settings.mjs's own
//               location genuinely fails to resolve - the exact failure mode the final review
//               reproduced by hand), then imports the COPIED modules and confirms loadSettings,
//               readAgentModel, and readChainPermitted all work correctly from that isolated
//               location: gate_mode/routing_enforce survive with no warning, an agent's declared
//               model is read, and the chain contract parses into its edge table - proving the
//               settings overlay and the dispatch-routing guard are no longer inert on the
//               documented install path (`node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs`, no install
//               step, no node_modules).
// why:          C1's own reproduction: "I reproduced the failure by copying settings.mjs to a
//               directory with no reachable node_modules and calling loadSettings on a valid
//               settings file ... Result: ... the yaml parser is unavailable". This test is that
//               same reproduction, run against the fixed modules, as a permanent CI-enforced proof
//               rather than a one-off manual check.
// runner:       node --test "tests/hooks/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

/** Builds a fresh "installed plugin" simulation: hooks/lib/{settings,routing,mini-yaml}.mjs copied
 * verbatim into an isolated temp tree, plus a minimal agents/ fixture the copied routing.mjs will
 * resolve DEFAULT_AGENTS_DIR against (it derives the plugin root from its own file location, so
 * copying it under <root>/hooks/lib/ makes <root>/agents/ its default agents directory). */
function buildInstalledPluginCopy() {
  const root = mkdtempSync(join(tmpdir(), 'ns-installed-plugin-sim-'));
  const libDir = join(root, 'hooks', 'lib');
  mkdirSync(libDir, { recursive: true });
  for (const name of ['settings.mjs', 'routing.mjs', 'mini-yaml.mjs']) {
    copyFileSync(join(REPO_ROOT, 'hooks', 'lib', name), join(libDir, name));
  }
  const agentsDir = join(root, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(agentsDir, 'test-agent.md'),
    '---\nmodel: sonnet\n---\nAgent body, irrelevant to this test.\n',
    'utf8'
  );
  writeFileSync(
    join(agentsDir, '_chain-permitted.yaml'),
    '# fixture chain contract\ntest-dispatcher:\n  - research-librarian\n  - line-editor\n',
    'utf8'
  );
  return { root, libDir, agentsDir };
}

// ---------------------------------------------------------------------------
// Precondition: the isolation is real, not accidental. If this fails, the temp directory this
// test built happens to have a resolvable "yaml" package on its module-resolution path (an
// environment quirk, not a defect this file's other assertions could distinguish from a real fix)
// and the test fixture itself needs attention, not settings.mjs/routing.mjs.
// ---------------------------------------------------------------------------

test('precondition: requiring "yaml" from the copied installed-plugin location genuinely fails to resolve', () => {
  const { libDir } = buildInstalledPluginCopy();
  const req = createRequire(pathToFileURL(join(libDir, 'settings.mjs')));
  assert.throws(
    () => req('yaml'),
    /Cannot find module ['"]yaml['"]/,
    'the isolated copy must have no reachable node_modules/yaml - otherwise this file is not ' +
    'actually simulating an installed plugin'
  );
});

// ---------------------------------------------------------------------------
// The fix: loadSettings, readAgentModel, and readChainPermitted all work from that same isolated
// location with no "yaml parser unavailable" warning anywhere.
// ---------------------------------------------------------------------------

test('loadSettings works from an installed-plugin copy with no node_modules: gate_mode and routing_enforce both survive, no warning', async () => {
  const { root, libDir } = buildInstalledPluginCopy();
  const projectDir = join(root, 'project');
  mkdirSync(join(projectDir, '.claude'), { recursive: true });
  writeFileSync(
    join(projectDir, '.claude', 'nonfiction-studio.local.md'),
    '---\ngate_mode: block\nthresholds:\n  overlap_min_words: 20\nrouting_enforce: block\n---\nHouse notes.\n',
    'utf8'
  );

  const { loadSettings } = await import(pathToFileURL(join(libDir, 'settings.mjs')));
  const result = loadSettings(projectDir);

  assert.strictEqual(result.warning, null, 'no warning: the settings file parses cleanly with no yaml package present');
  assert.deepStrictEqual(result.droppedKeys, []);
  assert.strictEqual(result.settings.gate_mode, 'block', 'OPP-P11 (per-project studio settings): gate_mode: block must not be silently dropped on an installed plugin');
  assert.strictEqual(result.settings.routing_enforce, 'block', 'routing_enforce: block must not be silently dropped on an installed plugin');
  assert.deepStrictEqual(result.settings.thresholds, { overlap_min_words: 20 });
});

test('readAgentModel works from an installed-plugin copy with no node_modules: the declared model is read, no error', async () => {
  const { libDir, agentsDir } = buildInstalledPluginCopy();
  const { readAgentModel } = await import(pathToFileURL(join(libDir, 'routing.mjs')));

  const result = readAgentModel('test-agent', agentsDir);
  assert.strictEqual(result.model, 'sonnet');
  assert.strictEqual(result.error, null);
});

test('readChainPermitted works from an installed-plugin copy with no node_modules: the edge table parses, no error', async () => {
  const { libDir, agentsDir } = buildInstalledPluginCopy();
  const { readChainPermitted } = await import(pathToFileURL(join(libDir, 'routing.mjs')));

  const result = readChainPermitted(agentsDir);
  assert.strictEqual(result.error, null);
  assert.deepStrictEqual(result.contract, {
    'test-dispatcher': ['research-librarian', 'line-editor'],
  });
});

// ---------------------------------------------------------------------------
// Static guard: neither module may reintroduce a runtime require/import of the "yaml" package on
// the hook execution path. Cheap, fast, and catches a regression before it needs a temp-dir dance
// to reproduce.
// ---------------------------------------------------------------------------

test('hooks/lib/settings.mjs and hooks/lib/routing.mjs no longer reference the "yaml" package at all', () => {
  for (const name of ['settings.mjs', 'routing.mjs']) {
    const text = readFileSync(join(REPO_ROOT, 'hooks', 'lib', name), 'utf8');
    assert.ok(
      !/require\(\s*['"]yaml['"]\s*\)/.test(text) && !/from\s+['"]yaml['"]/.test(text),
      'hooks/lib/' + name + ' must not require or import the "yaml" npm package - it must use ' +
      'hooks/lib/mini-yaml.mjs (vendored, zero-dependency) instead'
    );
  }
});
