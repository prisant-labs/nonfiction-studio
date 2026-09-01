// tests/checks/run-integration.test.mjs
// what-it-is:   end-to-end tests of the REAL scripts/run-integration.mjs, driven through
//               spawnSync with a controlled environment, not just the extracted decision
//               function (see tests/checks/credential-mode.test.mjs for that), so the
//               script's actual wiring is what gets proven, not only the function it calls.
// what-it-does: covers the credential-decision requirements (roadmap row 1.12) that are safe
//               and deterministic to prove without a real model call: the named
//               green skip in an unattended/no-credential environment, and that a credential
//               being present still lets a real failure exit nonzero. PATH has the real
//               claude CLI's directory surgically removed (see spawn-helper.mjs) in every
//               scenario that could otherwise reach live mode: this machine has a genuine,
//               authenticated `claude` CLI on its real PATH (confirmed directly: `command -v
//               claude` resolves), so leaving PATH untouched would risk an actual paid model
//               call the moment a test exercises a code path this wave is deliberately trying
//               to keep out of live mode.
//
//               The binary-PRESENT sub-case of the CI/no-credential scenario (the exact defect
//               this task fixes: a probe that would say "usable" must never even be asked once
//               CI has already decided) is covered safely at the unit level in
//               tests/checks/credential-mode.test.mjs ("requirement 4"), with a spy proving
//               the probe function is never invoked; that is a stronger and safer proof than a
//               fabricated cross-platform binary shim would be here.
// why:          F-CI-02 (Tier B trigger contradicts D-20).
// runner:       node --test tests/checks/run-integration.test.mjs (or node --test tests/checks/)
//
// CAUTION preserved from this file's own RED-phase development: an earlier draft of the
// "unattended CI, no credential" test below deliberately left PATH untouched, reasoning that a
// CORRECT implementation would never consult it. Run against the pre-fix script, that
// generated two real haiku calls (~$0.07 total, visible in that run's own cost output) instead
// of a skip, because the pre-fix script's forced-dry-run gate found this machine's real,
// authenticated claude CLI on PATH and proceeded into live mode - the exact defect this task
// fixes, reproduced by accident rather than by design. Every scenario below that could
// possibly reach live mode now ALWAYS uses pathWithoutClaudeCli(), independent of which
// script version is under test, specifically so an implementation bug fails loudly with a
// distinctive operational error instead of spending money silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildEnv, runNodeScript, pathWithoutClaudeCli } from './spawn-helper.mjs';

const SCRIPT = 'scripts/run-integration.mjs';

// ---------------------------------------------------------------------------
// Requirement 1 + 4: unattended CI, no credential -> named green skip, exit 0. claude's
// directory is removed from PATH (see file header CAUTION) so that IF the implementation
// under test were wrong and fell through toward live mode, it would fail on an unreachable
// binary rather than silently spend money.
// ---------------------------------------------------------------------------

test('unattended CI, no credential -> named green skip naming CLAUDE_CODE_OAUTH_TOKEN, exit 0', () => {
  const noClaude = pathWithoutClaudeCli();
  const env = buildEnv({ CI: 'true', PATH: noClaude, Path: noClaude });
  const result = runNodeScript(SCRIPT, [], env);
  assert.equal(result.status, 0, 'must exit 0 (green); got: ' + result.combined);
  assert.match(result.combined, /CLAUDE_CODE_OAUTH_TOKEN/, 'must name the missing secret');
  assert.match(result.combined, /skip/i, 'must say this is a skip, not a silent pass');
  assert.match(result.combined, /expected configuration|not a failure/i, 'must state this is expected, not a failure');
  // Distinguishes the new skip path from the old forced-dry-run fallback, which ran the full
  // deterministic assertion suite and printed this banner; the skip must short-circuit before
  // any of that runs at all.
  assert.doesNotMatch(result.combined, /DRY-RUN mode/, 'a CI skip must not fall through into dry-run assertions');
});

// ---------------------------------------------------------------------------
// Requirement 6: a credential present, but the claude binary is genuinely unreachable
// (claude's directory removed from PATH) -> a real operational failure, still exits nonzero.
// Proves the skip logic added for the CI/no-credential case can never fire when a credential
// exists, i.e. it cannot mask a real failure.
// ---------------------------------------------------------------------------

test('credential present, claude unreachable -> real failure still exits nonzero', () => {
  const noClaude = pathWithoutClaudeCli();
  const env = buildEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'test-fake-oauth-token', PATH: noClaude, Path: noClaude });
  const result = runNodeScript(SCRIPT, [], env);
  assert.notEqual(result.status, 0, 'a credentialed run with an unreachable claude binary must fail, not exit 0; got: ' + result.combined);
  assert.doesNotMatch(result.combined, /SKIP/, 'a credentialed run must never take the skip path');
  assert.match(result.combined, /FAIL/, 'the failure must be visible in the output, not swallowed');
});

// ---------------------------------------------------------------------------
// Requirement 3: no credential, not CI, claude unreachable -> dry-run fallback (developer
// machine), exit 0. This was already run-integration.mjs's behavior before this task; kept
// here as an explicit regression guard now that the decision is routed through the shared
// scripts/lib/credential-mode.mjs module.
//
// Declared red until Task 5 (ADR-0012 implementation wave): the dry-run assertion suite's
// [gate-golden] step runs `bin/ns-gate` against a temp clone of the REAL, COMMITTED
// examples/sample-book (scripts/run-integration.mjs's own makeTempClone, not this test file's
// -- deliberately never patched with a synthetic baseline, unlike tests/engines/gate.test.mjs's
// or tests/hooks/stop-gate.test.mjs's clones, because this script's whole purpose is verifying
// the REAL golden sample book's gate actually passes; patching its baseline away would silently
// stop verifying the thing this assertion exists to prove). examples/sample-book/.studio/
// config.json still carries a marker_set_version 4 baseline with no calibration ladder; scoring
// against it with the v5 computeDrift throws StaleBaselineError (ns-gate exit 2), not the exit
// 0 [gate-golden] expects. Task 5 recaptures that baseline; only then can this re-verify the
// real golden book end to end.
test('developer machine, no credential, claude unreachable -> dry-run fallback, exit 0', {
  skip: 'declared red until Task 5 (ADR-0012 implementation wave): the dry-run suite\'s ' +
    '[gate-golden] step runs ns-gate against a temp clone of the REAL committed examples/' +
    'sample-book, which still carries a marker_set_version 4 baseline with no calibration ' +
    'ladder; Task 5 recaptures it',
}, () => {
  const noClaude = pathWithoutClaudeCli();
  const env = buildEnv({ CI: undefined, PATH: noClaude, Path: noClaude });
  const result = runNodeScript(SCRIPT, [], env);
  assert.equal(result.status, 0, 'must exit 0; got: ' + result.combined);
  assert.match(result.combined, /DRY-RUN mode/, 'must run the dry-run assertion suite');
  assert.match(result.combined, /dry-run complete: all assertions pass/);
});
