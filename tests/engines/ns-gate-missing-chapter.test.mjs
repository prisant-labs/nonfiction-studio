// what-it-is:   CLI regression tests for ns-gate --chapter naming a chapter that does not exist
// what-it-does: runs the shipped bin/ns-gate against a disposable copy of the sample book and
//               asserts that a missing --chapter target exits 2 with "chapter not found" and
//               writes no gate report, while a real chapter and an empty whole book still gate
// why:          before this guard, a missing --chapter target exited 0 and wrote a report whose
//               verdict was "pass", even in block mode, because every check saw no chapters to
//               scan. The sibling CLIs (ns-claims, ns-stylometry, ns-scrub, ns-overlap) already
//               exit 2 with "chapter not found"; the ns-gate reference page promises exit 2 for an
//               argument error. Found by the 2026-11-17 audit (missing-chapter pass).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, '..', '..', 'examples', 'sample-book');
const NS_GATE = join(__dirname, '..', '..', 'bin', 'ns-gate');
const REAL_SLUG = '01-listening-before-speaking';

function cloneBook() {
  const base = join(os.tmpdir(), 'ns-gate-missing-chapter-test');
  mkdirSync(base, { recursive: true });
  const tmp = mkdtempSync(base + '/clone-');
  cpSync(GOLDEN, tmp, { recursive: true });
  // Block mode, so a false pass cannot hide behind the warn cap.
  const configPath = join(tmp, '_nonfiction-studio', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.gate = config.gate || {};
  config.gate.mode = 'block';
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return tmp;
}

function gateReports(tmp) {
  const dir = join(tmp, '_nonfiction-studio', 'gate');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function runGateCli(tmp, args) {
  return spawnSync(process.execPath, [NS_GATE, '--project=' + tmp, ...args], { cwd: tmp, encoding: 'utf8' });
}

test('ns-gate: a --chapter that does not exist exits 2, names the path, and writes no report', () => {
  const tmp = cloneBook();
  try {
    const before = gateReports(tmp);
    const r = runGateCli(tmp, ['--chapter=99-does-not-exist', '--json']);
    assert.equal(r.status, 2, 'exit code; stdout=' + r.stdout.slice(0, 200));
    assert.match(r.stderr, /ns-gate: chapter not found: .*99-does-not-exist\.md/);
    assert.equal(r.stdout.includes('"verdict": "pass"'), false, 'no passing report on stdout');
    assert.deepEqual(gateReports(tmp), before, 'no gate report written for a missing chapter');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ns-gate: a --chapter in a book whose chapters folder is empty also exits 2', () => {
  const tmp = cloneBook();
  try {
    for (const f of readdirSync(join(tmp, 'chapters'))) rmSync(join(tmp, 'chapters', f));
    const r = runGateCli(tmp, ['--chapter=' + REAL_SLUG, '--json']);
    assert.equal(r.status, 2, 'exit code; stdout=' + r.stdout.slice(0, 200));
    assert.match(r.stderr, /ns-gate: chapter not found: /);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ns-gate control: a real --chapter still gates and writes a report', () => {
  const tmp = cloneBook();
  try {
    const before = gateReports(tmp);
    const r = runGateCli(tmp, ['--chapter=' + REAL_SLUG, '--json']);
    assert.notEqual(r.status, 2, 'a real chapter is not an argument error; stderr=' + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.chapter, REAL_SLUG);
    assert.equal(gateReports(tmp).length, before.length + 1, 'one new gate report');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ns-gate control: a whole-book run with no chapters is not an argument error', () => {
  const tmp = cloneBook();
  try {
    for (const f of readdirSync(join(tmp, 'chapters'))) rmSync(join(tmp, 'chapters', f));
    const r = runGateCli(tmp, ['--json']);
    assert.notEqual(r.status, 2, 'an empty book with no selector keeps its behavior; stderr=' + r.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
