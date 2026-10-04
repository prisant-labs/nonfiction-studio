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
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

import { runGate, writeGateReport } from '../../hooks/lib/gate-engine.mjs';
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

test('without claims, overlap never reads an author\'s evidence-log.md in a shared research folder', () => {
  const root = adopted('eng-overlap-author-ledger');
  // A real 25-word span of ch01's prose, so a gate that read this ledger would flag a lift.
  const lifted = 'She did not ask whether people had enjoyed the class. She asked what they planned to do ' +
    'the next day that they would not have done otherwise.';
  writeFileSync(join(root, 'research', 'evidence-log.md'),
    '### EV-0001 (mine)\n- claim: x\n- source: SRC-0001\n- locator:\n- confidence: high\n- status: verified\n' +
    '- added-by: author\n- date: 2026-10-04\n- verbatim: ' + lifted + '\n');
  const e = entry(runGate(root, {}).report, 'overlap');
  assert.equal(e.verdict, 'pass', JSON.stringify(e));
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

test('pruning one chapter\'s gate reports never deletes another chapter\'s that share a prefix', () => {
  const root = adopted('eng-prune');
  writeFileSync(join(root, 'manuscript', 'ch01.md'), '# One\n\nA short chapter.\n');
  writeFileSync(join(root, 'manuscript', 'ch01.x.md'), '# One, again\n\nAnother short chapter.\n');
  const gateDir = join(root, '_nonfiction-studio', 'gate');
  const others = [];
  for (let i = 10; i < 22; i++) {
    const name = 'ch01.x.20250101T0000' + i + 'Z.json';
    others.push(name);
    writeFileSync(join(gateDir, name), '{}\n');
  }
  const { report } = runGate(root, { chapterSlug: 'ch01' });
  writeGateReport(root, report);
  const left = readdirSync(gateDir);
  for (const name of others) assert.ok(left.includes(name), 'kept ' + name);
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

test('without claims, the doctor never reads an author\'s own evidence-log.md in a shared research folder', () => {
  const root = adopted('doc-author-ledger');
  // In the plugin's own grammar, with a bad status and an unknown source, so a doctor that read it
  // would report it - as the control below, with claims adopted, shows.
  const ledger =
    '# Evidence Log\n\n### EV-0001 (mine)\n- claim: x\n- source: SRC-0009\n- locator:\n- confidence: high\n' +
    '- status: maybe\n- added-by: author\n- date: 2026-10-04\n';
  const claimsTypes = (findings) => findings.filter((f) => /^ev-grammar|^src-ref|^claim-marker/.test(f.type));
  writeFileSync(join(root, 'research', 'evidence-log.md'), ledger);
  assert.deepEqual(claimsTypes(runChecks(root).findings), []);
  const control = adopted('doc-author-ledger-control', { elements: { claims: 'adopted' } });
  writeFileSync(join(control, 'research', 'evidence-log.md'), ledger);
  assert.ok(claimsTypes(runChecks(control).findings).length > 0, 'with claims adopted the same ledger is read');
});

test('a malformed adoption record is a named finding, not a silent "not adopted"', () => {
  const root = adopted('doc-bad-record');
  const metaPath = join(root, '_nonfiction-studio', 'meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  meta.adoption.elements.style = 'yes';
  meta.adoption.date = '4 October';
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  const bad = runChecks(root).findings.filter((f) => f.type === 'shape.meta-violation');
  assert.ok(bad.some((f) => /adoption\.elements\.style/.test(f.path)), JSON.stringify(bad));
  assert.ok(bad.some((f) => /adoption\.date/.test(f.path)), JSON.stringify(bad));
});

test('an adoption record that leaves chapters unadopted is a finding: adoption always adopts chapters', () => {
  const root = adopted('doc-no-chapters', { elements: { chapters: 'not-adopted' } });
  const bad = runChecks(root).findings.filter((f) => f.type === 'shape.meta-violation');
  assert.ok(bad.some((f) => /adoption\.elements\.chapters/.test(f.path)), JSON.stringify(bad));
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

test('the plan also counts each chapter\'s whole file, for an author who declines the boundary', () => {
  const root = track(copyFixture('plan-whole'));
  const { json } = plan(root);
  assert.equal(json.chapters_folder, 'manuscript');
  for (const c of json.chapters) {
    const text = readFileSync(join(root, 'manuscript', c.file), 'utf8');
    assert.equal(c.words_whole_file, countWords(text), c.file);
  }
  const ch01 = json.chapters.find((c) => c.slug === 'ch01-the-first-question');
  assert.ok(ch01.words < ch01.words_whole_file, 'the apparatus is counted only in the whole-file figure');
});

test('--chapters-dir plans another candidate folder, and refuses a folder that is not one', () => {
  const root = track(copyFixture('plan-chosen'));
  const chosen = cli('ns-doctor', ['--adopt-plan', '--json', '--chapters-dir=evidence'], root);
  assert.equal(chosen.status, 0, chosen.stderr);
  const json = JSON.parse(chosen.stdout);
  assert.equal(json.chapters_folder, 'evidence');
  assert.deepEqual(json.chapters.map((c) => c.file), ['claim-ledger.md']);
  const refused = cli('ns-doctor', ['--adopt-plan', '--json', '--chapters-dir=research'], root);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /research/);
  assert.match(refused.stderr, /manuscript/, 'the refusal names the candidates');
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

test('ns-scrub scans prose only: a template marker below the boundary is not a finding, above it is', () => {
  const root = adopted('cli-scrub-boundary');
  const ch01 = join(root, 'manuscript', 'ch01-the-first-question.md');
  const original = readFileSync(ch01, 'utf8');
  writeFileSync(ch01, original + '| [TODO] recheck the count | C1.4 | open |\n');
  const below = cli('ns-scrub', ['--all', '--json'], root);
  assert.doesNotMatch(below.stdout, /\[TODO\]/, 'the apparatus is not scanned');
  writeFileSync(ch01, original.replace(FIXTURE_BOUNDARY, 'Still to check. [TODO]\n\n' + FIXTURE_BOUNDARY));
  const above = cli('ns-scrub', ['--all', '--json'], root);
  assert.match(above.stdout, /\[TODO\]/, 'the same marker in the prose is found');
});

test('ns-stylometry --measure counts prose only for a file in the chapters folder, and raw text elsewhere', () => {
  const root = adopted('cli-measure');
  const inside = join(root, 'manuscript', 'ch01-the-first-question.md');
  const text = readFileSync(inside, 'utf8');
  const outside = join(root, 'sample.md');
  writeFileSync(outside, text);
  const measured = (path) => {
    const result = cli('ns-stylometry', ['--measure=' + path], root);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).totalWords;
  };
  assert.equal(measured(inside), proseWords(text));
  assert.equal(measured(outside), countWords(text));
  assert.notEqual(proseWords(text), countWords(text), 'the fixture chapter has an apparatus to cut');
});
