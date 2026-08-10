// tests/checks/credential-mode.test.mjs
// what-it-is:   unit tests for scripts/lib/credential-mode.mjs
// what-it-does: drives decideCredentialMode() with controlled signal objects and a stub
//               probeCli, covering the three-state Tier B credential decision (live / skip /
//               dry-run) with zero subprocess spawns and zero model calls. The numbered
//               requirements below mirror this wave's roadmap row 1.12 acceptance list.
// why:          F-CI-02 (Tier B trigger contradicts D-20): the prior probe proved only that
//               the claude binary EXISTS (`claude --version`), never that it was
//               authenticated. Tier B's own workflow installs that binary before the live
//               steps, so on a keyless GitHub runner the probe reported usable and the
//               script proceeded into live mode instead of a named skip. These tests pin
//               the fix directly: a probe that WOULD say "usable" must never even be
//               consulted once an unattended CI environment with no credential has already
//               decided the outcome.
// runner:       node --test tests/checks/credential-mode.test.mjs (or node --test tests/checks/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideCredentialMode, OAUTH_TOKEN_VAR, API_KEY_VAR } from '../../scripts/lib/credential-mode.mjs';

test('constants name the real environment variables', () => {
  assert.equal(OAUTH_TOKEN_VAR, 'CLAUDE_CODE_OAUTH_TOKEN');
  assert.equal(API_KEY_VAR, 'ANTHROPIC_API_KEY');
});

// Requirement 1: neither credential set, CI truthy -> named green skip.
test('requirement 1: no credential, CI truthy -> skip, reason names CLAUDE_CODE_OAUTH_TOKEN', () => {
  const decision = decideCredentialMode({ oauthToken: undefined, apiKey: undefined, ci: 'true' }, () => true);
  assert.equal(decision.mode, 'skip');
  assert.match(decision.reason, /CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(decision.reason, /expected configuration|not a failure/i);
});

// Requirement 2: CLAUDE_CODE_OAUTH_TOKEN set -> does NOT skip; proceeds to live mode.
test('requirement 2: CLAUDE_CODE_OAUTH_TOKEN set -> live, regardless of CI', () => {
  const inCi = decideCredentialMode({ oauthToken: 'token-value', apiKey: undefined, ci: 'true' });
  assert.equal(inCi.mode, 'live');
  const notCi = decideCredentialMode({ oauthToken: 'token-value', apiKey: undefined, ci: undefined });
  assert.equal(notCi.mode, 'live');
});

// Requirement 3: neither credential set, not CI -> dry-run fallback (developer machine,
// local CLI not usable), unchanged developer behavior.
test('requirement 3: no credential, not CI, CLI unusable -> dry-run fallback', () => {
  const decision = decideCredentialMode({ oauthToken: undefined, apiKey: undefined, ci: undefined }, () => false);
  assert.equal(decision.mode, 'dry-run');
});

// Requirement 4: the binary-exists trap, the EXACT defect this task fixes. CI truthy, no
// credential, but the probe would report the binary present and runnable -> still skip, and
// the probe must never even be called once CI has already decided the outcome.
test('requirement 4 (binary-exists trap): CI truthy, no credential, CLI reports usable -> still skip, probe never consulted', () => {
  let probeCalls = 0;
  const probeCli = () => { probeCalls++; return true; };
  const decision = decideCredentialMode({ oauthToken: undefined, apiKey: undefined, ci: 'true' }, probeCli);
  assert.equal(decision.mode, 'skip');
  assert.equal(probeCalls, 0, 'the CLI-usability probe must never be consulted once CI already decided the outcome');
});

// Developer machine, CLI usable -> live (the authenticated CLI session is itself sufficient;
// no credential env var is required). Companion case to requirement 3.
test('developer machine, no credential, CLI usable -> live', () => {
  const decision = decideCredentialMode({ oauthToken: undefined, apiKey: undefined, ci: undefined }, () => true);
  assert.equal(decision.mode, 'live');
});

// ANTHROPIC_API_KEY still works as a legacy fallback, but the reason names it as such and
// still names the documented credential.
test('ANTHROPIC_API_KEY set (no OAuth token) -> live, reason marks it a legacy fallback', () => {
  const decision = decideCredentialMode({ oauthToken: undefined, apiKey: 'sk-legacy', ci: 'true' });
  assert.equal(decision.mode, 'live');
  assert.match(decision.reason, /legacy/i);
  assert.match(decision.reason, /CLAUDE_CODE_OAUTH_TOKEN/);
});

// CLAUDE_CODE_OAUTH_TOKEN takes priority when both are set; the reason names it, not the key.
test('both credentials set -> live, OAuth token is the named reason', () => {
  const decision = decideCredentialMode({ oauthToken: 'token', apiKey: 'sk-legacy', ci: 'true' });
  assert.equal(decision.mode, 'live');
  assert.match(decision.reason, /CLAUDE_CODE_OAUTH_TOKEN is set/);
});

// probeCli must never be consulted when a credential is already present: no wasted
// process spawn, and the module-header requirement "never a live model call" is trivially
// satisfied when the probe function is not even invoked.
test('probeCli is not consulted when any credential is present', () => {
  let probeCalls = 0;
  const probeCli = () => { probeCalls++; return true; };
  decideCredentialMode({ oauthToken: 'token', apiKey: undefined, ci: undefined }, probeCli);
  decideCredentialMode({ oauthToken: undefined, apiKey: 'sk', ci: undefined }, probeCli);
  assert.equal(probeCalls, 0);
});

// A missing probeCli (undefined) on a developer machine degrades to dry-run rather than
// throwing: callers are never forced to supply a probe just to get a safe default.
test('missing probeCli degrades to dry-run rather than throwing', () => {
  assert.doesNotThrow(() => decideCredentialMode({ oauthToken: undefined, apiKey: undefined, ci: undefined }));
  const decision = decideCredentialMode({ oauthToken: undefined, apiKey: undefined, ci: undefined });
  assert.equal(decision.mode, 'dry-run');
});
