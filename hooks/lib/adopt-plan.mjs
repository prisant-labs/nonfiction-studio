// hooks/lib/adopt-plan.mjs
// what-it-is:   the adoption plan of ADR-0016 (adopting an existing book), behind
//               `ns-doctor --adopt-plan --json`
// what-it-does: reads one directory, without walking up and without writing, and reports what
//               adopting it would involve: candidate chapters folders and their chapters, a
//               repeated trailing heading to propose as the prose boundary, bible folders that
//               already hold the author's files, files that look like a claim ledger, the title
//               of the top-level README, and any state folder or pointer already present
// why:          nfs-adopt shows this plan and asks before it writes anything. A plan that is
//               deterministic and read-only can be tested before the skill that uses it, and it
//               keeps the skill from guessing at a layout it can measure.
// used-by:      bin/ns-doctor (which adds the git probe: this module never spawns a process)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_STATE_DIR, LEGACY_STATE_DIR, POINTER_FILE,
  readPointer, tryBookRoot, findStateFolderCandidates, validateChaptersDirName,
} from './bible.mjs';
import { PLUGIN_FILES, adoptionOf } from './adoption.mjs';
import { proseOf } from './prose.mjs';
import { countWords } from './stylometry-engine.mjs';

/** Plain code-unit order, never localeCompare: ICU ordering differs across Node builds. */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const isHidden = (name) => name.startsWith('.');
const trimEnd = (line) => line.replace(/\s+$/, '');

/** Directory entries sorted by name; an unreadable directory has none. */
function entriesOf(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => byCodeUnit(a.name, b.name));
  } catch {
    return [];
  }
}

/** The .md files directly in dir, by name, hidden files excluded. */
function markdownFilesIn(dir) {
  return entriesOf(dir).filter((e) => e.isFile() && !isHidden(e.name) && e.name.endsWith('.md')).map((e) => e.name);
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The text of the first level-1 heading, or null. */
function firstH1(text) {
  for (const line of text.split('\n')) {
    const m = /^# (.+)$/.exec(trimEnd(line));
    if (m) return m[1].trim();
  }
  return null;
}

/** The last level-2 heading line of a file, trailing whitespace removed, or null. */
function lastH2(text) {
  let last = null;
  for (const line of text.split('\n')) {
    const t = trimEnd(line);
    if (/^## \S/.test(t)) last = t;
  }
  return last;
}

/** A title derived from a slug: a two-digit prefix dropped, hyphens to spaces. */
function slugTitle(slug) {
  return slug.replace(/^\d{2}-/, '').split('-').join(' ');
}

/**
 * The pointer as the plan reports it: null when there is none, otherwise what it names and
 * whether it is valid.
 */
function pointerOf(dir, platform) {
  if (!existsSync(join(dir, POINTER_FILE))) return { report: null, stateDir: DEFAULT_STATE_DIR };
  try {
    const p = readPointer(dir, platform);
    return {
      report: {
        valid: true,
        state_dir: p.namesState ? p.stateDir : null,
        chapters_dir: p.namesChapters ? p.chaptersDir : null,
        reason: null,
      },
      stateDir: p.stateDir,
    };
  } catch (err) {
    return {
      report: { valid: false, state_dir: null, chapters_dir: null, reason: String(err && err.message) },
      stateDir: DEFAULT_STATE_DIR,
    };
  }
}

/** Whether dir is itself a book root, without walking up; an unresolvable book is null. */
function bookOf(dir, platform) {
  try {
    const found = tryBookRoot(dir, platform);
    return found ? { root: found.root, adopted: adoptionOf(found.meta).adopted } : null;
  } catch {
    return null;
  }
}

/** Files under dir, recursively, as paths relative to base; hidden names and `skip` excluded. */
function walkFiles(dir, base, skip, out) {
  for (const e of entriesOf(dir)) {
    if (isHidden(e.name)) continue;
    const rel = base === '' ? e.name : base + '/' + e.name;
    if (e.isDirectory()) {
      if (base === '' && skip.has(e.name)) continue;
      walkFiles(join(dir, e.name), rel, skip, out);
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * The prose boundary to propose: the most common last level-2 heading across the chapters,
 * when it ends more than half of them.
 */
function proposeBoundary(texts) {
  const counts = new Map();
  for (const text of texts) {
    const h = lastH2(text);
    if (h !== null) counts.set(h, (counts.get(h) || 0) + 1);
  }
  let best = null;
  for (const heading of [...counts.keys()].sort(byCodeUnit)) {
    if (best === null || counts.get(heading) > counts.get(best)) best = heading;
  }
  if (best === null || counts.get(best) * 2 <= texts.length) return null;
  return { heading: best, files_with_heading: counts.get(best), markdown_files: texts.length };
}

/**
 * Builds the adoption plan for one directory. Read-only and deterministic: every list is in
 * code-unit order and nothing in it depends on the clock.
 *
 * @param {string} dir - absolute path of the directory to adopt
 * @param {object} [opts]
 * @param {object|null} [opts.git] - the caller's git probe result: null, or
 *   {work_tree: boolean, uncommitted: number}
 * @param {string|null} [opts.chaptersDir] - the candidate folder to list chapters for; the
 *   candidate with the most Markdown files when null
 * @param {string} [opts.platform]
 * @returns {object} the plan; see docs/reference/cli/ns-doctor.md for its fields
 * @throws {Error} with code NOT_A_CANDIDATE when chaptersDir names no candidate folder
 */
export function buildAdoptPlan(dir, { git = null, chaptersDir = null, platform = process.platform } = {}) {
  const pointer = pointerOf(dir, platform);
  const stateFolders = findStateFolderCandidates(dir);
  const stateNames = new Set([DEFAULT_STATE_DIR, LEGACY_STATE_DIR, pointer.stateDir, ...stateFolders]);

  // Chapters folders: a direct child that holds Markdown files directly and that a pointer
  // could name (validateChaptersDirName refuses the bible folders and the state folder).
  const chaptersCandidates = [];
  for (const e of entriesOf(dir)) {
    if (!e.isDirectory() || isHidden(e.name) || stateNames.has(e.name)) continue;
    if (validateChaptersDirName(e.name, pointer.stateDir, platform) !== null) continue;
    const count = markdownFilesIn(join(dir, e.name)).length;
    if (count > 0) chaptersCandidates.push({ folder: e.name, markdown_files: count });
  }
  chaptersCandidates.sort((a, b) => b.markdown_files - a.markdown_files || byCodeUnit(a.folder, b.folder));

  // The chosen candidate's chapters, counted on prose with the proposed boundary, and as whole
  // files for an author who declines it.
  let chosen = chaptersCandidates.length > 0 ? chaptersCandidates[0].folder : null;
  if (chaptersDir !== null) {
    if (!chaptersCandidates.some((c) => c.folder === chaptersDir)) {
      const err = new Error('"' + chaptersDir + '" is not a chapters folder candidate; the candidates are: ' +
        (chaptersCandidates.map((c) => c.folder).join(', ') || 'none'));
      err.code = 'NOT_A_CANDIDATE';
      throw err;
    }
    chosen = chaptersDir;
  }
  let chapters = [];
  let proseBoundary = null;
  if (chosen !== null) {
    const folder = join(dir, chosen);
    const files = markdownFilesIn(folder).map((name) => ({ name, text: readText(join(folder, name)) || '' }));
    proseBoundary = proposeBoundary(files.map((f) => f.text));
    const heading = proseBoundary ? proseBoundary.heading : null;
    chapters = files.map(({ name, text }) => {
      const slug = name.slice(0, -'.md'.length);
      return {
        file: name,
        slug,
        title: firstH1(text) || slugTitle(slug),
        words: countWords(proseOf(text, heading)),
        words_whole_file: countWords(text),
      };
    });
  }

  // Bible folders that already hold files the plugin did not create.
  const sharedFolders = [];
  for (const folder of Object.keys(PLUGIN_FILES).sort(byCodeUnit)) {
    const own = PLUGIN_FILES[folder];
    const abs = join(dir, folder);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;
    const authorFiles = walkFiles(abs, '', new Set(), []).filter((rel) => {
      const top = rel.split('/')[0];
      return !own.includes(top) && !own.includes(top + '/');
    });
    if (authorFiles.length > 0) sharedFolders.push({ folder, author_files: authorFiles.length });
  }

  const ledgerCandidates = walkFiles(dir, '', stateNames, [])
    .filter((rel) => /ledger|claim/i.test(rel.split('/').pop()))
    .sort(byCodeUnit);

  const readme = readText(join(dir, 'README.md'));

  return {
    version: 1,
    root: dir.split('\\').join('/'),
    book: bookOf(dir, platform),
    pointer: pointer.report,
    state_folders: stateFolders,
    chapters_candidates: chaptersCandidates,
    chapters_folder: chosen,
    chapters,
    prose_boundary: proseBoundary,
    shared_folders: sharedFolders,
    ledger_candidates: ledgerCandidates,
    title_candidate: readme === null ? null : firstH1(readme),
    git,
  };
}
