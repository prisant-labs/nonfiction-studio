// scripts/run-evals.mjs
// what-it-is:   Tier B eval batch runner
// what-it-does: reads every evals/*.eval.json file, sends each chain case's "given" trigger to
//               the claude CLI using haiku with this plugin loaded, and grades whether the
//               response names the correct callee via an exclusive DISPATCH: token (see the
//               grading contract below); produces a dispatch-accuracy report per Q-01 section
//               5.3, and fails the run if the pass rate drops below
//               scripts/lib/dispatch-threshold.mjs's documented threshold (roadmap row 1.12: a
//               genuinely broken dispatch table must turn a live run red).
// why:          Q-01 section 5.3; the batch runner measures routing accuracy.
//               A chain edge with 100% dispatch but poor output quality is a
//               separate concern, addressed by behavioral evals or
//               deterministic checkers, not this gate. OQ-002 (batch eval
//               runner ownership) resolved: toolkit v1.6.0 does not ship a
//               runner; this is the in-house Node.js + haiku implementation.
//               ADR-0018 (Tier B eval harness contract) records what a live call loads, what
//               is graded, and how the grader reads a reply.
// used-by:      .github/workflows/tier-b.yml
//
// What is graded (ADR-0018): chain evals only. A chain eval's covers.chain names a caller and
// the callee it dispatches, and a model genuinely chooses that callee. Hook evals stay under
// evals/, because the G3 conformance rule (scripts/checks/library-regression.mjs) requires an
// eval case for every hook event, and dry-run still validates them. They never count toward
// dispatch accuracy: Claude Code fires a hook when its event happens, no model dispatches one,
// and tests/hooks/ proves hook behavior deterministically in Tier A.
//
// How each live call runs (ADR-0018): from an empty temp folder created once per run, never from
// the repository, with the plugin loaded through --plugin-dir. User settings are left out
// (--setting-sources project), every hook is off (--settings disableAllHooks), every CLAUDE.md is
// off (CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 in the child's environment), no tool may run
// (--permission-mode dontAsk), and nothing is saved (--no-session-persistence). Before this, the
// children ran in the repository with the caller's own settings: they read the repository
// instead of the plugin, loaded its coding-agent guide and the user's global instructions, and
// fired the user's hooks. Loading the plugin without disabling hooks is not enough either: in an
// empty folder, the plugin's prompt-based Stop hook replaced the model's answer. --bare would
// isolate in one flag but refuses OAuth, which Tier B authenticates with (ADR-0010).
//
// Grading contract (F-CI-10 (weak eval grading), amended by ADR-0018): the construction code
// below never states the expected callee anywhere, in any form. The model is asked to name the
// agent or skill it believes would be dispatched, as a first line of the form
// "DISPATCH: <component-name>", with any reasoning on the next line. Grading (gradeResponse,
// exported below and unit-tested directly with zero model calls in
// tests/checks/run-evals.test.mjs) reads the FIRST such line out of the reply - a later,
// correct DISPATCH: line never rescues an earlier wrong one - and takes the component name at
// its start: leading markdown wrapping (asterisks, underscores, backticks, quotes) and a leading
// "/" are skipped, then the literal plugin namespace ("nonfiction-studio:", read from
// .claude-plugin/plugin.json) is stripped, then the name is the first run of letters, digits,
// hyphens and underscores. Whatever follows the name is ignored, so "DISPATCH: voice-capture
// (agent)" passes, unless it starts a hedge: "/", ",", ";", "&", "+", "or" or "and" before a
// second name fails the reply even when the first name is right. Only the literal namespace is
// stripped, never an arbitrary "<word>:" prefix, because the model also sees unprefixed
// built-in agents and skills. The name is normalized (lowercase, hyphens removed) and PASSes only
// on an exact match against covers.chain[1]. No DISPATCH: line anywhere in the reply, no name
// after the colon, a hedge, or a different name are all FAIL. This is fail-closed by
// construction, modeled on scripts/run-integration.mjs's exclusive-token design: naming the
// right callee only in prose, with no DISPATCH: line, still fails. Each case's "expect" field in
// evals/*.eval.json keeps its documentation value - what a human reviewer should recognize as
// correct behavior - but is not read by the grader.
//
// Pass rates are not comparable across the 2026-10-14 change (ADR-0018): before it, the 16
// hook cases counted, the plugin was not loaded, and reasoning on the DISPATCH: line failed a
// correct name. The threshold in scripts/lib/dispatch-threshold.mjs records the live run it was
// re-tuned against.
//
// Exit taxonomy:
//   0  - every graded case graded AND the dispatch-accuracy threshold was met, OR a named green
//        skip when neither credential is configured on an unattended CI runner (expected until
//        the maintainer sets the CLAUDE_CODE_OAUTH_TOKEN repo secret; see
//        scripts/lib/credential-mode.mjs), OR --dry-run / auto dry-run fallback validated every
//        eval file with zero model calls
//   1  - one or more eval files are malformed; runner aborted
//   2  - dispatch accuracy below scripts/lib/dispatch-threshold.mjs's threshold: a genuinely
//        broken dispatch table (roadmap row 1.12). RETIRED meaning: this code used to mean
//        "operational error: no model access (no API key and no usable claude CLI)"; that
//        situation no longer reaches an error at all, since it now resolves to either the named
//        skip above (unattended CI) or an automatic dry-run fallback (developer machine); see
//        scripts/lib/credential-mode.mjs.
//   3  - BUDGET_EXCEEDED: cumulative spend exceeded BUDGET_CAP_USD
//
// Budget note: see BUDGET_CAP_USD below for the arithmetic and the live run it rests on.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { decideCredentialMode } from './lib/credential-mode.mjs';
import { DISPATCH_ACCURACY_THRESHOLD, meetsDispatchThreshold } from './lib/dispatch-threshold.mjs';
import { isolationArgs, isolatedChildEnv } from './lib/claude-isolation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const EVALS_DIR = join(REPO_ROOT, 'evals');

// Budget (re-tuned 2026-10-14, ADR-0018). Three live runs of the 18 graded chain cases cost
// $0.0655, $0.0682 and $0.0656, about $0.0037 a call, with the plugin loaded and no tool use.
// The cap covers the worst case this design allows. If every call timed out once and was
// retried, a run would cost about 2 x $0.068 = $0.14. If, on top of that, every reply tried a
// tool, was denied, and took three turns, it would cost about 3 x $0.14 = $0.41. The three-turn
// figure is an assumption, taken from a probe whose plugin hooks were still on. $0.50 sits just
// above $0.41, so exit 3 means a genuine spend regression, such as a change that lets tools run,
// not an ordinary batch. The previous $1.50 cap was sized for 34 cases whose children read the
// repository.
const BUDGET_CAP_USD = 0.50;
const MODEL = 'haiku';

/** Per-call timeout. Raised from 60 seconds (issue #5): five calls on the 2026-09-23 GitHub run
 *  timed out and were graded as failures. A timeout is retried once; nothing else is. */
export const CALL_TIMEOUT_MS = 180000;

// The plugin's own name, which Claude Code puts in front of every component it loads from this
// plugin ("nonfiction-studio:thesis-architect"). Read from the manifest rather than repeated
// here, so a rename cannot leave the grader stripping a namespace that no longer exists.
const PLUGIN_NAMESPACE =
  JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).name + ':';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let dryRun = false;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
  }
  return { dryRun };
}

// ---------------------------------------------------------------------------
// Eval file loader
// ---------------------------------------------------------------------------

function loadEvalFiles() {
  if (!existsSync(EVALS_DIR)) {
    log('ERROR: evals/ directory not found at ' + EVALS_DIR);
    process.exit(1);
  }
  const files = readdirSync(EVALS_DIR).filter(f => f.endsWith('.eval.json')).sort();
  const sets = [];
  const malformed = [];
  for (const name of files) {
    const path = join(EVALS_DIR, name);
    let data;
    try {
      data = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      malformed.push({ file: name, error: e.message });
      continue;
    }
    if (!data || typeof data !== 'object' || !data.covers) {
      malformed.push({ file: name, error: 'missing covers object' });
      continue;
    }
    if (!Array.isArray(data.cases) || data.cases.length === 0) {
      malformed.push({ file: name, error: 'missing or empty cases array' });
      continue;
    }
    sets.push({ file: name, data });
  }
  return { sets, malformed };
}

/** The callee a set is graded against, or null when the set is not a dispatch eval. Only a
 *  chain eval is: a model chooses its callee. A hook eval is validated but never graded, because
 *  Claude Code fires hooks itself (ADR-0018). */
export function dispatchCallee(covers) {
  if (covers && Array.isArray(covers.chain) && covers.chain.length >= 2) return covers.chain[1];
  return null;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** Builds the prompt for one case. It interpolates the case's "given" text and nothing that
 *  names a callee. It asks for an agent or skill only: the 2026-10-13 live run showed that asking
 *  for a "hook handler" draws a script path as the answer. */
export function buildPrompt(given) {
  return (
    'Context: you are being evaluated on the Nonfiction Studio plugin, which is loaded in this ' +
    'session. Do not call any tool; answer from the agents and skills you can see.\n' +
    'Given: ' + given + '\n\n' +
    'Task: Name the one agent or skill that would be dispatched in this situation. Your first ' +
    'line must be exactly "DISPATCH: <component-name>", with nothing else on that line. If you ' +
    'add reasoning, put one sentence on the next line. Say nothing before the DISPATCH: line.'
  );
}

// ---------------------------------------------------------------------------
// Claude caller
// ---------------------------------------------------------------------------

/** The claude arguments for one live call (ADR-0018). The isolation flags come from
 *  scripts/lib/claude-isolation.mjs, shared with run-integration.mjs, with every hook turned off.
 *  Exported so a test pins every flag, and every absence: no --dangerously-skip-permissions,
 *  because no tool may run; no --bare, because it refuses OAuth. */
export function buildClaudeArgs(prompt, { repoRoot, model }) {
  return [
    '-p', prompt,
    '--model', model,
    '--output-format', 'json',
    ...isolationArgs({ repoRoot, pluginHooks: false }),
    '--permission-mode', 'dontAsk',
  ];
}

/** The child's environment, from scripts/lib/claude-isolation.mjs: every CLAUDE.md turned off. */
export const buildChildEnv = isolatedChildEnv;

function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function callOnce(prompt, { repoRoot, cwd, model, env, spawn, timeoutMs }) {
  const result = spawn('claude', buildClaudeArgs(prompt, { repoRoot, model }), {
    cwd,
    encoding: 'utf8',
    env,
    timeout: timeoutMs,
  });
  if (result.error) {
    return {
      ok: false,
      timedOut: result.error.code === 'ETIMEDOUT',
      error: result.error.message,
      costUsd: 0,
      text: '',
    };
  }
  if (!result.stdout) return { ok: false, timedOut: false, error: 'empty stdout (exit ' + result.status + ')', costUsd: 0, text: '' };
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch {
    return { ok: false, timedOut: false, error: 'non-JSON stdout', costUsd: 0, text: '' };
  }
  // The CLI emits total_cost_usd. A response missing it is a hard failure,
  // because continuing would grade the rest of the batch with no working
  // spend cap. Corrected 2026-08-07: this read only cost_usd, which CLI
  // 2.1.224 does not emit, so every call recorded $0.00 and the cap at the
  // bottom of the loop could never fire.
  //
  // Removed 2026-08-08: a legacy fallback to parsed.cost_usd, live-verified
  // absent against CLI 2.1.225 and never once observed; dead code that could
  // only ever mask a future rename of total_cost_usd behind a silent zero.
  const costUsd = typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null;
  if (costUsd === null) {
    return {
      ok: false,
      timedOut: false,
      error: 'CLI JSON carried no total_cost_usd field; '
        + 'refusing to continue without a working budget cap',
      costUsd: 0,
      text: '',
    };
  }
  return {
    ok: !parsed.is_error,
    timedOut: false,
    costUsd,
    text: typeof parsed.result === 'string' ? parsed.result : '',
    error: parsed.is_error ? (parsed.result || 'model error') : null,
  };
}

/**
 * One live call, retried once if and only if it timed out (issue #5). Refuses to run inside the
 * repository: a child there reads the repository's files and its coding-agent guide instead of
 * answering from the loaded plugin. A timed-out attempt reports no cost, because the CLI never
 * printed one; the budget cap therefore undercounts by at most one partial call per retry.
 * `spawn` is injectable so the retry rule is unit-tested with zero model calls.
 */
export function callClaudeWithRetry(prompt, { repoRoot, cwd, model, env, spawn = spawnSync, timeoutMs = CALL_TIMEOUT_MS }) {
  if (!cwd || isInside(repoRoot, cwd)) {
    throw new Error(
      'refusing to run a dispatch eval inside the repository (cwd: ' + cwd + '): the child would ' +
      'read the repository instead of answering from the loaded plugin'
    );
  }
  const opts = { repoRoot, cwd, model, env, spawn, timeoutMs };
  const first = callOnce(prompt, opts);
  if (!first.timedOut) return { ...first, attempts: 1 };
  const second = callOnce(prompt, opts);
  return { ...second, attempts: 2 };
}

/** The installed claude CLI's version, logged so a CI-only failure can be told apart from CLI
 *  version drift (issue #5). Never fatal: an unreachable CLI logs "unknown" and the run goes on to
 *  fail, or not, on its own terms. */
function claudeCliVersion() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 20000 });
  if (r.error) return 'unknown (probe failed: ' + (r.error.code || r.error.message) + ')';
  if (r.status !== 0) return 'unknown (probe exited ' + r.status + ')';
  return (r.stdout || '').trim() || 'unknown (empty output)';
}

// ---------------------------------------------------------------------------
// Grader: does the response name the expected callee?
// ---------------------------------------------------------------------------

// Returns the text after "DISPATCH:" on the FIRST line that carries the label (case-insensitive
// on the label), or null if no line does. Only the first such line is ever consulted, even if a
// later line would have graded correctly - the model does not get a second guess.
function extractDispatchLine(text) {
  if (typeof text !== 'string') return null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*DISPATCH:\s*(.*)$/i.exec(line);
    if (m) return m[1];
  }
  return null;
}

const LEADING_WRAPPERS = /^[\s*_`"']+/;
const TRAILING_WRAPPERS = /^[*_`"']+/;
const NAME_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]*/;
// A second name offered as an alternative: "a or b", "a/b", "a, b", "a and b", "a & b", "a + b",
// "a; b". A reply that hedges has not chosen, so it fails even when its first name is right.
const HEDGE = /^\s*(?:[/,;&+]|or\b|and\b)/i;

// Reads the component name at the start of a DISPATCH: line, per the grading contract in this
// file's header. Returns null when the line carries no name or hedges between two.
function parseDispatchName(rest) {
  let s = rest.replace(LEADING_WRAPPERS, '');
  if (s.startsWith('/')) s = s.slice(1);
  if (s.toLowerCase().startsWith(PLUGIN_NAMESPACE.toLowerCase())) s = s.slice(PLUGIN_NAMESPACE.length);
  const m = NAME_TOKEN.exec(s);
  if (!m) return null;
  const after = s.slice(m[0].length).replace(TRAILING_WRAPPERS, '');
  if (HEDGE.test(after)) return null;
  return m[0];
}

// Normalizes a component name for comparison: lowercase, hyphens removed. It makes a name
// written PascalCase ("PostToolUse") compare equal to its kebab-case form ("post-tool-use").
// Whitespace never reaches it: the name ends at the first space.
function normalizeComponentName(name) {
  return String(name == null ? '' : name).trim().toLowerCase().replace(/-+/g, '');
}

// Fail-closed grader. PASS only if the reply's FIRST "DISPATCH:" line starts with the expected
// callee, read and compared per the grading contract in this file's header. It takes the
// expected callee (covers.chain[1]) directly; a case's "expect" sentence is documentation for a
// human reader, not a grading signal.
export function gradeResponse(expectedCallee, text) {
  const rest = extractDispatchLine(text);
  if (rest === null) return false;
  const name = parseDispatchName(rest);
  if (!name) return false;
  return normalizeComponentName(name) === normalizeComponentName(expectedCallee);
}

// ---------------------------------------------------------------------------
// Describe a covers object for logging
// ---------------------------------------------------------------------------

function describeCovers(covers) {
  if (covers.chain) return 'chain: ' + covers.chain.join(' -> ');
  if (covers.hook) return 'hook: ' + covers.hook;
  if (covers.skill) return 'skill: ' + covers.skill;
  return JSON.stringify(covers);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function log(msg) { process.stdout.write(msg + '\n'); }

// Everything below runs only when this file is executed directly (node scripts/run-evals.mjs),
// never when it is imported for its exported functions. Without this guard,
// importing the module - as tests/checks/run-evals.test.mjs does to unit-test gradeResponse
// with zero spawns - would execute the entire credential decision, eval loading, and (on a
// machine with a real authenticated claude CLI on PATH, which this repo's own test helper
// documents as the normal case here) genuine live model calls, as a side effect of the import
// statement alone. Same guard idiom as scripts/check.mjs's own `process.argv[1]?.endsWith(...)`
// direct-run check: a filename suffix match, not a full-path comparison, so it is immune to the
// Windows drive-letter-casing mismatches a resolve()-based path-equality check would need to
// guard against. Verified false for the test file's own name (tests/checks/run-evals.test.mjs
// does not end in "run-evals.mjs"); the existing dry-run/skip tests below would catch it loudly
// if this ever silently stopped matching.
function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));

// Live grading needs working model access, which is NOT the same thing as an API key. The
// claude CLI authenticates from the active account when one is logged in, so an authenticated
// CLI session is sufficient on a developer machine, with no credential env var required at
// all. scripts/lib/credential-mode.mjs is the shared, three-state decision that both this
// script and scripts/run-integration.mjs now call; see that module's header for the full
// precedence and why CI-truthiness alone, never this probe's result, is what triggers the
// skip. Corrected 2026-08-07 alongside the same gate in run-integration.mjs.
//
// Corrected again in this task (F-CI-02, Tier B trigger contradicts D-20): this probe proves
// only that the claude binary EXISTS, never that anyone is authenticated, and this script's
// prior gate treated "no model access" as a hard exit(2) with no CI-awareness at all,
// disagreeing with run-integration.mjs's own (also broken) dry-run fallback for the identical
// situation. Both scripts now call the same decision function and can never disagree again.
// The probe below is consulted ONLY on a non-CI developer machine with neither credential set.
function claudeCliUsable() {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 20000 });
  return !probe.error && probe.status === 0;
}

// An explicit --dry-run always wins, regardless of credential or CI state - the same
// precedence the pre-existing flag always had; the credential decision is not even computed.
let decisionMode;
if (dryRun) {
  decisionMode = 'dry-run';
} else {
  // The two process.env reads immediately below are intentionally the only literal
  // `ANTHROPIC_API_KEY`- and `CLAUDE_CODE_OAUTH_TOKEN`-shaped access in this file;
  // scripts/lib/credential-mode.mjs takes already-read values instead, so it never touches
  // process.env itself. See scripts/self-sufficiency-exceptions.json for the reviewed,
  // still-current reason the ANTHROPIC_API_KEY read is allowed.
  const decision = decideCredentialMode(
    {
      oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      apiKey: process.env.ANTHROPIC_API_KEY,
      ci: process.env.CI,
    },
    claudeCliUsable
  );
  log('[run-evals] credential decision: ' + decision.mode + ' (' + decision.reason + ')');
  if (decision.mode === 'skip') {
    log('[run-evals] SKIP - ' + decision.reason);
    process.exit(0);
  }
  decisionMode = decision.mode;
}

log('[run-evals] loading eval files from ' + EVALS_DIR);
const { sets, malformed } = loadEvalFiles();

if (malformed.length > 0) {
  for (const m of malformed) {
    log('[run-evals] MALFORMED: ' + m.file + ': ' + m.error);
  }
  log('[run-evals] aborting: ' + malformed.length + ' malformed eval file(s)');
  process.exit(1);
}

let gradedCaseCount = 0;
let hookCaseCount = 0;
let otherCaseCount = 0;
for (const s of sets) {
  if (dispatchCallee(s.data.covers)) gradedCaseCount += s.data.cases.length;
  else if (s.data.covers.hook) hookCaseCount += s.data.cases.length;
  else otherCaseCount += s.data.cases.length;
}

log('[run-evals] found ' + sets.length + ' eval file(s)');
if (decisionMode === 'dry-run') {
  log('[run-evals] DRY-RUN: files validated (zero model calls)');
  for (const s of sets) {
    log('  ok: ' + s.file + ' (' + describeCovers(s.data.covers) + ', ' + s.data.cases.length + ' case(s))');
  }
  log(
    '[run-evals] dry-run complete: all ' + sets.length + ' eval files well-formed (' +
    gradedCaseCount + ' graded chain case(s), ' + hookCaseCount + ' hook case(s) validated but not graded' +
    (otherCaseCount ? ', ' + otherCaseCount + ' other case(s) validated but not graded' : '') + ')'
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live grading
// ---------------------------------------------------------------------------

// One empty folder per run, removed on every exit path: process.exit() skips finally blocks, so
// cleanup hangs off the process's own exit event instead.
const evalCwd = mkdtempSync(join(tmpdir(), 'nfs-evals-'));
process.on('exit', () => {
  try { rmSync(evalCwd, { recursive: true, force: true }); } catch { /* best effort */ }
});
const childEnv = buildChildEnv(process.env);

log('[run-evals] claude CLI version: ' + claudeCliVersion());
log('[run-evals] model: ' + MODEL + ', budget cap: $' + BUDGET_CAP_USD + ', per-call timeout: ' +
  (CALL_TIMEOUT_MS / 1000) + 's with one retry on timeout');
log('[run-evals] isolation: each call runs in an empty temp folder with the plugin loaded from ' +
  'the repository; user settings, every hook and every CLAUDE.md are off');
log('');

const results = [];
let totalCases = 0;
let passedCases = 0;
let totalSpendUsd = 0;

for (const s of sets) {
  const covers = s.data.covers;
  const coversDesc = describeCovers(covers);
  const callee = dispatchCallee(covers);
  if (!callee) {
    log('[' + s.file + '] ' + coversDesc + ' - ' + s.data.cases.length + ' case(s) not graded ' +
      '(not a dispatch eval: Claude Code fires hooks itself; tests/hooks/ covers their behavior)');
    continue;
  }
  log('[' + s.file + '] ' + coversDesc + ' - ' + s.data.cases.length + ' case(s)');

  for (let i = 0; i < s.data.cases.length; i++) {
    const c = s.data.cases[i];
    totalCases++;

    if (totalSpendUsd > BUDGET_CAP_USD) {
      log('  BUDGET_EXCEEDED: $' + totalSpendUsd.toFixed(6) + ' > $' + BUDGET_CAP_USD);
      process.exit(3);
    }

    const r = callClaudeWithRetry(buildPrompt(c.given), {
      repoRoot: REPO_ROOT,
      cwd: evalCwd,
      model: MODEL,
      env: childEnv,
    });
    totalSpendUsd += r.costUsd;
    const grade = r.ok ? gradeResponse(callee, r.text) : false;
    if (grade) passedCases++;

    const verdict = grade ? 'PASS' : (r.ok ? 'FAIL' : 'ERROR');
    const retried = r.attempts > 1 ? ', retried after a timeout' : '';
    log('  case ' + (i + 1) + ': ' + verdict + ' ($' + r.costUsd.toFixed(6) + retried + ') - ' + c.given.slice(0, 60));
    if (!r.ok) log('    error: ' + r.error);
    if (r.ok && !grade) log('    response: ' + r.text.slice(0, 160).replace(/\n/g, ' '));

    results.push({ file: s.file, caseIndex: i, verdict, costUsd: r.costUsd });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

log('');
log('[run-evals] === dispatch-accuracy report ===');
log('[run-evals] eval files:  ' + sets.length);
log('[run-evals] total cases: ' + totalCases);
log('[run-evals] passed:      ' + passedCases + ' / ' + totalCases +
  ' (' + (totalCases > 0 ? Math.round(100 * passedCases / totalCases) : 0) + '%)');
log('[run-evals] hook cases not graded: ' + hookCaseCount +
  ' (hook events are fired by Claude Code, not dispatched by a model; tests/hooks/ covers their behavior)');
log('[run-evals] total spend: $' + totalSpendUsd.toFixed(6) + ' of $' + BUDGET_CAP_USD + ' cap');

const failedResults = results.filter(r => r.verdict !== 'PASS');
if (failedResults.length > 0) {
  log('[run-evals] failed cases:');
  for (const r of failedResults) {
    log('  ' + r.file + ' case ' + (r.caseIndex + 1) + ': ' + r.verdict);
  }
}

// Posture (F-CI-02, Tier B trigger contradicts D-20): advisory to merges, because this tier
// never runs on pull requests at all (.github/workflows/tier-b.yml has no pull_request
// trigger, so it cannot block one); blocking to releases, because a scheduled or manually
// dispatched run that falls below the threshold below now exits nonzero. Both hold at once --
// neither line here contradicts the other. This replaces the old unconditional "failures here
// do not block the gate" claim, which stopped being true the moment the threshold gate below
// was added.
log('[run-evals] posture: advisory to merges (this tier never runs on pull requests); blocking to a scheduled or dispatched run below the threshold');

if (!meetsDispatchThreshold(passedCases, totalCases)) {
  log(
    '[run-evals] DISPATCH ACCURACY BELOW THRESHOLD: ' + passedCases + '/' + totalCases +
    ' < the required ' + Math.round(DISPATCH_ACCURACY_THRESHOLD * 100) +
    '% (roadmap row 1.12: a genuinely broken dispatch table must turn a live run red)'
  );
  process.exit(2);
}

log('[run-evals] dispatch accuracy meets the ' + Math.round(DISPATCH_ACCURACY_THRESHOLD * 100) + '% threshold');
process.exit(0);
}

if (process.argv[1]?.endsWith('run-evals.mjs')) {
  main();
}
