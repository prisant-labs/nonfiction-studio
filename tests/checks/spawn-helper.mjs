// tests/checks/spawn-helper.mjs
// what-it-is:   shared subprocess-env helper for end-to-end tests of scripts/run-integration.mjs
//               and scripts/run-evals.mjs
// what-it-does: builds a controlled child-process environment (starting from a copy of the
//               real process.env, with CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY always
//               removed first so a test's intent is never accidentally satisfied by whatever
//               happens to be set on the machine actually running the suite) and runs a
//               repo-relative script against it via the current node binary's own absolute
//               path (process.execPath), never the bare word "node" -- so resolution never
//               depends on the very PATH a test may be deliberately altering. Also exposes
//               pathWithoutClaudeCli(), a PATH value with ONLY the directory containing the
//               real `claude` executable removed, for tests that need the target script's own
//               `spawnSync('claude', ...)` call to fail deterministically (the "credentialed
//               run still fails for real" and "developer machine, CLI unusable" proofs).
//               Surgical removal, not a blanked-out PATH: an earlier version of this helper
//               pointed PATH at an empty directory, which also broke run-integration.mjs's OWN
//               unrelated `spawnSync('node', ...)` calls into bin/ns-doctor and bin/ns-gate
//               (discovered directly: a dry-run test failed with "ns-gate expected exit 0, got
//               1" under a blanked PATH, but passed under the real one -- the inner spawn was
//               silently failing to find `node` itself and its exit code was coerced to 1, not
//               genuinely failing the gate). Removing only claude's directory keeps every
//               other tool in the target script's dependency chain resolving normally.
// why:          F-CI-02 (Tier B trigger contradicts D-20) requires proving the new credential
//               decision against the REAL scripts, not only the extracted decision function --
//               this is the plumbing that makes that possible without spawning a real model
//               call or depending on the test machine's own claude installation state.
// exit taxonomy: n/a (test helper module, not a CLI)

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve, delimiter as PATH_DELIM } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');

/**
 * A copy of the real process.env with both credential variables removed, then the given
 * overrides applied. Deleting (not setting undefined) keeps the child's env free of the two
 * keys entirely unless a test re-adds one on purpose -- some platforms/Node versions treat an
 * explicit `KEY: undefined` value inconsistently, so deletion is the only fully portable way
 * to guarantee absence.
 */
export function buildEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/**
 * Runs a repo-relative script (e.g. "scripts/run-integration.mjs") via the CURRENT node
 * binary's absolute path, so the child process is located without any PATH search at all --
 * only the CHILD's own internal spawns (e.g. run-integration.mjs's own `spawnSync('claude', ...)`)
 * are subject to the env's PATH.
 */
export function runNodeScript(relScriptPath, args, env, opts = {}) {
  const scriptAbs = join(REPO_ROOT, ...relScriptPath.split('/'));
  const result = spawnSync(process.execPath, [scriptAbs, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env,
    timeout: opts.timeout ?? 60000,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: (result.stdout || '') + (result.stderr || ''),
    error: result.error,
  };
}

const CLAUDE_NAME_RE = /^claude(\.(cmd|exe|ps1|bat))?$/i;

/**
 * The real PATH with every directory that contains a `claude`-named executable removed, so a
 * child's own `spawnSync('claude', ...)` fails to resolve while every other tool the child's
 * dependency chain needs (node, git, etc.) keeps resolving exactly as it does for real. See
 * the file header for why this replaced an earlier blanked-PATH approach.
 */
export function pathWithoutClaudeCli() {
  const real = process.env.PATH || process.env.Path || '';
  const dirs = real.split(PATH_DELIM).filter(Boolean);
  const kept = dirs.filter((dir) => {
    try {
      return !readdirSync(dir).some((name) => CLAUDE_NAME_RE.test(name));
    } catch {
      return true; // unreadable/nonexistent directory: not claude's home, keep it
    }
  });
  return kept.join(PATH_DELIM);
}
