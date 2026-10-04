// tests/lib/adopted-books.mjs
// what-it-is:   shared builders for the foreign-layout fixture of ADR-0016 (adopting an existing
//               book)
// what-it-does: copies examples/fixtures/adopted-book/ into a temp directory, either as found
//               (pre-adoption) or with exactly what the nfs-adopt skill writes on adoption: the
//               state folder from the scaffold templates, its README, an adoption record in
//               meta.json, an optional prose boundary in config.json, seeded progress, and the
//               pointer that names the chapters folder
// why:          the lib, hook, engine and CLI suites must all adopt the fixture the same way, so
//               a change to what adoption writes is made in one place
// used-by:      the ADR-0016 suites under tests/lib, tests/hooks, tests/engines and tests/checks

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');
export const ADOPTED_FIXTURE = join(REPO_ROOT, 'examples', 'fixtures', 'adopted-book');
const SCAFFOLD_STATE = join(REPO_ROOT, 'templates', 'book-scaffold', '_nonfiction-studio');

// The fixture's own layout, spelled out once.
export const FIXTURE_CHAPTERS_DIR = 'manuscript';
export const FIXTURE_BOUNDARY = '## Drafting apparatus';
export const FIXTURE_TITLE = 'Counting What Matters';
export const FIXTURE_CHAPTER_FILES = [
  'authors-note.md',
  'ch01-the-first-question.md',
  'ch02-what-the-numbers-hid.md',
  'ch03-the-busy-teams.md',
  'introduction.md',
];
export const ELEMENTS = ['chapters', 'style', 'brief', 'structure', 'claims'];

// Spelled out rather than imported, so these builders work before bible.mjs exports them.
export const POINTER_FILE = 'nonfiction-studio.json';
export const DEFAULT_STATE_DIR = '_nonfiction-studio';

/** A temp copy of the fixture exactly as an author would bring it: no state folder, no pointer. */
export function copyFixture(label) {
  const root = join(mkdtempSync(join(tmpdir(), 'ns-adopt-' + label + '-')), 'book');
  cpSync(ADOPTED_FIXTURE, root, { recursive: true });
  return root;
}

/** The adoption record nfs-adopt writes: chapters adopted, every other element not, unless overridden. */
export function adoptionRecord({ elements = {}, sharedFolders = [{ folder: 'research', consented: null }] } = {}) {
  const states = {};
  for (const name of ELEMENTS) states[name] = name === 'chapters' ? 'adopted' : 'not-adopted';
  Object.assign(states, elements);
  return { date: '2026-10-04', elements: states, shared_folders: sharedFolders };
}

/**
 * Adopts a temp copy of the fixture the way nfs-adopt does and returns its root.
 *
 * @param {string} label
 * @param {object} [opts]
 * @param {boolean} [opts.boundary=true] - record the prose boundary in config.json
 * @param {object} [opts.elements] - element states that override the defaults
 * @param {object[]} [opts.sharedFolders] - the adoption record's shared_folders
 * @param {string} [opts.stateDir] - a non-default state-folder name, recorded in the pointer
 * @param {object|null} [opts.pointer] - the pointer's content; defaults to naming the chapters folder
 * @param {(text: string) => number} [opts.countWords] - word counter for the seeded progress; 0 when absent
 */
export function adoptFixture(label, opts = {}) {
  const {
    boundary = true,
    elements,
    sharedFolders,
    stateDir = DEFAULT_STATE_DIR,
    countWords = null,
  } = opts;
  const pointer = opts.pointer !== undefined
    ? opts.pointer
    : Object.assign({ chapters_dir: FIXTURE_CHAPTERS_DIR }, stateDir !== DEFAULT_STATE_DIR ? { state_dir: stateDir } : {});

  const root = copyFixture(label);
  const sd = join(root, stateDir);
  mkdirSync(sd, { recursive: true });
  for (const sub of ['gate', 'logs', 'snapshots']) {
    mkdirSync(join(sd, sub), { recursive: true });
    writeFileSync(join(sd, sub, '.gitkeep'), '');
  }
  writeFileSync(join(sd, 'README.md'), readFileSync(join(SCAFFOLD_STATE, 'README.md'), 'utf8'));
  writeFileSync(join(sd, 'progress.schema.json'), readFileSync(join(SCAFFOLD_STATE, 'progress.schema.json'), 'utf8'));
  writeFileSync(join(sd, 'ai-use-log.jsonl'), '');

  const meta = {
    schema_version: '2',
    created: '2026-10-04T00:00:00Z',
    plugin_version_at_creation: '0.0.0-test',
    book_title: FIXTURE_TITLE,
    adoption: adoptionRecord({ elements, sharedFolders }),
  };
  writeFileSync(join(sd, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  const config = JSON.parse(readFileSync(join(REPO_ROOT, 'templates', 'config-defaults.json'), 'utf8'));
  if (boundary) config.prose = { ends_at_heading: FIXTURE_BOUNDARY };
  writeFileSync(join(sd, 'config.json'), JSON.stringify(config, null, 2) + '\n');

  const chaptersAbs = join(root, FIXTURE_CHAPTERS_DIR);
  const files = readdirSync(chaptersAbs).filter((f) => f.endsWith('.md')).sort();
  const chapters = files.map((f) => {
    const text = readFileSync(join(chaptersAbs, f), 'utf8');
    return {
      slug: f.slice(0, -3),
      title: (text.match(/^# (.+)$/m) || [null, f.slice(0, -3)])[1].trim(),
      status: 'drafting',
      word_count: countWords ? countWords(text) : 0,
      open_claim_count: 0,
    };
  });
  const total = chapters.reduce((n, c) => n + c.word_count, 0);
  const progress = {
    version: 2,
    updated: '2026-10-04T00:00:00Z',
    chapters,
    totals: { word_count: total, open_claim_count: 0, chapters_final: 0, chapters_total: chapters.length },
  };
  writeFileSync(join(sd, 'progress.json'), JSON.stringify(progress, null, 2) + '\n');

  if (pointer !== null) writeFileSync(join(root, POINTER_FILE), JSON.stringify(pointer, null, 2) + '\n');
  return root;
}
