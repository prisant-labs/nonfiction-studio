// scripts/check-self-sufficiency.mjs
// what-it-is:   the no-additional-keys self-sufficiency guard
// what-it-does: scans every git-tracked file under bin/, hooks/, scripts/, agents/, skills/,
//               templates/, docs/, .github/workflows/, tests/, evals/, examples/, and the root
//               manifests (every direct child of the repo root, plus the native plugin manifests
//               under .claude-plugin/ and .codex-plugin/) for five forbidden pattern classes:
//                 1. raw network calls (fetch(, http(s).request(, axios, new WebSocket(, a
//                    spawned curl/wget) - ERROR, never waivable via the exceptions file, except
//                    inside a test-fixture directory (any path with a "/fixtures/" segment) or
//                    anywhere under examples/: synthetic sample content is not a shipped
//                    capability, and a worked example legitimately contains prose about sources
//                    and URLs (F7 (scan-set blind spots) - this carve-out was only ever justified
//                    for this class).
//                 2. non-Anthropic model-provider keys (OPENAI_API_KEY, GEMINI_API_KEY,
//                    COHERE_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, AZURE_OPENAI_*) - ERROR,
//                    never waivable, no fixture or examples/ carve-out: a leaked key pattern in
//                    an example is exactly as bad as one in shipped code, and examples get copied.
//                 3. ANTHROPIC_API_KEY - ERROR unless a matching {file, pattern} entry exists in
//                    scripts/self-sufficiency-exceptions.json with a real (non-empty) reason.
//                    This is the ONLY class the exceptions file ever applies to. No fixture or
//                    examples/ carve-out, same reasoning as class 2.
//                 4. workflow trigger guard - any .github/workflows/*.yml whose on: block
//                    includes pull_request or push while the file references any secrets.NAME
//                    beyond secrets.GITHUB_TOKEN - ERROR. Parsed textually, line-based, no YAML
//                    dependency (a workflow this permissive would demand a credential from every
//                    contributor, not just a maintainer running workflow_dispatch by hand).
//                 5. doc-misleading phrases ("requires an api key", "you must set your api key",
//                    "sign up for a paid", "purchase a license", "subscription is required"),
//                    scoped to docs/**, README.md, agents/**, skills/** - ERROR.
//               Every applied exception is echoed (ALLOWED), never silently consumed, mirroring
//               scripts/lib/suppressions.mjs's never-silent philosophy. An exceptions-file entry
//               that matches zero real hits is a STALE EXCEPTION; one with an empty reason is
//               invalid; both are folded into the same "stale" tally below because both describe
//               an entry that is not actually protecting anything and must be removed.
//               Excludes itself and scripts/checks/mcp-valid.mjs by path: this checker cannot
//               usefully police its own source (every forbidden literal it looks for necessarily
//               appears in this file too), and mcp-valid.mjs's own secret-detector regex
//               (SECRETISH_KEY / LOOKS_LIKE_SECRET) would self-trip the key-shaped pattern scan.
//               Falls back to a plain filesystem walk of the same scanned paths when git is
//               unavailable or the tree is not a git repository (mirrors check-links.mjs), which
//               is how a plain directory copy (no .git) still gets a correct scan.
// why:          the 2026-08-07 self-sufficiency audit (an internal report, not published in
//               this repository), section 5: the no-additional-keys invariant held on
//               inspection across all 486 tracked files;
//               this turns that one-time audit finding into permanent, deterministic CI
//               machinery instead of a claim that can silently rot as the tree changes. examples/
//               added to the scanned set per F7 (scan-set blind spots): the directory was
//               entirely unscanned before, which incidentally exempted provider-key patterns
//               there with no stated reason - only the network-pattern exemption was ever
//               justified.
// used-by:      runs as a Tier A step (wired into .github/workflows/tier-a.yml at lines 83-85)
// exit taxonomy: 0 = pass; 1 = named finding(s) (forbidden pattern, stale or invalid exception);
//                2 = operational error (unreadable root, malformed exceptions file)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const PREFIX = '[check-self-sufficiency]';

// ---------------------------------------------------------------------------
// Scanned-path scope
// ---------------------------------------------------------------------------

const SELF_PATH = 'scripts/check-self-sufficiency.mjs';
const EXCLUDED_PATHS = new Set([SELF_PATH, 'scripts/checks/mcp-valid.mjs']);

const SCANNED_PREFIXES = [
  'bin/', 'hooks/', 'scripts/', 'agents/', 'skills/', 'templates/',
  'docs/', '.github/workflows/', 'tests/', 'evals/', 'examples/',
  '.claude-plugin/', '.codex-plugin/',
];

function isRootLevelFile(rel) {
  return !rel.includes('/');
}

function inScannedSet(rel) {
  if (EXCLUDED_PATHS.has(rel)) return false;
  if (isRootLevelFile(rel)) return true;
  return SCANNED_PREFIXES.some((p) => rel.startsWith(p));
}

function isFixturePath(rel) {
  return rel.split('/').includes('fixtures');
}

function isExamplesPath(rel) {
  return rel.startsWith('examples/');
}

// Class 1 (network patterns) only: exempts test-fixture directories and examples/,
// per each one's own stated reason above. Never exempts classes 2 or 3 (provider
// keys) -- F7 (scan-set blind spots) narrowed the examples/ carve-out to exactly
// this class, which is the only one it was ever justified for.
function isNetworkExempt(rel) {
  return isFixturePath(rel) || isExamplesPath(rel);
}

function isDocScope(rel) {
  return rel.startsWith('docs/') || rel === 'README.md' || rel.startsWith('agents/') || rel.startsWith('skills/');
}

function isWorkflowYaml(rel) {
  return rel.startsWith('.github/workflows/') && (rel.endsWith('.yml') || rel.endsWith('.yaml'));
}

// ---------------------------------------------------------------------------
// Tracked-set scan (git ls-files -z), with a plain filesystem-walk fallback
// when git is unavailable or REPO_ROOT is not a git repository. The fallback
// is what lets a plain directory copy (no .git present, e.g. a temp copy made
// to trial a planted violation) still be scanned correctly.
// ---------------------------------------------------------------------------

function getGitTrackedFiles(repoRoot) {
  let gitRootRaw;
  try {
    gitRootRaw = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null; // git unavailable, or not a git repo
  }
  if (!gitRootRaw) return null;
  const gitRoot = resolve(gitRootRaw);

  let listing;
  try {
    listing = execFileSync('git', ['ls-files', '-z'], {
      cwd: gitRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }

  const relPaths = listing.toString('utf8').split('\0').filter(Boolean);
  return { gitRoot, relPaths };
}

function collectAllFiles(dir, baseDir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      collectAllFiles(full, baseDir, out);
    } else if (e.isFile()) {
      out.push(full.slice(baseDir.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

const gitInfo = getGitTrackedFiles(REPO_ROOT);
let scanRoot;
let scanModeLabel;
let relPaths;
if (gitInfo) {
  scanRoot = gitInfo.gitRoot;
  scanModeLabel = 'git-tracked';
  relPaths = gitInfo.relPaths;
} else {
  scanRoot = REPO_ROOT;
  scanModeLabel = 'filesystem-walk (git unavailable or ' + REPO_ROOT + ' is not a git repository)';
  relPaths = collectAllFiles(REPO_ROOT, REPO_ROOT);
}

const scannedFiles = relPaths.filter(inScannedSet).sort();

// ---------------------------------------------------------------------------
// Forbidden pattern classes 1, 2, 3 (line-based literal/regex matches)
// ---------------------------------------------------------------------------

// Class 1: raw network calls. Non-waivable outside test fixtures.
const NETWORK_PATTERNS = [
  /fetch\(/,
  /https?\.request\(/,
  /axios/,
  /new WebSocket\(/,
  /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*(['"`])(?:curl|wget)\1/,
];

// Class 2: non-Anthropic model-provider keys. Always ERROR, never waivable.
const NON_ANTHROPIC_KEY_PATTERNS = [
  /OPENAI_API_KEY/,
  /GEMINI_API_KEY/,
  /COHERE_API_KEY/,
  /MISTRAL_API_KEY/,
  /GROQ_API_KEY/,
  /AZURE_OPENAI_[A-Z0-9_]*/,
];

// Class 3: ANTHROPIC_API_KEY. ERROR unless a matching exceptions-file entry exists.
// Scoped to a LIVE reference (process.env.ANTHROPIC_API_KEY, process.env['ANTHROPIC_API_KEY'],
// or the GitHub Actions secrets.ANTHROPIC_API_KEY form), not a bare textual mention: a comment
// explaining the mechanism, or a log/error string that tells a user what to set, is the
// 2026-08-07 self-sufficiency audit's own "test, fixture, or doc mention" bucket (an internal
// report, not published in this repository; section 3.1 row (c)), already reviewed as accurate
// and never meant to require its own exceptions-file entry. Only the
// four sites that actually read the credential (tier-b.yml:48,55, run-integration.mjs:559,
// run-evals.mjs:173) are section 3.1 row (b)'s "hard reference" sites this class exists to gate.
const ANTHROPIC_KEY_PATTERN = /(?:process\.env\.|process\.env\[['"`]|secrets\.)ANTHROPIC_API_KEY/;

// Class 5: doc-misleading phrases (case-insensitive substring match).
const MISLEADING_PHRASES = [
  'requires an api key',
  'you must set your api key',
  'sign up for a paid',
  'purchase a license',
  'subscription is required',
];

function patternDisplay(re) {
  return '/' + re.source + '/';
}

// ---------------------------------------------------------------------------
// Exceptions file: scripts/self-sufficiency-exceptions.json
// Bare JSON array of {file, pattern, reason, addedBy, date}. Applies ONLY to
// class 3 (ANTHROPIC_API_KEY) hits, matched by exact {file, pattern} equality.
// ---------------------------------------------------------------------------

const EXCEPTIONS_PATH_REL = 'scripts/self-sufficiency-exceptions.json';
const EXCEPTIONS_PATH_ABS = join(scanRoot, 'scripts', 'self-sufficiency-exceptions.json');

function fatal(message) {
  process.stderr.write(PREFIX + ' FATAL: ' + message + '\n');
  process.exit(2);
}

function loadExceptions() {
  if (!existsSync(EXCEPTIONS_PATH_ABS)) return { entries: [], invalid: [] };
  let raw;
  try {
    raw = readFileSync(EXCEPTIONS_PATH_ABS, 'utf8');
  } catch (err) {
    fatal('cannot read ' + EXCEPTIONS_PATH_REL + ': ' + err.message);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fatal(EXCEPTIONS_PATH_REL + ' is not valid JSON: ' + err.message);
  }
  if (!Array.isArray(data)) {
    fatal(EXCEPTIONS_PATH_REL + ' must be a JSON array of {file, pattern, reason, addedBy, date} entries.');
  }

  const entries = [];
  const invalid = [];
  for (const item of data) {
    const file = item && typeof item.file === 'string' ? item.file : null;
    const pattern = item && typeof item.pattern === 'string' ? item.pattern : null;
    const reason = item && typeof item.reason === 'string' ? item.reason.trim() : '';
    if (!file || !pattern) {
      invalid.push({ file: file ?? '(missing file)', pattern: pattern ?? '(missing pattern)', detail: 'malformed entry: file and pattern are required' });
      continue;
    }
    if (!reason) {
      invalid.push({ file, pattern, detail: 'empty reason' });
      continue;
    }
    entries.push({ file, pattern, reason, used: false });
  }
  return { entries, invalid };
}

const { entries: exceptions, invalid: invalidExceptions } = loadExceptions();

function findException(file, pattern) {
  return exceptions.find((e) => e.file === file && e.pattern === pattern) ?? null;
}

// ---------------------------------------------------------------------------
// Class 4: workflow trigger guard (line-based, no YAML dependency)
// ---------------------------------------------------------------------------

/** Extract the text of the top-level "on:" key: its inline value, or its indented block. */
function extractOnBlockText(lines) {
  const onLineIdx = lines.findIndex((l) => /^on:\s*(.*)$/.test(l));
  if (onLineIdx === -1) return '';
  const inline = lines[onLineIdx].match(/^on:\s*(.*)$/)[1].trim();
  if (inline) return inline; // e.g. "on: push" or "on: [push, pull_request]"
  let block = '';
  for (let i = onLineIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { block += '\n'; continue; }
    if (/^\S/.test(l)) break; // dedent to column 0: the next top-level key
    block += l + '\n';
  }
  return block;
}

/** Returns forbidden findings (as {rel, line, message}) for the workflow-trigger guard. */
function checkWorkflowTriggerGuard(rel, lines) {
  const onBlock = extractOnBlockText(lines);
  const triggers = [];
  if (/\bpull_request\b/.test(onBlock)) triggers.push('pull_request');
  if (/\bpush\b/.test(onBlock)) triggers.push('push');
  if (triggers.length === 0) return [];

  const out = [];
  const secretRe = /secrets\.([A-Za-z0-9_]+)/g;
  for (let i = 0; i < lines.length; i++) {
    secretRe.lastIndex = 0;
    let m;
    while ((m = secretRe.exec(lines[i])) !== null) {
      if (m[1] !== 'GITHUB_TOKEN') {
        out.push({
          rel,
          line: i + 1,
          message: 'workflow trigger guard: on: includes ' + triggers.join('/') + ' and references secrets.' + m[1] + ' beyond GITHUB_TOKEN',
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

const errorLines = [];  // FORBIDDEN / INVALID EXCEPTION -> stderr
const infoLines = [];   // ALLOWED / STALE EXCEPTION -> stdout
let forbiddenCount = 0;
let appliedCount = 0;

for (const rel of scannedFiles) {
  const abs = join(scanRoot, ...rel.split('/'));
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue; // unreadable entry (e.g. a broken symlink) - skip, not fatal
  }
  const lines = text.split('\n');
  const networkExempt = isNetworkExempt(rel);
  const docScope = isDocScope(rel);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (!networkExempt) {
      for (const re of NETWORK_PATTERNS) {
        if (re.test(line)) {
          forbiddenCount++;
          errorLines.push(PREFIX + ' FORBIDDEN: ' + rel + ':' + lineNo + ': raw network call matches ' + patternDisplay(re) + ' (no exceptions-file entry)');
        }
      }
    }

    for (const re of NON_ANTHROPIC_KEY_PATTERNS) {
      if (re.test(line)) {
        forbiddenCount++;
        errorLines.push(PREFIX + ' FORBIDDEN: ' + rel + ':' + lineNo + ': non-Anthropic model-provider key matches ' + patternDisplay(re) + ' (no exceptions-file entry)');
      }
    }

    if (ANTHROPIC_KEY_PATTERN.test(line)) {
      const ex = findException(rel, 'ANTHROPIC_API_KEY');
      if (ex) {
        ex.used = true;
        appliedCount++;
        infoLines.push(PREFIX + ' ALLOWED (' + ex.reason + '): ' + rel + ':' + lineNo + ' ANTHROPIC_API_KEY');
      } else {
        forbiddenCount++;
        errorLines.push(PREFIX + ' FORBIDDEN: ' + rel + ':' + lineNo + ': ANTHROPIC_API_KEY reference matches /ANTHROPIC_API_KEY/ (no exceptions-file entry)');
      }
    }

    if (docScope) {
      const lower = line.toLowerCase();
      for (const phrase of MISLEADING_PHRASES) {
        if (lower.includes(phrase)) {
          forbiddenCount++;
          errorLines.push(PREFIX + ' FORBIDDEN: ' + rel + ':' + lineNo + ': doc-misleading phrase matches "' + phrase + '"');
        }
      }
    }
  }

  if (isWorkflowYaml(rel)) {
    for (const f of checkWorkflowTriggerGuard(rel, lines)) {
      forbiddenCount++;
      errorLines.push(PREFIX + ' FORBIDDEN: ' + f.rel + ':' + f.line + ': ' + f.message);
    }
  }
}

// Stale and invalid exceptions: an entry that matches zero real hits, or one
// that was never eligible to match anything because it is malformed, is
// tallied together below - both describe an allowlist line protecting
// nothing, and both must be removed to keep the allowlist trustworthy.
let staleCount = 0;
for (const ex of exceptions) {
  if (!ex.used) {
    staleCount++;
    infoLines.push(PREFIX + ' STALE EXCEPTION: ' + ex.file + ' / "' + ex.pattern + '" matched nothing; remove it');
  }
}
for (const inv of invalidExceptions) {
  staleCount++;
  errorLines.push(PREFIX + ' INVALID EXCEPTION: ' + inv.file + ' / "' + inv.pattern + '": ' + inv.detail + '; every exception must state a real, non-empty reason');
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

process.stdout.write(PREFIX + ' mode: ' + scanModeLabel + ' (' + scannedFiles.length + ' file(s) scanned)\n');

for (const l of infoLines) process.stdout.write(l + '\n');
for (const l of errorLines) process.stderr.write(l + '\n');

const verdict = forbiddenCount === 0 && staleCount === 0 ? 'pass' : 'fail';
process.stdout.write(
  PREFIX + ' ' + forbiddenCount + ' forbidden pattern(s), ' + appliedCount + ' documented exception(s) applied, ' + staleCount + ' stale. ' + verdict + '\n'
);

process.exit(verdict === 'pass' ? 0 : 1);
