// scripts/checks/check-skill-cli-targets.mjs
// what-it-is:   shipped-Markdown CLI routing-target resolution checker
// what-it-does: scans every git-tracked .md file under agents/, docs/, examples/, skills/,
//               templates/, plus root-level .md files, for the literal invocation form a
//               CLI-wrapper skill (or any other shipped document) uses to name a routing
//               target - "bin/ns-<name>", the same shape node "<plugin-root>/bin/ns-<name>"
//               resolves to once the plugin root is substituted in (see skills/nfs-new-book/
//               SKILL.md Step 4 for that resolution) - and asserts each named CLI is genuinely
//               shipped: the extensionless file exists directly under bin/. A bare "ns-<name>"
//               mention with no "bin/" prefix (for example a sentence naming a sibling CLI in
//               passing) is deliberately out of scope: this checker verifies that a document's
//               own ROUTING target resolves to a real file, not that every CLI name mentioned
//               anywhere in shipped prose is spelled correctly. Checking for the ".cmd" Windows
//               shim is scripts/checks/check-inventory.mjs's job (component inventory
//               equality); this checker only ever asserts the extensionless bin/ns-<name>
//               target a document actually invokes.
//               EXCLUDED: files under docs/adr/ and docs/gates/ are skipped entirely - dated,
//               point-in-time historical records (an ADR's own Date: field fixes what it
//               describes to that date; a gate doc records what was true at a named past gate),
//               not living documents that track the current tree, so a routing target named in
//               one that has since been renamed or removed is not a live defect. Same rationale
//               and the same path-prefix-skip mechanism as scripts/checks/
//               check-component-counts.mjs's HISTORICAL_RECORD_PREFIXES.
// why:          F-CI-07 (dispatcher and CLI-wrapper skills uncovered) - nothing previously
//               asserted that a CLI-wrapper skill's named routing target is a real, shipped
//               file, so a typo'd or renamed CLI reference would ship silently and surface only
//               as a runtime failure for an author. This is the generic, reusable form of that
//               finding's fix; it was written to close the gap for status-dashboard's
//               bin/ns-status reference, and it applies to every other skill in the same scan
//               scope for free, at no extra cost, because the mechanism does not special-case
//               any one skill. The scan scope was widened from skills/**/SKILL.md only to every
//               shipped Markdown location - PF-22 (checker coverage shapes) widening 1 - because
//               the original scope missed a broken bin/ns-<name> reference anywhere else in the
//               tree: an agent's own prose, a reference doc, a fixture note, a scaffold
//               template, or a root-level doc could name a stale routing target with nothing to
//               catch it, the exact same defect class this checker already catches inside a
//               SKILL.md file.
// exit taxonomy: 0 = every referenced CLI target resolves; 1 = named finding(s) (a document
//               names a bin/ns-<name> target that does not exist under bin/); 2 = operational
//               error (zero files matched the scan scope, which means a broken checkout or a
//               resolution bug, not a clean pass).
// used-by:      .github/workflows/tier-a.yml, the "Skill CLI routing targets" step.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-skill-cli-targets]';
const BIN_DIR = join(REPO_ROOT, 'bin');

// ---------------------------------------------------------------------------
// Scan scope: every .md file under agents/, docs/, examples/, skills/,
// templates/, plus root-level .md files, except docs/adr/ and docs/gates/
// (dated historical records - see header comment).
// ---------------------------------------------------------------------------

const SCAN_DIR_PREFIXES = ['agents/', 'docs/', 'examples/', 'skills/', 'templates/'];
const HISTORICAL_RECORD_PREFIXES = ['docs/adr/', 'docs/gates/'];

function isRootLevelFile(rel) {
  return !rel.includes('/');
}

function inScope(rel) {
  if (!rel.endsWith('.md')) return false;
  if (HISTORICAL_RECORD_PREFIXES.some((p) => rel.startsWith(p))) return false;
  if (isRootLevelFile(rel)) return true;
  return SCAN_DIR_PREFIXES.some((p) => rel.startsWith(p));
}

// ---------------------------------------------------------------------------
// Tracked-file discovery (git ls-files), with a plain filesystem-walk
// fallback when git is unavailable or REPO_ROOT is not a git repository -
// mirrors scripts/checks/check-plugin-root.mjs and check-workspace-refs.mjs,
// so a temp clone with no .git present (the standard fixture shape the
// companion test file uses) still scans correctly in degraded mode. The
// fallback walk mirrors check-component-counts.mjs's own two-part shape: a
// recursive walk of each scan-prefix directory, plus a separate, non-
// recursive pass over root-level files only.
// ---------------------------------------------------------------------------

function getGitTrackedFiles(repoRoot) {
  let gitRootRaw;
  try {
    gitRootRaw = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null;
  }
  if (!gitRootRaw) return null;

  let listing;
  try {
    listing = execFileSync('git', ['ls-files', '-z'], {
      cwd: resolve(gitRootRaw),
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }

  return listing.toString('utf8').split('\0').filter(Boolean);
}

function walkDirRecursive(dir, baseDir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkDirRecursive(full, baseDir, out);
    } else if (e.isFile()) {
      out.push(full.slice(baseDir.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

function walkRootLevelFiles(baseDir, out = []) {
  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isFile()) out.push(e.name);
  }
  return out;
}

let trackedFiles = getGitTrackedFiles(REPO_ROOT);
let degradedReason = null;
if (!trackedFiles) {
  degradedReason = 'git unavailable or ' + REPO_ROOT + ' is not a git repository';
  trackedFiles = walkRootLevelFiles(REPO_ROOT);
  for (const prefix of SCAN_DIR_PREFIXES) {
    walkDirRecursive(join(REPO_ROOT, prefix.slice(0, -1)), REPO_ROOT, trackedFiles);
  }
}

const filesToScan = trackedFiles.filter(inScope).sort();

if (filesToScan.length === 0) {
  process.stderr.write(
    PREFIX + ' FATAL: zero files matched the scan scope (agents/, docs/, examples/, skills/, ' +
    'templates/, root-level .md files; excluding docs/adr/, docs/gates/) under ' + REPO_ROOT +
    '. This indicates a broken checkout or a resolution bug, not a clean pass.\n'
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Bin-target reference detection: "bin/ns-<name>", the same prefix
// check-plugin-root.mjs's RELATIVE_BIN_RE anchors on. The character class
// stops at the first character that cannot appear in a CLI basename (a
// closing quote, backtick, or ".cmd" suffix all fall outside it), so a
// trailing ".cmd" is never folded into the captured name.
// ---------------------------------------------------------------------------

const BIN_TARGET_RE = /bin\/(ns-[a-z0-9][a-z0-9-]*)/g;

const findings = [];

for (const rel of filesToScan) {
  const absFile = join(REPO_ROOT, rel);
  let text;
  try {
    text = readFileSync(absFile, 'utf8');
  } catch (err) {
    findings.push(rel + ': cannot read file: ' + err.message);
    continue;
  }

  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    BIN_TARGET_RE.lastIndex = 0;
    let m;
    while ((m = BIN_TARGET_RE.exec(line)) !== null) {
      const cliName = m[1];
      const targetPath = join(BIN_DIR, cliName);
      if (!existsSync(targetPath)) {
        findings.push(
          rel + ':' + (li + 1) + ': routing target "bin/' + cliName + '" does not exist - ' +
          'this document names a CLI that is not shipped under bin/'
        );
      }
      if (m.index === BIN_TARGET_RE.lastIndex) BIN_TARGET_RE.lastIndex++;
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (degradedReason) {
  process.stdout.write(PREFIX + ' NOTE: degraded mode, scanning the filesystem directly instead of the git-tracked set (' + degradedReason + ')\n');
} else {
  process.stdout.write(PREFIX + ' mode: git-tracked (' + filesToScan.length + ' file(s) in scope: agents/, docs/, examples/, skills/, templates/, root-level .md files; excluding docs/adr/, docs/gates/)\n');
}

if (findings.length === 0) {
  process.stdout.write(PREFIX + ' pass: ' + filesToScan.length + ' file(s) checked, every bin/ns-<name> routing target resolves to a shipped CLI\n');
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
