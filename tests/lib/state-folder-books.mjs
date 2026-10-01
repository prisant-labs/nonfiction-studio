// tests/lib/state-folder-books.mjs
// what-it-is:   shared builders for throwaway book projects with a chosen state-folder layout
// what-it-does: creates minimal books (context/, chapters/, a state folder, an optional
//               pointer file) and full clones of the sample book whose state folder is
//               renamed, so tests can exercise ADR-0015 (state folder name) layouts
// why:          the lib, hook, and CLI suites all need the same layouts; one builder keeps
//               the pointer file name and the state folder's minimum contents in one place
// used-by:      tests/lib/state-folder.test.mjs, tests/hooks/state-folder-hooks.test.mjs

import { mkdirSync, mkdtempSync, writeFileSync, cpSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { DEFAULT_STATE_DIR } from '../../hooks/lib/bible.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');
export const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// The committed pointer file at a book root (ADR-0015). Spelled out here rather than imported,
// so these builders keep working against a bible.mjs that does not yet export the constant.
export const POINTER_FILE = 'nonfiction-studio.json';

/** A fresh, empty temp directory. */
export function makeTmpDir(label) {
  return mkdtempSync(join(tmpdir(), 'ns-state-' + label + '-'));
}

/**
 * Writes a minimal state folder named `name` under `root`: meta.json, config.json, and
 * progress.json, which is the content signature the unpointed-folder detector looks for.
 */
export function writeStateFolder(root, name, { withProgress = true } = {}) {
  const sd = join(root, name);
  mkdirSync(sd, { recursive: true });
  writeFileSync(
    join(sd, 'meta.json'),
    JSON.stringify({ schema_version: '2', book_title: 'State folder test' }, null, 2) + '\n',
    'utf8'
  );
  writeFileSync(join(sd, 'config.json'), JSON.stringify({ version: 1 }, null, 2) + '\n', 'utf8');
  if (withProgress) {
    writeFileSync(join(sd, 'progress.json'), JSON.stringify({ chapters: [] }, null, 2) + '\n', 'utf8');
  }
  return sd;
}

/**
 * Writes the pointer file at `root`. An object is written as JSON; a string is written raw,
 * so tests can plant malformed pointers.
 */
export function writePointer(root, pointer) {
  const text = typeof pointer === 'string' ? pointer : JSON.stringify(pointer, null, 2) + '\n';
  writeFileSync(join(root, POINTER_FILE), text, 'utf8');
}

/**
 * Builds a minimal book: context/ and chapters/, plus an optional state folder and an optional
 * pointer. With `parent`, the book is created at parent/<label>; otherwise in a fresh temp dir.
 */
export function makeBook({ label = 'book', parent = null, stateDir = null, pointer, withProgress = true } = {}) {
  const root = parent ? join(parent, label) : makeTmpDir(label);
  mkdirSync(join(root, 'context'), { recursive: true });
  mkdirSync(join(root, 'chapters'), { recursive: true });
  if (stateDir) writeStateFolder(root, stateDir, { withProgress });
  if (pointer !== undefined) writePointer(root, pointer);
  return root;
}

/**
 * Clones the sample book into a temp dir and renames its state folder from the default name to
 * `name`. With `pointer: true`, also writes a valid pointer naming `name`.
 */
export function cloneSampleBookWithStateDir(label, name, { pointer = true } = {}) {
  const root = makeTmpDir(label);
  cpSync(SAMPLE_BOOK, root, { recursive: true });
  if (name !== DEFAULT_STATE_DIR) {
    renameSync(join(root, DEFAULT_STATE_DIR), join(root, name));
  }
  if (pointer) writePointer(root, { state_dir: name });
  return root;
}
