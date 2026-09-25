// tests/checks/plugin-root-resolver.test.mjs
// what-it-is:   parity + behavior tests for the shared plugin-root resolver line embedded in
//               the eight CLI-backed skills (nfs-build-apparatus, nfs-check-chapter, nfs-doctor,
//               nfs-fact-check, nfs-new-book, nfs-quick-scan, nfs-status-dashboard, nfs-tour)
// what-it-does: (1) extracts the resolver's `node -e "..."` line from each of the eight
//               SKILL.md files under the heading "## Step <n> - (Find|Resolve) the plugin
//               root" and asserts every skill carries it and all eight are byte-identical (the
//               parity guard: a skill that regresses to its own bespoke lookup, or a fix
//               applied to only some skills, is caught here) - (2) executes the extracted JS
//               with node itself (never a real `bash`, so this suite has no shell dependency
//               and runs the same way on both Tier A OS legs) against fixture layouts built in
//               an isolated temp directory, with HOME, USERPROFILE, HOMEDRIVE, HOMEPATH, and
//               CLAUDE_CONFIG_DIR all explicitly controlled per case (os.homedir() reads
//               USERPROFILE on win32 and HOME on POSIX; a case that only sets HOME silently
//               falls back to the real machine home directory on Windows and pollutes the
//               result - see the homedirEnv() helper).
// why:          the post-release clean-install test (2026-09-24) found that a MARKETPLACE
//               install (living at <config>/plugins/cache/<marketplace>/nonfiction-studio/
//               <version>/) broke every CLI-backed skill, because the old resolver's cache
//               fallback (`find ... -maxdepth 3 -name "nonfiction-studio*" | head -1`) matches
//               the marketplace-name-then-nonfiction-studio directory two levels up from the
//               actual install root, before the version folder - a directory that never
//               contains bin/ns-stylometry. The new resolver reads
//               <config>/plugins/installed_plugins.json (the authoritative source; its shape is
//               not documented in the resolver line itself, only here and in ADR-0014) first,
//               verifies every candidate by checking for bin/ns-stylometry, ignores a
//               project/local-scope entry whose own projectPath is not the cwd or one of its
//               ancestors (so another project's install can never shadow this one), and only
//               then falls through to the local self-marketplace (settings.json) and cache-scan
//               tiers. A not-found result also prints the config directory it checked, on
//               stderr, so a halting skill can report it without a second resolver call.
// runner:       node --test "tests/checks/*.test.mjs" (picked up by scripts/test-engines.mjs's
//               tests/checks/*.test.mjs glob - no registration needed elsewhere)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// The eight CLI-backed skills this hotfix touches, in the order the bug report names them.
const SKILLS = [
  'nfs-build-apparatus',
  'nfs-check-chapter',
  'nfs-doctor',
  'nfs-fact-check',
  'nfs-new-book',
  'nfs-quick-scan',
  'nfs-status-dashboard',
  'nfs-tour',
];

// Matches "## Step 4 - Resolve the plugin root" and nfs-new-book's "## Step 4 - Find the
// plugin root" alike; step numbers legitimately differ between skills (not part of the parity
// guard), only the resolver line itself must match.
const HEADING_RE = /^## Step \S+ - (?:Resolve|Find) the plugin root\s*$/m;
const FENCE_LINE_RE = /^node -e "(.*)"\s*$/m;

/**
 * Reads skills/<name>/SKILL.md, finds the plugin-root-resolution heading, and returns the
 * first `node -e "..."` fenced line after it (the JS source only, unescaped from its
 * surrounding node -e "..." shell wrapper), or null if the heading or the line is absent.
 */
function extractResolverLine(skillName) {
  const path = join(REPO_ROOT, 'skills', skillName, 'SKILL.md');
  const text = readFileSync(path, 'utf8');
  const headingMatch = HEADING_RE.exec(text);
  if (!headingMatch) return null;
  const after = text.slice(headingMatch.index);
  // Stop at the next "## " heading so a later, unrelated node -e line in the same file is
  // never mistaken for the resolver.
  const nextHeadingIdx = after.slice(1).search(/^## /m);
  const scoped = nextHeadingIdx === -1 ? after : after.slice(0, nextHeadingIdx + 1);
  const fenceMatch = FENCE_LINE_RE.exec(scoped);
  if (!fenceMatch) return null;
  return fenceMatch[1];
}

// ---------------------------------------------------------------------------
// Parity guard
// ---------------------------------------------------------------------------

test('parity: every one of the 8 CLI-backed skills carries the resolver line', () => {
  const missing = [];
  for (const name of SKILLS) {
    if (extractResolverLine(name) === null) missing.push(name);
  }
  assert.deepEqual(missing, [], 'skill(s) missing the "node -e" resolver line under a "Resolve/Find the plugin root" step: ' + missing.join(', '));
});

test('parity: the resolver line is byte-identical across all 8 CLI-backed skills', () => {
  const lines = SKILLS.map((name) => ({ name, line: extractResolverLine(name) }));
  const present = lines.filter((l) => l.line !== null);
  assert.ok(present.length > 0, 'no skill carried a resolver line at all; run the parity presence test first');
  const reference = present[0].line;
  const mismatched = present.filter((l) => l.line !== reference).map((l) => l.name);
  assert.deepEqual(mismatched, [], 'resolver line differs from ' + present[0].name + ' in: ' + mismatched.join(', '));
});

// The resolver line lives inside a `node -e "..."` bash double-quoted string in every SKILL.md,
// so it must never itself contain a double quote, a backtick, or a backslash (a backslash would
// either escape the closing quote or need doubling, and this repo's ASCII/no-em-dash rule plus
// cross-shell portability both push toward avoiding it entirely). Static proof, not just "it
// happened to work in the fixture runs below" - the actual guarantee this suite gives for
// Windows Git Bash / PowerShell-launched bash / macOS / Linux parity.
test('shell-safety: the resolver line contains no double quote, backtick, or backslash', () => {
  const line = extractResolverLine('nfs-tour');
  assert.ok(line, 'nfs-tour must carry the resolver line for this test to mean anything');
  assert.doesNotMatch(line, /["`\\]/, 'a double quote, backtick, or backslash in the resolver line breaks the surrounding node -e "..." wrapper on at least one shell');
});

// A bare "!" is also a portability hazard, but narrower than the three characters above: an
// INTERACTIVE bash or zsh with history expansion on (the default in a login shell) treats
// "!" followed directly by a word character as a history-event reference and aborts with
// "event not found" before node ever runs - confirmed with `history -p` under `set -H` for
// forms like "!p" and "!best", never for "!==" or "!='user'" (bash's own history-expansion
// rule excludes "!" immediately followed by "="). Neither non-interactive bash (what the Bash
// tool actually runs) nor PowerShell is affected either way; this test exists for an author who
// copies the documented command into their own interactive shell. "$" is also forbidden: this
// resolver never needs shell interpolation, and a stray "$" inside the double-quoted node -e
// wrapper is a latent variable-expansion hazard even where it happens not to fire today.
test('shell-safety: the resolver line contains no "$", and no "!" immediately followed by a word character or "("', () => {
  const line = extractResolverLine('nfs-tour');
  assert.ok(line, 'nfs-tour must carry the resolver line for this test to mean anything');
  assert.doesNotMatch(line, /\$/, 'a "$" in the resolver line is a shell-interpolation hazard inside the double-quoted node -e wrapper');
  assert.doesNotMatch(line, /![\w(]/, 'a "!" directly followed by a word character or "(" triggers bash/zsh history expansion ("event not found") when pasted into an interactive shell; "!==" and "!=" are unaffected and remain allowed');
});

// ---------------------------------------------------------------------------
// Execution harness
// ---------------------------------------------------------------------------

const cleanupDirs = [];

function mktemp(label) {
  const dir = mkdtempSync(join(tmpdir(), 'nfs-resolver-' + label + '-'));
  cleanupDirs.push(dir);
  return dir;
}

function touchStylometry(root) {
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(join(root, 'bin', 'ns-stylometry'), '#!/usr/bin/env node\n');
}

/**
 * Runs the extracted resolver JS with node itself (process.execPath -e <js>), never a shell -
 * so this suite has no dependency on bash being present on the runner, and the same code path
 * exercises identically on both Tier A OS legs. HOME, USERPROFILE, HOMEDRIVE, and HOMEPATH are
 * all pointed at `home` (os.homedir() reads USERPROFILE on win32 and HOME on POSIX; setting
 * only one silently leaks the real machine's home directory into the test on the other
 * platform). CLAUDE_CONFIG_DIR is deleted unless the case passes one explicitly.
 */
function runResolver(js, { cwd, home, configDir } = {}) {
  const env = { ...process.env };
  if (home !== undefined) {
    env.HOME = home;
    env.USERPROFILE = home;
    env.HOMEDRIVE = '';
    env.HOMEPATH = '';
  }
  if (configDir === undefined) {
    delete env.CLAUDE_CONFIG_DIR;
  } else {
    env.CLAUDE_CONFIG_DIR = configDir;
  }
  const result = spawnSync(process.execPath, ['-e', js], {
    cwd: cwd ?? home,
    env,
    encoding: 'utf8',
  });
  return {
    stdout: (result.stdout ?? '').trim(),
    status: result.status,
    stderr: result.stderr ?? '',
  };
}

/** Native realpath, so a Windows temp dir's 8.3 short-name / case quirks never cause a false mismatch. */
function real(p) {
  return realpathSync.native(p);
}

test.after(() => {
  for (const d of cleanupDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// One resolver line, read once, reused by every execution test below.
const RESOLVER_JS = extractResolverLine('nfs-tour');

test('fixture: marketplace install via installed_plugins.json (version subfolder) resolves to the install path', () => {
  assert.ok(RESOLVER_JS, 'resolver line must be present before running fixture tests (see the parity tests above)');
  const home = mktemp('marketplace');
  const cfg = join(home, '.claude');
  const installRoot = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  touchStylometry(installRoot);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'nonfiction-studio@prisant-labs': [{ scope: 'user', installPath: installRoot, version: '0.1.0' }] },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(installRoot));
});

test('fixture: installPath written with Windows-style backslashes (as installed_plugins.json stores it on win32) still resolves', () => {
  const home = mktemp('winpath');
  const cfg = join(home, '.claude');
  const installRoot = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  touchStylometry(installRoot);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  // Simulate the literal on-disk JSON shape: a win32 installPath is backslash-separated; a
  // POSIX one is forward-slash-separated. Only the platform-native form is expected to
  // resolve via fs.existsSync/path.join, so this test writes whichever form this process's
  // own platform actually produces (this fixture proves the resolver does not mis-handle the
  // separator its own OS writes, not that it cross-parses a foreign OS's separator).
  const installPathForJson = process.platform === 'win32' ? installRoot.split('/').join('\\') : installRoot;
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'nonfiction-studio@prisant-labs': [{ scope: 'user', installPath: installPathForJson, version: '0.1.0' }] },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(installRoot));
});

test('fixture: two installed versions -> the newer version wins', () => {
  const home = mktemp('two-versions');
  const cfg = join(home, '.claude');
  const older = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  const newer = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.1');
  touchStylometry(older);
  touchStylometry(newer);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'nonfiction-studio@prisant-labs': [
        { scope: 'user', installPath: older, version: '0.1.0' },
        { scope: 'user', installPath: newer, version: '0.1.1' },
      ],
    },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(newer));
});

test('fixture: project-scope and user-scope entries at the same version -> user scope wins the tie', () => {
  const home = mktemp('scope-tie');
  const cfg = join(home, '.claude');
  const projectRoot = join(cfg, 'plugins', 'cache', 'proj-marketplace', 'nonfiction-studio', '0.1.0');
  const userRoot = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  touchStylometry(projectRoot);
  touchStylometry(userRoot);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'nonfiction-studio@prisant-labs': [
        { scope: 'project', installPath: projectRoot, version: '0.1.0' },
        { scope: 'user', installPath: userRoot, version: '0.1.0' },
      ],
    },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(userRoot));
});

test('fixture: installed_plugins.json missing -> falls through to the modern cache-scan layout and finds the version folder', () => {
  const home = mktemp('no-installed-json');
  const cfg = join(home, '.claude');
  const root = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  touchStylometry(root);

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(root));
});

test('fixture: legacy flat cache layout (<config>/plugins/cache/nonfiction-studio*/, no marketplace or version subfolder) still resolves', () => {
  const home = mktemp('legacy-flat');
  const cfg = join(home, '.claude');
  const root = join(cfg, 'plugins', 'cache', 'nonfiction-studio-legacy');
  touchStylometry(root);

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(root));
});

test('fixture: the modern versioned cache scan wins even when a legacy-shaped nested self-marketplace directory also exists', () => {
  // The self-marketplace is itself named "nonfiction-studio", so a local self-marketplace
  // install can legitimately land at cache/nonfiction-studio/nonfiction-studio/<ver>/ - a path
  // that also matches the legacy flat-layout glob (cache/nonfiction-studio*/) one level too
  // early. The modern versioned scan must win regardless of directory iteration order.
  const home = mktemp('legacy-vs-modern');
  const cfg = join(home, '.claude');
  const versioned = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  const nestedLegacyShaped = join(cfg, 'plugins', 'cache', 'nonfiction-studio', 'nonfiction-studio', '0.0.9');
  touchStylometry(versioned);
  touchStylometry(nestedLegacyShaped);

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(versioned));
});

test('fixture: local self-marketplace via settings.json extraKnownMarketplaces resolves when bin/ns-stylometry is present there', () => {
  const home = mktemp('self-marketplace');
  const cfg = join(home, '.claude');
  const devRoot = join(home, 'dev-checkout');
  touchStylometry(devRoot);
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({
    extraKnownMarketplaces: { 'nonfiction-studio': { source: { path: devRoot } } },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(devRoot));
});

test('fixture: settings.json self-marketplace path without bin/ns-stylometry is rejected, not trusted blindly', () => {
  const home = mktemp('self-marketplace-unverified');
  const cfg = join(home, '.claude');
  const devRoot = join(home, 'dev-checkout-empty');
  mkdirSync(devRoot, { recursive: true }); // exists, but no bin/ns-stylometry
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({
    extraKnownMarketplaces: { 'nonfiction-studio': { source: { path: devRoot } } },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(stdout, 'not-found');
});

test('fixture: dev mode (cwd itself carries bin/ns-stylometry, nothing else present) resolves to cwd', () => {
  const home = mktemp('dev-mode-home');
  const cwd = mktemp('dev-mode-cwd');
  touchStylometry(cwd);

  const { stdout, status } = runResolver(RESOLVER_JS, { home, cwd });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(cwd));
});

test('fixture: nothing resolves anywhere -> prints not-found, exit 0 (never throws)', () => {
  const home = mktemp('nothing-home');
  const cwd = mktemp('nothing-cwd');

  const { stdout, status } = runResolver(RESOLVER_JS, { home, cwd });
  assert.equal(status, 0);
  assert.equal(stdout, 'not-found');
});

test('fixture: malformed installed_plugins.json and settings.json -> no throw, falls through to cache scan', () => {
  const home = mktemp('malformed-json');
  const cfg = join(home, '.claude');
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), '{not valid json,,,');
  writeFileSync(join(cfg, 'settings.json'), '{also not valid json');
  const root = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  touchStylometry(root);

  const { stdout, status, stderr } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0, 'malformed JSON must never crash the resolver; stderr: ' + stderr);
  assert.equal(real(stdout), real(root));
});

test('fixture: CLAUDE_CONFIG_DIR is honored over HOME/USERPROFILE when both point at a real install', () => {
  const home = mktemp('config-dir-home');
  const homeRoot = join(home, '.claude', 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  touchStylometry(homeRoot);

  const altConfig = mktemp('config-dir-alt');
  const altRoot = join(altConfig, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  touchStylometry(altRoot);

  const { stdout, status } = runResolver(RESOLVER_JS, { home, cwd: home, configDir: altConfig });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(altRoot));
  assert.notEqual(real(stdout), real(homeRoot));
});

test('fixture: a stale installed_plugins.json entry (its version folder missing) never shadows a real, older entry', () => {
  // A wiped cache, or a newer version merely listed but not yet unpacked, must not win the
  // version comparison just because it sorts higher - has() is the gate, not the version string
  // alone. Mutating the resolver to drop the has(p) check on this tier (leaving only "if(p==null)
  // continue;") leaves every other fixture in this file green; only this one goes red.
  const home = mktemp('stale-entry');
  const cfg = join(home, '.claude');
  const staleNewer = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.2'); // never created
  const realOlder = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.1');
  touchStylometry(realOlder);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'nonfiction-studio@prisant-labs': [
        { scope: 'user', installPath: staleNewer, version: '0.1.2' },
        { scope: 'user', installPath: realOlder, version: '0.1.1' },
      ],
    },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(realOlder));
});

// ---------------------------------------------------------------------------
// F5: project/local-scope entries are ignored unless the current working directory is the
// entry's own projectPath or a descendant of it. Without this, a "local"-scope install for one
// project could out-version and shadow a "user"-scope (or another project's) install everywhere
// the resolver runs, which is exactly the shape this machine's own real installed_plugins.json
// carries for several other plugins (several "local"-scope entries at different versions for
// different projects).
// ---------------------------------------------------------------------------

test('fixture: a local-scope entry for a DIFFERENT project is ignored even though its version is newer', () => {
  const home = mktemp('f5-diff-project');
  const cwdA = mktemp('f5-project-a');
  const projectBPath = mktemp('f5-project-b');
  const cfg = join(home, '.claude');
  const userRoot = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.1');
  const localRootForB = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.2');
  touchStylometry(userRoot);
  touchStylometry(localRootForB);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'nonfiction-studio@prisant-labs': [
        { scope: 'user', installPath: userRoot, version: '0.1.1' },
        { scope: 'local', installPath: localRootForB, version: '0.1.2', projectPath: projectBPath },
      ],
    },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home, cwd: cwdA });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(userRoot), 'must resolve to the user-scope 0.1.1, not another project\'s local-scope 0.1.2');
});

test('fixture: a local-scope entry for the CURRENT project (cwd matches projectPath) is honored and wins on version', () => {
  const home = mktemp('f5-same-project');
  const projectPath = mktemp('f5-project-self');
  const cfg = join(home, '.claude');
  const userRoot = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.1');
  const localRoot = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.2');
  touchStylometry(userRoot);
  touchStylometry(localRoot);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'nonfiction-studio@prisant-labs': [
        { scope: 'user', installPath: userRoot, version: '0.1.1' },
        { scope: 'local', installPath: localRoot, version: '0.1.2', projectPath: projectPath },
      ],
    },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home, cwd: projectPath });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(localRoot), 'the newer local-scope install must win when cwd is that project');
});

test('fixture: cwd is a SUBDIRECTORY of the project path -> the local-scope entry still matches (ancestor check)', () => {
  const home = mktemp('f5-subdir');
  const projectPath = mktemp('f5-project-parent');
  const subdir = join(projectPath, 'chapters', 'ch01');
  mkdirSync(subdir, { recursive: true });
  const cfg = join(home, '.claude');
  const localRoot = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.2');
  touchStylometry(localRoot);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'nonfiction-studio@prisant-labs': [
        { scope: 'local', installPath: localRoot, version: '0.1.2', projectPath: projectPath },
      ],
    },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home, cwd: subdir });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(localRoot));
});

test('fixture: a foreign-project local-scope entry with no backing directory anywhere else -> the entries tier skips it, not-found', () => {
  // installPath verifies (has() would pass), and nothing separately matches the cache-scan
  // fallback tier's own naming convention, so a resolve here could only come from the
  // entries-tier match this test proves is skipped.
  const home = mktemp('f5-foreign-no-fallback');
  const cwdA = mktemp('f5-cwd-a2');
  const projectBPath = mktemp('f5-project-b2');
  const cfg = join(home, '.claude');
  const outsideCacheLayout = join(home, 'elsewhere', 'not-in-cache-layout');
  touchStylometry(outsideCacheLayout);
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'nonfiction-studio@prisant-labs': [
        { scope: 'local', installPath: outsideCacheLayout, version: '0.1.2', projectPath: projectBPath },
      ],
    },
  }));

  const { stdout, status } = runResolver(RESOLVER_JS, { home, cwd: cwdA });
  assert.equal(status, 0);
  assert.equal(stdout, 'not-found');
});

// ---------------------------------------------------------------------------
// F9: a not-found result also prints the config directory the resolver actually checked, on
// stderr, so a halting skill can report it without deriving CLAUDE_CONFIG_DIR-vs-HOME itself
// (which it cannot do reliably: the resolver's own stdout carries only the sentinel).
// ---------------------------------------------------------------------------

test('fixture: not-found also prints the config dir checked, on stderr', () => {
  const home = mktemp('f9-home');
  const cwd = mktemp('f9-cwd');
  const { stdout, status, stderr } = runResolver(RESOLVER_JS, { home, cwd });
  assert.equal(status, 0);
  assert.equal(stdout, 'not-found');
  assert.equal(stderr.trim(), join(home, '.claude'));
});

test('fixture: not-found stderr honors CLAUDE_CONFIG_DIR over HOME', () => {
  const home = mktemp('f9-home2');
  const cwd = mktemp('f9-cwd2');
  const altConfig = mktemp('f9-altcfg');
  const { stdout, status, stderr } = runResolver(RESOLVER_JS, { home, cwd, configDir: altConfig });
  assert.equal(status, 0);
  assert.equal(stdout, 'not-found');
  assert.equal(stderr.trim(), altConfig);
});

// ---------------------------------------------------------------------------
// Regression proof: the OLD design (documented in scripts/checks/check-plugin-root.mjs's own
// header before this fix, and in this fix's commit history) fails against exactly the layout
// this bug report is about. Reimplemented here in pure Node rather than shelling out to a real
// `find` binary, so this test carries no dependency on a POSIX `find` being on PATH (not
// guaranteed on a Windows Tier A runner outside a bash invocation) and stays fully
// deterministic. Mirrors `find "$config/plugins/cache" -maxdepth 3 -type d -name
// "nonfiction-studio*" | head -1` closely enough to prove the point: it matches the
// marketplace-name-then-nonfiction-studio directory two levels above the real install root,
// which never contains bin/ns-stylometry.
// ---------------------------------------------------------------------------

function oldFindMaxdepth3(cacheRoot) {
  const matches = [];
  function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(dir, e.name);
      if (e.name.indexOf('nonfiction-studio') === 0) matches.push(full);
      walk(full, depth + 1);
    }
  }
  if (existsSync(cacheRoot)) walk(cacheRoot, 1);
  return matches[0]; // "head -1"
}

test('regression proof: the OLD cache-fallback shape (maxdepth 3, first match) resolves to a directory with no bin/ns-stylometry on a marketplace install', () => {
  const home = mktemp('old-design-regression');
  const cfg = join(home, '.claude');
  const installRoot = join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio', '0.1.0');
  touchStylometry(installRoot);

  const oldResolved = oldFindMaxdepth3(join(cfg, 'plugins', 'cache'));
  assert.ok(oldResolved, 'the old maxdepth-3 scan must find something in this fixture');
  assert.equal(real(oldResolved), real(join(cfg, 'plugins', 'cache', 'prisant-labs', 'nonfiction-studio')));

  assert.equal(
    existsSync(join(oldResolved, 'bin', 'ns-stylometry')),
    false,
    'RED: the OLD resolution lands one directory above the real install root and bin/ns-stylometry does not exist there - this is the marketplace-install bug this hotfix fixes'
  );

  // The NEW resolver, run against the identical fixture, must succeed.
  const { stdout, status } = runResolver(RESOLVER_JS, { home });
  assert.equal(status, 0);
  assert.equal(real(stdout), real(installRoot), 'GREEN: the new resolver finds the real install root the old one missed');
});
