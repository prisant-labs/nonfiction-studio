// what-it-is:   book root locator and bible read/write helpers
// what-it-does: walks up from a start directory to find the book root, reads meta.json and config.json,
//               and provides atomic progress.json read/write with unknown-field preservation
// why:          all engine CLIs and hooks share the same root-finding and bible-access logic;
//               one module eliminates drift across every caller that needs the book root or
//               progress.json
// used-by:      every CLI under bin/ imports this directly except ns-statusline, which reaches
//               it one hop away through hooks/lib/statusline-engine.mjs; also imported directly
//               by every hook script under hooks/, and under hooks/lib/ by orientation.mjs and
//               statusline-engine.mjs. Stated as a rule rather than a count on purpose: the
//               previous wording carried "thirteen importers total" against a true fifteen, and
//               a count here is checked by nothing. The tradeoff is that this rule is also
//               unchecked, and a future CLI that does NOT import this module would falsify it.

import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
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
 * The state folder: the one directory at the book root that holds the machine-managed
 * records (meta.json, config.json, progress.json, the AI-use log, gate reports, logs,
 * snapshots). Every hook, engine, and CLI reaches it through stateDirNameOf / stateDirOf
 * below, never through a literal, so its name is decided in exactly one place
 * (ADR-0015, state folder name).
 */
export const DEFAULT_STATE_DIR = '.studio';

/**
 * The committed pointer file at a book root. Present only in a book whose state folder has
 * a non-default name: { "state_dir": "<name>" }. Read only from the book root itself, never
 * from an ancestor, so a pointer can never govern more than one book.
 */
export const POINTER_FILE = 'nonfiction-studio.json';

// One folder name: ASCII letters, digits, "_", "-", "."; 1 to 64 characters.
const STATE_DIR_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

// Names a state folder may never take. The research-librarian's write scope follows the state
// folder (hooks/lib/agent-identity.mjs), so a pointer naming a bible folder would widen that
// scope into the manuscript, and one naming .claude would let it plant a project skill.
const RESERVED_STATE_DIR_NAMES = ['context', 'structure', 'research', 'chapters', 'production', '.git', '.claude'];

/**
 * Checks a candidate state-folder name. Returns null when valid, or a one-clause reason.
 * Reserved names are compared without regard to case on win32 only (F-HK-13 convention:
 * folding on a case-sensitive filesystem would treat different folders as one).
 *
 * @param {*} name - the value of a pointer's state_dir
 * @param {string} [platform] - defaults to process.platform; injectable for tests
 * @returns {string|null}
 */
export function validateStateDirName(name, platform = process.platform) {
  if (typeof name !== 'string') {
    return 'state_dir must be a string';
  }
  if (!STATE_DIR_NAME_RE.test(name)) {
    return 'state_dir must be one folder name of 1 to 64 ASCII letters, digits, "_", "-" or "."';
  }
  if (name === '.' || name === '..') {
    return 'state_dir may not be "." or ".."';
  }
  const compared = platform === 'win32' ? name.toLowerCase() : name;
  if (RESERVED_STATE_DIR_NAMES.includes(compared)) {
    return 'state_dir may not name the reserved folder "' + name + '"';
  }
  return null;
}

/**
 * Builds the bad-pointer error: the corrupt-bible class, which write guards treat as
 * fail-closed. Carries the book root and the pointer path so a caller can tell the author
 * exactly which file to repair, and so the write guard can let that one repair through.
 */
function pointerError(root, reason) {
  const pointerPath = join(root, POINTER_FILE);
  const err = new BibleError(
    'Bad state-folder pointer at ' + pointerPath + ': ' + reason + '. Repair or remove ' +
      POINTER_FILE + ', or run /nonfiction-studio:nfs-doctor.',
    'STATE_POINTER_INVALID'
  );
  err.root = root;
  err.pointerPath = pointerPath;
  return err;
}

/**
 * Returns the state folder's name (a single path segment) for the given book root: the
 * pointer's state_dir when a pointer exists, otherwise DEFAULT_STATE_DIR. A pointer that is
 * unreadable, malformed, or carries an invalid name throws STATE_POINTER_INVALID; it never
 * falls back to the default, because a fallback would split the book's records across two
 * folders (ADR-0015).
 *
 * @param {string} root - absolute path to the book root
 * @param {string} [platform] - defaults to process.platform; injectable for tests
 * @returns {string}
 * @throws {BibleError} code STATE_POINTER_INVALID on a bad pointer
 */
export function stateDirNameOf(root, platform = process.platform) {
  const pointerPath = join(root, POINTER_FILE);
  if (!existsSync(pointerPath)) {
    return DEFAULT_STATE_DIR;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(pointerPath, 'utf8'));
  } catch (err) {
    throw pointerError(root, 'it is not readable JSON (' + err.message + ')');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw pointerError(root, 'it must be a JSON object');
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'state_dir')) {
    throw pointerError(root, 'it has no "state_dir" key');
  }
  const reason = validateStateDirName(data.state_dir, platform);
  if (reason) {
    throw pointerError(root, reason);
  }
  return data.state_dir;
}

/**
 * Returns the absolute path of the state folder for the given book root.
 *
 * @param {string} root - absolute path to the book root
 * @param {string} [platform] - defaults to process.platform; injectable for tests
 * @returns {string}
 * @throws {BibleError} code STATE_POINTER_INVALID on a bad pointer
 */
export function stateDirOf(root, platform = process.platform) {
  return join(root, stateDirNameOf(root, platform));
}

/**
 * Lists the immediate child folders of `root` that carry the state-folder signature
 * (meta.json and progress.json), sorted by code point. Used only on the failure path, when
 * a directory has the bible folders but nothing at its resolved state-folder name, so a
 * healthy book never pays for the scan.
 *
 * @param {string} root - absolute directory path
 * @returns {string[]}
 */
export function findStateFolderCandidates(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (existsSync(join(dir, 'meta.json')) && existsSync(join(dir, 'progress.json'))) {
      names.push(entry.name);
    }
  }
  // Plain code-unit comparison, never localeCompare: ICU ordering differs across Node builds.
  return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Tests one directory as a book root. Returns the loaded bible when it is one, null when it
 * is not (keep walking), and throws when it has the bible folders but its state folder is
 * missing behind a pointer (STATE_POINTER_INVALID) or sits under an unexpected name
 * (NO_BOOK_ROOT carrying the candidates, so hooks stay silent while session start and the
 * doctor name the folder). The walk stops there rather than attaching to an enclosing book.
 *
 * @param {string} dir - absolute directory path to test
 * @param {string} platform
 * @returns {object|null}
 */
function tryBookRoot(dir, platform) {
  if (!existsSync(join(dir, 'context')) || !existsSync(join(dir, 'chapters'))) {
    return null;
  }
  const hasPointer = existsSync(join(dir, POINTER_FILE));
  const name = stateDirNameOf(dir, platform);
  if (existsSync(join(dir, name, 'meta.json'))) {
    return loadBible(dir, name);
  }
  if (hasPointer) {
    throw pointerError(
      dir,
      'it names the state folder "' + name + '", which ' +
        (existsSync(join(dir, name)) ? 'holds no meta.json' : 'does not exist')
    );
  }
  const candidates = findStateFolderCandidates(dir);
  if (candidates.length > 0) {
    const err = new BibleError(
      'Book project found at ' + dir + ', but its records are in ' +
        candidates.map((c) => '"' + c + '"').join(', ') + ', and this plugin expects "' +
        DEFAULT_STATE_DIR + '". Run /nonfiction-studio:nfs-doctor to rename the folder or to ' +
        'record its name in ' + POINTER_FILE + '.',
      'NO_BOOK_ROOT'
    );
    err.root = dir;
    err.candidates = candidates;
    throw err;
  }
  return null;
}

/**
 * Reads and parses meta.json and config.json from a confirmed book root.
 * Returns { root, meta, config, stateDir, stateDirName } where config is null when
 * config.json is absent, stateDir is the state folder's absolute path, and stateDirName
 * is its name.
 * Throws BibleError if meta.json is missing or contains invalid JSON.
 *
 * @param {string} root - absolute path to the confirmed book root
 * @param {string} stateDirName - the book's resolved state-folder name
 * @returns {{ root: string, meta: object, config: object|null, stateDir: string, stateDirName: string }}
 */
function loadBible(root, stateDirName) {
  const stateDir = join(root, stateDirName);
  const metaPath = join(stateDir, 'meta.json');
  const configPath = join(stateDir, 'config.json');

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

  return { root, meta, config, stateDir, stateDirName };
}

/**
 * Walks up from startDir to locate the book root.
 *
 * Supports two layouts:
 *   1. Direct book root: the given directory itself holds meta.json in its state
 *      folder, with context/ and chapters/ siblings.
 *   2. book/ subdirectory layout: the given directory contains a book/ subdirectory
 *      that is itself a valid book root.
 *
 * In both layouts the pointer is read from the directory being tested as the root. A
 * directory with the bible folders but a missing or misnamed state folder stops the walk
 * with an error (see tryBookRoot) instead of attaching the search to an enclosing book.
 *
 * @param {string} startDir - the directory to start walking from (any depth inside or at a book root)
 * @param {string} [platform] - defaults to process.platform; injectable for tests
 * @returns {{ root: string, meta: object, config: object|null, stateDir: string, stateDirName: string }}
 * @throws {BibleError} with exitCode 2: NO_BOOK_ROOT when no book root is found (with
 *   err.root and err.candidates when an unpointed state folder was found), or
 *   STATE_POINTER_INVALID (with err.root and err.pointerPath) on a bad pointer
 */
export function findBookRoot(startDir, platform = process.platform) {
  let current = resolve(startDir);

  for (;;) {
    // Layout 1: the directory itself is the book root.
    const direct = tryBookRoot(current, platform);
    if (direct) {
      return direct;
    }

    // Layout 2: a book/ subdirectory is the book root.
    const nested = tryBookRoot(join(current, 'book'), platform);
    if (nested) {
      return nested;
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
 * Reads progress.json from the book's state folder and returns the parsed object.
 *
 * @param {string} root - absolute path to the book root
 * @returns {object}
 * @throws {BibleError} with exitCode 2 when the file is missing or contains invalid JSON
 */
export function readProgress(root) {
  const progressPath = join(stateDirOf(root), 'progress.json');
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
 * Writes the state folder's progress.json atomically (temp file then rename) to prevent
 * partial writes.
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
  const progressPath = join(stateDirOf(root), 'progress.json');
  const tmpPath = join(stateDirOf(root), 'progress.tmp.json');

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
