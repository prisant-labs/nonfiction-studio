// tests/hooks/hooks-json.test.mjs
// what-it-is:   interim shape test for hooks/hooks.json
// what-it-does: asserts the Phase 1 wiring file matches the nested Form A (wrapper) shape
//               from S-07 section 1 and the assertion list in the TSK-030 brief
// note:         superseded by node scripts/check-hooks-schema.mjs at TSK-055 (Tier A check scripts);
//               until that lands, this file is the deterministic gate for hooks.json shape
// runner:       node --test "tests/hooks/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const HOOKS_JSON = join(REPO_ROOT, 'hooks', 'hooks.json');

// Parse once at module level; a parse failure fails the entire suite with a clear error.
const parsed = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));

const EXPECTED_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolBatch', 'Stop', 'PreCompact'];
// Command pattern: node ${CLAUDE_PLUGIN_ROOT}/hooks/<script>.mjs (literal braced interpolation)
const COMMAND_PATTERN = /^node \$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z-]+\.mjs$/;

// ---- top-level structure -------------------------------------------------------

test('hooks.json parses as valid JSON', () => {
  // Parse already succeeded at module load; this test documents that assertion formally.
  assert.ok(typeof parsed === 'object' && parsed !== null, 'parsed value is a non-null object');
});

test('top-level keys are a subset of [description, hooks] with hooks present', () => {
  const allowed = new Set(['description', 'hooks']);
  const keys = Object.keys(parsed);
  assert.ok(keys.includes('hooks'), '"hooks" top-level key is present');
  for (const key of keys) {
    assert.ok(allowed.has(key), `unexpected top-level key: "${key}"`);
  }
});

test('exactly five Phase 1 event keys are present', () => {
  const eventKeys = Object.keys(parsed.hooks).sort();
  assert.deepEqual(eventKeys, [...EXPECTED_EVENTS].sort(), 'event keys match the Phase 1 set exactly');
});

// ---- per-event nested Form A shape ---------------------------------------------

for (const event of EXPECTED_EVENTS) {
  test(`${event}: maps to an array of exactly one group object whose single key is "hooks"`, () => {
    const groups = parsed.hooks[event];
    assert.ok(Array.isArray(groups), `${event} value is an array`);
    assert.equal(groups.length, 1, `${event} has exactly one group`);
    const group = groups[0];
    const groupKeys = Object.keys(group);
    assert.deepEqual(groupKeys, ['hooks'], `${event} group has exactly one key "hooks"`);
    assert.ok(Array.isArray(group.hooks), `${event} group.hooks is an array`);
  });
}

// ---- command entry conformance -------------------------------------------------

test('every command entry has type "command" and a conforming command string', () => {
  for (const event of EXPECTED_EVENTS) {
    const entries = parsed.hooks[event][0].hooks;
    for (const entry of entries) {
      if (entry.type === 'command') {
        assert.equal(typeof entry.command, 'string', `${event}: command field is a string`);
        assert.ok(
          COMMAND_PATTERN.test(entry.command),
          `${event}: command does not match pattern -- got: ${entry.command}`
        );
      }
    }
  }
});

test('exactly one command entry per event (D-06 single-writer state discipline)', () => {
  for (const event of EXPECTED_EVENTS) {
    const entries = parsed.hooks[event][0].hooks;
    const commandEntries = entries.filter(e => e.type === 'command');
    assert.equal(commandEntries.length, 1, `${event}: exactly one command entry`);
  }
});

// ---- Stop-event two-handler contract ------------------------------------------

test('Stop group has exactly two entries: one command and one prompt', () => {
  const entries = parsed.hooks['Stop'][0].hooks;
  assert.equal(entries.length, 2, 'Stop group has exactly two entries');
  const types = entries.map(e => e.type).sort();
  assert.deepEqual(types, ['command', 'prompt'], 'Stop entries are one command and one prompt');
});

// ---- script file existence ----------------------------------------------------

test('every script referenced in a command entry exists in the tree', () => {
  for (const event of EXPECTED_EVENTS) {
    const entries = parsed.hooks[event][0].hooks;
    for (const entry of entries) {
      if (entry.type === 'command') {
        // command is: node ${CLAUDE_PLUGIN_ROOT}/hooks/<script>.mjs
        const relative = entry.command.replace('node ${CLAUDE_PLUGIN_ROOT}/', '');
        const scriptPath = join(REPO_ROOT, relative);
        assert.ok(existsSync(scriptPath), `script file missing: ${relative}`);
      }
    }
  }
});

// ---- timeout values -----------------------------------------------------------

test('SessionStart command entry has timeout: 60 (seconds)', () => {
  const entries = parsed.hooks['SessionStart'][0].hooks;
  const cmd = entries.find(e => e.type === 'command');
  assert.ok(cmd, 'SessionStart command entry exists');
  assert.equal(cmd.timeout, 60, 'SessionStart timeout is 60');
});

test('Stop prompt entry has timeout: 30 (seconds)', () => {
  const entries = parsed.hooks['Stop'][0].hooks;
  const prompt = entries.find(e => e.type === 'prompt');
  assert.ok(prompt, 'Stop prompt entry exists');
  assert.equal(prompt.timeout, 30, 'Stop prompt timeout is 30');
});
