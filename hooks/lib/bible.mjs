// what-it-is:   book root locator and bible read/write helpers
// what-it-does: walks up from a start directory to find the book root, reads meta.json and config.json,
//               and provides atomic progress.json read/write with unknown-field preservation
// why:          all engine CLIs and hooks share the same root-finding and bible-access logic;
//               one module eliminates drift across the seven of the eight shipped CLIs and all
//               six hook scripts that import it (thirteen importers total)
// used-by:      imported by seven of the eight CLIs under bin/ (ns-claims, ns-doctor, ns-gate,
//               ns-notes, ns-scrub, ns-status, ns-stylometry; not ns-statusline) and by all six
//               hook scripts under hooks/

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

/**
 * Typed error for the exit-2 class (operational errors: missing required files,
 * invalid JSON, incompatible schema version, book root not found).
 * Callers catch BibleError and exit with code 2.
 */
export class BibleError extends Error {
  constructor(message, code = 'BIBLE_ERROR') {
    super(message);
    this.name = 'BibleError';
    this.code = code;
    this.exitCode = 2;
  }
}

/**
 * Returns true if the given directory is a valid book root.
 * A valid book root contains .studio/meta.json AND has both context/ and chapters/ siblings.
 *
 * @param {string} dir - absolute directory path to test
 * @returns {boolean}
 */
function isBookRoot(dir) {
  return (
    existsSync(join(dir, '.studio', 'meta.json')) &&
    existsSync(join(dir, 'context')) &&
    existsSync(join(dir, 'chapters'))
  );
}

/**
 * Reads and parses meta.json and config.json from a confirmed book root.
 * Returns { root, meta, config } where config is null when config.json is absent.
 * Throws BibleError if meta.json is missing or contains invalid JSON.
 *
 * @param {string} root - absolute path to the confirmed book root
 * @returns {{ root: string, meta: object, config: object|null }}
 */
function loadBible(root) {
  const metaPath = join(root, '.studio', 'meta.json');
  const configPath = join(root, '.studio', 'config.json');

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (err) {
    throw new BibleError(
      'Cannot read meta.json at ' + metaPath + ': ' + err.message,
      'META_READ_ERROR'
    );
  }

  let config = null;
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new BibleError(
        'Cannot read config.json at ' + configPath + ': ' + err.message,
        'CONFIG_READ_ERROR'
      );
    }
  }

  return { root, meta, config };
}

/**
 * Walks up from startDir to locate the book root.
 *
 * Supports two layouts:
 *   1. Direct book root: the given directory itself contains .studio/meta.json
 *      with context/ and chapters/ siblings.
 *   2. book/ subdirectory layout: the given directory contains a book/ subdirectory
 *      that is itself a valid book root.
 *
 * @param {string} startDir - the directory to start walking from (any depth inside or at a book root)
 * @returns {{ root: string, meta: object, config: object|null }}
 * @throws {BibleError} with exitCode 2 when no book root is found
 */
export function findBookRoot(startDir) {
  let current = resolve(startDir);

  for (;;) {
    // Layout 1: the directory itself is the book root.
    if (isBookRoot(current)) {
      return loadBible(current);
    }

    // Layout 2: a book/ subdirectory is the book root.
    const bookSub = join(current, 'book');
    if (isBookRoot(bookSub)) {
      return loadBible(bookSub);
    }

    // Walk up one level. Stop at the filesystem root (dirname of root is itself).
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new BibleError(
    'No book root found walking up from: ' + startDir,
    'NO_BOOK_ROOT'
  );
}

/**
 * Reads .studio/progress.json from the book root and returns the parsed object.
 *
 * @param {string} root - absolute path to the book root
 * @returns {object}
 * @throws {BibleError} with exitCode 2 when the file is missing or contains invalid JSON
 */
export function readProgress(root) {
  const progressPath = join(root, '.studio', 'progress.json');
  try {
    return JSON.parse(readFileSync(progressPath, 'utf8'));
  } catch (err) {
    throw new BibleError(
      'Cannot read progress.json at ' + progressPath + ': ' + err.message,
      'PROGRESS_READ_ERROR'
    );
  }
}

/**
 * Writes .studio/progress.json atomically (temp file then rename) to prevent partial writes.
 * Performs a read-modify-write cycle so unknown fields added by future schema versions
 * are preserved rather than discarded, satisfying S-08 (schemas and file formats) Rule 2.
 *
 * On success, no .tmp file remains. On failure, a BibleError is thrown and the original
 * progress.json is left untouched.
 *
 * @param {string} root - absolute path to the book root
 * @param {object} obj  - fields to merge over the existing progress object (shallow merge)
 * @throws {BibleError} with exitCode 2 when the write or rename fails
 */
export function writeProgressAtomic(root, obj) {
  const progressPath = join(root, '.studio', 'progress.json');
  const tmpPath = join(root, '.studio', 'progress.tmp.json');

  // Read existing content to preserve unknown fields (read-modify-write pattern).
  let existing = {};
  if (existsSync(progressPath)) {
    try {
      existing = JSON.parse(readFileSync(progressPath, 'utf8'));
    } catch {
      // If the existing file is corrupt, start from obj only.
    }
  }

  const merged = Object.assign({}, existing, obj);

  try {
    writeFileSync(tmpPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    renameSync(tmpPath, progressPath);
  } catch (err) {
    throw new BibleError(
      'Cannot write progress.json at ' + progressPath + ': ' + err.message,
      'PROGRESS_WRITE_ERROR'
    );
  }
}
