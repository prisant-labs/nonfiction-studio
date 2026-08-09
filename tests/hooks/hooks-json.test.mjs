// tests/hooks/hooks-json.test.mjs
// what-it-is:   thin wrapper asserting check-hooks-schema.mjs exits 0
// what-it-does: replaces the fourteen-case interim shape test with a single case;
//               all hook-schema logic now lives in scripts/check-hooks-schema.mjs per
//               TSK-055 (Tier A check scripts) resolution 1 (single source of logic).
// why:          the wrapper keeps the test suite covering the hooks.json gate without
//               duplicating checks; if check-hooks-schema.mjs exits 0 then hooks.json
//               satisfies every contract the old tests asserted.
// runner:       node --test "tests/hooks/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-hooks-schema.mjs');

test('check-hooks-schema.mjs exits 0 for the committed hooks/hooks.json', () => {
  const result = spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: process.env,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    'check-hooks-schema.mjs must exit 0; stderr: ' + (result.stderr || '').trim()
  );
});
