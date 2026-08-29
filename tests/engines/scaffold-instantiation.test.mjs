// tests/engines/scaffold-instantiation.test.mjs
// what-it-is:   proof that the literal templates/book-scaffold/ tree, instantiated the way
//               skills/nfs-new-book/SKILL.md Steps 5-6 instantiate it, is doctor-clean
// what-it-does: clones templates/book-scaffold/ into a mkdtempSync temp dir, applies the exact
//               token substitutions Steps 5-6 specify ({{DATE}}, {{DATETIME}}, {{BOOK_TITLE}},
//               {{PLUGIN_VERSION}}) with fixed deterministic values ONLY to the named files, then
//               recursively scans the ENTIRE cloned tree (not just the named files) for any
//               surviving {{TOKEN}} marker, so a future scaffold file that gains a token without
//               SUBSTITUTION_FILES (and the skill) being updated fails this scan loudly instead
//               of shipping unnoticed. Then runs a real spawned bin/ns-doctor against the temp
//               dir (exit 0, zero findings, the Task 5 style-profile.not-captured NOTICE
//               present) and cross-checks the same result via a direct hooks/lib/doctor-engine.mjs
//               runChecks call. Two deliberately corrupted clones are the negative controls: one
//               with .studio/progress.json replaced with invalid JSON (schema.invalid-json), one
//               with structure/outline.md deleted (structure.missing-path), so load-bearing
//               coverage spans more than the JSON-parse layer. The raw un-substituted scaffold
//               was checked by hand and already doctors clean (none of the four templated fields
//               are validated for format or content by doctor-engine.mjs, only for being a
//               string), so an un-substituted clone cannot serve as a negative control here.
// why:          F-CI-06 (scaffold untested): the scaffold every new book starts from had never
//               been proven, in CI, to survive the instantiation an author actually runs.
// exit taxonomy: n/a (test file; node --test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { runChecks } from '../../hooks/lib/doctor-engine.mjs';
import { REPO_ROOT, runNodeScript, buildEnv } from '../checks/spawn-helper.mjs';

const SCAFFOLD_SRC = join(REPO_ROOT, 'templates', 'book-scaffold');
const PLUGIN_MANIFEST_PATH = join(REPO_ROOT, '.claude-plugin', 'plugin.json');

// ---------------------------------------------------------------------------
// Deterministic substitution values (constraint: fixed, no locale/timezone
// dependence). PLUGIN_VERSION is read at runtime from plugin.json, never
// hardcoded, so the test tracks the real shipped version.
// ---------------------------------------------------------------------------

const FIXED_DATE = '2026-01-15';
const FIXED_DATETIME = '2026-01-15T09:00:00Z';
const FIXED_BOOK_TITLE = 'The Fixture Book';
const PLUGIN_VERSION = JSON.parse(readFileSync(PLUGIN_MANIFEST_PATH, 'utf8')).version;

// ---------------------------------------------------------------------------
// Per-file substitution map, derived directly from skills/nfs-new-book/SKILL.md
// Steps 5-6 and confirmed against the template tree with:
//   grep -rn "{{" templates/book-scaffold/
// which returns exactly these four files and no others:
//   context/decisions.md        {{DATE}}       (Step 5's "Token substitutions for
//                                                prose files" header covers this file
//                                                too; only research/evidence-log.md
//                                                gets an explicit parenthetical call-out
//                                                in Step 5's text, but the substitution
//                                                is not file-specific)
//   research/evidence-log.md    {{DATE}}
//   .studio/meta.json           {{DATETIME}}, {{PLUGIN_VERSION}}, {{BOOK_TITLE}}
//   .studio/progress.json       {{DATETIME}}
// No other token, and no other file, appears anywhere under templates/book-scaffold/.
// ---------------------------------------------------------------------------

const SUBSTITUTION_FILES = [
  'context/decisions.md',
  'research/evidence-log.md',
  '.studio/meta.json',
  '.studio/progress.json',
];

function substituteTokens(text) {
  return text
    .split('{{DATE}}').join(FIXED_DATE)
    .split('{{DATETIME}}').join(FIXED_DATETIME)
    .split('{{BOOK_TITLE}}').join(FIXED_BOOK_TITLE)
    .split('{{PLUGIN_VERSION}}').join(PLUGIN_VERSION);
}

// ---------------------------------------------------------------------------
// Local temp-clone helper (the makeTempClone pattern from
// scripts/test-fixtures.mjs:140-153; not imported, since that script does not
// export it).
// ---------------------------------------------------------------------------

function makeTempClone(label) {
  const prefix = 'nonfiction-scaffold-' + label.replace(/[^a-z0-9]/gi, '-') + '-';
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  cpSync(SCAFFOLD_SRC, tempDir, { recursive: true });
  return tempDir;
}

function removeTempClone(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup only; never fail a test on teardown
  }
}

function applyInitProjectSubstitutions(root) {
  for (const rel of SUBSTITUTION_FILES) {
    const abs = join(root, ...rel.split('/'));
    const original = readFileSync(abs, 'utf8');
    writeFileSync(abs, substituteTokens(original));
  }
}

const LEFTOVER_TOKEN_RE = /\{\{[A-Z_]+\}\}/;

// Recursively scans the ENTIRE cloned tree (every file, not only the ones
// substitution touched) for a surviving {{TOKEN}} marker. This is the
// completeness proof: SUBSTITUTION_FILES and skills/nfs-new-book/SKILL.md
// name the files that currently carry tokens, but if a future scaffold
// change adds a templated file to templates/book-scaffold/ without updating
// both of those, nothing else in this file would catch the stray {{TOKEN}}
// string. Scanning the whole tree, rather than trusting the named-files
// list to stay complete, is what makes that assumption self-enforcing.
function scanForLeftoverTokens(root) {
  const violations = [];
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    const text = readFileSync(abs, 'utf8');
    const match = LEFTOVER_TOKEN_RE.exec(text);
    if (match) {
      violations.push(relative(root, abs).split('\\').join('/') + ': ' + match[0]);
    }
  }
  return violations;
}

function assertNoLeftoverTokens(root) {
  const violations = scanForLeftoverTokens(root);
  assert.deepEqual(violations, [], 'unsubstituted token(s) survived in the cloned tree: ' + violations.join(', '));
}

// ---------------------------------------------------------------------------
// bin/ns-doctor spawn helper, reusing tests/checks/spawn-helper.mjs's
// runNodeScript (process.execPath plus an argv array, no shell involved, so
// nothing here depends on OS shell syntax) and buildEnv (doctor needs no
// credentials; buildEnv's credential stripping is inert here but keeps this
// spawn on the same env-construction path as the rest of the suite).
// ---------------------------------------------------------------------------

function spawnDoctorJson(projectDir) {
  return runNodeScript('bin/ns-doctor', ['--project=' + projectDir, '--json'], buildEnv());
}

// ---------------------------------------------------------------------------
// Cleanup registry: every temp dir created by any test in this file is
// removed in after(), even if a test fails partway through.
// ---------------------------------------------------------------------------

const tempDirsToClean = [];

test.after(() => {
  for (const dir of tempDirsToClean) removeTempClone(dir);
});

// ---------------------------------------------------------------------------
// Positive case: the scaffold instantiated the way nfs-new-book instantiates it
// ---------------------------------------------------------------------------

test('instantiated scaffold: token substitution leaves no {{TOKEN}} markers', () => {
  const tempDir = makeTempClone('positive');
  tempDirsToClean.push(tempDir);

  applyInitProjectSubstitutions(tempDir);
  assertNoLeftoverTokens(tempDir);
});

test('instantiated scaffold: bin/ns-doctor --json exits 0 with zero findings and the style-profile.not-captured notice', () => {
  const tempDir = makeTempClone('positive-doctor');
  tempDirsToClean.push(tempDir);

  applyInitProjectSubstitutions(tempDir);

  const result = spawnDoctorJson(tempDir);
  assert.equal(
    result.status,
    0,
    'ns-doctor should exit 0 on the instantiated scaffold; stdout: ' + result.stdout + ' stderr: ' + result.stderr
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(
    parsed.findings.length,
    0,
    'expected zero findings on the instantiated scaffold, got: ' + JSON.stringify(parsed.findings)
  );

  const hasStubNotice = parsed.notices.some((n) => n.type === 'style-profile.not-captured');
  assert.ok(
    hasStubNotice,
    'expected the style-profile.not-captured NOTICE (Task 5 seam), got notices: ' + JSON.stringify(parsed.notices)
  );
});

test('instantiated scaffold: hooks/lib/doctor-engine.mjs runChecks agrees with the spawned CLI', () => {
  const tempDir = makeTempClone('positive-runchecks');
  tempDirsToClean.push(tempDir);

  applyInitProjectSubstitutions(tempDir);

  const { findings, notices } = runChecks(tempDir);
  assert.equal(
    findings.length,
    0,
    'runChecks: expected zero findings on the instantiated scaffold, got: ' + JSON.stringify(findings)
  );
  assert.ok(
    notices.some((n) => n.type === 'style-profile.not-captured'),
    'runChecks: expected the style-profile.not-captured NOTICE, got notices: ' + JSON.stringify(notices)
  );
});

// ---------------------------------------------------------------------------
// Negative control
//
// The brief's suggested negative control (the raw, un-substituted template)
// was checked directly first: bin/ns-doctor --project=<raw clone> --json
// already exits 0 with zero findings and the same style-profile.not-captured
// notice, because none of the four templated fields (created,
// plugin_version_at_creation, book_title, and progress.json's updated) is
// validated for format or content by doctor-engine.mjs, only for being a
// string (and progress.schema.json's "format": "date-time" on "updated" is
// not enforced by the hand-rolled validator, which checks type, const, enum,
// minimum/maximum, pattern, required, and properties, but never format). An
// un-substituted clone therefore cannot serve as a load-bearing negative
// control, so this test corrupts .studio/progress.json into invalid JSON
// instead, per the brief's own fallback.
// ---------------------------------------------------------------------------

test('negative control: a clone with invalid .studio/progress.json fails doctor', () => {
  const tempDir = makeTempClone('negative-corrupt');
  tempDirsToClean.push(tempDir);

  applyInitProjectSubstitutions(tempDir);

  const progressPath = join(tempDir, '.studio', 'progress.json');
  writeFileSync(progressPath, '{ this is not valid JSON');

  const result = spawnDoctorJson(tempDir);
  assert.notEqual(result.status, 0, 'ns-doctor should not exit 0 against a corrupted progress.json');

  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings.length >= 1, 'expected at least one finding, got: ' + JSON.stringify(parsed.findings));
  assert.ok(
    parsed.findings.some((f) => f.type === 'schema.invalid-json'),
    'expected a schema.invalid-json finding, got: ' + JSON.stringify(parsed.findings)
  );
});

// Second corruption shape: a required scaffold path removed outright, so
// negative-control coverage spans more than the JSON-parse layer above.
test('negative control: a clone missing a required scaffold path fails doctor with structure.missing-path', () => {
  const tempDir = makeTempClone('negative-missing-path');
  tempDirsToClean.push(tempDir);

  applyInitProjectSubstitutions(tempDir);

  const outlinePath = join(tempDir, 'structure', 'outline.md');
  rmSync(outlinePath);

  const result = spawnDoctorJson(tempDir);
  assert.notEqual(result.status, 0, 'ns-doctor should not exit 0 with a required scaffold path missing');

  const parsed = JSON.parse(result.stdout);
  assert.ok(
    parsed.findings.some((f) => f.type === 'structure.missing-path' && f.path === 'structure/outline.md'),
    'expected a structure.missing-path finding for structure/outline.md, got: ' + JSON.stringify(parsed.findings)
  );
});
