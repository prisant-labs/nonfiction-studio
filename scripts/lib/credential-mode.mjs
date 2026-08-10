// what-it-is:   the shared Tier B credential decision
// what-it-does: decides among three modes (live, skip, dry-run) from a caller-supplied
//               set of already-read signals (never process.env itself, so a test can drive
//               every branch with a plain object and zero environment mutation) and an
//               injectable, optional CLI-usability probe. Precedence: a credential present
//               (CLAUDE_CODE_OAUTH_TOKEN, or ANTHROPIC_API_KEY as a legacy fallback) always
//               means live; absent both, a truthy `ci` signal means a named green skip
//               WITHOUT ever consulting the probe; absent both and not CI (a developer
//               machine), the probe decides between live (on an already-authenticated local
//               CLI session) and a dry-run fallback.
// why:          F-CI-02 (Tier B trigger contradicts D-20). The prior probe in both
//               scripts/run-integration.mjs and scripts/run-evals.mjs asked only
//               `claude --version`, which proves the binary exists, never that it is
//               authenticated. Tier B's own workflow installs that binary before the live
//               steps, so on a keyless GitHub runner the old probe reported usable and both
//               scripts proceeded into live mode, failing on ordinary model-call errors
//               (run-integration.mjs) or hard-erroring with exit 2 (run-evals.mjs): two
//               different outcomes for the identical "no credential" situation. This module
//               is the single decision both scripts now call, so they can never disagree
//               again, and CI-truthiness alone (never a probe result) is what triggers the
//               skip, since a probe result cannot be trusted to mean "authenticated" and a
//               credential check that costs money is a credential check people disable.
// used-by:      scripts/run-integration.mjs, scripts/run-evals.mjs
// exit taxonomy: n/a (library module; callers choose their own exit code per mode)

/** The documented Tier B credential: an OAuth token minted with `claude setup-token` and set
 *  as a repo secret. Subscription authentication, per the self-sufficiency invariant. */
export const OAUTH_TOKEN_VAR = 'CLAUDE_CODE_OAUTH_TOKEN';

/** A legacy, optional fallback. Honored if a caller happens to set it, but never documented,
 *  never required, and never the thing this module's skip/live decision is built around. */
export const API_KEY_VAR = 'ANTHROPIC_API_KEY';

/**
 * @param {object} signals
 * @param {string|undefined} signals.oauthToken - the caller's own read of CLAUDE_CODE_OAUTH_TOKEN
 * @param {string|undefined} signals.apiKey - the caller's own read of ANTHROPIC_API_KEY
 * @param {string|undefined} signals.ci - the caller's own read of CI
 * @param {() => boolean} [probeCli] - returns true iff the local claude CLI is installed AND
 *   runnable (e.g. `claude --version` exits 0). Consulted ONLY on a non-CI developer machine
 *   with neither credential set: never when a credential is present, and never when CI is
 *   truthy, so a binary that merely EXISTS can never again masquerade as "authenticated."
 * @returns {{mode: 'live'|'skip'|'dry-run', reason: string}}
 */
export function decideCredentialMode(signals, probeCli) {
  const oauthToken = signals && signals.oauthToken;
  const apiKey = signals && signals.apiKey;
  const ci = signals && signals.ci;

  if (oauthToken) {
    return { mode: 'live', reason: OAUTH_TOKEN_VAR + ' is set' };
  }

  if (apiKey) {
    return {
      mode: 'live',
      reason: API_KEY_VAR + ' is set (legacy fallback; ' + OAUTH_TOKEN_VAR + ' is the documented Tier B credential)',
    };
  }

  // Unattended environment, no credential: CI-truthiness alone is decisive. A GitHub runner
  // never has an interactive login, so absence of both variables here is conclusive without
  // asking the local CLI anything, and asking would be exactly the mistake being fixed:
  // the CLI binary is INSTALLED by Tier B's own workflow before this decision runs, so a
  // probe would report "usable" even though nobody is authenticated.
  if (ci) {
    return {
      mode: 'skip',
      reason:
        'neither ' + OAUTH_TOKEN_VAR + ' nor ' + API_KEY_VAR + ' is set, and CI is set (an unattended runner); ' +
        'this is expected configuration, not a failure - set the ' + OAUTH_TOKEN_VAR + ' repository secret ' +
        'to enable live Tier B runs',
    };
  }

  // Developer machine: no credential env var is required here, because an already-logged-in
  // local claude CLI session is itself sufficient. The probe is consulted ONLY in this
  // branch, matching the module header's precedence.
  const usable = typeof probeCli === 'function' ? !!probeCli() : false;
  return {
    mode: usable ? 'live' : 'dry-run',
    reason: usable
      ? 'no credential set, but the local claude CLI is installed and usable (developer machine); '
        + 'proceeding live on the authenticated CLI session'
      : 'no credential set and the local claude CLI is not usable (developer machine); falling back to dry-run',
  };
}
