// tests/engines/adopted-book.test.mjs
// what-it-is:   engine and CLI behavior in an adopted book, per ADR-0016 (adopting an existing
//               book)
// what-it-does: runs the gate engine, the doctor engine, and the ns-* CLIs against a temp copy of
//               examples/fixtures/adopted-book/, adopted the way nfs-adopt adopts it, and pins:
//               the gate's element skips and its day-one checks, the doctor's notices for
//               unadopted elements, the read-only `ns-doctor --adopt-plan --json` report, and the
//               chapter-reading CLIs finding the book's own chapters folder
// runner:       node --test "tests/engines/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

import { runGate } from '../../hooks/lib/gate-engine.mjs';
import { runChecks } from '../../hooks/lib/doctor-engine.mjs';
import { countWords } from '../../hooks/lib/stylometry-engine.mjs';
import {
  REPO_ROOT,
  adoptFixture,
  copyFixture,
  FIXTURE_BOUNDARY,
  FIXTURE_CHAPTER_FILES,
} from '../lib/adopted-books.mjs';

const BIN = join(REPO_ROOT, 'bin');

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const track = (root) => {
  made.push(dirname(root));
  return root;
};

/** The boundary cut, spelled out here so this suite does not depend on the module it tests. */
function proseWords(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.replace(/\s+$/, '') === FIXTURE_BOUNDARY);
  return countWords(at === -1 ? text : lines.slice(0, at).join('\n') + '\n');
}

/** An adopted copy whose seeded progress carries prose-only word counts, as nfs-adopt seeds it. */
const adopted = (label, opts = {}) => track(adoptFixture(label, Object.assign({ countWords: proseWords }, opts)));

function cli(name, args, cwd) {
  const result = spawnSync('node', [join(BIN, name), ...args], { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

/** Every file under root with its size, for a read-only check. */
function snapshotTree(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(root, p) + ':' + statSync(p).size);
    }
  };
  walk(root);
  return out.sort();
}

const entry = (report, name) => report.checks.find((c) => c.check === name || c.name === name);

// ---- the gate ---------------------------------------------------------------------------------

test('the gate runs in an adopted book and never blocks on an unadopted element', () => {
  const root = adopted('eng-gate');
  const { exitCode, report } = runGate(root, {});
  assert.notEqual(exitCode, 2, 'the gate finds the book\'s own chapters folder');
  assert.ok(report, 'a report is produced');
  assert.notEqual(report.verdict, 'block');
});

test('claim_coverage and quote_fidelity skip without claims, naming the element', () => {
  const { report } = runGate(adopted('eng-claims'), {});
  for (const name of ['claim_coverage', 'quote_fidelity']) {
    const e = entry(report, name);
    assert.equal(e.verdict, 'skip', name);
    assert.match(JSON.stringify(e), /claims/, name + ' names the element');
    assert.match(JSON.stringify(e), /not adopted/, name);
  }
});

test('stylometry skips until style is adopted, naming the command that adopts it', () => {
  const e = entry(runGate(adopted('eng-style'), {}).report, 'stylometry');
  assert.equal(e.verdict, 'skip');
  assert.match(JSON.stringify(e), /style/);
  assert.match(JSON.stringify(e), /nfs-adopt style/);
});

test('an element skip is not an engine error', () => {
  const { exitCode } = runGate(adopted('eng-no-error'), {});
  assert.notEqual(exitCode, 2);
});

test('state_coherence passes: the gate measures prose only, as the seeded counts do', () => {
  const e = entry(runGate(adopted('eng-coherence'), {}).report, 'state_coherence');
  assert.equal(e.verdict, 'pass', JSON.stringify(e));
});

test('overlap reports that it had nothing to compare against rather than passing silently', () => {
  const e = entry(runGate(adopted('eng-overlap'), {}).report, 'overlap');
  assert.equal(e.verdict, 'pass');
  assert.match(e.detail, /nothing to compare|no source material/i, e.detail);
});

test('prompt_scrub and continuity run on the adopted book', () => {
  const report = runGate(adopted('eng-scrub'), {}).report;
  for (const name of ['prompt_scrub', 'continuity']) {
    const e = entry(report, name);
    assert.ok(e, name + ' is reported');
    assert.ok(!/not adopted/.test(JSON.stringify(e)), name + ' does not need an element');
  }
});

test('a single chapter with a free-form name can be gated by slug', () => {
  const { exitCode, report } = runGate(adopted('eng-slug'), { chapterSlug: 'authors-note' });
  assert.notEqual(exitCode, 2);
  assert.equal(report.chapter, 'authors-note');
});

// ---- the doctor -------------------------------------------------------------------------------

test('a freshly adopted book has no doctor findings', () => {
  const { findings } = runChecks(adopted('doc-clean'));
  assert.deepEqual(findings, []);
});

test('the doctor reports each unadopted element as a notice that names nfs-adopt', () => {
  const { notices } = runChecks(adopted('doc-notices'));
  const text = JSON.stringify(notices);
  for (const name of ['style', 'brief', 'structure', 'claims']) {
    assert.ok(notices.some((n) => n.type === 'element-not-adopted' && n.element === name), name + ': ' + text);
  }
  assert.match(text, /nfs-adopt/);
});

test('an adopted element is checked like a plugin-created book\'s', () => {
  const { findings } = runChecks(adopted('doc-style-adopted', { elements: { style: 'adopted' } }));
  assert.ok(findings.some((f) => /style-profile\.md/.test(f.path || f.message)), JSON.stringify(findings));
});

test('ns-doctor exits 0 on a freshly adopted book', () => {
  const root = adopted('doc-cli');
  const result = cli('ns-doctor', ['--json'], root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// ---- ns-doctor --adopt-plan --json --------------------------------------------------------------

function plan(root) {
  const result = cli('ns-doctor', ['--adopt-plan', '--json'], root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return { json: JSON.parse(result.stdout), raw: result.stdout };
}

test('the plan finds the chapters folder, the boundary, the shared folder, the ledger and the title', () => {
  const root = track(copyFixture('plan-shape'));
  const { json } = plan(root);
  assert.equal(json.version, 1);
  assert.equal(json.book, null);
  assert.equal(json.pointer, null);
  assert.deepEqual(json.state_folders, []);
  assert.deepEqual(json.chapters_candidates[0], { folder: 'manuscript', markdown_files: 5 });
  assert.deepEqual(json.chapters.map((c) => c.file), FIXTURE_CHAPTER_FILES);
  assert.deepEqual(json.prose_boundary, { heading: FIXTURE_BOUNDARY, files_with_heading: 3, markdown_files: 5 });
  assert.deepEqual(json.shared_folders, [{ folder: 'research', author_files: 2 }]);
  assert.deepEqual(json.ledger_candidates, ['evidence/claim-ledger.md']);
  assert.equal(json.title_candidate, 'Counting What Matters');
  assert.equal(json.git, null, 'a temp folder is not a git working tree');
});

test('the plan counts each chapter\'s words on prose only, with titles from the first heading', () => {
  const root = track(copyFixture('plan-words'));
  const ch01 = plan(root).json.chapters.find((c) => c.slug === 'ch01-the-first-question');
  const text = readFileSync(join(root, 'manuscript', 'ch01-the-first-question.md'), 'utf8');
  assert.equal(ch01.words, proseWords(text));
  assert.equal(ch01.title, 'The First Question');
});

test('the plan is read-only and byte-identical across runs', () => {
  const root = track(copyFixture('plan-pure'));
  const before = snapshotTree(root);
  const a = plan(root).raw;
  const b = plan(root).raw;
  assert.equal(a, b);
  assert.deepEqual(snapshotTree(root), before);
});

test('the plan reports an already adopted book', () => {
  const root = adopted('plan-already');
  const { json } = plan(root);
  assert.equal(json.book.adopted, true);
  assert.equal(json.pointer.valid, true);
  assert.equal(json.pointer.chapters_dir, 'manuscript');
  assert.deepEqual(json.state_folders, ['_nonfiction-studio']);
});

// ---- the chapter-reading CLIs -----------------------------------------------------------------

test('ns-scrub, ns-overlap and ns-status find the book\'s own chapters folder', () => {
  const root = adopted('cli-chapters');
  for (const [name, args] of [['ns-scrub', ['--all']], ['ns-overlap', ['--all']], ['ns-status', ['--json']]]) {
    const result = cli(name, args, root);
    assert.notEqual(result.status, 2, name + ': ' + result.stderr);
  }
  const status = cli('ns-status', ['--json'], root).stdout;
  for (const slug of ['authors-note', 'ch01-the-first-question', 'introduction']) {
    assert.ok(status.includes(slug), 'ns-status lists ' + slug);
  }
});
