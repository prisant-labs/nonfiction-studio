// scripts/run-evals.mjs
// what-it-is:   Tier B eval batch runner
// what-it-does: reads every evals/*.eval.json file, sends each case's "given"
//               trigger to the Claude API using haiku, and grades whether the
//               response names the correct callee via an exclusive DISPATCH:
//               token (see the grading contract below); produces a
//               dispatch-accuracy report per Q-01 section 5.3, and fails the
//               run if the pass rate drops below scripts/lib/dispatch-threshold.mjs's
//               documented threshold (roadmap row 1.12: a genuinely broken
//               dispatch table must turn a live run red).
// why:          Q-01 section 5.3; the batch runner measures routing accuracy.
//               A chain edge with 100% dispatch but poor output quality is a
//               separate concern, addressed by behavioral evals or
//               deterministic checkers, not this gate. OQ-002 (batch eval
//               runner ownership) resolved: toolkit v1.6.0 does not ship a
//               runner; this is the in-house Node.js + haiku implementation.
// used-by:      .github/workflows/tier-b.yml
//
// Grading contract (F-CI-10 (weak eval grading), replacing a prior substring check): the
// construction code below never states the expected callee anywhere, in any form - not the
// callee name, not the covers description it is derived from - except where an eval case's own
// "given" text names its hook literally (e.g. post-tool-use.eval.json's given text opens
// "PostToolUse fires for a WebFetch result..."), a pre-existing eval-content property this
// change does not touch: all 16 cases across the 6 hook eval files (post-tool-batch,
// post-tool-use, pre-compact, pre-tool-use, session-start, stop) name their hook this way, while
// the 10 chain eval files' 18 cases describe a triggering situation without naming the callee.
// The model is asked only to name the component it believes would be dispatched, as exactly one
// line of the form
// "DISPATCH: <component-name>", optionally followed by one sentence of reasoning. Grading
// (gradeResponse, exported below and unit-tested directly with zero model calls in
// tests/checks/run-evals.test.mjs) parses the FIRST such line out of the reply - a later,
// correct DISPATCH: line never rescues an earlier wrong one - normalizes it (trim, lowercase,
// strip whitespace and hyphens, so a covers.hook value written PascalCase such as "PostToolUse"
// compares equal to a reply written "post-tool-use" or "post tool use"; the same rule applies
// uniformly to chain callees, which already ship kebab-case), and PASSes only on an exact match
// against the expected callee (covers.chain[1] or covers.hook). No DISPATCH: line anywhere in
// the reply, an empty name after the colon, or a different name are all FAIL. This is
// fail-closed by construction, modeled on scripts/run-integration.mjs's exclusive-token design
// (its SCAFFOLD_OK / SCAFFOLD_MISSING pattern): naming the right callee only in prose, with no
// DISPATCH: line, still fails - that used to pass under the deleted callee-echo fallback
// (`gradeResponse(c.expect, r.text) || r.text.includes(callee)`), because the model was simply
// repeating text an earlier version of this prompt had handed it directly in a line reading
// "Expected callee: " plus that same callee. Each case's "expect" field in evals/*.eval.json
// keeps its documentation value - what a human reviewer should recognize as correct behavior -
// but is no longer read by the grader at all.
//
// Pass rates from before this change are NOT comparable to pass rates after it: the deleted
// grader passed on a loose substring match against a callee the model had already been handed
// in the prompt, which is a fundamentally easier task than answering cold with an exclusive
// token it was never shown. No live run against evals/ has been made since this change landed
// (no live model calls are made by this task's tests or by its own verification), so the new
// pass rate under the stricter contract is not yet known. Pass rates are also not comparable
// ACROSS the two eval shapes for the reason noted above: the 6 hook files' cases name their
// hook inside "given" itself, so their pass rate measures something closer to reading
// comprehension than the 10 chain files' cold-inference task, and will tend to run higher for
// that reason alone, not because chain dispatch is less reliable. The dispatch-accuracy
// threshold in scripts/lib/dispatch-threshold.mjs is deliberately left untouched at 0.70:
// re-tuning it is a decision for the maintainer's next live Tier B run, once the actual pass
// rate under this contract has been observed, not something this change should guess at.
//
// Exit taxonomy:
//   0  - every case graded AND the dispatch-accuracy threshold was met, OR a named green skip
//        when neither credential is configured on an unattended CI runner (expected until the
//        maintainer sets the CLAUDE_CODE_OAUTH_TOKEN repo secret; see
//        scripts/lib/credential-mode.mjs), OR --dry-run / auto dry-run fallback validated every
//        eval file with zero model calls
//   1  - one or more eval files are malformed; runner aborted
//   2  - dispatch accuracy below scripts/lib/dispatch-threshold.mjs's threshold: a genuinely
//        broken dispatch table (roadmap row 1.12). RETIRED meaning, as of this task: this code
//        used to mean "operational error: no model access (no API key and no usable claude
//        CLI)"; that situation no longer reaches an error at all, since it now resolves to
//        either the named skip above (unattended CI) or an automatic dry-run fallback
//        (developer machine); see scripts/lib/credential-mode.mjs.
//   3  - BUDGET_EXCEEDED: cumulative spend exceeded the $1.50 cap
//
// Budget note (recalibrated 2026-08-08, case count corrected 2026-08-09): 34 eval cases across
// 16 files (counted directly from each file's cases[] array; the file originally said 28
// across 15, which had gone stale as evals/ grew). The $0.037-per-haiku-call and ~$1.04-total
// figures below are carried forward from the 2026-08-08 measurement and are NOT re-measured
// against the corrected 34-case count; treat them as an estimate from an earlier case count,
// not a re-verified one. Comfortably inside the $1.50 cap either way. A live batch is expected
// to grade every case and exit 0; the old $0.10 cap covered barely two calls, so it tripped
// BUDGET_EXCEEDED partway through every single run by design, not in response to any real
// overrun. Hitting BUDGET_EXCEEDED (exit 3) now means a genuine regression in spend, not the
// previously guaranteed outcome.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideCredentialMode } from './lib/credential-mode.mjs';
import { DISPATCH_ACCURACY_THRESHOLD, meetsDispatchThreshold } from './lib/dispatch-threshold.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const EVALS_DIR = join(REPO_ROOT, 'evals');

const BUDGET_CAP_USD = 1.50;
const MODEL = 'haiku';

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

// ---------------------------------------------------------------------------
// Claude caller
// ---------------------------------------------------------------------------

let totalSpendUsd = 0;

function callClaude(prompt) {
  const args = [
    '-p', prompt,
    '--model', MODEL,
    '--dangerously-skip-permissions',
    '--output-format', 'json',
  ];
  const result = spawnSync('claude', args, {
    encoding: 'utf8',
    env: process.env,
    timeout: 60000,
  });
  if (result.error) return { ok: false, error: result.error.message, costUsd: 0, text: '' };
  if (!result.stdout) return { ok: false, error: 'empty stdout (exit ' + result.status + ')', costUsd: 0, text: '' };
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch {
    return { ok: false, error: 'non-JSON stdout', costUsd: 0, text: '' };
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
      error: 'CLI JSON carried no total_cost_usd field; '
        + 'refusing to continue without a working budget cap',
      costUsd: 0,
      text: '',
    };
  }
  totalSpendUsd += costUsd;
  return {
    ok: !parsed.is_error,
    costUsd,
    text: typeof parsed.result === 'string' ? parsed.result : '',
    error: parsed.is_error ? (parsed.result || 'model error') : null,
  };
}

// ---------------------------------------------------------------------------
// Grader: does the response mention the expected callee?
// ---------------------------------------------------------------------------

// Parses the FIRST "DISPATCH: <name>" line out of a model reply. Case-insensitive on the
// "DISPATCH:" label itself (so "dispatch:" still parses), but only the first matching line is
// ever consulted, even if a later line would have graded correctly - the model does not get a
// second guess. Returns the trimmed name (which may be empty if the line has nothing after the
// colon), or null if no such line exists anywhere in the reply.
// A line is captured verbatim after the colon, so trailing prose on the same line ("DISPATCH:
// drafting-partner is right") becomes part of the captured name and fails normalized comparison
// against a bare callee - the prompt asks for the component name alone on that line, and a
// reply that does not follow that shape is graded on what it actually said, not on what it
// probably meant.
function extractDispatchName(text) {
  if (typeof text !== 'string') return null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*DISPATCH:\s*(.*)$/i.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

// Normalizes a component name for comparison: trim, lowercase, strip all whitespace and
// hyphens. This is the hook-name normalization rule: it makes a covers.hook value written
// PascalCase (e.g. "PostToolUse") compare equal to a kebab-case or spaced form a model might
// answer with ("post-tool-use", "post tool use") - all three normalize to "posttooluse". The
// same rule applies uniformly to chain callees, which already ship kebab-case (e.g.
// "drafting-partner"), so one normalization covers both callee shapes without a separate branch
// for hooks vs. chain members.
function normalizeComponentName(name) {
  return String(name == null ? '' : name).trim().toLowerCase().replace(/[\s-]+/g, '');
}

// Fail-closed grader for F-CI-10 (weak eval grading). PASS only if the reply's FIRST
// "DISPATCH: <name>" line names the expected callee, compared via normalizeComponentName above.
// No DISPATCH: line anywhere in the reply, a DISPATCH: line with an empty name, or a DISPATCH:
// line naming something other than the expected callee are all FAIL - including a reply that
// names the correct callee only in prose, with no DISPATCH: line at all, which is exactly the
// shape the deleted callee-echo fallback (`|| text.includes(callee)`) used to let through. This
// function no longer takes an eval case's "expect" sentence as its first argument: it takes the
// expected callee (covers.chain[1] or covers.hook) directly, since "expect" is documentation
// for a human reader now, not a grading signal.
export function gradeResponse(expectedCallee, text) {
  const name = extractDispatchName(text);
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
// never when it is imported for its exported functions (gradeResponse). Without this guard,
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

log('[run-evals] found ' + sets.length + ' eval file(s)');
if (decisionMode === 'dry-run') {
  log('[run-evals] DRY-RUN: files validated (zero model calls)');
  let dryRunTotalCases = 0;
  for (const s of sets) {
    dryRunTotalCases += s.data.cases.length;
    log('  ok: ' + s.file + ' (' + describeCovers(s.data.covers) + ', ' + s.data.cases.length + ' case(s))');
  }
  log(
    '[run-evals] dry-run complete: all ' + sets.length + ' eval files well-formed (' +
    dryRunTotalCases + ' case(s))'
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live grading
// ---------------------------------------------------------------------------

log('[run-evals] model: ' + MODEL + ', budget cap: $' + BUDGET_CAP_USD);
log('');

const results = [];
let totalCases = 0;
let passedCases = 0;

for (const s of sets) {
  const covers = s.data.covers;
  const coversDesc = describeCovers(covers);
  log('[' + s.file + '] ' + coversDesc + ' - ' + s.data.cases.length + ' case(s)');

  for (let i = 0; i < s.data.cases.length; i++) {
    const c = s.data.cases[i];
    totalCases++;

    if (totalSpendUsd > BUDGET_CAP_USD) {
      log('  BUDGET_EXCEEDED: $' + totalSpendUsd.toFixed(6) + ' > $' + BUDGET_CAP_USD);
      process.exit(3);
    }

    // Build prompt: the construction code here injects nothing that names the callee it is
    // being graded against. Deliberately excludes coversDesc (used above and below for the
    // runner's own logging only): describeCovers() renders "chain: nfs-draft ->
    // drafting-partner" or "hook: PostToolUse", which names the expected callee just as
    // directly as the deleted "Expected callee: " line did, so it must never reach the prompt.
    // This is a claim about what this code adds, not about the prompt as sent: c.given is
    // interpolated verbatim below, and for the 6 hook eval files (post-tool-batch,
    // post-tool-use, pre-compact, pre-tool-use, session-start, stop) that eval-authored text
    // already names the hook itself (e.g. "PostToolUse fires for..."), a pre-existing property
    // of those eval files this change does not touch. The 10 chain eval files' given text does
    // not name their callee, so only those cases exercise a genuinely cold inference.
    const callee = covers.chain ? covers.chain[1] : covers.hook;
    const prompt =
      'Context: Nonfiction Studio plugin evaluation.\n' +
      'Given: ' + c.given + '\n\n' +
      'Task: Answer with exactly one line of the form "DISPATCH: <component-name>", naming the ' +
      'agent, skill, or hook handler that would be dispatched in this situation. You may follow ' +
      'that line with one sentence of reasoning, but say nothing before the DISPATCH: line.';

    const r = callClaude(prompt);
    const grade = r.ok ? gradeResponse(callee, r.text) : false;
    if (grade) passedCases++;

    const verdict = grade ? 'PASS' : (r.ok ? 'FAIL' : 'ERROR');
    log('  case ' + (i + 1) + ': ' + verdict + ' ($' + r.costUsd.toFixed(6) + ') - ' + c.given.slice(0, 60));
    if (!r.ok) log('    error: ' + r.error);
    if (r.ok && !grade) log('    response: ' + r.text.slice(0, 120).replace(/\n/g, ' '));

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
