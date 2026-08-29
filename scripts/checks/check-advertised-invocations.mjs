// scripts/checks/check-advertised-invocations.mjs
// what-it-is:   advertised skill-invocation resolution checker
// what-it-does: scans every git-tracked .md file under agents/, docs/, examples/, skills/,
//               templates/, plus root-level .md files, for the literal advertised invocation
//               form "/nonfiction-studio:<name>" - the namespaced slash-invocation shape this
//               plugin's own docs teach an author to type - and asserts each named <name>
//               resolves to a shipped skill: a directory at skills/<name>/. A document that
//               advertises an invocation with no shipped skill behind it is a phantom: it reads
//               as a real, working command to an author and fails only at the moment they try
//               it, never before.
//               EXCLUDED: files under docs/adr/ and docs/gates/ are skipped entirely - dated,
//               point-in-time historical records (an ADR's own Date: field fixes what it
//               describes to that date; a gate doc records what was true at a named past gate),
//               not living documents that track the current tree, so an invocation named in one
//               that has since been renamed or removed is not a live defect. This repo's own
//               SPK-03 (skill invocation spike) stub names, "spike-echo" and "spike-status",
//               are exactly this shape: probe skills that never shipped and never will, named
//               only inside dated ADR evidence sections. Same rationale and the same
//               path-prefix-skip mechanism as scripts/checks/check-skill-cli-targets.mjs and
//               check-component-counts.mjs's HISTORICAL_RECORD_PREFIXES.
// why:          PF-09 (revise-pass phantom): a shipped example document told a reader to run
//               `/nonfiction-studio:revise-pass`, an invocation that had never existed as a
//               skill; nothing machine-checked that a document's own advertised invocation
//               actually resolves to something shipped. PF-23 (stale version literal) drew the
//               general lesson this checker applies here: shipped prose that restates a fact a
//               machine could verify instead - here, "does skills/<name>/ exist" - needs actual
//               machinery behind it, not human vigilance re-applied at the next audit. This
//               closes F-CI-07 (dispatcher and CLI-wrapper skills uncovered)'s remaining half:
//               check-skill-cli-targets.mjs already covers a CLI-wrapper skill's own
//               bin/ns-<name> routing target; this checker covers the other named-invocation
//               shape shipped prose uses, the "/nonfiction-studio:<name>" form an author actually
//               types.
// exit taxonomy: 0 = every advertised invocation resolves; 1 = named finding(s) (a document
//               advertises "/nonfiction-studio:<name>" for a <name> with no skills/<name>/
//               directory shipped); 2 = operational error (zero files matched the scan scope,
//               which means a broken checkout or a resolution bug, not a clean pass).
// used-by:      .github/workflows/tier-a.yml, the "Advertised invocations" step.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-advertised-invocations]';
const SKILLS_DIR = join(REPO_ROOT, 'skills');

// ---------------------------------------------------------------------------
// Scan scope: every .md file under agents/, docs/, examples/, skills/,
// templates/, plus root-level .md files, except docs/adr/ and docs/gates/
// (dated historical records - see header comment). Identical shape to
// scripts/checks/check-skill-cli-targets.mjs's own scan scope.
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
// mirrors scripts/checks/check-skill-cli-targets.mjs, so a temp clone with
// no .git present (the standard fixture shape the companion test file uses)
// still scans correctly in degraded mode. The fallback walk mirrors
// check-component-counts.mjs's own two-part shape: a recursive walk of each
// scan-prefix directory, plus a separate, non-recursive pass over
// root-level files only.
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
// Advertised-invocation detection: the literal namespaced slash-invocation
// form "/nonfiction-studio:<name>" this plugin's own docs teach an author to
// type. A resolvable <name> must exist as a directory under skills/; a bare
// "nonfiction-studio:<name>" mention with no leading slash, or any other
// spelling, is out of scope by construction, since the regex anchors on the
// literal leading "/".
// ---------------------------------------------------------------------------

const ADVERTISED_INVOCATION_RE = /\/nonfiction-studio:([a-z0-9][a-z0-9-]*)/g;

function skillDirExists(name) {
  const dir = join(SKILLS_DIR, name);
  if (!existsSync(dir)) return false;
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

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
    ADVERTISED_INVOCATION_RE.lastIndex = 0;
    let m;
    while ((m = ADVERTISED_INVOCATION_RE.exec(line)) !== null) {
      const name = m[1];
      if (!skillDirExists(name)) {
        findings.push(
          rel + ':' + (li + 1) + ': advertised invocation "/nonfiction-studio:' + name + '" does ' +
          'not resolve - no skills/' + name + '/ directory is shipped'
        );
      }
      if (m.index === ADVERTISED_INVOCATION_RE.lastIndex) ADVERTISED_INVOCATION_RE.lastIndex++;
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
  process.stdout.write(PREFIX + ' pass: ' + filesToScan.length + ' file(s) checked, every advertised /nonfiction-studio:<name> invocation resolves to a shipped skill\n');
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
