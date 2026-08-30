// tests/checks/check-frontmatter.test.mjs
// what-it-is:   planted-violation tests for scripts/check-frontmatter.mjs's nfs- skill
//               naming convention rules (closing PF-29, skill-directory existence gaps)
// what-it-does: runs the real checker script (already wired into Tier A as the
//               "Frontmatter completeness" step) against temp clones of the tracked tree,
//               with one violation planted into the clone only. Covers all four rules of
//               the convention: (1) every directory under skills/ that contains a
//               SKILL.md matches ^nfs-[a-z0-9]+(-[a-z0-9]+)*$; (2) every SKILL.md's name:
//               frontmatter field equals its containing directory name; (3) every
//               library.json components.skills[] entry satisfies rule 1; (4) every
//               directory under skills/ contains a SKILL.md (PF-29, skill-directory
//               existence gaps). Each mutation test isolates its rule from the other
//               three so a passing assertion is evidence for that rule specifically, not
//               a coincidence of some other check firing on the same planted change.
// why:          F6 (checker negative tests) - "a checker that cannot fail is not a
//               checker" - applied to the nfs- naming convention shipped as a machine
//               rule rather than as documentation alone, so it binds every skill added
//               after this commit.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, renameSync, cpSync } from 'node:fs';
import { join } from 'node:path';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, snapshotPaths, diffPathSnapshots, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/check-frontmatter.mjs';

after(() => {
  cleanupGoldenClone();
});

/**
 * check-frontmatter.mjs is the only standalone checker under scripts/*.mjs or
 * scripts/checks/*.mjs that imports an npm dependency ("yaml"); the shared
 * golden clone in clone-helper.mjs deliberately carries only git-tracked
 * files, and node_modules is gitignored, so a clone's own ESM resolution of
 * the bare "yaml" specifier fails unless the package exists under the
 * clone's own node_modules/. Hydrates just that one package (it declares no
 * dependencies of its own) from the real repo's already-installed copy.
 */
function hydrateYamlDependency(root) {
  cpSync(join(REPO_ROOT, 'node_modules', 'yaml'), join(root, 'node_modules', 'yaml'), { recursive: true });
}

// ---------------------------------------------------------------------------
// Working-tree-untouched proof, matching the other tests/checks/*.test.mjs
// files' content-hash-snapshot pattern (see clone-helper.mjs's header comment
// for why a whole-tree snapshot and a `git status` check both give false
// positives in this wave's actively shared tree). Scoped to exactly the
// live-repo paths this file's plant steps target.
// ---------------------------------------------------------------------------

const WATCHED_LIVE_PATHS = [
  'skills/nfs-tour/SKILL.md',
  'skills/tour/SKILL.md', // must never come into existence live (rule 1 rename target)
  'skills/_t4-ghost/SKILL.md', // must never come into existence live (rule 4 fixture)
  'library.json',
];

const beforeWatchedSnapshot = snapshotPaths(WATCHED_LIVE_PATHS);

after(() => {
  const diff = diffPathSnapshots(beforeWatchedSnapshot, snapshotPaths(WATCHED_LIVE_PATHS));
  assert.deepEqual(
    diff, [],
    'the live repo paths this file plants into must be unchanged after every clone/plant/run; diff: ' + diff.join(', ')
  );
});

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

test('clean clone: check-frontmatter exits 0 on an unmodified temp clone', () => {
  const { root, cleanup } = cloneRepoToTemp('frontmatter-clean');
  try {
    hydrateYamlDependency(root);
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 on a clean clone; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Rule 1: every directory under skills/ that contains a SKILL.md matches
// ^nfs-[a-z0-9]+(-[a-z0-9]+)*$. Isolated from rule 2 by also updating the
// moved SKILL.md's name: field to match the new (rule-1-violating) directory
// name, so only rule 1 fires here.
// ---------------------------------------------------------------------------

test('rule 1: a skill directory renamed to drop the nfs- prefix is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('frontmatter-rule1-unprefixed-dir');
  try {
    hydrateYamlDependency(root);
    const oldDir = join(root, 'skills', 'nfs-tour');
    const newDir = join(root, 'skills', 'tour');
    renameSync(oldDir, newDir);

    const skillMdPath = join(newDir, 'SKILL.md');
    const text = readFileSync(skillMdPath, 'utf8');
    // Keep rule 2 satisfied (name: matches its directory) so only rule 1 fires.
    writeFileSync(skillMdPath, text.replace('name: nfs-tour\n', 'name: tour\n'));

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /skills\/tour/, 'message must name the offending directory');
    assert.match(result.combined, /nfs-\[a-z0-9\]/, 'message must name the broken naming-convention rule');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Rule 2: every SKILL.md's name: frontmatter field equals its containing
// directory name. Isolated from rule 1 by leaving the directory correctly
// prefixed and only mutating the frontmatter value.
// ---------------------------------------------------------------------------

test('rule 2: a SKILL.md name: field diverging from its directory is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('frontmatter-rule2-name-mismatch');
  try {
    hydrateYamlDependency(root);
    const skillMdPath = join(root, 'skills', 'nfs-tour', 'SKILL.md');
    const text = readFileSync(skillMdPath, 'utf8');
    writeFileSync(skillMdPath, text.replace('name: nfs-tour\n', 'name: nfs-tour-mutated\n'));

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /skills\/nfs-tour\/SKILL\.md/, 'message must name the offending file');
    assert.match(result.combined, /nfs-tour-mutated/, 'message must name the mismatched value');
    assert.match(result.combined, /does not match directory name/, 'message must name the broken rule');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Rule 3: every library.json components.skills[] entry satisfies rule 1.
// ---------------------------------------------------------------------------

test('rule 3: an unprefixed entry added to library.json components.skills[] is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('frontmatter-rule3-unprefixed-manifest-entry');
  try {
    hydrateYamlDependency(root);
    const libraryJsonPath = join(root, 'library.json');
    const library = JSON.parse(readFileSync(libraryJsonPath, 'utf8'));
    library.components.skills.push('bogus-skill');
    writeFileSync(libraryJsonPath, JSON.stringify(library, null, 2) + '\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /library\.json components\.skills/, 'message must name the offending manifest field');
    assert.match(result.combined, /bogus-skill/, 'message must name the offending entry');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Rule 4 (PF-29, skill-directory existence gaps): every directory under
// skills/ contains a SKILL.md.
// ---------------------------------------------------------------------------

test('rule 4: a skill directory with no SKILL.md is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('frontmatter-rule4-missing-skill-md');
  try {
    hydrateYamlDependency(root);
    mkdirSync(join(root, 'skills', '_t4-ghost'), { recursive: true });

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /_t4-ghost/, 'message must name the offending directory');
    assert.match(result.combined, /SKILL\.md/, 'message must name the broken rule (missing SKILL.md)');
  } finally {
    cleanup();
  }
});
