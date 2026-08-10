// tests/checks/run-evals.test.mjs
// what-it-is:   end-to-end tests of the REAL scripts/run-evals.mjs, driven through spawnSync
//               with a controlled environment, not just the extracted decision functions
//               (see tests/checks/credential-mode.test.mjs and dispatch-threshold.test.mjs for
//               those), so the script's actual wiring is what gets proven.
// what-it-does: mirrors tests/checks/run-integration.test.mjs's coverage for the second Tier B
//               script, plus a symmetry test proving both scripts agree given the identical
//               environment (requirement 5). Every scenario that could otherwise reach live
//               grading uses pathWithoutClaudeCli() (see spawn-helper.mjs and the CAUTION in
//               run-integration.test.mjs's header for why this is not optional on this
//               machine, which has a real, authenticated claude CLI on its real PATH).
// why:          F-CI-02 (Tier B trigger contradicts D-20). Before this task, run-evals.mjs's
//               "no model access" gate was a hard process.exit(2) with no CI-awareness at
//               all, disagreeing with run-integration.mjs's own (broken) dry-run fallback:
//               the two scripts disagreed about what "no credential" means.
// runner:       node --test tests/checks/run-evals.test.mjs (or node --test tests/checks/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildEnv, runNodeScript, pathWithoutClaudeCli } from './spawn-helper.mjs';

const SCRIPT = 'scripts/run-evals.mjs';

// ---------------------------------------------------------------------------
// Requirement 1 + 4: unattended CI, no credential -> named green skip, exit 0.
// ---------------------------------------------------------------------------

test('unattended CI, no credential -> named green skip naming CLAUDE_CODE_OAUTH_TOKEN, exit 0', () => {
  const noClaude = pathWithoutClaudeCli();
  const env = buildEnv({ CI: 'true', PATH: noClaude, Path: noClaude });
  const result = runNodeScript(SCRIPT, [], env);
  assert.equal(result.status, 0, 'must exit 0 (green); got: ' + result.combined);
  assert.match(result.combined, /CLAUDE_CODE_OAUTH_TOKEN/, 'must name the missing secret');
  assert.match(result.combined, /skip/i, 'must say this is a skip, not a silent pass');
  assert.match(result.combined, /expected configuration|not a failure/i, 'must state this is expected, not a failure');
  // The old hard-error path never reached the eval-file loader; the skip must not either.
  assert.doesNotMatch(result.combined, /dispatch-accuracy report/, 'a CI skip must not fall through into grading');
});

// ---------------------------------------------------------------------------
// Requirement 6: a credential present, but claude is genuinely unreachable -> every case
// fails to grade, the dispatch-accuracy gate (0%) fails it, and the run exits nonzero. Proves
// the skip added for the CI/no-credential case can never fire once a credential is present,
// i.e. it cannot mask a real failure, and that a batch which graded nothing is never
// silently treated as healthy (dispatch-threshold.test.mjs's "zero cases" case, reached here
// through the real script instead of the extracted function).
// ---------------------------------------------------------------------------

test('credential present, claude unreachable -> every case fails, exits nonzero', () => {
  const noClaude = pathWithoutClaudeCli();
  const env = buildEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'test-fake-oauth-token', PATH: noClaude, Path: noClaude });
  // Several dozen cases across the real evals/ set, each a fast ENOENT (claude unreachable),
  // not a real network call: generous timeout headroom, not an expectation of needing it.
  const result = runNodeScript(SCRIPT, [], env, { timeout: 120000 });
  assert.notEqual(result.status, 0, 'a credentialed run with an unreachable claude binary must fail, not exit 0; got: ' + result.combined);
  assert.doesNotMatch(result.combined, /SKIP/, 'a credentialed run must never take the skip path');
  // Not just "any nonzero exit": proves grading was genuinely ATTEMPTED (the credential was
  // recognized and the script did not hard-block before ever trying), and that the new
  // dispatch-accuracy gate, not some other unrelated exit path, is what failed it.
  assert.match(result.combined, /dispatch-accuracy report/, 'must have actually attempted grading, not hard-blocked before trying');
  assert.match(result.combined, /passed:\s+0 \/ /, 'every case must have failed to grade (claude unreachable)');
  assert.doesNotMatch(result.combined, /no model access available/, 'must not take the old unconditional hard-error path');
});

// ---------------------------------------------------------------------------
// Requirement 3: no credential, not CI, claude unreachable -> dry-run fallback (developer
// machine), exit 0. NEW behavior for this script specifically: before this task, run-evals.mjs
// had no automatic fallback at all and hard-errored with exit 2 unless --dry-run was passed
// explicitly, disagreeing with run-integration.mjs's own (broken) auto-fallback.
// ---------------------------------------------------------------------------

test('developer machine, no credential, claude unreachable -> dry-run fallback, exit 0', () => {
  const noClaude = pathWithoutClaudeCli();
  const env = buildEnv({ CI: undefined, PATH: noClaude, Path: noClaude });
  const result = runNodeScript(SCRIPT, [], env);
  assert.equal(result.status, 0, 'must exit 0; got: ' + result.combined);
  assert.match(result.combined, /DRY-RUN/, 'must validate eval files rather than hard-erroring');
  assert.match(result.combined, /well-formed/);
});

// ---------------------------------------------------------------------------
// Requirement 5: both scripts produce the same decision for the same environment.
// ---------------------------------------------------------------------------

test('requirement 5: run-integration.mjs and run-evals.mjs agree given the identical environment', () => {
  const noClaude = pathWithoutClaudeCli();
  const env = buildEnv({ CI: 'true', PATH: noClaude, Path: noClaude });
  const a = runNodeScript('scripts/run-integration.mjs', [], env);
  const b = runNodeScript(SCRIPT, [], env);
  assert.equal(a.status, 0, 'run-integration.mjs must skip green; got: ' + a.combined);
  assert.equal(b.status, 0, 'run-evals.mjs must skip green; got: ' + b.combined);
  assert.match(a.combined, /CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(b.combined, /CLAUDE_CODE_OAUTH_TOKEN/);
});
