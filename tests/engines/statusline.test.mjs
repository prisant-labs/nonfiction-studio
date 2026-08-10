// tests/engines/statusline.test.mjs
// what-it-is:   unit tests for hooks/lib/statusline-engine.mjs (OPP-P03, studio HUD)
// what-it-does: exercises the pure helper functions (resolveProjectDir, deriveActiveChapter,
//               deriveWordTarget, formatWords, deriveGateInfo, renderStatusLine) directly
//               against synthetic objects, and the filesystem-touching functions
//               (readJsonSafe, findRootSafe, buildMainStatusLine, buildSubagentLines) against
//               small temp book roots built per test. No process spawning here; CLI-level,
//               end-to-end behavior (including the eight required cases from OPP-P03, studio
//               HUD) is covered separately in tests/engines/statusline-cli.test.mjs.
// runner:       node --test tests/engines/statusline.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  resolveProjectDir,
  readJsonSafe,
  findRootSafe,
  deriveActiveChapter,
  deriveWordTarget,
  formatWords,
  deriveGateInfo,
  renderStatusLine,
  buildMainStatusLine,
  buildSubagentLines,
  PLUGIN_NAMESPACE,
} from '../../hooks/lib/statusline-engine.mjs';

// ---------------------------------------------------------------------------
// Helper: builds a minimal valid book root under a fresh temp directory.
// Only .studio/meta.json, context/, and chapters/ are required by
// hooks/lib/bible.mjs's isBookRoot; the other files are supplied per test.
// ---------------------------------------------------------------------------

function makeMinimalBookRoot(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ns-statusline-engine-'));
  mkdirSync(join(dir, 'context'), { recursive: true });
  mkdirSync(join(dir, 'chapters'), { recursive: true });
  mkdirSync(join(dir, '.studio', 'gate'), { recursive: true });

  const meta = overrides.meta !== undefined ? overrides.meta : {
    schema_version: '2',
    created: '2026-08-10T09:00:00Z',
    plugin_version_at_creation: '0.1.0',
    book_title: 'Test Book',
  };
  writeFileSync(join(dir, '.studio', 'meta.json'), JSON.stringify(meta), 'utf8');

  if (overrides.progressRaw !== undefined) {
    writeFileSync(join(dir, '.studio', 'progress.json'), overrides.progressRaw, 'utf8');
  } else if (overrides.progress !== undefined && overrides.progress !== null) {
    writeFileSync(join(dir, '.studio', 'progress.json'), JSON.stringify(overrides.progress), 'utf8');
  }

  if (overrides.config !== undefined && overrides.config !== null) {
    writeFileSync(join(dir, '.studio', 'config.json'), JSON.stringify(overrides.config), 'utf8');
  }

  if (overrides.lastGate !== undefined && overrides.lastGate !== null) {
    writeFileSync(join(dir, '.studio', 'gate', 'last-gate.json'), JSON.stringify(overrides.lastGate), 'utf8');
  }

  return dir;
}

const cleanupDirs = [];
function trackedBookRoot(overrides) {
  const dir = makeMinimalBookRoot(overrides);
  cleanupDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- resolveProjectDir ----------------------------------------------------

test('resolveProjectDir: prefers workspace.current_dir when present', () => {
  const dir = resolveProjectDir({ cwd: '/a/cwd', workspace: { current_dir: '/b/workspace-dir' } });
  assert.equal(dir, '/b/workspace-dir');
});

test('resolveProjectDir: falls back to top-level cwd when workspace.current_dir is absent', () => {
  const dir = resolveProjectDir({ cwd: '/a/cwd' });
  assert.equal(dir, '/a/cwd');
});

test('resolveProjectDir: returns null when neither field is a usable string', () => {
  assert.equal(resolveProjectDir({}), null);
  assert.equal(resolveProjectDir({ cwd: '' }), null);
  assert.equal(resolveProjectDir({ cwd: 42 }), null);
  assert.equal(resolveProjectDir(null), null);
});

// ---- deriveActiveChapter ---------------------------------------------------

test('deriveActiveChapter: picks the first chapter with status "drafting"', () => {
  const progress = {
    chapters: [
      { slug: '01-a', status: 'final' },
      { slug: '02-b', status: 'drafting' },
      { slug: '03-c', status: 'drafting' },
    ],
  };
  const active = deriveActiveChapter(progress);
  assert.equal(active.slug, '02-b');
});

test('deriveActiveChapter: falls back to the first non-final chapter when none is drafting', () => {
  const progress = {
    chapters: [
      { slug: '01-a', status: 'final' },
      { slug: '02-b', status: 'drafted' },
      { slug: '03-c', status: 'outlined' },
    ],
  };
  const active = deriveActiveChapter(progress);
  assert.equal(active.slug, '02-b');
});

test('deriveActiveChapter: returns null when every chapter is final', () => {
  const progress = { chapters: [{ slug: '01-a', status: 'final' }, { slug: '02-b', status: 'final' }] };
  assert.equal(deriveActiveChapter(progress), null);
});

test('deriveActiveChapter: returns null on an empty chapters array', () => {
  assert.equal(deriveActiveChapter({ chapters: [] }), null);
});

test('deriveActiveChapter: returns null when progress is null or chapters is missing/malformed', () => {
  assert.equal(deriveActiveChapter(null), null);
  assert.equal(deriveActiveChapter({}), null);
  assert.equal(deriveActiveChapter({ chapters: 'not-an-array' }), null);
});

// ---- deriveWordTarget / formatWords ----------------------------------------

test('deriveWordTarget: reads config.targets.word_count when it is a positive number', () => {
  assert.equal(deriveWordTarget({ targets: { word_count: 30000 } }), 30000);
});

test('deriveWordTarget: returns null when absent, non-numeric, or non-positive', () => {
  assert.equal(deriveWordTarget(null), null);
  assert.equal(deriveWordTarget({}), null);
  assert.equal(deriveWordTarget({ targets: {} }), null);
  assert.equal(deriveWordTarget({ targets: { word_count: 'a lot' } }), null);
  assert.equal(deriveWordTarget({ targets: { word_count: 0 } }), null);
  assert.equal(deriveWordTarget({ targets: { word_count: -5 } }), null);
});

test('formatWords: renders count alone when no target', () => {
  assert.equal(formatWords(1055, null), '1055w');
});

test('formatWords: renders count against target when a target is given', () => {
  assert.equal(formatWords(1055, 30000), '1055/30000w');
});

// ---- deriveGateInfo ---------------------------------------------------------

test('deriveGateInfo: gateToken is the uppercased top-level verdict; driftBand is the stylometry check verdict', () => {
  const lastGate = {
    verdict: 'warn',
    checks: [
      { check: 'claim_coverage', verdict: 'pass' },
      { check: 'stylometry', verdict: 'block' },
    ],
  };
  const info = deriveGateInfo(lastGate);
  assert.equal(info.gateToken, 'WARN');
  assert.equal(info.driftBand, 'block');
});

test('deriveGateInfo: both fields null when lastGate is null or has no string verdict', () => {
  assert.deepEqual(deriveGateInfo(null), { gateToken: null, driftBand: null });
  assert.deepEqual(deriveGateInfo({}), { gateToken: null, driftBand: null });
});

test('deriveGateInfo: driftBand is null when no stylometry entry is present in checks', () => {
  const info = deriveGateInfo({ verdict: 'pass', checks: [{ check: 'claim_coverage', verdict: 'pass' }] });
  assert.equal(info.gateToken, 'PASS');
  assert.equal(info.driftBand, null);
});

// ---- renderStatusLine (composition + graceful per-field omission) ----------

test('renderStatusLine: composes every segment when all inputs are fully populated', () => {
  const line = renderStatusLine({
    meta: { book_title: 'The Quiet Network' },
    progress: {
      chapters: [{ slug: '01-listening-before-speaking', title: 'Listening Before Speaking', status: 'drafted', promise: 'you will learn to listen first' }],
      totals: { word_count: 1055, open_claim_count: 0 },
    },
    config: { targets: { word_count: 30000 } },
    lastGate: { verdict: 'pass', checks: [{ check: 'stylometry', verdict: 'pass' }] },
  });

  assert.ok(line.includes('The Quiet Network'), 'book title present; got: ' + line);
  assert.ok(line.includes('01-listening-before-speaking'), 'active chapter slug present; got: ' + line);
  assert.ok(line.includes('Listening Before Speaking'), 'active chapter title present; got: ' + line);
  assert.ok(line.includes('you will learn to listen first'), 'chapter promise present; got: ' + line);
  assert.ok(line.includes('1055/30000w'), 'words against target present; got: ' + line);
  assert.ok(line.includes('claims:0'), 'open claims present; got: ' + line);
  assert.ok(line.includes('drift:pass'), 'drift band present; got: ' + line);
  assert.ok(line.includes('gate:PASS'), 'gate token present; got: ' + line);
});

test('renderStatusLine: BLOCK verdict renders the literal token BLOCK', () => {
  const line = renderStatusLine({
    meta: { book_title: 'T' },
    progress: { chapters: [], totals: { word_count: 10, open_claim_count: 0 } },
    config: null,
    lastGate: { verdict: 'block', checks: [] },
  });
  assert.ok(line.includes('BLOCK'), 'gate token BLOCK present; got: ' + line);
});

test('renderStatusLine: omits chapter/words/claims segments when progress is null, but keeps gate info', () => {
  const line = renderStatusLine({
    meta: { book_title: 'T' },
    progress: null,
    config: null,
    lastGate: { verdict: 'pass', checks: [] },
  });
  assert.ok(!line.includes('claims:'), 'no claims segment; got: ' + line);
  assert.ok(!line.includes('w'), 'no words segment; got: ' + line);
  assert.ok(line.includes('gate:PASS'), 'gate token still present; got: ' + line);
});

test('renderStatusLine: omits gate/drift segments when lastGate is null', () => {
  const line = renderStatusLine({
    meta: { book_title: 'T' },
    progress: { chapters: [], totals: { word_count: 10, open_claim_count: 2 } },
    config: null,
    lastGate: null,
  });
  assert.ok(!line.includes('gate:'), 'no gate segment; got: ' + line);
  assert.ok(!line.includes('drift:'), 'no drift segment; got: ' + line);
  assert.ok(line.includes('claims:2'), 'claims still present; got: ' + line);
});

test('renderStatusLine: never throws on a completely empty context object', () => {
  assert.doesNotThrow(() => renderStatusLine({}));
});

// Self-review fix (not in the original required-case list): a chapters[] entry that is missing
// its (schema-required, but not schema-GUARANTEED against a hand-edited file) slug must never
// render the literal text "undefined" into the status bar.
test('renderStatusLine: a chapter entry with no slug is omitted, never rendered as "undefined"', () => {
  const line = renderStatusLine({
    meta: { book_title: 'T' },
    progress: {
      chapters: [{ status: 'drafting', title: 'No Slug Here' }],
      totals: { word_count: 5, open_claim_count: 0 },
    },
    config: null,
    lastGate: null,
  });
  assert.ok(!line.includes('undefined'), 'no literal "undefined" text; got: ' + line);
  assert.ok(!/\|\s*\|/.test(line), 'no empty double-pipe segment left behind; got: ' + line);
});

// ---- readJsonSafe -----------------------------------------------------------

test('readJsonSafe: returns null (never throws) for a missing file', () => {
  const dir = trackedBookRoot({});
  assert.equal(readJsonSafe(join(dir, 'does-not-exist.json')), null);
});

test('readJsonSafe: returns null (never throws) for malformed JSON', () => {
  const dir = trackedBookRoot({ progressRaw: '{ not valid json' });
  assert.equal(readJsonSafe(join(dir, '.studio', 'progress.json')), null);
});

test('readJsonSafe: returns the parsed object for valid JSON', () => {
  const dir = trackedBookRoot({ progress: { chapters: [], totals: { word_count: 0, open_claim_count: 0 } } });
  const parsed = readJsonSafe(join(dir, '.studio', 'progress.json'));
  assert.deepEqual(parsed, { chapters: [], totals: { word_count: 0, open_claim_count: 0 } });
});

// ---- findRootSafe -----------------------------------------------------------

test('findRootSafe: returns null (never throws) when no book root exists', () => {
  const bareDir = mkdtempSync(join(tmpdir(), 'ns-statusline-bare-'));
  cleanupDirs.push(bareDir);
  assert.equal(findRootSafe(bareDir), null);
});

test('findRootSafe: returns {root, meta, config} when a book root is found', () => {
  const dir = trackedBookRoot({});
  const found = findRootSafe(dir);
  assert.ok(found, 'a book root was found');
  assert.equal(found.root, dir);
  assert.equal(found.meta.book_title, 'Test Book');
});

// ---- buildMainStatusLine (integration of the above over a real temp root) --

test('buildMainStatusLine: returns empty string when the stdin event carries no usable directory', () => {
  assert.equal(buildMainStatusLine({}), '');
});

test('buildMainStatusLine: returns empty string when the directory has no book root', () => {
  const bareDir = mkdtempSync(join(tmpdir(), 'ns-statusline-bare2-'));
  cleanupDirs.push(bareDir);
  assert.equal(buildMainStatusLine({ cwd: bareDir }), '');
});

test('buildMainStatusLine: renders a populated line from a real temp book root', () => {
  const dir = trackedBookRoot({
    progress: {
      chapters: [{ slug: '01-a', status: 'drafting' }],
      totals: { word_count: 42, open_claim_count: 1 },
    },
    config: {},
    lastGate: { verdict: 'warn', checks: [{ check: 'stylometry', verdict: 'warn' }] },
  });
  const line = buildMainStatusLine({ cwd: dir });
  assert.ok(line.includes('01-a'), 'chapter present; got: ' + line);
  assert.ok(line.includes('42w'), 'words present; got: ' + line);
  assert.ok(line.includes('claims:1'), 'claims present; got: ' + line);
  assert.ok(line.includes('gate:WARN'), 'gate token present; got: ' + line);
});

test('buildMainStatusLine: degrades gracefully (no throw, still a string) when progress.json is malformed', () => {
  const dir = trackedBookRoot({ progressRaw: '{ broken' });
  assert.doesNotThrow(() => buildMainStatusLine({ cwd: dir }));
  const line = buildMainStatusLine({ cwd: dir });
  assert.equal(typeof line, 'string');
  assert.ok(!/error/i.test(line), 'no error text leaked into the line; got: ' + line);
});

// ---- buildSubagentLines ------------------------------------------------------

test('buildSubagentLines: emits one JSON line for a namespaced plugin agent task, nothing for others', () => {
  const dir = trackedBookRoot({
    progress: { chapters: [{ slug: '01-a', status: 'drafting' }], totals: { word_count: 5, open_claim_count: 0 } },
    lastGate: { verdict: 'pass', checks: [] },
  });

  const event = {
    columns: 80,
    tasks: [
      { id: 'task-1', type: PLUGIN_NAMESPACE + ':drafting-partner', cwd: dir },
      { id: 'task-2', type: 'general-purpose', cwd: dir },
    ],
  };

  const lines = buildSubagentLines(event);
  assert.equal(lines.length, 1, 'exactly one line emitted; got: ' + JSON.stringify(lines));

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.id, 'task-1');
  assert.equal(typeof parsed.content, 'string');
  assert.ok(parsed.content.length > 0);
});

test('buildSubagentLines: returns an empty array when tasks is missing or empty', () => {
  assert.deepEqual(buildSubagentLines({}), []);
  assert.deepEqual(buildSubagentLines({ tasks: [] }), []);
});

test('buildSubagentLines: a chapter entry with no slug does not render "ch undefined" in the row content', () => {
  const dir = trackedBookRoot({
    progress: { chapters: [{ status: 'drafting' }], totals: { word_count: 0, open_claim_count: 0 } },
  });
  const lines = buildSubagentLines({
    tasks: [{ id: 'task-4', type: PLUGIN_NAMESPACE + ':drafting-partner', cwd: dir }],
  });
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.ok(!parsed.content.includes('undefined'), 'no literal "undefined" text; got: ' + parsed.content);
});

test('buildSubagentLines: skips a namespaced task whose cwd has no book root (no line emitted)', () => {
  const bareDir = mkdtempSync(join(tmpdir(), 'ns-statusline-bare3-'));
  cleanupDirs.push(bareDir);
  const lines = buildSubagentLines({
    tasks: [{ id: 'task-3', type: PLUGIN_NAMESPACE + ':drafting-partner', cwd: bareDir }],
  });
  assert.deepEqual(lines, []);
});
