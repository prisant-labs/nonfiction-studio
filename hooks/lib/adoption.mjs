// hooks/lib/adoption.mjs
// what-it-is:   the adoption record of ADR-0016 (adopting an existing book)
// what-it-does: reads meta.json's optional `adoption` object: which of the bible's five elements
//               an adopted book has taken on, and which bible folders it shares with the
//               author's own files. Also names the plugin's own files in each bible folder,
//               which is what an agent may still write in a shared folder.
// why:          the doctor, the gate, the orientation block, and the write guard all ask the same
//               two questions (is this element adopted? is this folder shared?), and one reader
//               keeps their answers identical
// used-by:      hooks/lib/agent-identity.mjs, hooks/lib/doctor-engine.mjs,
//               hooks/lib/gate-engine.mjs, hooks/lib/orientation.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDirOf } from './bible.mjs';

/** The bible's five elements, in the record's order. */
export const ELEMENTS = ['chapters', 'style', 'brief', 'structure', 'claims'];

/**
 * The plugin's own files in each bible folder, as the agents and skills create them. A trailing
 * slash names a folder. In a shared folder an agent's write scope covers only these (ADR-0016,
 * Shared folders), so the author's own files beside them stay out of reach.
 */
export const PLUGIN_FILES = {
  context: ['audience.md', 'brief.md', 'decisions.md', 'project-init.md', 'style-profile.md'],
  structure: ['chapter-list.md', 'comps.md', 'outline.md', 'thesis.md'],
  research: ['evidence-log.md', 'open-questions.md', 'packets/', 'sources.md'],
  production: ['README.md', 'back-matter.md', 'exports/', 'front-matter.md'],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalizes a meta.json object's adoption record. A book with no `adoption` key was created by
 * the plugin: it is not adopted, every element counts as adopted, and no folder is shared. A
 * book with an `adoption` key is adopted, and its record fails closed: an element whose state is
 * anything but exactly "adopted" (including a missing entry or a malformed record) reads as not
 * adopted.
 *
 * @param {object|null} meta - the parsed meta.json
 * @returns {{ adopted: boolean, date: string|null, elements: Object<string, boolean>,
 *   sharedFolders: { folder: string, consented: string|null }[] }}
 */
export function adoptionOf(meta) {
  const hasRecord = Boolean(meta) && typeof meta === 'object' && Object.prototype.hasOwnProperty.call(meta, 'adoption');
  const elements = {};
  if (!hasRecord) {
    for (const name of ELEMENTS) elements[name] = true;
    return { adopted: false, date: null, elements, sharedFolders: [] };
  }
  const record = meta.adoption && typeof meta.adoption === 'object' && !Array.isArray(meta.adoption) ? meta.adoption : {};
  const states = record.elements && typeof record.elements === 'object' ? record.elements : {};
  for (const name of ELEMENTS) elements[name] = states[name] === 'adopted';
  const sharedFolders = (Array.isArray(record.shared_folders) ? record.shared_folders : [])
    .filter((e) => e && typeof e === 'object' && typeof e.folder === 'string' && e.folder.length > 0)
    .map((e) => ({ folder: e.folder, consented: typeof e.consented === 'string' && DATE_RE.test(e.consented) ? e.consented : null }))
    .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
  return {
    adopted: true,
    date: typeof record.date === 'string' && DATE_RE.test(record.date) ? record.date : null,
    elements,
    sharedFolders,
  };
}

/**
 * True when the book has taken on the element. Throws on a name that is not one of the five, so
 * a typo in a caller fails loudly instead of reading as "not adopted".
 *
 * @param {object|null} meta - the parsed meta.json
 * @param {string} element - one of ELEMENTS
 * @returns {boolean}
 */
export function isAdopted(meta, element) {
  if (!ELEMENTS.includes(element)) {
    throw new Error('unknown bible element "' + element + '"; expected one of ' + ELEMENTS.join(', '));
  }
  return adoptionOf(meta).elements[element];
}

/** The elements the book has not adopted, in ELEMENTS order. Empty for a plugin-created book. */
export function unadoptedElements(meta) {
  const { elements } = adoptionOf(meta);
  return ELEMENTS.filter((name) => !elements[name]);
}

/**
 * Reads the adoption record of the book at `root`. A meta.json that cannot be read yields the
 * plugin-created default; every caller reaches this only after findBookRoot has already loaded
 * meta.json, so that branch is a race, not a normal path.
 *
 * @param {string} root - absolute path to the book root
 */
export function adoptionAt(root) {
  let meta = null;
  try {
    meta = JSON.parse(readFileSync(join(stateDirOf(root), 'meta.json'), 'utf8'));
  } catch {
    meta = null;
  }
  return adoptionOf(meta);
}
