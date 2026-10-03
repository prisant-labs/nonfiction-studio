// hooks/lib/existing-writing.mjs
// what-it-is:   detection of existing writing in a directory that has no book root, per
//               ADR-0016 (adopting an existing book)
// what-it-does: walks a directory breadth-first for a Markdown file outside hidden folders and
//               files (names beginning with a dot), other than a top-level README.md, and returns
//               the first one it finds
// why:          a directory that already holds writing is somebody's manuscript; pointing it at
//               the new-book flow would stamp an empty project beside that manuscript. The
//               SessionStart hook uses this to choose its empty-state message. The new-book
//               skill applies the same definition with a shell `find`, and its behavior tests
//               pin the two to the same layouts.
// used-by:      hooks/session-start.mjs

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Hidden folders and files, at any depth, hold tool state rather than the author's writing:
// .git and .claude, but also folders such as .github, .cursor or a memory tool's store, which a
// fresh folder for a new book may well contain (ADR-0016's definition).
const isHidden = (name) => name.startsWith('.');

// The one file a fresh folder may hold without counting as writing: a repository's own README.
const TOP_LEVEL_EXEMPT = 'README.md';

const MARKDOWN_RE = /\.(md|markdown)$/i;

// Directory entries examined before the walk gives up. A manuscript's first Markdown file is
// found within a few entries; the budget only bounds a large tree with no Markdown near the top,
// such as a home directory, so the SessionStart hook stays fast everywhere it fires.
export const DEFAULT_BUDGET = 2000;

/**
 * Looks for existing writing under `dir`.
 *
 * Returns `{ found, exhausted }`. `found` is the first matching path, relative to `dir` with
 * forward slashes, or null. `exhausted` is true when the budget ran out before a match, so the
 * absence of a match is not known. Each listing is sorted by code unit, never localeCompare, so
 * the result is the same on every platform. Symbolic links are not followed: a dirent for a link
 * reports neither isFile() nor isDirectory().
 *
 * Throws when `dir` itself cannot be read; an unreadable subfolder is skipped.
 */
export function findExistingWriting(dir, { budget = DEFAULT_BUDGET } = {}) {
  const queue = [''];
  let seen = 0;
  for (let i = 0; i < queue.length; i++) {
    const rel = queue[i];
    let entries;
    try {
      entries = readdirSync(rel ? join(dir, rel) : dir, { withFileTypes: true });
    } catch (err) {
      if (!rel) throw err;
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (seen >= budget) return { found: null, exhausted: true };
      seen++;
      if (isHidden(entry.name)) continue;
      const path = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        queue.push(path);
      } else if (entry.isFile() && MARKDOWN_RE.test(entry.name) && path !== TOP_LEVEL_EXEMPT) {
        return { found: path, exhausted: false };
      }
    }
  }
  return { found: null, exhausted: false };
}
