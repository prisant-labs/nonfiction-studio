// tests/checks/dispatch-threshold.test.mjs
// what-it-is:   unit tests for scripts/lib/dispatch-threshold.mjs
// what-it-does: drives meetsDispatchThreshold() with synthetic pass/total counts -- no eval
//               file, no claude CLI, no model call. Requirement 7 of this wave's task-7
//               brief testing section: "a dispatch pass rate below the threshold exits
//               nonzero; at or above it exits 0."
// why:          roadmap row 1.12 requires that a deliberately broken dispatch table turns a
//               live Tier B run red. Before this module existed, scripts/run-evals.mjs
//               always exited 0 once every case was graded, whatever the pass rate --
//               dispatch accuracy was signal only, never a gate. This is the pure decision
//               function the script's exit code is now conditioned on.
// runner:       node --test tests/checks/dispatch-threshold.test.mjs (or node --test tests/checks/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DISPATCH_ACCURACY_THRESHOLD, meetsDispatchThreshold } from '../../scripts/lib/dispatch-threshold.mjs';

test('the threshold constant is a documented fraction between 0 and 1', () => {
  assert.equal(typeof DISPATCH_ACCURACY_THRESHOLD, 'number');
  assert.ok(DISPATCH_ACCURACY_THRESHOLD > 0 && DISPATCH_ACCURACY_THRESHOLD < 1);
});

test('requirement 7: pass rate below the threshold fails the gate', () => {
  // 19/28 ~= 67.9%, below the documented 70% threshold.
  assert.equal(meetsDispatchThreshold(19, 28), false);
});

test('requirement 7: pass rate at or above the threshold passes the gate', () => {
  // 20/28 ~= 71.4%, at/above the documented 70% threshold.
  assert.equal(meetsDispatchThreshold(20, 28), true);
  assert.equal(meetsDispatchThreshold(28, 28), true);
});

test('exact boundary counts as meeting the threshold (>=, not >)', () => {
  assert.equal(meetsDispatchThreshold(7, 10, 0.7), true);
});

test('a custom threshold overrides the default', () => {
  assert.equal(meetsDispatchThreshold(5, 10, 0.4), true);
  assert.equal(meetsDispatchThreshold(5, 10, 0.6), false);
});

test('zero cases never passes the gate, even though 0/0 is not mathematically "below" anything', () => {
  // Fail-closed: a batch that graded nothing is not evidence the dispatch table is healthy.
  assert.equal(meetsDispatchThreshold(0, 0), false);
});

test('a genuinely broken dispatch table (near-total failure) fails the gate', () => {
  assert.equal(meetsDispatchThreshold(2, 28), false);
});

test('a healthy batch with a handful of ordinary grading misses still passes', () => {
  // 25/28 ~= 89.3%: a few noisy misses from a small model's loose grading, not a broken table.
  assert.equal(meetsDispatchThreshold(25, 28), true);
});
