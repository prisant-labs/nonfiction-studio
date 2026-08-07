// scripts/check-links.mjs
// what-it-is:   relative Markdown link checker
// what-it-does: scans all .md files under docs/ and the repo root, extracts relative
//               Markdown link targets ([text](path) and [text](path#anchor)), and
//               verifies each referenced target is a file tracked by git (matching what
//               a clean CI checkout sees, since gitignored directories such as _local/
//               and .superpowers/ are physically present in a working tree but absent
//               from a clean checkout); reports named errors with file path and line
//               number for every broken link. Falls back to plain filesystem existence
//               checks if git is unavailable or the directory is not a git repo.
// why:          Q-02 1.2 link-check step; cross-references between docs must resolve on
//               a clean checkout, not merely in the author's local working tree.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Determine the set of git-tracked files (and their containing directories),
// so link targets are validated against what a clean CI checkout would see
// rather than against whatever happens to exist on the local filesystem
// (which also contains gitignored directories such as _local/ and
// .superpowers/). Falls back to null when git is unavailable or the
// directory is not a git repo; callers must handle that degraded case.
// ---------------------------------------------------------------------------

// Tracked files/dirs are keyed by their path RELATIVE to the repo root, in
// forward-slash form, in the EXACT case git reports (git ls-files never
// folds case, on any platform). Comparisons against this key must therefore
// stay exact-case too -- see repoRelativeKey() below for the one place case
// is deliberately folded, and why that is limited to the root prefix only.

function getGitTrackedInfo(repoRoot) {
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
  const files = new Set();
  const dirs = new Set();
  dirs.add(''); // repo root itself, keyed as the empty relative path

  for (const rel of relPaths) {
    // rel is already root-relative, forward-slash separated, and in git's
    // exact tracked case -- store it as-is. Folding case here would let a
    // link whose case does not match the tracked file pass on win32 while
    // failing on ubuntu-latest, which is exactly the local/CI divergence
    // this checker exists to close.
    files.add(rel);
    // Register every ancestor directory as "tracked" (contains tracked
    // content), so directory links resolve correctly.
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }

  return { gitRoot, files, dirs };
}

// Resolve an absolute path to its repo-root-relative key, for comparison
// against gitInfo.files / gitInfo.dirs. The ROOT PREFIX is matched with
// case folded on win32 only: gitRoot comes from `git rev-parse` while
// absolute link targets are built from this script's own module path, and
// those two independently-derived paths to the same directory can differ
// in drive-letter/invocation case on Windows without indicating any
// authoring mistake. The remainder of the path -- the part an author
// actually typed in the link, and the part git tracks case-sensitively --
// is never folded, so a genuine case mismatch there is still caught
// identically on win32 and ubuntu-latest. Returns null if absPath is
// outside gitRoot.
function repoRelativeKey(absPath, gitRoot) {
  const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const rootFolded = fold(gitRoot);
  const pathFolded = fold(absPath);
  if (pathFolded === rootFolded) return '';
  const prefix = rootFolded + sep;
  if (!pathFolded.startsWith(prefix)) return null;
  return absPath.slice(gitRoot.length + sep.length).replace(/\\/g, '/');
}

const gitInfo = getGitTrackedInfo(REPO_ROOT);
// Degraded mode (git unavailable, or REPO_ROOT is not a git repo) falls
// back to plain filesystem existence checks and still exits 0 on a clean
// pass -- i.e. it fails OPEN on exactly the local/CI divergence bug class
// this hardening exists to close, because a missing-tooling condition
// cannot distinguish gitignored-but-present-locally paths from genuinely
// tracked ones. That is a deliberate tradeoff, not an oversight: hard-
// failing whenever git is absent would break the check in more
// environments (sandboxed tool invocations, git-less checkouts) than it
// protects, so degraded mode intentionally reverts to the weaker
// pre-hardening guarantee instead of blocking the whole check.
const degradedReason = gitInfo
  ? null
  : 'git unavailable or ' + REPO_ROOT + ' is not a git repository';

// ---------------------------------------------------------------------------
// Glob all .md files under a directory tree (recursive)
// ---------------------------------------------------------------------------

function collectMdFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skip hidden dirs like .studio
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      collectMdFiles(full, out);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collect files to scan: docs/ subtree + root-level .md files
// ---------------------------------------------------------------------------

const filesToScan = [];

// Root-level .md files (README.md, CHANGELOG.md, etc.)
try {
  for (const e of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) {
      filesToScan.push(join(REPO_ROOT, e.name));
    }
  }
} catch (err) {
  process.stderr.write('[check-links] FATAL: cannot read repo root: ' + err.message + '\n');
  process.exit(2);
}

// docs/ subtree
const docsDir = join(REPO_ROOT, 'docs');
if (existsSync(docsDir)) {
  collectMdFiles(docsDir, filesToScan);
}

// ---------------------------------------------------------------------------
// Link extraction regex
// Matches [text](target) where target is not empty.
// Captures the target (group 1).
// ---------------------------------------------------------------------------

// Matches markdown links and images: [text](target) or ![text](target)
const LINK_RE = /!?\[(?:[^\]]*)\]\(([^)]+)\)/g;

// ---------------------------------------------------------------------------
// Check each file
// ---------------------------------------------------------------------------

const findings = [];

function isExternalLink(target) {
  return (
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('mailto:') ||
    target.startsWith('//')
  );
}

function isAnchorOnly(target) {
  return target.startsWith('#');
}

for (const absFile of filesToScan) {
  let text;
  try {
    text = readFileSync(absFile, 'utf8');
  } catch (err) {
    findings.push(absFile + ': cannot read file: ' + err.message);
    continue;
  }

  const lines = text.split('\n');
  const fileDir = dirname(absFile);

  // Relative path from repo root for reporting
  const relFile = absFile.replace(REPO_ROOT + '\\', '').replace(REPO_ROOT + '/', '').replace(/\\/g, '/');

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let match;
    LINK_RE.lastIndex = 0;
    while ((match = LINK_RE.exec(line)) !== null) {
      const raw = match[1].trim();

      // Skip external links, anchor-only links, and empty targets
      if (!raw || isExternalLink(raw) || isAnchorOnly(raw)) continue;

      // Separate path from optional fragment (#anchor)
      const hashIdx = raw.indexOf('#');
      const filePart = hashIdx === -1 ? raw : raw.slice(0, hashIdx);

      if (!filePart) continue; // anchor-only after split

      // Resolve relative to the file's directory
      const resolved = resolve(fileDir, filePart);
      const displayPath = resolved.replace(REPO_ROOT, '').replace(/\\/g, '/');

      let ok;
      let reason;
      if (!gitInfo) {
        // Degraded mode: no git available, fall back to plain filesystem check.
        ok = existsSync(resolved);
        reason = 'does not exist';
      } else {
        const relKey = repoRelativeKey(resolved, gitInfo.gitRoot);
        if (relKey !== null) {
          // Target must be a tracked file, or a directory that contains
          // tracked content -- matching what a clean CI checkout sees.
          ok = gitInfo.files.has(relKey) || gitInfo.dirs.has(relKey);
          reason = 'is not a git-tracked file (would not exist on a clean checkout)';
        } else {
          // Outside the repo root (e.g. a link that escapes via ../..): git
          // tracking doesn't apply to paths git never indexed, so this was
          // checked by plain filesystem existence instead.
          ok = existsSync(resolved);
          reason = 'does not exist on disk (outside the repo root, checked by filesystem existence, not git tracking)';
        }
      }

      if (!ok) {
        findings.push(relFile + ':' + (li + 1) + ': broken link "' + raw + '" -> resolved "' + displayPath + '" ' + reason);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (degradedReason) {
  process.stdout.write('[check-links] NOTE: degraded mode, checking filesystem existence instead of git-tracked status (' + degradedReason + ')\n');
} else {
  process.stdout.write('[check-links] mode: git-tracked (' + gitInfo.files.size + ' tracked file(s) under ' + gitInfo.gitRoot.replace(/\\/g, '/') + ')\n');
}

if (findings.length === 0) {
  process.stdout.write('[check-links] pass: ' + filesToScan.length + ' file(s) checked, no broken relative links\n');
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write('[check-links] ERROR: ' + f + '\n');
  }
  process.stdout.write('[check-links] ' + findings.length + ' broken link(s) found\n');
  process.exit(1);
}
