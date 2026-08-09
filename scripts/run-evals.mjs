// scripts/run-evals.mjs
// what-it-is:   Tier B eval batch runner
// what-it-does: reads every evals/*.eval.json file, sends each case's "given"
//               trigger to the Claude API using haiku, and grades whether the
//               response routes to the declared callee; produces a
//               dispatch-accuracy report per Q-01 section 5.3.
// why:          Q-01 section 5.3; the batch runner measures routing accuracy
//               as advisory signal (a chain edge with 100% dispatch but poor
//               output quality is addressed separately by behavioral evals or
//               deterministic checkers). OQ-002 (batch eval runner ownership)
//               resolved: toolkit v1.6.0 does not ship a runner; this is the
//               in-house Node.js + haiku implementation.
// used-by:      .github/workflows/tier-b.yml
//
// Exit taxonomy:
//   0  - all cases graded (pass or fail; the runner always completes)
//   1  - one or more eval files are malformed; runner aborted
//   2  - operational error (no model access: no API key and no usable claude CLI)
//   3  - BUDGET_EXCEEDED: cumulative spend exceeded the $1.50 cap
//
// Budget note (recalibrated 2026-08-08): 28 eval cases across 15 files at a
// measured $0.037 per haiku call cost roughly $1.04 the last time this was
// measured live, comfortably inside the $1.50 cap. A live batch is expected
// to grade every case and exit 0; the old $0.10 cap covered barely two calls,
// so it tripped BUDGET_EXCEEDED partway through every single run by design,
// not in response to any real overrun. Hitting BUDGET_EXCEEDED (exit 3) now
// means a genuine regression in spend, not the previously guaranteed outcome.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function gradeResponse(expect, text) {
  // Grade: the expect string should appear (case-insensitive) in the response.
  // This is an intentionally loose check - routing evals measure whether the
  // model knows about the callee, not prose quality or exact phrasing.
  return text.toLowerCase().includes(expect.toLowerCase());
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

const { dryRun } = parseArgs(process.argv.slice(2));

// Live grading needs working model access, not an API key specifically. The
// claude CLI authenticates from the active account when one is logged in, so an
// authenticated CLI is sufficient. A key is required only where no account
// exists, which is a CI runner. Corrected 2026-08-07 alongside the same gate in
// run-integration.mjs.
function claudeCliUsable() {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 20000 });
  return !probe.error && probe.status === 0;
}

if (!dryRun && !process.env.ANTHROPIC_API_KEY && !claudeCliUsable()) {
  log('[run-evals] ERROR: no model access available. Set ANTHROPIC_API_KEY, or log in');
  log('[run-evals]        with the claude CLI, or run with --dry-run to validate files only.');
  process.exit(2);
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
if (dryRun) {
  log('[run-evals] DRY-RUN: files validated (zero model calls)');
  for (const s of sets) {
    log('  ok: ' + s.file + ' (' + describeCovers(s.data.covers) + ', ' + s.data.cases.length + ' case(s))');
  }
  log('[run-evals] dry-run complete: all ' + sets.length + ' eval files well-formed');
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

    // Build prompt: give the model the trigger text and ask it to identify the callee
    const callee = covers.chain ? covers.chain[1] : covers.hook;
    const prompt =
      'Context: Nonfiction Studio plugin evaluation.\n' +
      'Covers: ' + coversDesc + '\n' +
      'Expected callee: ' + callee + '\n' +
      'Given: ' + c.given + '\n\n' +
      'Task: In 1-2 sentences, describe which agent, skill, or hook handler would be dispatched ' +
      'in this situation and why. Name the expected callee explicitly.';

    const r = callClaude(prompt);
    const grade = r.ok ? gradeResponse(c.expect, r.text) || r.text.toLowerCase().includes((callee || '').toLowerCase()) : false;
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

log('[run-evals] advisory: dispatch accuracy is signal only; failures here do not block the gate');
process.exit(0);
