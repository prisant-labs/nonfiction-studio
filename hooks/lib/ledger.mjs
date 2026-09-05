// what-it-is:   the evidence-log and sources ledger parser and serializer
// what-it-does: parses research/evidence-log.md (S-08 section 6 grammar) and research/sources.md
//               (S-08 section 7 grammar) into typed entry arrays; serializes them back byte-faithfully;
//               exports the resolvedStatuses set for coverage checks
// why:          the grammar docs are law; one shared parser eliminates drift between ns-claims,
//               ns-doctor, and the fact-checker agent; unknown fields round-trip untouched per S-08 Rule 2
// used-by:      imported by bin/ns-claims, bin/ns-notes, and by hooks/lib/claims-engine.mjs,
//               hooks/lib/doctor-engine.mjs, hooks/lib/gate-engine.mjs, hooks/lib/orientation.mjs,
//               hooks/lib/overlap-engine.mjs (parseEvidenceLog, for corpus discovery over
//               research/evidence-log.md's verbatim fields)

// --- resolvedStatuses -----------------------------------------------------------
// Corrected coverage rule (adjudicated 2026-07-18, TSK-015 ledger grammar review):
// resolved statuses are 'verified' and 'interpretation'. Evidence entries with either
// of these two statuses count as resolved for claim-coverage computation. The prior
// rule ('verified' only) is superseded by this adjudication.
export const resolvedStatuses = new Set(['verified', 'interpretation']);

// --- ID patterns ----------------------------------------------------------------
const EV_HEADING = /^### (EV-\d{4}) \(([^)]+)\)$/;
const SRC_HEADING = /^### (SRC-\d{4}) \(([^)]+)\)$/;

// Known EV fields (in canonical order).
// 'verbatim' (D-07 (claim ledger with stable IDs) amendment, per OPP-D03: quote fidelity
// and source packets) is OPTIONAL: it holds the exact source text for a quoted span,
// compared character-for-character with no normalization by the quote-fidelity check in
// claims-engine.mjs. An entry without it parses and round-trips exactly as it did before
// this field existed.
const EV_KNOWN = new Set(['claim', 'source', 'locator', 'verbatim', 'confidence', 'status', 'added-by', 'date']);

// Known SRC fields (in canonical order).
const SRC_KNOWN = new Set(['type', 'nature', 'author', 'title', 'year', 'publisher', 'identifier', 'url', 'accessed', 'retrieval-status']);

// --- Shared parsing helpers -----------------------------------------------------

/**
 * Parses a single bullet line of the form '- key: value' or '- key:' (empty value).
 * Returns { key, value } or null if the line is not a bullet field.
 *
 * @param {string} line - a single text line (no trailing newline)
 * @returns {{ key: string, value: string }|null}
 */
function parseBulletLine(line) {
  if (!line.startsWith('- ')) return null;
  const content = line.slice(2);
  const sepIdx = content.indexOf(': ');
  if (sepIdx !== -1) {
    return { key: content.slice(0, sepIdx), value: content.slice(sepIdx + 2) };
  }
  // Empty-value case: '- key:' with no space after the colon.
  if (content.endsWith(':')) {
    return { key: content.slice(0, -1), value: '' };
  }
  return null;
}

/**
 * Serializes a single field to the canonical bullet format.
 * Empty values produce '- key:' (no trailing space); non-empty produce '- key: value'.
 *
 * @param {string} key   - field name
 * @param {string} value - field value (string representation)
 * @returns {string} the line without trailing newline
 */
function serializeBulletLine(key, value) {
  return value === '' ? '- ' + key + ':' : '- ' + key + ': ' + value;
}

/**
 * Core entry-block parser. Splits the text into per-entry blocks and parses each.
 *
 * @param {string} text       - full file content
 * @param {RegExp} headingRe  - regex matching the entry heading (EV_HEADING or SRC_HEADING)
 * @param {Set<string>} known - set of known field names for this entry type
 * @param {Function} coerce   - function(key, value) => coerced value (for typed fields)
 * @returns {object[]} array of parsed entry objects
 */
function parseBlocks(text, headingRe, known, coerce) {
  const lines = text.split('\n');
  const entries = [];
  let i = 0;

  while (i < lines.length) {
    const headMatch = headingRe.exec(lines[i]);
    if (!headMatch) {
      i++;
      continue;
    }

    const id = headMatch[1];
    const handle = headMatch[2];
    const entry = { id, handle, extra: {}, _fieldOrder: [] };
    i++;

    // Consume bullet lines until a blank line, another heading, or end of input.
    while (i < lines.length) {
      const line = lines[i];
      // Stop at blank line or next heading.
      if (line.trim() === '' || headingRe.exec(line)) {
        break;
      }
      const parsed = parseBulletLine(line);
      if (parsed) {
        const { key, value } = parsed;
        entry._fieldOrder.push(key);
        if (known.has(key)) {
          entry[key] = coerce(key, value);
        } else {
          entry.extra[key] = value;
        }
      }
      i++;
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Serializes a single entry back to its Markdown block form.
 * Fields are written in the order captured by _fieldOrder (preserving unknown field positions).
 * Falls back to a canonical order for entries that were created programmatically (no _fieldOrder).
 *
 * @param {object}  entry       - a parsed entry object
 * @param {string}  prefix      - heading prefix: 'EV' or 'SRC'
 * @param {string[]} canonical  - canonical field order for programmatic entries
 * @returns {string} the entry block text (heading + fields, no trailing blank line)
 */
function serializeEntry(entry, canonical) {
  const lines = [];
  lines.push('### ' + entry.id + ' (' + entry.handle + ')');

  const fieldOrder = entry._fieldOrder && entry._fieldOrder.length > 0
    ? entry._fieldOrder
    : canonical;

  for (const key of fieldOrder) {
    let value;
    if (Object.prototype.hasOwnProperty.call(entry, key) && key !== 'id' && key !== 'handle' && key !== 'extra' && key !== '_fieldOrder') {
      value = entry[key] == null ? '' : String(entry[key]);
    } else if (Object.prototype.hasOwnProperty.call(entry.extra, key)) {
      value = entry.extra[key];
    } else {
      // Field in _fieldOrder but not in entry: skip.
      continue;
    }
    lines.push(serializeBulletLine(key, value));
  }

  return lines.join('\n');
}

// --- Evidence Log (S-08 section 6) ---------------------------------------------

// Canonical EV field order for programmatic entries.
const EV_CANONICAL = ['claim', 'source', 'locator', 'verbatim', 'confidence', 'status', 'added-by', 'date'];

/**
 * Identity coercion for EV fields (all stored as strings; no numeric fields in EV).
 */
function coerceEv(key, value) {
  return value;
}

/**
 * Parses research/evidence-log.md text into an array of evidence entries.
 * Each entry contains typed known fields and an 'extra' map for unknown fields.
 * The '_fieldOrder' array records the original field sequence for byte-faithful serialization.
 *
 * Known fields: claim, source, locator, verbatim, confidence, status, added-by, date.
 * All other fields land in entry.extra.
 *
 * @param {string} text - full content of research/evidence-log.md
 * @returns {object[]} array of EV entry objects
 */
export function parseEvidenceLog(text) {
  return parseBlocks(text, EV_HEADING, EV_KNOWN, coerceEv);
}

/**
 * Serializes an array of evidence entries back to the evidence-log entry block format.
 * Entries are joined with a blank line separator, matching the on-disk format.
 * Byte-faithful for entries that were parsed and not modified (preserves _fieldOrder).
 *
 * @param {object[]} entries - array of EV entry objects
 * @returns {string} serialized text (entries only, no preamble or file heading)
 */
export function serializeEvidenceLog(entries) {
  return entries.map(e => serializeEntry(e, EV_CANONICAL)).join('\n\n');
}

// --- Sources (S-08 section 7) --------------------------------------------------

// Canonical SRC field order for programmatic entries.
const SRC_CANONICAL = ['type', 'nature', 'author', 'title', 'year', 'publisher', 'identifier', 'url', 'accessed', 'retrieval-status'];

/**
 * Coercion for SRC fields: 'year' is stored as an integer; all other fields are strings.
 */
function coerceSrc(key, value) {
  if (key === 'year') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

/**
 * Parses research/sources.md text into an array of source record entries.
 * Each entry contains typed known fields and an 'extra' map for unknown fields.
 * The '_fieldOrder' array records the original field sequence for byte-faithful serialization.
 *
 * Known fields: type, nature, author, title, year, publisher, identifier, url, accessed, retrieval-status.
 * All other fields land in entry.extra.
 *
 * @param {string} text - full content of research/sources.md
 * @returns {object[]} array of SRC entry objects
 */
export function parseSources(text) {
  return parseBlocks(text, SRC_HEADING, SRC_KNOWN, coerceSrc);
}

/**
 * Serializes an array of source record entries back to the sources entry block format.
 * Entries are joined with a blank line separator, matching the on-disk format.
 * Byte-faithful for entries that were parsed and not modified (preserves _fieldOrder).
 *
 * @param {object[]} entries - array of SRC entry objects
 * @returns {string} serialized text (entries only, no preamble or file heading)
 */
export function serializeSources(entries) {
  return entries.map(e => serializeEntry(e, SRC_CANONICAL)).join('\n\n');
}
