// tests/lib/prose.test.mjs
// what-it-is:   unit tests for hooks/lib/prose.mjs, the prose boundary of ADR-0016 (adopting an
//               existing book)
// what-it-does: verifies proseOf (everything from the first line equal to the boundary heading
//               to the end of the file is not prose) and proseBoundaryOf (reads the setting from
//               config.json's "prose" block, and treats anything else as no boundary)
// runner:       node --test tests/lib/prose.test.mjs (or node --test tests/lib/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as prose from '../../hooks/lib/prose.mjs';
import { ADOPTED_FIXTURE, FIXTURE_BOUNDARY, FIXTURE_CHAPTERS_DIR } from './adopted-books.mjs';

const HEADING = '## Drafting apparatus';

test('proseOf drops the boundary line and everything after it', () => {
  const text = '# Title\n\nBody one.\n\n## Drafting apparatus\n\n| a | b |\n';
  assert.equal(prose.proseOf(text, HEADING), '# Title\n\nBody one.\n\n');
});

test('proseOf returns the text unchanged when there is no boundary or no matching line', () => {
  const text = '# Title\n\nBody.\n';
  assert.equal(prose.proseOf(text, null), text);
  assert.equal(prose.proseOf(text, ''), text);
  assert.equal(prose.proseOf(text, HEADING), text);
});

test('proseOf cuts at the first matching line only', () => {
  const text = 'A\n## Drafting apparatus\nB\n## Drafting apparatus\nC\n';
  assert.equal(prose.proseOf(text, HEADING), 'A\n');
});

test('proseOf matches the whole line, ignoring trailing whitespace and CR, but not a prefix or a different level', () => {
  assert.equal(prose.proseOf('A\r\n## Drafting apparatus  \r\nB\r\n', HEADING), 'A\r\n');
  assert.equal(prose.proseOf('A\n## Drafting apparatus notes\nB\n', HEADING), 'A\n## Drafting apparatus notes\nB\n');
  assert.equal(prose.proseOf('A\n### Drafting apparatus\nB\n', HEADING), 'A\n### Drafting apparatus\nB\n');
  assert.equal(prose.proseOf('A\n  ## Drafting apparatus\nB\n', HEADING), 'A\n  ## Drafting apparatus\nB\n');
});

test('proseOf tolerates trailing whitespace in the configured heading', () => {
  assert.equal(prose.proseOf('A\n## Drafting apparatus\nB\n', HEADING + '  '), 'A\n');
});

test('a boundary on the first line leaves no prose', () => {
  assert.equal(prose.proseOf('## Drafting apparatus\nB\n', HEADING), '');
});

test('proseBoundaryOf reads config.prose.ends_at_heading and nothing else', () => {
  assert.equal(prose.proseBoundaryOf({ prose: { ends_at_heading: HEADING } }), HEADING);
  for (const config of [null, undefined, {}, { prose: null }, { prose: {} }, { prose: { ends_at_heading: 7 } },
    { prose: { ends_at_heading: '   ' } }, { prose: 'x' }]) {
    assert.equal(prose.proseBoundaryOf(config), null, JSON.stringify(config));
  }
});

test('on the fixture, the boundary removes each apparatus table and leaves files without one unchanged', () => {
  const dir = join(ADOPTED_FIXTURE, FIXTURE_CHAPTERS_DIR);
  const ch01 = readFileSync(join(dir, 'ch01-the-first-question.md'), 'utf8');
  const cut = prose.proseOf(ch01, FIXTURE_BOUNDARY);
  assert.ok(cut.includes('the piles told her more than nine years of rows'));
  assert.ok(!cut.includes('C1.1'), 'the apparatus table is not prose');
  const note = readFileSync(join(dir, 'authors-note.md'), 'utf8');
  assert.equal(prose.proseOf(note, FIXTURE_BOUNDARY), note);
});
