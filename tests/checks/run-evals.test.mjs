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
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnv, runNodeScript, pathWithoutClaudeCli } from './spawn-helper.mjs';
import {
  gradeResponse,
  buildClaudeArgs,
  buildChildEnv,
  buildPrompt,
  callClaudeWithRetry,
  dispatchCallee,
  CALL_TIMEOUT_MS,
} from '../../scripts/run-evals.mjs';

const SCRIPT = 'scripts/run-evals.mjs';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Counts the real evals/ set the same way the runner does, so the end-to-end assertions below
// follow the eval set as it grows instead of pinning a number that goes stale.
function countEvalCases() {
  const dir = join(REPO_ROOT, 'evals');
  let chain = 0;
  let hook = 0;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.eval.json'))) {
    const data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (data.covers.chain) chain += data.cases.length;
    else if (data.covers.hook) hook += data.cases.length;
  }
  return { chain, hook };
}

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
  // Issue #5 (the Tier B eval harness measures guessing, not dispatch): only chain cases count
  // toward dispatch accuracy. Hook events are fired by Claude Code, not dispatched by a model.
  const { chain, hook } = countEvalCases();
  assert.match(result.combined, new RegExp('passed:\\s+0 / ' + chain + ' '), 'the denominator must be the chain cases only');
  assert.match(result.combined, new RegExp('hook cases not graded:\\s+' + hook + '\\b'), 'the report must name the hook cases it did not grade');
  // The version probe fails here too (claude is unreachable); it must log and continue.
  assert.match(result.combined, /claude CLI version: unknown/, 'an unreachable CLI must log an unknown version, not abort');
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
  // Dry-run still validates the hook files (G3 needs them) and says which cases a live run grades.
  const { chain, hook } = countEvalCases();
  assert.match(result.combined, new RegExp(chain + ' graded chain case\\(s\\), ' + hook + ' hook case\\(s\\) validated but not graded'));
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

test('names normalize across PascalCase, kebab-case, and letter case', () => {
  assert.equal(gradeResponse('PostToolUse', 'DISPATCH: post-tool-use'), true);
  assert.equal(gradeResponse('PostToolUse', 'dispatch: POST-TOOL-USE'), true);
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: Drafting-Partner'), true);
});

test('a name split by spaces is graded on its first word only', () => {
  // The name ends at the first space, so trailing reasoning can follow it (issue #5). Every
  // shipped component name is a single kebab-case token, so no correct answer contains a space.
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: drafting partner'), false);
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

// ---------------------------------------------------------------------------
// Issue #5 (the Tier B eval harness measures guessing, not dispatch), grading. The prompt let
// the model add reasoning without saying where, and the grader failed reasoning on the same
// line: three replies in the 2026-10-13 live run named the right agent and still failed. The
// grader now reads the leading component name and ignores what follows it, unless what follows
// is a second name offered as an alternative.
// ---------------------------------------------------------------------------

test('trailing reasoning on the DISPATCH: line no longer fails a correct name', () => {
  // The first three are the exact replies from the 2026-10-13 live run.
  assert.equal(gradeResponse('thesis-architect', 'DISPATCH: thesis-architect (the nfs-outline skill chains to it when structure/thesis.md is absent)'), true);
  assert.equal(gradeResponse('voice-capture', 'DISPATCH: voice-capture (agent)'), true);
  assert.equal(gradeResponse('fact-checker', 'DISPATCH: fact-checker (agent). The skill delegates every run to it.'), true);
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: drafting-partner. It drafts the chapter.'), true);
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: drafting-partner - it drafts the chapter'), true);
});

test('the plugin namespace and markdown wrapping are stripped before comparison', () => {
  // With the plugin loaded, the model sees every component as nonfiction-studio:<name>.
  assert.equal(gradeResponse('thesis-architect', 'DISPATCH: nonfiction-studio:thesis-architect'), true);
  assert.equal(gradeResponse('nfs-new-book', 'DISPATCH: /nonfiction-studio:nfs-new-book'), true);
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: **drafting-partner**'), true);
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: `nonfiction-studio:drafting-partner`'), true);
});

test('only the literal plugin namespace is stripped, never an arbitrary prefix', () => {
  // A generic "<word>:" strip would pass these; the namespace is the only thing that tells a
  // plugin component apart from a built-in the model can also see.
  assert.equal(gradeResponse('thesis-architect', 'DISPATCH: agent: thesis-architect'), false);
  assert.equal(gradeResponse('thesis-architect', 'DISPATCH: other-plugin:thesis-architect'), false);
  assert.equal(gradeResponse('thesis-architect', 'DISPATCH: the thesis-architect agent'), false);
});

test('a hedge between two components fails even when the first one is right', () => {
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: drafting-partner or line-editor'), false);
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: drafting-partner/line-editor'), false);
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: drafting-partner, line-editor'), false);
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: drafting-partner and line-editor'), false);
  assert.equal(gradeResponse('drafting-partner', 'DISPATCH: drafting-partner & line-editor'), false);
});

// ---------------------------------------------------------------------------
// Issue #5, what gets graded: chain evals only. Hook evals stay under evals/ because the G3
// conformance rule (scripts/checks/library-regression.mjs) needs a case for every hook event,
// but no model dispatches a hook, so they never count toward dispatch accuracy.
// ---------------------------------------------------------------------------

test('a chain eval is graded against its callee; a hook eval is not graded at all', () => {
  assert.equal(dispatchCallee({ chain: ['nfs-outline', 'thesis-architect'] }), 'thesis-architect');
  assert.equal(dispatchCallee({ hook: 'PostToolUse' }), null);
  assert.equal(dispatchCallee({ skill: 'nfs-start' }), null);
});

test('the prompt asks for an agent or skill, never a hook handler, and wants reasoning on the next line', () => {
  const p = buildPrompt('nfs-outline runs and structure/thesis.md does not exist');
  assert.match(p, /nfs-outline runs and structure\/thesis\.md does not exist/);
  assert.doesNotMatch(p, /hook/i, 'the 2026-10-13 run showed "hook handler" invites a script path as the answer');
  assert.match(p, /next line/i);
  assert.match(p, /do not (call|use) any tool/i);
  assert.doesNotMatch(p, /thesis-architect/, 'the construction code must never name a callee');
});

// ---------------------------------------------------------------------------
// Issue #5, how each live call runs. The 2026-10-13 local run spawned every child in the
// repository with the user's own settings: the children read the repository, loaded its
// coding-agent guide and the user's global instructions, and fired the user's hooks. Loading the
// plugin also loads its hooks, and in an empty folder its prompt-based Stop hook replaced the
// model's answer. Each call now loads the plugin and nothing else.
// ---------------------------------------------------------------------------

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  assert.notEqual(i, -1, flag + ' is missing from the claude arguments');
  return args[i + 1];
}

test('every live call loads the plugin from the repository root, with user settings and all hooks off', () => {
  const args = buildClaudeArgs('PROMPT', { repoRoot: REPO_ROOT, model: 'haiku' });
  assert.equal(flagValue(args, '-p'), 'PROMPT');
  assert.equal(flagValue(args, '--model'), 'haiku');
  assert.equal(flagValue(args, '--plugin-dir'), REPO_ROOT);
  assert.equal(flagValue(args, '--setting-sources'), 'project');
  assert.equal(JSON.parse(flagValue(args, '--settings')).disableAllHooks, true);
  assert.equal(flagValue(args, '--permission-mode'), 'dontAsk');
  assert.equal(flagValue(args, '--output-format'), 'json');
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(!args.includes('--dangerously-skip-permissions'), 'no tool may run during a dispatch eval');
  assert.ok(!args.includes('--bare'), '--bare refuses OAuth, which Tier B authenticates with');
});

test('the child environment turns off every CLAUDE.md and keeps the credential', () => {
  const env = buildChildEnv({ PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'tok' });
  assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'tok');
  assert.equal(env.PATH, '/bin');
});

function fakeSpawn(outcomes) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
  };
  fn.calls = calls;
  return fn;
}

const TIMED_OUT = { error: Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT' }), stdout: '', status: null };
const NOT_FOUND = { error: Object.assign(new Error('spawnSync claude ENOENT'), { code: 'ENOENT' }), stdout: '', status: null };
const ANSWERED = {
  error: undefined,
  status: 0,
  stdout: JSON.stringify({ is_error: false, result: 'DISPATCH: drafting-partner', total_cost_usd: 0.005 }),
};
const CALL_OPTS = { repoRoot: REPO_ROOT, cwd: join(REPO_ROOT, '..', 'not-the-repo'), model: 'haiku', env: {} };

test('a live call never runs inside the repository', () => {
  const spawn = fakeSpawn([ANSWERED]);
  assert.throws(() => callClaudeWithRetry('P', { ...CALL_OPTS, cwd: REPO_ROOT, spawn }), /repository/);
  assert.throws(() => callClaudeWithRetry('P', { ...CALL_OPTS, cwd: undefined, spawn }), /repository|cwd/);
  assert.equal(spawn.calls.length, 0);
  callClaudeWithRetry('P', { ...CALL_OPTS, spawn });
  assert.equal(spawn.calls[0].opts.cwd, CALL_OPTS.cwd);
});

test('the per-call timeout is 180 seconds', () => {
  assert.equal(CALL_TIMEOUT_MS, 180000);
  const spawn = fakeSpawn([ANSWERED]);
  callClaudeWithRetry('P', { ...CALL_OPTS, spawn });
  assert.equal(spawn.calls[0].opts.timeout, 180000);
});

test('a timed-out call is retried exactly once, and the retry can succeed', () => {
  const spawn = fakeSpawn([TIMED_OUT, ANSWERED]);
  const r = callClaudeWithRetry('P', { ...CALL_OPTS, spawn });
  assert.equal(spawn.calls.length, 2);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.text, 'DISPATCH: drafting-partner');
  assert.equal(r.costUsd, 0.005);
});

test('two timeouts in a row give up after the single retry', () => {
  const spawn = fakeSpawn([TIMED_OUT, TIMED_OUT, ANSWERED]);
  const r = callClaudeWithRetry('P', { ...CALL_OPTS, spawn });
  assert.equal(spawn.calls.length, 2);
  assert.equal(r.ok, false);
  assert.match(r.error, /ETIMEDOUT|timed out/);
});

test('a failure that is not a timeout is never retried', () => {
  const spawn = fakeSpawn([NOT_FOUND, ANSWERED]);
  const r = callClaudeWithRetry('P', { ...CALL_OPTS, spawn });
  assert.equal(spawn.calls.length, 1);
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1);
});
