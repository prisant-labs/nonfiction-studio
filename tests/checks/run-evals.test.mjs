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
import { gradeResponse } from '../../scripts/run-evals.mjs';

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

// ---------------------------------------------------------------------------
// F-CI-10 (weak eval grading): the fail-closed DISPATCH-token grading contract.
// gradeResponse is imported directly (see the top of this file), never spawned, so every
// scenario below runs with zero model calls and zero claude CLI dependency. main()'s own guard
// in scripts/run-evals.mjs (see that file) is what makes this safe: importing the module for
// gradeResponse alone must never execute the credential decision, eval loading, or a live call
// as a side effect of the import statement.
// ---------------------------------------------------------------------------

test('exact match on a DISPATCH: line passes', () => {
  assert.equal(
    gradeResponse('drafting-partner', 'DISPATCH: drafting-partner\nBecause it drafts the chapter.'),
    true
  );
});

test('a wrong DISPATCH: line fails even when the correct callee is named elsewhere in prose', () => {
  // This is the shape the deleted callee-echo fallback (`|| text.includes(callee)`) used to
  // pass: the correct name appears somewhere in the reply, but the model's actual DISPATCH:
  // line names something else. Fail-closed grading must not rescue a wrong answer just because
  // the right word shows up nearby.
  assert.equal(
    gradeResponse(
      'drafting-partner',
      'DISPATCH: line-editor\nThough drafting-partner handles drafting, line-editor fits here.'
    ),
    false
  );
});

test('no DISPATCH: line at all fails, even when the correct callee is named in prose', () => {
  // The exact shape of the old echo behavior: the model names the right component in prose
  // without ever committing to the exclusive DISPATCH: token the new contract requires.
  assert.equal(
    gradeResponse('drafting-partner', 'I would call drafting-partner for this job.'),
    false
  );
});

test('a bare "DISPATCH:" with no name after the colon fails (empty name)', () => {
  assert.equal(
    gradeResponse('drafting-partner', 'DISPATCH:   \nSome reasoning that never names anything.'),
    false
  );
});

test('hook names normalize across PascalCase, kebab-case, and spacing', () => {
  assert.equal(gradeResponse('PostToolUse', 'DISPATCH: post-tool-use'), true);
  assert.equal(gradeResponse('PostToolUse', 'dispatch: POST TOOL USE'), true);
});

test('the FIRST DISPATCH: line wins: a wrong first line is not rescued by a correct later one', () => {
  assert.equal(
    gradeResponse('drafting-partner', 'DISPATCH: line-editor\nDISPATCH: drafting-partner'),
    false
  );
});

test('the FIRST DISPATCH: line wins: a correct first line is not spoiled by a wrong later one', () => {
  assert.equal(
    gradeResponse('drafting-partner', 'DISPATCH: drafting-partner\nDISPATCH: line-editor'),
    true
  );
});

test('naming the correct callee only in prose (no DISPATCH: line) fails - the old echo shape', () => {
  assert.equal(
    gradeResponse('drafting-partner', 'The correct component here is drafting-partner.'),
    false
  );
});
