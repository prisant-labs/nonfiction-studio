// tests/lib/adoption.test.mjs
// what-it-is:   unit tests for hooks/lib/adoption.mjs and for the agent write scopes that follow
//               an adopted book's layout, per ADR-0016 (adopting an existing book)
// what-it-does: verifies the adoption record helpers (a book with no record has every element
//               adopted; an adopted book reads each element's state, failing closed on anything
//               unexpected), and pins every computed and narrowed agent write scope: the drafting
//               agents follow the resolved chapters folder, and in a shared folder the
//               research-librarian and structure-architect reach only the plugin's own files
// runner:       node --test tests/lib/adoption.test.mjs (or node --test tests/lib/)
//
// The security section of ADR-0016 requires a test for each narrowed scope: a missed narrowing
// fails open for the author's own files.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

import * as adoption from '../../hooks/lib/adoption.mjs';
import { checkAgentWriteConstraint } from '../../hooks/lib/agent-identity.mjs';
import { makeBook } from './state-folder-books.mjs';
import { adoptFixture, adoptionRecord, ELEMENTS, FIXTURE_CHAPTERS_DIR } from './adopted-books.mjs';

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const track = (root) => {
  made.push(dirname(root));
  return root;
};
const allow = (agent, target, root) => checkAgentWriteConstraint(agent, target, root, 'linux');

// ---- the adoption record --------------------------------------------------------------------

test('the module names the five elements in the record\'s order', () => {
  assert.deepEqual(adoption.ELEMENTS, ELEMENTS);
});

test('a book with no adoption record has every element adopted and no shared folders', () => {
  const a = adoption.adoptionOf({ schema_version: '2' });
  assert.equal(a.adopted, false);
  for (const name of ELEMENTS) assert.equal(adoption.isAdopted({ schema_version: '2' }, name), true, name);
  assert.deepEqual(a.sharedFolders, []);
});

test('an adopted book reads each element\'s state from the record', () => {
  const meta = { adoption: adoptionRecord({ elements: { style: 'adopted' } }) };
  const a = adoption.adoptionOf(meta);
  assert.equal(a.adopted, true);
  assert.equal(a.date, '2026-10-04');
  assert.equal(adoption.isAdopted(meta, 'chapters'), true);
  assert.equal(adoption.isAdopted(meta, 'style'), true);
  for (const name of ['brief', 'structure', 'claims']) assert.equal(adoption.isAdopted(meta, name), false, name);
  assert.deepEqual(a.sharedFolders, [{ folder: 'research', consented: null }]);
  assert.deepEqual(adoption.unadoptedElements(meta), ['brief', 'structure', 'claims']);
});

test('an adopted book fails closed: a missing or unknown element state reads as not adopted', () => {
  const meta = { adoption: { date: '2026-10-04', elements: { chapters: 'adopted', style: 'yes' } } };
  for (const name of ['style', 'brief', 'structure', 'claims']) assert.equal(adoption.isAdopted(meta, name), false, name);
  assert.equal(adoption.isAdopted({ adoption: 'garbage' }, 'style'), false, 'a malformed record is an adopted book');
});

test('shared_folders keeps only well-formed entries, sorted by folder', () => {
  const meta = {
    adoption: {
      elements: {},
      shared_folders: [{ folder: 'structure', consented: '2026-10-05' }, { folder: 'research' }, 'context', { folder: 7 }],
    },
  };
  assert.deepEqual(adoption.adoptionOf(meta).sharedFolders, [
    { folder: 'research', consented: null },
    { folder: 'structure', consented: '2026-10-05' },
  ]);
});

test('an unknown element name is an error, not a silent false', () => {
  assert.throws(() => adoption.isAdopted({}, 'chapter'), /element/);
});

test('PLUGIN_FILES names the plugin\'s own files in each bible folder', () => {
  assert.deepEqual(adoption.PLUGIN_FILES.research, ['evidence-log.md', 'open-questions.md', 'packets/', 'sources.md']);
  assert.ok(adoption.PLUGIN_FILES.structure.includes('chapter-list.md'));
  assert.ok(adoption.PLUGIN_FILES.context.includes('style-profile.md'));
});

// ---- the drafting agents follow the resolved chapters folder --------------------------------

test('drafting-partner and line-editor may write in an adopted book\'s chapters folder', () => {
  const root = track(adoptFixture('scope-chapters'));
  for (const agent of ['drafting-partner', 'line-editor']) {
    assert.equal(allow(agent, join(root, FIXTURE_CHAPTERS_DIR, 'ch01-the-first-question.md'), root), null, agent);
  }
});

test('in an adopted book, a folder named chapters/ is outside the drafting agents\' scope [fails open if the table keeps a literal chapters/]', () => {
  const root = track(adoptFixture('scope-literal'));
  mkdirSync(join(root, 'chapters'));
  for (const agent of ['drafting-partner', 'line-editor']) {
    const reason = allow(agent, join(root, 'chapters', 'x.md'), root);
    assert.equal(typeof reason, 'string', agent);
    assert.ok(reason.includes(FIXTURE_CHAPTERS_DIR + '/'), 'the deny reason names the resolved folder: ' + reason);
  }
});

test('a plugin-created book keeps chapters/ as the drafting agents\' scope', () => {
  const root = makeBook({ label: 'scope-plugin', stateDir: '_nonfiction-studio' });
  assert.equal(allow('drafting-partner', join(root, 'chapters', '01-a.md'), root), null);
  assert.equal(typeof allow('drafting-partner', join(root, 'context', 'brief.md'), root), 'string');
});

// ---- narrowed scopes in a shared folder (one test per narrowed scope) -----------------------

test('research-librarian in a shared research/ reaches only the plugin\'s research files', () => {
  const root = track(adoptFixture('scope-librarian'));
  for (const file of ['evidence-log.md', 'sources.md', 'open-questions.md', join('packets', '01-x.md')]) {
    assert.equal(allow('research-librarian', join(root, 'research', file), root), null, file);
  }
  for (const file of ['interview-guide.md', 'ethics-protocol.md', 'new-notes.md', join('packets-old', 'x.md')]) {
    const reason = allow('research-librarian', join(root, 'research', file), root);
    assert.equal(typeof reason, 'string', file + ' must be denied');
  }
  assert.equal(allow('research-librarian', join(root, '_nonfiction-studio', 'fetch-log.jsonl'), root), null, 'the state folder is unchanged');
});

test('structure-architect in a shared research/ reaches only the plugin\'s research files', () => {
  const root = track(adoptFixture('scope-architect'));
  assert.equal(allow('structure-architect', join(root, 'research', 'open-questions.md'), root), null);
  assert.equal(typeof allow('structure-architect', join(root, 'research', 'interview-guide.md'), root), 'string');
  assert.equal(allow('structure-architect', join(root, 'structure', 'outline.md'), root), null, 'an unshared folder is unchanged');
});

test('a shared structure/ narrows structure-architect and thesis-architect alike', () => {
  const root = track(adoptFixture('scope-structure', { sharedFolders: [{ folder: 'structure', consented: '2026-10-05' }] }));
  for (const agent of ['structure-architect', 'thesis-architect']) {
    assert.equal(allow(agent, join(root, 'structure', 'thesis.md'), root), null, agent);
    assert.equal(typeof allow(agent, join(root, 'structure', 'my-plan.md'), root), 'string', agent);
  }
});

test('a shared context/ narrows thesis-architect to the plugin\'s context files', () => {
  const root = track(adoptFixture('scope-context', { sharedFolders: [{ folder: 'context', consented: null }] }));
  assert.equal(allow('thesis-architect', join(root, 'context', 'brief.md'), root), null);
  assert.equal(typeof allow('thesis-architect', join(root, 'context', 'style-guide.md'), root), 'string');
});

test('narrowing applies whether or not consent is recorded', () => {
  const root = track(adoptFixture('scope-consented', { sharedFolders: [{ folder: 'research', consented: '2026-10-05' }] }));
  assert.equal(typeof allow('research-librarian', join(root, 'research', 'interview-guide.md'), root), 'string');
});

test('narrowed scopes compare without regard to case on win32 only', () => {
  const root = track(adoptFixture('scope-case'));
  assert.equal(checkAgentWriteConstraint('research-librarian', join(root, 'Research', 'Evidence-Log.md'), root, 'win32'), null);
  assert.equal(typeof checkAgentWriteConstraint('research-librarian', join(root, 'research', 'Evidence-Log.md'), root, 'linux'), 'string');
});
