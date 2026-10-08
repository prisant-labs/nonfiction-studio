// tests/checks/adoption-skills.test.mjs
// what-it-is:   pin tests for the skill side of ADR-0016 (adopting an existing book)
// what-it-does: pins that every skill carrying the shared state-folder stanza declares the
//               elements it needs, that the claims-dependent skills need `claims`, that the
//               stanza resolves <chapters-dir> and stops on an unadopted element, that the
//               nfs-adopt skill plans with `ns-doctor --adopt-plan --json` and writes only after an
//               explicit yes, and that the new-book flow defers to adoption
// runner:       node --test "tests/checks/*.test.mjs" (picked up by scripts/test-engines.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, ELEMENTS } from '../lib/adopted-books.mjs';

const SKILLS = join(REPO_ROOT, 'skills');
const STANZA = '## Locate the state folder';
const ELEMENTS_LINE_RE = /^Elements this skill needs: (.+)$/m;

const skillText = (name) => readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');
const carriers = () =>
  readdirSync(SKILLS).filter((name) => existsSync(join(SKILLS, name, 'SKILL.md')) && skillText(name).includes(STANZA));

/** The declared elements of a carrier: a comma-separated list, or "none". */
function declared(name) {
  const m = skillText(name).match(ELEMENTS_LINE_RE);
  assert.ok(m, name + ' declares "Elements this skill needs:"');
  return m[1].trim() === 'none' ? [] : m[1].split(',').map((s) => s.trim());
}

test('every stanza-carrying skill declares the elements it needs, from the five', () => {
  for (const name of carriers()) {
    for (const element of declared(name)) assert.ok(ELEMENTS.includes(element), name + ': unknown element ' + element);
  }
});

test('the claims-dependent skills need claims', () => {
  for (const name of ['nfs-draft', 'nfs-research', 'nfs-fact-check', 'nfs-build-apparatus']) {
    assert.ok(declared(name).includes('claims'), name);
  }
});

test('each element-creating skill needs its own element, and nfs-outline also needs brief', () => {
  assert.deepEqual(declared('nfs-capture-voice'), ['style']);
  assert.deepEqual(declared('nfs-interview'), ['brief']);
  assert.deepEqual(declared('nfs-outline'), ['brief', 'structure']);
});

test('the stanza resolves <chapters-dir> and stops on an unadopted element', () => {
  const text = skillText('nfs-draft');
  const stanza = text.slice(text.indexOf(STANZA), text.indexOf('\n---', text.indexOf(STANZA)));
  assert.match(stanza, /<chapters-dir>/);
  assert.match(stanza, /chapters_dir/);
  assert.match(stanza, /adoption/);
  assert.match(stanza, /Elements this skill needs/);
  assert.match(stanza, /\/nonfiction-studio:nfs-adopt/);
});

test('nfs-adopt exists, plans with the doctor, and writes only after an explicit yes', () => {
  const path = join(SKILLS, 'nfs-adopt', 'SKILL.md');
  assert.ok(existsSync(path), 'skills/nfs-adopt/SKILL.md');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /^name: nfs-adopt$/m);
  assert.match(text, /ns-doctor[^\n]*--adopt-plan --json/);
  assert.match(text, /explicit yes/i);
  assert.match(text, /undo/i);
  for (const element of ['style', 'brief', 'structure']) assert.ok(text.includes('nfs-adopt ' + element), element);
});

test('nfs-new-book names nfs-adopt for existing writing and stops in an adopted book', () => {
  const text = skillText('nfs-new-book');
  const step1 = text.slice(text.indexOf('## Step 1'), text.indexOf('### Step 1a'));
  assert.match(step1, /\/nonfiction-studio:nfs-adopt/);
  assert.match(text, /adoption/);
});
