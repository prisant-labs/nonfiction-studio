// hooks/lib/prose.mjs
// what-it-is:   the prose boundary of ADR-0016 (adopting an existing book)
// what-it-does: cuts a chapter's text at the first line equal to the book's boundary heading
//               (config.json's `"prose": {"ends_at_heading": "..."}`), so that working material
//               an author keeps below that heading - a drafting table, notes, a checklist - is
//               never counted, scored, or scanned as prose
// why:          an adopted book can carry apparatus inside its chapter files. Every measurement
//               of chapter text (word counts, stylometry, scrub, continuity, overlap, claims)
//               must agree on where the prose ends, or the gate and the progress file disagree
//               about the same chapter. The engines stay pure: callers apply the cut where they
//               read a chapter, and snapshots still copy the raw file.
// used-by:      hooks/lib/gate-engine.mjs, hooks/lib/doctor-engine.mjs, hooks/post-tool-batch.mjs,
//               and the chapter-reading CLIs under bin/

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDirOf } from './bible.mjs';

/** A line with its trailing whitespace (including a CR from a CRLF file) removed. */
const trimEnd = (line) => line.replace(/\s+$/, '');

/**
 * The prose of a chapter: everything before the first line that equals the boundary heading.
 * The comparison ignores trailing whitespace and CR on both sides, but nothing else, so a longer
 * heading, a heading at another level, or an indented line is not the boundary. With no
 * boundary, or no matching line, the text is returned unchanged.
 *
 * @param {string} text - the chapter file's full text
 * @param {string|null} heading - the boundary heading, from proseBoundaryOf
 * @returns {string}
 */
export function proseOf(text, heading) {
  if (typeof text !== 'string') return text;
  if (typeof heading !== 'string') return text;
  const target = trimEnd(heading);
  if (target.trim() === '') return text;
  let start = 0;
  while (start <= text.length) {
    const end = text.indexOf('\n', start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    if (trimEnd(line) === target) return text.slice(0, start);
    if (end === -1) break;
    start = end + 1;
  }
  return text;
}

/**
 * The boundary heading a book's config.json sets, or null when it sets none. Anything other
 * than a non-blank string at `prose.ends_at_heading` is no boundary: a book the plugin created
 * has none, and a malformed setting never cuts a chapter.
 *
 * @param {object|null|undefined} config - the parsed config.json
 * @returns {string|null}
 */
export function proseBoundaryOf(config) {
  if (!config || typeof config !== 'object') return null;
  const block = config.prose;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const heading = block.ends_at_heading;
  if (typeof heading !== 'string' || heading.trim() === '') return null;
  return heading;
}

/**
 * The boundary heading for the book at root, read from its config.json. A missing or unreadable
 * config, or a bad pointer, is no boundary: callers include hooks, which fail open, and an
 * uncut chapter is the behavior every book had before ADR-0016.
 *
 * @param {string} root - absolute path to the book root
 * @returns {string|null}
 */
export function proseBoundaryAt(root) {
  try {
    return proseBoundaryOf(JSON.parse(readFileSync(join(stateDirOf(root), 'config.json'), 'utf8')));
  } catch {
    return null;
  }
}
