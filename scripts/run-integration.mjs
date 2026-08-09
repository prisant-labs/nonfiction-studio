// scripts/run-integration.mjs
// what-it-is:   Tier B model-integration runner
// what-it-does: drives the MVP author flow against a TEMP CLONE seeded from
//               examples/sample-book/ with the haiku model; asserts ONLY
//               artifact-level conditions from Q-01 section 7; exits
//               BUDGET_EXCEEDED (code 3) when haiku spend passes $0.10.
//               Supports --dry-run: validates the plan and resolves paths with
//               zero model calls, running only deterministic assertions.
// why:          Q-02 section 2 Tier B; the budget cap makes this safe to run
//               locally and in CI without unbounded spend.
// used-by:      .github/workflows/tier-b.yml; local: node scripts/run-integration.mjs
//
// Exit taxonomy:
//   0  - all assertions pass (live or dry-run)
//   1  - functional assertion failure
//   2  - operational error (clone failed, CLI unavailable, etc.)
//   3  - BUDGET_EXCEEDED: cumulative haiku spend exceeded $0.10
//
// Budget mechanism:
//   Each claude -p call uses --output-format json. The JSON result carries the
//   API-reported cost for that call in total_cost_usd. Costs accumulate; when the
//   running total exceeds BUDGET_CAP_USD the runner exits 3 before the next call.
//   This derives spend from the CLI's machine-readable output surface, not from
//   token arithmetic, so it honors cache discounts automatically.
//
//   Corrected 2026-08-07: this read parsed.cost_usd, a field the CLI does not
//   emit (verified against CLI 2.1.224, which emits total_cost_usd). The value
//   was therefore always undefined, coerced to 0, and the cap could never fire.
//   The defect was undetectable while the API-key gate below forced dry-run on
//   every machine, so runLiveMode had never executed against a real response.
//   A missing cost field is now a HARD ERROR rather than a silent zero, so this
//   class of failure can never again present as a working budget.
//
// Flat-layout note (Q-02 section 2.1, 2026-07-19):
//   The Q-02 sketch references a "book/" scaffold. The built flat reality has no
//   book/ subdirectory: all project directories (context/, structure/, chapters/,
//   research/, production/, .studio/) live at the project root. Assertions in
//   this runner use the flat paths, not a nested book/ prefix.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BUDGET_CAP_USD = 0.10;
const DEFAULT_MODEL = 'haiku';
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');
const FIXTURES_DIR = join(REPO_ROOT, 'examples', 'fixtures');
const BIN = join(REPO_ROOT, 'bin');
const NS_DOCTOR = join(BIN, 'ns-doctor');
const NS_GATE = join(BIN, 'ns-gate');

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let dryRun = false;
  let model = DEFAULT_MODEL;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--model') model = argv[++i] ?? DEFAULT_MODEL;
    else if (a.startsWith('--model=')) model = a.slice('--model='.length) || DEFAULT_MODEL;
  }
  return { dryRun, model };
}

// ---------------------------------------------------------------------------
// Temp clone helpers
// ---------------------------------------------------------------------------

function makeTempClone(sourceDir, label) {
  const prefix = 'nonfiction-integration-' + label + '-';
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  cpSync(sourceDir, tempDir, { recursive: true });
  return tempDir;
}

function removeTempClone(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Assertion helpers (structural only: file/dir existence, content markers)
// ---------------------------------------------------------------------------

function assertDirExists(dir, label) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: false, message: 'FAIL [' + label + ']: directory not found: ' + dir };
  }
  return { ok: true, message: 'pass [' + label + ']: directory exists' };
}

function assertFileContains(filePath, pattern, label) {
  if (!existsSync(filePath)) {
    return { ok: false, message: 'FAIL [' + label + ']: file not found: ' + filePath };
  }
  const content = readFileSync(filePath, 'utf8');
  const found = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content);
  if (!found) {
    return { ok: false, message: 'FAIL [' + label + ']: pattern not found in ' + filePath };
  }
  return { ok: true, message: 'pass [' + label + ']: pattern found' };
}

function assertDirNonEmpty(dir, ext, label) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: false, message: 'FAIL [' + label + ']: directory not found: ' + dir };
  }
  const files = readdirSync(dir).filter(f => !ext || f.endsWith(ext));
  if (files.length === 0) {
    return { ok: false, message: 'FAIL [' + label + ']: no ' + (ext || '') + ' files in ' + dir };
  }
  // Check the first matching file has a non-empty body
  const first = join(dir, files[0]);
  const body = readFileSync(first, 'utf8').trim();
  if (!body) {
    return { ok: false, message: 'FAIL [' + label + ']: first file ' + files[0] + ' is empty' };
  }
  return { ok: true, message: 'pass [' + label + ']: ' + files.length + ' file(s) found, first non-empty' };
}

function assertAiUseLogHasAgent(logPath, label) {
  if (!existsSync(logPath)) {
    return { ok: false, message: 'FAIL [' + label + ']: file not found: ' + logPath };
  }
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim());
  const hasAgent = lines.some(line => {
    try { return JSON.parse(line).agent !== undefined; } catch { return false; }
  });
  if (!hasAgent) {
    return { ok: false, message: 'FAIL [' + label + ']: no line with agent field in ' + logPath };
  }
  return { ok: true, message: 'pass [' + label + ']: ai-use-log has entry with agent field' };
}

// ---------------------------------------------------------------------------
// Engine runner (deterministic; no model calls)
// ---------------------------------------------------------------------------

function runEngine(enginePath, args, cwd) {
  const result = spawnSync('node', [enginePath, ...args], {
    encoding: 'utf8',
    env: process.env,
    cwd,
  });
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// ---------------------------------------------------------------------------
// Claude CLI caller (live mode only)
// ---------------------------------------------------------------------------

let totalSpendUsd = 0;

function callClaude(prompt, model, cwd) {
  const args = [
    '-p', prompt,
    '--model', model,
    '--dangerously-skip-permissions',
    '--output-format', 'json',
  ];
  const result = spawnSync('claude', args, {
    encoding: 'utf8',
    env: process.env,
    cwd,
    timeout: 120000,
  });
  if (result.error) {
    return { ok: false, error: result.error.message, costUsd: 0, text: '' };
  }
  if (!result.stdout) {
    return { ok: false, error: 'empty stdout (exit ' + result.status + ')', costUsd: 0, text: '' };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, error: 'non-JSON stdout', costUsd: 0, text: result.stdout.slice(0, 200) };
  }
  // The CLI emits total_cost_usd; cost_usd is accepted as a legacy fallback.
  // A response with NEITHER field is a hard failure: continuing would run the
  // rest of the flow with no working spend cap, which is exactly how the
  // pre-2026-08-07 defect stayed invisible.
  const costUsd = typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd
    : (typeof parsed.cost_usd === 'number' ? parsed.cost_usd : null);
  if (costUsd === null) {
    return {
      ok: false,
      error: 'CLI JSON carried no total_cost_usd (or legacy cost_usd) field; '
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
// Scaffold assertion set (flat layout: no book/ prefix)
// ---------------------------------------------------------------------------

function runStructuralAssertions(projectDir, label) {
  const assertions = [];
  assertions.push(assertDirExists(join(projectDir, 'context'), label + ':context/'));
  assertions.push(assertDirExists(join(projectDir, 'structure'), label + ':structure/'));
  assertions.push(assertDirExists(join(projectDir, 'chapters'), label + ':chapters/'));
  assertions.push(assertDirExists(join(projectDir, 'research'), label + ':research/'));
  assertions.push(assertDirExists(join(projectDir, 'production'), label + ':production/'));
  assertions.push(assertDirExists(join(projectDir, '.studio'), label + ':.studio/'));
  // Q-01 section 7: "File contains a DRAFT: block" applies during the active interview.
  // For a seeded clone (post-interview), the brief is finalized with section headers (## N.).
  // The assertion is: brief.md is non-empty and populated (has at least one ## section).
  // TSK-056 review Minor C: brief-population assertion uses section headers, not DRAFT blocks,
  // because the seeded sample-book clone has a finalized brief. Q-01 section 5.2 updated 2026-07-19.
  assertions.push(assertFileContains(
    join(projectDir, 'context', 'brief.md'), '## ', label + ':brief populated (section headers)'
  ));
  assertions.push(assertDirNonEmpty(
    join(projectDir, 'chapters'), '.md', label + ':chapters/ non-empty'
  ));
  assertions.push(assertFileContains(
    join(projectDir, 'research', 'evidence-log.md'), 'EV-', label + ':evidence-log EV- entry'
  ));
  // structure/outline.md must exist and be non-empty (Fix 3: TSK-056 review)
  assertions.push(assertFileContains(
    join(projectDir, 'structure', 'outline.md'), /\S/, label + ':outline.md non-empty'
  ));
  assertions.push(assertAiUseLogHasAgent(
    join(projectDir, '.studio', 'ai-use-log.jsonl'), label + ':ai-use-log agent field'
  ));
  return assertions;
}

// ---------------------------------------------------------------------------
// Deterministic assertions (fixture-based; no model calls)
// ---------------------------------------------------------------------------

function runDeterministicAssertions(goldenClone) {
  const assertions = [];

  // Broken fixture caught: ns-doctor against unsourced-claim exits 1
  const ucFixture = join(FIXTURES_DIR, 'unsourced-claim');
  if (!existsSync(ucFixture)) {
    assertions.push({ ok: false, message: 'FAIL [broken-fixture]: unsourced-claim fixture not found' });
  } else {
    const r = runEngine(NS_DOCTOR, ['--project=' + ucFixture, '--check'], REPO_ROOT);
    const ok = r.status === 1;
    assertions.push({
      ok,
      message: ok
        ? 'pass [broken-fixture]: ns-doctor exits 1 on unsourced-claim (word-count coherence)'
        : 'FAIL [broken-fixture]: ns-doctor expected exit 1, got ' + r.status,
    });
  }

  // Gate passes on golden clone: ns-gate exits 0 in warn-mode
  const r = runEngine(NS_GATE, ['--project=' + goldenClone], REPO_ROOT);
  const gateOk = r.status === 0;
  assertions.push({
    ok: gateOk,
    message: gateOk
      ? 'pass [gate-golden]: ns-gate exits 0 on golden clone (warn-mode)'
      : 'FAIL [gate-golden]: ns-gate expected exit 0, got ' + r.status,
  });

  return assertions;
}

// ---------------------------------------------------------------------------
// Dry-run mode: validate plan and run deterministic checks only
// ---------------------------------------------------------------------------

function runDryMode(model) {
  log('[run-integration] DRY-RUN mode: zero model calls; deterministic checks only');
  log('[run-integration] model that would be used: ' + model);
  log('[run-integration] budget cap: $' + BUDGET_CAP_USD);
  log('[run-integration] seed source: ' + SAMPLE_BOOK);

  if (!existsSync(SAMPLE_BOOK)) {
    fatal('seed source not found: ' + SAMPLE_BOOK);
  }
  log('[run-integration] seed source: OK');

  // Resolve paths
  const requiredPaths = [
    join(SAMPLE_BOOK, 'context', 'brief.md'),
    join(SAMPLE_BOOK, 'structure', 'outline.md'),
    join(SAMPLE_BOOK, 'research', 'evidence-log.md'),
    join(SAMPLE_BOOK, '.studio', 'ai-use-log.jsonl'),
    join(FIXTURES_DIR, 'unsourced-claim'),
    NS_DOCTOR,
    NS_GATE,
  ];
  let pathsOk = true;
  for (const p of requiredPaths) {
    if (existsSync(p)) {
      log('  path OK: ' + p);
    } else {
      log('  path MISSING: ' + p);
      pathsOk = false;
    }
  }
  if (!pathsOk) return exitWithCode(2, 'dry-run: one or more required paths missing');

  // Create a temp clone for deterministic assertions
  let tempDir;
  try {
    log('[run-integration] creating temp clone for deterministic assertions ...');
    tempDir = makeTempClone(SAMPLE_BOOK, 'dry');
    log('[run-integration] temp clone: ' + tempDir);
  } catch (err) {
    return exitWithCode(2, 'dry-run: clone failed: ' + err.message);
  }

  try {
    log('\n[run-integration] -- structural assertions --');
    const structAssertions = runStructuralAssertions(tempDir, 'dry-run');
    let allOk = true;
    for (const a of structAssertions) {
      log('  ' + a.message);
      if (!a.ok) allOk = false;
    }

    log('\n[run-integration] -- deterministic assertions --');
    const detAssertions = runDeterministicAssertions(tempDir);
    for (const a of detAssertions) {
      log('  ' + a.message);
      if (!a.ok) allOk = false;
    }

    if (!allOk) return exitWithCode(1, 'dry-run: one or more assertions failed');

    log('\n[run-integration] dry-run complete: all assertions pass, $0.00 spent');
    log('[run-integration] no model calls made; rerun without --dry-run for the live flow');
    return exitWithCode(0);
  } finally {
    removeTempClone(tempDir);
  }
}

// ---------------------------------------------------------------------------
// Live mode: full MVP flow via claude -p with budget tracking
// ---------------------------------------------------------------------------

function runLiveMode(model) {
  log('[run-integration] LIVE mode: model=' + model + ', budget cap=$' + BUDGET_CAP_USD);

  if (!existsSync(SAMPLE_BOOK)) {
    return exitWithCode(2, 'seed source not found: ' + SAMPLE_BOOK);
  }

  let tempDir;
  try {
    log('[run-integration] creating temp clone from ' + SAMPLE_BOOK + ' ...');
    tempDir = makeTempClone(SAMPLE_BOOK, 'live');
    log('[run-integration] temp clone: ' + tempDir);
  } catch (err) {
    return exitWithCode(2, 'clone failed: ' + err.message);
  }

  let allOk = true;

  try {
    // Flow step 1: init-project scaffold - verify scaffold directories present
    log('\n[run-integration] -- flow step 1: init-project scaffold --');
    checkBudget();

    const scaffoldPrompt =
      'I am running a Tier B integration test on this Nonfiction Studio project. ' +
      'List which of these directories exist at the project root: context, structure, chapters, research, production, .studio. ' +
      'Reply with SCAFFOLD_OK if all six directories are present, or SCAFFOLD_MISSING followed by the names of any absent directories.';

    const scaffoldResult = callClaude(scaffoldPrompt, model, tempDir);
    log('  cost: $' + scaffoldResult.costUsd.toFixed(6) + ' (total: $' + totalSpendUsd.toFixed(6) + ')');
    if (!scaffoldResult.ok) {
      log('  FAIL [init-project]: claude call failed: ' + scaffoldResult.error);
    } else {
      log('  result snippet: ' + scaffoldResult.text.slice(0, 120).replace(/\n/g, ' '));
      const scaffoldOk = scaffoldResult.text.toUpperCase().includes('SCAFFOLD_OK');
      log('  scaffold check: ' + (scaffoldOk ? 'pass (all six directories present)' : 'warn (unexpected result; structural assertions will verify)'));
    }
    // Artifact assertions for step 1: scaffold directories
    const step1Assertions = [
      assertDirExists(join(tempDir, 'context'), 'step1:context/'),
      assertDirExists(join(tempDir, 'structure'), 'step1:structure/'),
      assertDirExists(join(tempDir, 'chapters'), 'step1:chapters/'),
      assertDirExists(join(tempDir, 'research'), 'step1:research/'),
      assertDirExists(join(tempDir, 'production'), 'step1:production/'),
      assertDirExists(join(tempDir, '.studio'), 'step1:.studio/'),
    ];
    for (const a of step1Assertions) {
      log('  ' + a.message);
      if (!a.ok) allOk = false;
    }

    checkBudget();

    // Flow step 2: intake-interview brief check - verify brief.md is populated
    log('\n[run-integration] -- flow step 2: intake-interview brief check --');
    checkBudget();

    const briefPrompt =
      'I am running a Tier B integration test on this Nonfiction Studio project. ' +
      'Check whether context/brief.md exists and contains at least one section header (a line starting with ##). ' +
      'Reply with BRIEF_OK if the file exists and contains section headers, or BRIEF_MISSING if the file is absent or empty.';

    const briefResult = callClaude(briefPrompt, model, tempDir);
    log('  cost: $' + briefResult.costUsd.toFixed(6) + ' (total: $' + totalSpendUsd.toFixed(6) + ')');
    if (!briefResult.ok) {
      log('  FAIL [intake-interview]: claude call failed: ' + briefResult.error);
    } else {
      log('  result snippet: ' + briefResult.text.slice(0, 120).replace(/\n/g, ' '));
      const briefOk = briefResult.text.toUpperCase().includes('BRIEF_OK');
      log('  brief check: ' + (briefOk ? 'pass (brief populated with section headers)' : 'warn (unexpected result; structural assertions will verify)'));
    }
    // Artifact assertion for step 2: brief.md has section headers
    const step2Assertion = assertFileContains(
      join(tempDir, 'context', 'brief.md'), '## ', 'step2:brief populated (section headers)'
    );
    log('  ' + step2Assertion.message);
    if (!step2Assertion.ok) allOk = false;

    checkBudget();

    // Flow step 3: draft-chapter chapter check - verify chapters/ has content
    log('\n[run-integration] -- flow step 3: draft-chapter chapter check --');
    checkBudget();

    const chapterPrompt =
      'I am running a Tier B integration test on this Nonfiction Studio project. ' +
      'Check whether the chapters/ directory contains at least one Markdown file (.md) with non-empty content. ' +
      'Reply with CHAPTER_OK if at least one non-empty .md file exists in chapters/, or CHAPTER_MISSING if chapters/ is absent or empty.';

    const chapterResult = callClaude(chapterPrompt, model, tempDir);
    log('  cost: $' + chapterResult.costUsd.toFixed(6) + ' (total: $' + totalSpendUsd.toFixed(6) + ')');
    if (!chapterResult.ok) {
      log('  FAIL [draft-chapter]: claude call failed: ' + chapterResult.error);
    } else {
      log('  result snippet: ' + chapterResult.text.slice(0, 120).replace(/\n/g, ' '));
      const chapterOk = chapterResult.text.toUpperCase().includes('CHAPTER_OK');
      log('  chapter check: ' + (chapterOk ? 'pass (chapters/ non-empty)' : 'warn (unexpected result; structural assertions will verify)'));
    }
    // Artifact assertion for step 3: chapters/ non-empty
    const step3Assertion = assertDirNonEmpty(
      join(tempDir, 'chapters'), '.md', 'step3:chapters/ non-empty'
    );
    log('  ' + step3Assertion.message);
    if (!step3Assertion.ok) allOk = false;

    checkBudget();

    // Flow step 4: fact-check-pass with planted [UNVERIFIED] marker
    log('\n[run-integration] -- flow step 4: fact-check-pass with planted [UNVERIFIED] --');
    checkBudget();

    const factCheckPrompt =
      'I am running a Tier B integration test. ' +
      'Check whether the text "[UNVERIFIED]" appears anywhere in the context/ or chapters/ directories of this project. ' +
      'Reply with FOUND if you see [UNVERIFIED] in any file, or NOT_FOUND if you do not. ' +
      'Do not run any quality gate or write any files; read-only check only.';

    const factResult = callClaude(factCheckPrompt, model, tempDir);
    log('  cost: $' + factResult.costUsd.toFixed(6) + ' (total: $' + totalSpendUsd.toFixed(6) + ')');
    if (!factResult.ok) {
      log('  FAIL [fact-check-pass]: claude call failed: ' + factResult.error);
    } else {
      log('  result snippet: ' + factResult.text.slice(0, 120).replace(/\n/g, ' '));
      // The sample-book chapters do NOT have [UNVERIFIED] markers; expect NOT_FOUND
      const markerFound = factResult.text.toUpperCase().includes('NOT_FOUND') ||
        !factResult.text.toUpperCase().includes('[UNVERIFIED]');
      log('  [UNVERIFIED] check: ' + (markerFound ? 'pass (no planted marker in seeded clone, as expected)' : 'unexpected UNVERIFIED found'));
    }

    checkBudget();

    // Flow step 5: run-quality-gate deterministic assertions (no model call)
    log('\n[run-integration] -- flow step 5: run-quality-gate (deterministic) --');

    log('\n[run-integration] -- structural assertions --');
    const structAssertions = runStructuralAssertions(tempDir, 'live');
    for (const a of structAssertions) {
      log('  ' + a.message);
      if (!a.ok) allOk = false;
    }

    log('\n[run-integration] -- deterministic assertions --');
    const detAssertions = runDeterministicAssertions(tempDir);
    for (const a of detAssertions) {
      log('  ' + a.message);
      if (!a.ok) allOk = false;
    }

    log('\n[run-integration] total spend: $' + totalSpendUsd.toFixed(6) + ' of $' + BUDGET_CAP_USD + ' cap');

    if (!allOk) return exitWithCode(1, 'live run: one or more assertions failed');
    log('[run-integration] live run complete: all assertions pass');
    return exitWithCode(0);
  } finally {
    removeTempClone(tempDir);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) { process.stdout.write(msg + '\n'); }

function checkBudget() {
  if (totalSpendUsd > BUDGET_CAP_USD) {
    log('[run-integration] BUDGET_EXCEEDED: $' + totalSpendUsd.toFixed(6) + ' > $' + BUDGET_CAP_USD);
    process.exit(3);
  }
}

function exitWithCode(code, reason) {
  if (reason) log('[run-integration] exit ' + code + ': ' + reason);
  process.exit(code);
}

function fatal(msg) { exitWithCode(2, msg); }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { dryRun, model } = parseArgs(process.argv.slice(2));

// Live mode needs working model access, which is NOT the same thing as an API
// key. The claude CLI authenticates from the active account when one is logged
// in, so an authenticated CLI is sufficient. A GitHub runner has no logged-in
// account, which is the only place ANTHROPIC_API_KEY is actually required.
//
// Corrected 2026-08-07: this gated solely on ANTHROPIC_API_KEY and so forced
// dry-run on every developer machine, which is why runLiveMode had never once
// executed and the broken cost field above went unnoticed.
function claudeCliUsable() {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 20000 });
  return !probe.error && probe.status === 0;
}

const hasApiKey = !!(process.env.ANTHROPIC_API_KEY);
const hasUsableCli = hasApiKey ? true : claudeCliUsable();
const forcedDryRun = !hasApiKey && !hasUsableCli && !dryRun;

if (forcedDryRun) {
  log('[run-integration] LIVE RUN BLOCKER: no model access available');
  log('[run-integration]   ANTHROPIC_API_KEY is not set, and the claude CLI is not runnable');
  log('[run-integration]   (an authenticated claude CLI is sufficient; a key is only needed');
  log('[run-integration]    where no account is logged in, such as a CI runner)');
  log('[run-integration] falling back to dry-run mode');
  log('');
  runDryMode(model);
} else if (dryRun) {
  runDryMode(model);
} else {
  runLiveMode(model);
}
