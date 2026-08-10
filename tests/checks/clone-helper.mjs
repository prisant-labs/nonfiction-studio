// tests/checks/clone-helper.mjs
// what-it-is:   shared temp-clone helper for the standalone checker planted-violation tests
// what-it-does: copies every git-tracked file from the real repo into a fresh OS-temp directory
//               with NO .git directory present, so a checker script run from the copy falls into
//               its own documented degraded / plain-filesystem-walk mode (each of the three
//               checkers under test names this exact mode, in its own header comment, as a
//               correct way to scan "a bare directory copy with no .git present"). Because
//               check-plugin-root.mjs, check-self-sufficiency.mjs, and check-inventory.mjs all
//               resolve their own REPO_ROOT from import.meta.url rather than argv or cwd, a "temp
//               clone" for these three specifically means copying the checker's own source
//               alongside the tree it scans, so the copy's __dirname resolves to the temp root.
//               Builds one read-only "golden" clone per process (first call), then hands out cheap
//               recursive copies of it per test so repeated clones do not each re-walk git.
//               Also exposes snapshotPaths(paths)/diffPathSnapshots(before, after), so a test can
//               prove -- not just claim -- that planting a violation into a clone never touched the
//               real working tree. Two design choices, both forced by running inside this wave's
//               shared, actively-edited tree ((local working notes, not published) section 6):
//                 (1) scoped to an explicit path list, not the whole tracked tree, because a
//                     whole-tree snapshot observes another task's legitimate, unrelated commits
//                     landing mid-run and reports them as residue (confirmed in practice: a
//                     concurrent task's edit to docs/formats/evidence-log.md tripped an earlier,
//                     whole-tree version of this check even though this file's tests never go near
//                     that path);
//                 (2) content-hash comparison against a snapshot taken at test-file load time, not
//                     `git status` against HEAD/the index, because a path this file plants into can
//                     legitimately already carry an uncommitted modification from earlier, unrelated
//                     work in the same session (confirmed in practice: skills/draft-chapter/SKILL.md carries
//                     this task's own F4 edit, so `git status` on it is never clean to begin with;
//                     only "did it change again DURING this file's tests" is the real question).
//               Mirrors scripts/test-fixtures.mjs's temp-clone discipline in spirit (a real, checked
//               proof of no residue, not an assertion of intent), adapted to a shared-tree reality
//               test-fixtures.mjs's narrower, single-purpose examples/ footprint does not face.
// why:          F6 (checker negative tests) - "use temp clones, never mutate the working tree" is
//               this repo's established discipline (test-fixtures.mjs); this is that same
//               discipline applied to the three standalone checkers, which have no --project=-style
//               flag of their own to point at a scratch directory.
// exit taxonomy: n/a (test helper module, not a CLI)

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, cpSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');

/** git ls-files -z under REPO_ROOT, as repo-relative forward-slash paths. */
function trackedFiles() {
  const listing = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return listing.toString('utf8').split('\0').filter(Boolean);
}

let goldenClone = null;

/** Builds the one golden git-tracked-files-only copy for this process, lazily, once. */
function getGoldenClone() {
  if (goldenClone) return goldenClone;
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-checker-golden-'));
  for (const rel of trackedFiles()) {
    const src = join(REPO_ROOT, ...rel.split('/'));
    const dst = join(root, ...rel.split('/'));
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
  goldenClone = root;
  return root;
}

/**
 * Returns a fresh, independent temp clone of the git-tracked tree (no .git present),
 * plus a cleanup() that removes it. Safe to plant violations into: mutating the
 * returned clone never touches REPO_ROOT or the shared golden clone.
 */
export function cloneRepoToTemp(label) {
  const golden = getGoldenClone();
  const prefix = 'nonfiction-checker-clone-' + String(label).replace(/[^a-z0-9]/gi, '-') + '-';
  const root = mkdtempSync(join(tmpdir(), prefix));
  cpSync(golden, root, { recursive: true });
  return { root, cleanup: () => safeRemove(root) };
}

function safeRemove(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort, mirrors scripts/test-fixtures.mjs removeTempClone
  }
}

/** Removes the shared golden clone. Call once, from an `after()` hook, per test file. */
export function cleanupGoldenClone() {
  if (goldenClone) {
    safeRemove(goldenClone);
    goldenClone = null;
  }
}

/**
 * Runs a checker script that lives INSIDE a temp clone (so the script's own
 * REPO_ROOT, resolved from import.meta.url, is the clone, not the real repo).
 * relScriptPath is repo-relative, e.g. "scripts/checks/check-plugin-root.mjs".
 */
export function runClonedChecker(cloneRoot, relScriptPath, args = []) {
  const scriptAbs = join(cloneRoot, ...relScriptPath.split('/'));
  const result = spawnSync('node', [scriptAbs, ...args], {
    encoding: 'utf8',
    cwd: cloneRoot,
    env: process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: (result.stdout || '') + (result.stderr || ''),
    error: result.error,
  };
}

/**
 * Content-hash snapshot of a fixed, caller-supplied list of LIVE-repo
 * repo-relative paths (sha256 hex, or the sentinel '(absent)' for a path
 * that does not exist -- e.g. one this test only ever expects to exist
 * inside a clone). Deliberately does not care whether a path is currently
 * clean relative to git HEAD: only whether it changes AGAIN between two
 * calls to this function is the residue question these tests need answered.
 */
export function snapshotPaths(paths) {
  const map = new Map();
  for (const rel of paths) {
    const abs = join(REPO_ROOT, ...rel.split('/'));
    map.set(rel, existsSync(abs) ? createHash('sha256').update(readFileSync(abs)).digest('hex') : '(absent)');
  }
  return map;
}

/** Diffs two snapshotPaths() results; returns a list of human-readable changes (empty = no residue). */
export function diffPathSnapshots(before, after) {
  const changes = [];
  for (const [path, hash] of after) {
    const b = before.get(path);
    if (b !== hash) changes.push(path + ': ' + b + ' -> ' + hash);
  }
  return changes;
}
