// scripts/test-engines.mjs
// what-it-is:   thin runner over the engine, lib, hook, and schema unit test suites
// what-it-does: invokes node --test with glob patterns covering tests/engines/*.test.mjs,
//               tests/lib/*.test.mjs, tests/hooks/*.test.mjs, and tests/schemas/*.test.mjs;
//               exits with the node --test exit code so CI gates on any failure
// why:          Q-02 1.2 engine-unit-tests step; all suites in one deterministic command
//               per the zero-logic-in-YAML rule (section 6)
// exit taxonomy: 0 = all tests pass; 1 = one or more failures (from node --test)

import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// Test glob patterns in the order they should run.
// engines: bin CLI unit tests; lib: shared lib tests; hooks: hook script tests;
// schemas: schema round-trip tests (Q-01 section 4).
const TEST_GLOBS = [
  'tests/engines/*.test.mjs',
  'tests/lib/*.test.mjs',
  'tests/hooks/*.test.mjs',
  'tests/schemas/*.test.mjs',
];

// Build a single node --test invocation with all globs.
// node --test accepts multiple file/glob arguments in Node.js >= 22.
const nodeArgs = ['--test', ...TEST_GLOBS];

process.stdout.write('[test-engines] running: node ' + nodeArgs.join(' ') + '\n');

const result = spawnSync('node', nodeArgs, {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

if (result.error) {
  process.stderr.write('[test-engines] FATAL: could not spawn node: ' + result.error.message + '\n');
  process.exit(2);
}

process.exit(result.status ?? 1);
