// scripts/checks/check-workspace-refs.mjs
// what-it-is:   workspace-reference checker (durable form of "a shipped file must not point at a
//               path that does not survive a clean checkout")
// what-it-does: derives the forbidden-directory set by parsing this repo's own .gitignore for
//               explicit directory patterns (a pattern line ending in "/"; negation lines and
//               glob-wildcard directory patterns are not supported and are skipped, since none
//               occur in this repo's .gitignore today), then scans every git-tracked file under
//               the shipped scan scope (bin/, hooks/, scripts/, skills/, agents/, docs/,
//               examples/, templates/, evals/, tests/, and root-level files) for two forms of
//               plain-text reference into a forbidden directory:
//                 form 1 (path reference): a forbidden directory name immediately followed by "/"
//                 and at least one more non-whitespace path segment, anywhere in the file's text
//                 (not only inside Markdown link syntax - scripts/check-links.mjs already covers
//                 that narrower case; this extends the same principle to code comments, prose, and
//                 test names, which is where every violation this checker exists to close actually
//                 landed);
//                 form 2 (bare filename reference): the basename of a file that currently exists,
//                 on disk, under a forbidden directory, AND does not exist anywhere in the
//                 git-tracked tree (i.e. it exists ONLY inside a forbidden directory), mentioned on
//                 its own with no preceding "/" (a "/"-preceded occurrence is form 1's territory,
//                 so the two forms never double-report the same text).
//               A small, explicitly-named subtraction is applied to the .gitignore-derived set
//               before either form runs: directories gitignored because they hold reproducible,
//               machine-generated content (an installed dependency tree, build output, test-
//               coverage output, or a per-project runtime cache the platform itself creates when a
//               subagent runs with a project-scoped memory field) are not the kind of directory
//               this rule is about, and treating them the same as an authored-content scratch
//               directory produces real false positives, not hypothetical ones - see
//               NON_SCRATCH_GITIGNORED_DIRS below for the exact set and the concrete evidence that
//               justified each entry. This is a bounded, stated exclusion sitting alongside the
//               fully dynamic .gitignore-derived set, not a replacement for it: a NEW authored-
//               content scratch directory added to .gitignore tomorrow is covered automatically,
//               with no code change here; only a new directory in the same reproducible-artifact
//               category would ever need adding to the exclusion.
// scope note:   this checker does not attempt to catch every shape a workspace reference can take.
//               Two shapes it deliberately does not attempt: an internal task-number label (e.g. a
//               capitalized "Task" plus a digit) carries no path or filename at all, so there is
//               nothing here to derive it from without hardcoding wave-specific vocabulary, which
//               is exactly what this checker's design is built to avoid; and a prose citation that
//               names no file ("per the brief", "the kickoff plan for this wave") is not
//               distinguishable from ordinary English by any pattern this checker could apply
//               without an unacceptable false-positive rate on normal prose. Both are out of scope
//               by design, not by oversight; see the task report for the full reasoning.
// why:          C2 (enforcement theater) - a policy asserted in prose and enforced by nothing is
//               not a control. Applied here to this wave's own process: the rule that a shipped
//               file must not reference this wave's scratch workspace was restated in the shared
//               constraints after each of three violations and still recurred a fourth time; this
//               turns the rule into machinery instead of prose.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-workspace-refs]';

function fatal(message) {
  process.stderr.write(PREFIX + ' FATAL: ' + message + '\n');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Forbidden-directory derivation from .gitignore
// ---------------------------------------------------------------------------

const GITIGNORE_PATH = join(REPO_ROOT, '.gitignore');

/**
 * Parses a .gitignore file for explicit directory patterns (a line ending in
 * "/"), returning repo-root-relative, forward-slash directory paths with no
 * leading or trailing slash. A leading "/" (root anchor) is stripped. Lines
 * that are blank, a comment, a negation ("!..."), or contain a glob wildcard
 * in the directory name are skipped: negation and wildcard directory
 * patterns do not occur in this repo's .gitignore today, and resolving them
 * correctly would need real gitignore-matching semantics this checker does
 * not implement.
 */
function parseGitignoreDirectories(absPath) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (err) {
    fatal('cannot read .gitignore at ' + absPath + ': ' + err.message);
  }
  const dirs = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('!')) continue;
    if (!line.endsWith('/')) continue;
    let dir = line.slice(0, -1);
    if (dir.startsWith('/')) dir = dir.slice(1);
    if (/[*?[\]]/.test(dir)) continue;
    if (!dir) continue;
    dirs.push(dir);
  }
  return [...new Set(dirs)].sort();
}

if (!existsSync(GITIGNORE_PATH)) {
  fatal('no .gitignore found at ' + GITIGNORE_PATH + '; the forbidden-directory set cannot be derived');
}

const allGitignoredDirs = parseGitignoreDirectories(GITIGNORE_PATH);

// Directories gitignored for reproducibility, not because they hold uniquely
// authored planning or scratch content. Each entry was checked against this
// repo's actual shipped content before being added here, not assumed:
//   - node_modules: an installed dependency tree, reproducible from the lock
//     file. Walking it for form 2's basename derivation would also make that
//     form unusable (a dependency tree's basenames - an index file, a readme,
//     a manifest - are exactly the "common word that happens to be a
//     gitignored basename" false-positive risk the design brief warns about).
//   - dist, coverage, .nyc_output: build and test-coverage output, absent
//     from this checkout until the corresponding command runs; regenerated,
//     not authored.
//   - .claude/agent-memory, .claude/agent-memory-local: a per-project runtime
//     cache the platform creates in an END USER's OWN project when a shipped
//     subagent runs with a project-scoped memory field - not pre-existing
//     content in THIS repository that a reader is being sent to read. This
//     entry is not hypothetical: applying the plain rule to it would flag
//     more than a dozen sites of correct, already-reviewed documentation
//     that describes this real product behavior (README.md's privacy
//     section, multiple agents/** and skills/** reference bodies,
//     docs/reference/**, and the ADR that records how the directory is
//     named), none of which are a reference to content that vanishes at the
//     end of this wave.
const NON_SCRATCH_GITIGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.nyc_output',
  '.claude/agent-memory',
  '.claude/agent-memory-local',
]);

const scratchDirs = allGitignoredDirs.filter((d) => !NON_SCRATCH_GITIGNORED_DIRS.has(d));

// ---------------------------------------------------------------------------
// Tracked-file discovery (git ls-files -z), with a plain filesystem-walk
// fallback when git is unavailable or REPO_ROOT is not a git repository -
// mirrors scripts/check-links.mjs and scripts/checks/check-plugin-root.mjs.
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

  return { gitRoot, relPaths: listing.toString('utf8').split('\0').filter(Boolean) };
}

// ignoredDirSet holds repo-root-relative directory paths (as produced by
// parseGitignoreDirectories) that a real "git ls-files" would never surface.
// A plain recursive walk has no such knowledge on its own, so degraded mode
// must be told explicitly - otherwise a file living inside a gitignored
// scratch directory looks exactly as "tracked" as a real shipped file, which
// would silently defeat form 2's "exists only under a gitignored directory"
// test the moment git is unavailable (this is not hypothetical: it is
// exactly how clone-helper.mjs's temp clones run, by design - see that
// file's header comment - which is how this was caught before it ever
// reached a real degraded-mode environment).
function walkAllFiles(dir, baseDir, ignoredDirSet, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === '.git') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const rel = full.slice(baseDir.length + 1).replace(/\\/g, '/');
      if (ignoredDirSet.has(rel)) continue;
      walkAllFiles(full, baseDir, ignoredDirSet, out);
    } else if (e.isFile()) {
      out.push(full.slice(baseDir.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

const gitInfo = getGitTrackedFiles(REPO_ROOT);
let scanRoot;
let scanModeLabel;
let allTrackedRelPaths;
if (gitInfo) {
  scanRoot = gitInfo.gitRoot;
  scanModeLabel = 'git-tracked';
  allTrackedRelPaths = gitInfo.relPaths;
} else {
  scanRoot = REPO_ROOT;
  scanModeLabel = 'filesystem-walk (git unavailable or ' + REPO_ROOT + ' is not a git repository)';
  allTrackedRelPaths = walkAllFiles(REPO_ROOT, REPO_ROOT, new Set(allGitignoredDirs));
}

// ---------------------------------------------------------------------------
// Scan scope: bin/, hooks/, scripts/, skills/, agents/, docs/, examples/,
// templates/, evals/, tests/, and root-level files. Deliberately excludes
// .github/, .claude-plugin/, and .codex-plugin/, which are out of this
// checker's stated scope.
// ---------------------------------------------------------------------------

const SCAN_PREFIXES = [
  'bin/', 'hooks/', 'scripts/', 'skills/', 'agents/', 'docs/',
  'examples/', 'templates/', 'evals/', 'tests/',
];

function isRootLevelFile(rel) {
  return !rel.includes('/');
}

function inScanScope(rel) {
  if (isRootLevelFile(rel)) return true;
  return SCAN_PREFIXES.some((p) => rel.startsWith(p));
}

const filesToScan = allTrackedRelPaths.filter(inScanScope).sort();

if (filesToScan.length === 0) {
  fatal(
    'zero files matched the scan scope (bin/, hooks/, scripts/, skills/, agents/, docs/, ' +
    'examples/, templates/, evals/, tests/, root-level files) under ' + scanRoot +
    '. This indicates a broken checkout or a resolution bug, not a clean pass.'
  );
}

// ---------------------------------------------------------------------------
// Form 2 forbidden-basename derivation: a file basename that exists on disk
// under a scratch directory and does not exist anywhere in the tracked tree.
// ---------------------------------------------------------------------------

const trackedBasenames = new Set(allTrackedRelPaths.map((p) => basename(p)));

function walkFileBasenames(absDir, out = []) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(absDir, e.name);
    if (e.isDirectory()) {
      walkFileBasenames(full, out);
    } else if (e.isFile()) {
      out.push(e.name);
    }
  }
  return out;
}

// basename -> the scratch directory it was first discovered under (for the
// finding message; a basename colliding across two scratch directories is
// rare enough in practice that reporting the first origin is sufficient).
const basenameOrigin = new Map();
for (const dir of scratchDirs) {
  const abs = join(scanRoot, ...dir.split('/'));
  if (!existsSync(abs)) continue;
  for (const name of walkFileBasenames(abs)) {
    if (trackedBasenames.has(name)) continue;
    if (!basenameOrigin.has(name)) basenameOrigin.set(name, dir);
  }
}

// ---------------------------------------------------------------------------
// Regex construction
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Form 1: a scratch directory name, not itself preceded by an identifier or
// path character (so it is not matched as a suffix of a larger token or a
// deeper nested path), followed by "/" and one or more characters that are
// not whitespace or a closing/quoting character that would end an inline
// code span, a quoted string, or a Markdown link target.
function buildDirRefRegex(dirs) {
  if (dirs.length === 0) return null;
  const alternation = dirs.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|');
  return new RegExp('(?<![A-Za-z0-9_./-])(' + alternation + ')/([^\\s"\'`)\\]]+)', 'g');
}

// Form 2: a forbidden basename, not preceded by an identifier or path
// character (so a "/"-preceded occurrence, already form 1's territory, is
// never double-reported here) and not followed by another identifier
// character (so a basename is never matched as a prefix of a longer token).
function buildBasenameRegex(basenames) {
  if (basenames.length === 0) return null;
  const alternation = basenames.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|');
  return new RegExp('(?<![A-Za-z0-9_./-])(' + alternation + ')(?![A-Za-z0-9_-])', 'g');
}

const dirRefRegex = buildDirRefRegex(scratchDirs);
const basenameRegex = buildBasenameRegex([...basenameOrigin.keys()]);

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const findings = [];

for (const rel of filesToScan) {
  const abs = join(scanRoot, ...rel.split('/'));
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue; // unreadable entry - skip, not fatal
  }
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (dirRefRegex) {
      dirRefRegex.lastIndex = 0;
      let m;
      while ((m = dirRefRegex.exec(line)) !== null) {
        const dirName = m[1];
        const trailing = m[2];
        findings.push(
          rel + ':' + lineNo + ': workspace path reference "' + dirName + '/' + trailing + '" - "' +
          dirName + '/" is gitignored and will not exist after a clean checkout'
        );
        if (m.index === dirRefRegex.lastIndex) dirRefRegex.lastIndex++;
      }
    }

    if (basenameRegex) {
      basenameRegex.lastIndex = 0;
      let m2;
      while ((m2 = basenameRegex.exec(line)) !== null) {
        const name = m2[1];
        const originDir = basenameOrigin.get(name);
        findings.push(
          rel + ':' + lineNo + ': bare workspace filename reference "' + name +
          '" - it exists only under gitignored directory "' + originDir +
          '/" and will not exist after a clean checkout'
        );
        if (m2.index === basenameRegex.lastIndex) basenameRegex.lastIndex++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

process.stdout.write(
  PREFIX + ' mode: ' + scanModeLabel + ' (' + filesToScan.length + ' file(s) scanned, ' +
  scratchDirs.length + ' scratch gitignored dir(s): ' + (scratchDirs.join(', ') || '(none)') +
  ', ' + basenameOrigin.size + ' forbidden basename(s))\n'
);

if (findings.length === 0) {
  process.stdout.write(PREFIX + ' pass: no workspace-scratch references found\n');
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
