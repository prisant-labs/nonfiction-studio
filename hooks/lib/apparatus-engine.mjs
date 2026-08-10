// what-it-is:   the apparatus generator engine (OPP-D05, apparatus generator)
// what-it-does: reads parsed evidence-log and sources entries plus chapter text, resolves every
//               [claim: EV-nnnn] anchor into a Chicago-style note or an attention row, dedupes
//               and sorts a bibliography of actually-cited sources, derives index-candidate
//               terms, and renders all four as deterministic Markdown (no generation timestamp)
// why:          the claim ledger already holds everything a publisher-ready back matter needs;
//               this turns ledger maintenance into the highest-return habit in the workflow
//               instead of a chore that only pays off at a gate check (OPP-D05)
// used-by:      bin/ns-notes
//
// Design note (read-then-emit only): this module never writes anything. It has no fs access at
// all -- the caller (bin/ns-notes) reads research/evidence-log.md, research/sources.md,
// chapters/*.md, and hooks/lib/citation-styles/chicago.json, and passes already-parsed data in,
// matching the pattern hooks/lib/claims-engine.mjs uses for the same reason: unit-testable
// without spawning or touching disk.
//
// Attention precedence (per anchor, first failing check wins, so every row names exactly one
// problem): (1) the EV entry must exist; (2) its locator must be non-blank; (3) its `source`
// field must name a SRC entry that exists; (4) that source's `type` must be a key in the style's
// `types` object; (5) every field that type's `required` list names must be non-blank on the
// source record. A citation that passes all five renders a note. Bibliography and index-term
// eligibility for a source depend only on checks 3-5 (a source is "cited" the moment an EV entry
// anchored in a chapter names it, whether or not that EV's own locator is filled in yet -- the
// missing locator blocks only that one note, named separately in attention, per OPP-D05's "every
// SRC actually cited" bibliography rule).

// ---- Chicago short-title derivation ------------------------------------------------------

const LEADING_ARTICLE_RE = /^(The|A|An) /;

/**
 * Deterministic Chicago short-title derivation, used identically for short-form notes and for
 * index-candidate title terms so the same title always shortens the same way (OPP-D05's
 * "short-form consistency" requirement): the text before the title's first colon (or the whole
 * title if there is none), trimmed, with one leading "The ", "A ", or "An " stripped.
 *
 * @param {string} title
 * @returns {string}
 */
export function shortTitle(title) {
  const text = String(title == null ? '' : title);
  const colonIdx = text.indexOf(':');
  const base = colonIdx === -1 ? text : text.slice(0, colonIdx);
  return base.trim().replace(LEADING_ARTICLE_RE, '');
}

// ---- author name helpers -----------------------------------------------------------------

/**
 * Splits a sources.md `author` field into its individual "Surname, First" segments. Multiple
 * authors are joined in the source data by the literal string " and " (research/sources.md
 * grammar, docs/formats/sources.md). A segment with no comma is returned with an empty `rest`,
 * a defensive fallback for the case; every author field the sources.md grammar produces carries
 * a comma.
 *
 * @param {string} author
 * @returns {{surname: string, rest: string}[]}
 */
function splitAuthors(author) {
  return String(author == null ? '' : author)
    .split(' and ')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const commaIdx = segment.indexOf(',');
      if (commaIdx === -1) return { surname: segment, rest: '' };
      return { surname: segment.slice(0, commaIdx).trim(), rest: segment.slice(commaIdx + 1).trim() };
    });
}

/**
 * Every author surname in a (possibly multi-author) sources.md `author` field, in field order.
 * Used to derive one index-candidate author term per author.
 *
 * @param {string} author
 * @returns {string[]}
 */
export function authorSurnames(author) {
  return splitAuthors(author).map((a) => a.surname).filter(Boolean);
}

/**
 * The first author's surname, used for Chicago short-note form and for bibliography sorting.
 *
 * @param {string} author
 * @returns {string}
 */
export function authorSurname(author) {
  const all = authorSurnames(author);
  return all.length > 0 ? all[0] : '';
}

/**
 * Converts a sources.md `author` field from ledger "Surname, First" order to Chicago note
 * "First Surname" order, reordering each "and"-joined segment independently and rejoining with
 * " and ". A segment with no comma (see splitAuthors) is returned unchanged.
 *
 * @param {string} author
 * @returns {string}
 */
export function authorFullForm(author) {
  return splitAuthors(author)
    .map((a) => (a.rest ? a.rest + ' ' + a.surname : a.surname))
    .join(' and ');
}

// ---- claim anchor scanning ---------------------------------------------------------------

const CLAIM_ANCHOR_RE = /\[claim: (EV-\d{4})\]/g;

/**
 * Scans chapter text for `[claim: EV-nnnn]` anchors (marker form 1 only; docs/formats/claim-
 * markers.md) in document order. The apparatus generator only builds notes from this marker
 * form -- [UNVERIFIED], [SOURCE-UNVERIFIABLE], and [quote: EV-nnnn] belong to claim coverage
 * and quote fidelity (bin/ns-claims), not to this generator.
 *
 * @param {string} text - full chapter file content
 * @returns {{id: string, line: number}[]}
 */
export function scanClaimAnchors(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const anchors = [];
  for (let i = 0; i < lines.length; i++) {
    CLAIM_ANCHOR_RE.lastIndex = 0;
    let m;
    while ((m = CLAIM_ANCHOR_RE.exec(lines[i])) !== null) {
      anchors.push({ id: m[1], line: i + 1 });
    }
  }
  return anchors;
}

// ---- source resolution --------------------------------------------------------------------

/**
 * Resolves a source ID against the parsed sources.md map and the citation style, independent of
 * any specific citing EV entry's locator. This is the single check both note-rendering (which
 * additionally requires a non-blank locator, checked by the caller) and bibliography/index-term
 * eligibility (which does not) share.
 *
 * @param {string}   srcId     - the EV entry's `source` field, possibly blank
 * @param {Map<string,object>} sourceMap - SRC id -> parsed source entry (from parseSources)
 * @param {object}   style     - parsed chicago.json (or a compatible style object)
 * @returns {{ok: true, srcId: string, entry: object, type: string, typeDef: object}
 *         | {ok: false, reason: 'missing-source', srcId: string|null}
 *         | {ok: false, reason: 'unknown-source-type', srcId: string, srcType: string}
 *         | {ok: false, reason: 'incomplete-source', srcId: string, srcType: string, missingFields: string[]}}
 */
export function resolveSource(srcId, sourceMap, style) {
  const trimmedId = String(srcId == null ? '' : srcId).trim();
  if (!trimmedId) {
    return { ok: false, reason: 'missing-source', srcId: null };
  }
  const entry = sourceMap.get(trimmedId);
  if (!entry) {
    return { ok: false, reason: 'missing-source', srcId: trimmedId };
  }
  const typeDef = style.types[entry.type];
  if (!typeDef) {
    return { ok: false, reason: 'unknown-source-type', srcId: trimmedId, srcType: entry.type };
  }
  const missingFields = typeDef.required.filter(
    (field) => entry[field] == null || String(entry[field]).trim() === ''
  );
  if (missingFields.length > 0) {
    return { ok: false, reason: 'incomplete-source', srcId: trimmedId, srcType: entry.type, missingFields };
  }
  return { ok: true, srcId: trimmedId, entry, type: entry.type, typeDef };
}

/**
 * Builds the human-readable attention reason for a failed resolveSource result, given the
 * citing EV entry's ID. Kept separate from resolveSource so that function's return value stays
 * structured and independently assertable in tests.
 *
 * @param {string} evId
 * @param {object} failure - a resolveSource() result with ok:false
 * @returns {string}
 */
function describeSourceFailure(evId, failure) {
  switch (failure.reason) {
    case 'missing-source':
      return failure.srcId
        ? evId + ' names source ' + failure.srcId + ', which does not exist in research/sources.md'
        : evId + ' has no source recorded; nothing to cite';
    case 'unknown-source-type':
      return failure.srcId + ' has type "' + failure.srcType + '", which has no entry in hooks/lib/citation-styles/chicago.json';
    case 'incomplete-source':
      return failure.srcId + ' (type ' + failure.srcType + ') is missing required field(s) for Chicago style: ' + failure.missingFields.join(', ');
    default:
      return evId + ': unresolvable citation';
  }
}

// ---- template rendering ---------------------------------------------------------------------

const TEMPLATE_TOKEN_RE = /\{([a-z-]+)\}/g;

// A field value that itself ends in a period-terminated abbreviation (a middle initial such as
// "Dunbar, R. I. M." or "Horrigan, John B.") collides with a template's own literal closing
// period ("{author-last-first}. ") to produce a double period ("R. I. M.. "). Chicago style does
// not double punctuation: the abbreviation's period also serves as the clause's period. Squeezing
// every run of two or more periods down to one, applied uniformly after every template fill
// rather than as a per-field special case, fixes this wherever it occurs (today: only
// author-last-first in the bibliography form, since author-full and author-surname always end in
// a surname, never an initial) without the interpreter needing to know which fields can end in a
// period.
function squeezePeriods(text) {
  return text.replace(/\.{2,}/g, '.');
}

/**
 * Fills a chicago.json template string. Total by construction, not by branching: every
 * placeholder a template uses is guaranteed present because resolveSource already required it
 * (a universal field, or one of the type's own `required` fields) before this is ever called, so
 * there is no blank-field case to guess at.
 *
 * @param {string} template
 * @param {object} fields - token name (without braces) -> substitution value
 * @returns {string}
 */
function fillTemplate(template, fields) {
  const filled = template.replace(TEMPLATE_TOKEN_RE, (whole, key) => {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      throw new Error('citation style template references unknown field: ' + key);
    }
    return fields[key];
  });
  return squeezePeriods(filled);
}

function noteFields(entry, locator) {
  return {
    'author-full': authorFullForm(entry.author),
    'author-surname': authorSurname(entry.author),
    'title': entry.title,
    'short-title': shortTitle(entry.title),
    'year': String(entry.year),
    'publisher': entry.publisher,
    'url': entry.url,
    'locator': locator,
  };
}

/**
 * Renders one Chicago note (full or short form) for a resolved, renderable citation.
 *
 * @param {object} resolved - an ok:true result from resolveSource
 * @param {string} locator  - the citing EV entry's locator (already confirmed non-blank)
 * @param {'full'|'short'} form
 * @returns {string}
 */
export function renderNote(resolved, locator, form) {
  const template = form === 'full' ? resolved.typeDef.fullNote : resolved.typeDef.shortNote;
  return fillTemplate(template, noteFields(resolved.entry, locator));
}

// Uniform bibliography suffix: prefer a stable identifier (DOI, ISBN) over a URL; fall back to
// the URL with an access date in parens when present; append nothing when the source carries
// neither. Applies identically to every type, so it lives here rather than in chicago.json.
function bibliographySuffix(entry) {
  const identifier = String(entry.identifier == null ? '' : entry.identifier).trim();
  if (identifier) return ' ' + identifier + '.';
  const url = String(entry.url == null ? '' : entry.url).trim();
  if (!url) return '';
  const accessed = String(entry.accessed == null ? '' : entry.accessed).trim();
  return accessed ? ' ' + url + ' (accessed ' + accessed + ').' : ' ' + url + '.';
}

/**
 * Renders one Chicago bibliography entry for a resolved (renderable) source. No locator: a
 * bibliography entry names the work, not one citation of it.
 *
 * @param {object} resolved - an ok:true result from resolveSource
 * @returns {string}
 */
export function renderBibliographyEntry(resolved) {
  const entry = resolved.entry;
  const fields = {
    'author-full': authorFullForm(entry.author),
    'author-surname': authorSurname(entry.author),
    'author-last-first': entry.author,
    'title': entry.title,
    'short-title': shortTitle(entry.title),
    'year': String(entry.year),
    'publisher': entry.publisher,
    'url': entry.url,
  };
  // squeezePeriods again at this outer seam: fillTemplate already squeezed its own output, but
  // the suffix is concatenated afterward and is not itself template-filled, so a source whose
  // identifier field happened to end in a period would otherwise reintroduce the same doubling
  // fillTemplate already guards against.
  return squeezePeriods(fillTemplate(resolved.typeDef.bibliography, fields) + bibliographySuffix(entry));
}

// ---- deterministic, locale-independent sort helpers ----------------------------------------

// Plain lowercased code-unit comparison, never localeCompare: this repo's determinism
// requirements (byte-identical regeneration, sort order independent of insertion order) must
// hold across whatever ICU data happens to ship with a given Node build, which localeCompare
// does not guarantee.
function asciiCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function asciiCompareCI(a, b) {
  return asciiCompare(String(a).toLowerCase(), String(b).toLowerCase());
}

// ---- index candidates -----------------------------------------------------------------------

function addIndexTerm(map, type, term, chapterFile) {
  if (!term) return;
  const key = type + ' ' + term;
  if (!map.has(key)) map.set(key, { type, term, chapters: new Set() });
  map.get(key).chapters.add(chapterFile);
}

function finalizeIndexCandidates(map) {
  const rows = [...map.values()].map((r) => ({
    term: r.term,
    type: r.type,
    chapters: [...r.chapters].sort(asciiCompare),
  }));
  rows.sort((a, b) => asciiCompareCI(a.term, b.term) || asciiCompare(a.type, b.type));
  return rows;
}

// ---- bibliography finalization ---------------------------------------------------------------

function finalizeBibliography(citedRenderable) {
  const rows = [...citedRenderable.values()].map((resolved) => ({
    srcId: resolved.srcId,
    text: renderBibliographyEntry(resolved),
    _authorSurname: authorSurname(resolved.entry.author),
    _title: resolved.entry.title,
    _year: Number(resolved.entry.year) || 0,
  }));
  rows.sort((a, b) =>
    asciiCompareCI(a._authorSurname, b._authorSurname) ||
    asciiCompareCI(a._title, b._title) ||
    (a._year - b._year)
  );
  return rows.map(({ srcId, text }) => ({ srcId, text }));
}

// ---- chapter heading derivation ---------------------------------------------------------------

const H1_RE = /^#\s+(.+?)\s*$/m;

/**
 * Derives a chapter's display heading from its own first-level Markdown heading line, falling
 * back to the chapter's slug (its filename without extension) when no H1 is present. Chosen over
 * reading structure/chapter-list.md so the generator's input surface stays exactly what OPP-D05
 * names (the ledger and the chapter markers) and does not gain a dependency on a registry file
 * that is not guaranteed present or in sync.
 *
 * @param {string} file - bible-relative chapter path, e.g. 'chapters/01-slug.md'
 * @param {string} text - full chapter text
 * @returns {string}
 */
function chapterHeading(file, text) {
  const m = H1_RE.exec(text);
  if (m) return m[1];
  const base = file.split('/').pop() || file;
  return base.replace(/\.md$/, '');
}

// ---- top-level orchestration -------------------------------------------------------------------

/**
 * Computes the full apparatus (per-chapter notes, bibliography, index candidates, attention
 * list) from parsed ledger data, parsed source data, chapter texts, and a citation style. Pure:
 * no fs access, no randomness, no clock reads. Chapters must already be in the desired output
 * order (the caller sorts by filename, matching the chapter-discovery convention bin/ns-claims
 * uses).
 *
 * @param {{file: string, text: string}[]} chapters
 * @param {object[]} ledgerEntries - from parseEvidenceLog
 * @param {object[]} sourceEntries - from parseSources
 * @param {object}   style         - parsed hooks/lib/citation-styles/chicago.json
 * @returns {{
 *   chapters: {file: string, heading: string, notes: {number: number, text: string}[]}[],
 *   bibliography: {srcId: string, text: string}[],
 *   indexCandidates: {term: string, type: string, chapters: string[]}[],
 *   attention: {type: string, evId: string, srcId: string|null, chapter: string, line: number, reason: string}[]
 * }}
 */
export function computeApparatus(chapters, ledgerEntries, sourceEntries, style) {
  const ledgerMap = new Map(ledgerEntries.map((e) => [e.id, e]));
  const sourceMap = new Map(sourceEntries.map((e) => [e.id, e]));

  const attention = [];
  const indexMap = new Map();
  const citedRenderable = new Map(); // srcId -> resolveSource() ok result
  const chapterResults = [];

  for (const { file, text } of chapters) {
    const seenSrcInChapter = new Set();
    let noteNumber = 0;
    const notes = [];

    for (const { id, line } of scanClaimAnchors(text)) {
      const entry = ledgerMap.get(id);
      if (!entry) {
        attention.push({
          type: 'missing-evidence', evId: id, srcId: null, chapter: file, line,
          reason: id + ' is not found in research/evidence-log.md',
        });
        continue;
      }

      // The EV entry exists: its handle names a concept present in the manuscript regardless of
      // whether its citation can be rendered, so it is a candidate index term unconditionally.
      addIndexTerm(indexMap, 'claim', entry.handle, file);

      const locator = String(entry.locator == null ? '' : entry.locator).trim();
      const srcIdRaw = String(entry.source == null ? '' : entry.source).trim();
      const srcResolution = resolveSource(srcIdRaw, sourceMap, style);

      if (srcResolution.ok) {
        // Bibliography and author/title index-term eligibility depend only on the source
        // resolving, never on this citation's own locator (see the module header).
        if (!citedRenderable.has(srcResolution.srcId)) {
          citedRenderable.set(srcResolution.srcId, srcResolution);
        }
        for (const surname of authorSurnames(srcResolution.entry.author)) {
          addIndexTerm(indexMap, 'author', surname, file);
        }
        addIndexTerm(indexMap, 'title', shortTitle(srcResolution.entry.title), file);
      }

      if (locator === '') {
        attention.push({
          type: 'missing-locator', evId: id, srcId: srcResolution.ok ? srcResolution.srcId : (srcIdRaw || null),
          chapter: file, line,
          reason: id + ' has a blank locator; no Chicago note can be built without one',
        });
        continue;
      }

      if (!srcResolution.ok) {
        attention.push({
          type: srcResolution.reason, evId: id, srcId: srcResolution.srcId || null, chapter: file, line,
          reason: describeSourceFailure(id, srcResolution),
        });
        continue;
      }

      const firstInChapter = !seenSrcInChapter.has(srcResolution.srcId);
      seenSrcInChapter.add(srcResolution.srcId);
      noteNumber++;
      notes.push({
        number: noteNumber,
        text: renderNote(srcResolution, locator, firstInChapter ? 'full' : 'short'),
      });
    }

    chapterResults.push({ file, heading: chapterHeading(file, text), notes });
  }

  return {
    chapters: chapterResults,
    bibliography: finalizeBibliography(citedRenderable),
    indexCandidates: finalizeIndexCandidates(indexMap),
    attention,
  };
}

// ---- markdown builders ---------------------------------------------------------------------
// Every builder below is a pure function of its `result` argument: no generation timestamp, no
// clock read, no randomness, so regenerating over an unchanged ledger is byte-identical.

function escapeTableCell(text) {
  return String(text == null ? '' : text).replace(/\|/g, '\\|');
}

/**
 * Builds production/endnotes.md: one heading per chapter, notes numbered contiguously within
 * that chapter in anchor order. A chapter with zero renderable notes still gets a heading, so
 * the file's structure is predictable even when every anchor in a chapter needed attention.
 *
 * @param {ReturnType<typeof computeApparatus>} result
 * @returns {string}
 */
export function buildEndnotesMarkdown(result) {
  const lines = [];
  lines.push('# Endnotes');
  lines.push('');
  lines.push(
    'Chicago-style endnotes generated from `research/evidence-log.md` and `research/sources.md`. ' +
    'Do not hand-edit; regenerate with `ns-notes` after updating the ledger. Notes are numbered ' +
    'within each chapter, in the order their `[claim: EV-nnnn]` anchors appear. The first citation ' +
    'of a source within a chapter uses the full note form; a later citation of the same source in ' +
    'the same chapter uses the Chicago short form. An anchor whose citation cannot yet be built ' +
    '(a blank locator, an unresolved source, or an incomplete source record) is omitted here and ' +
    'listed instead in `apparatus-attention.md`.'
  );

  for (const chapter of result.chapters) {
    lines.push('');
    lines.push('## ' + chapter.heading);
    lines.push('');
    if (chapter.notes.length === 0) {
      lines.push('No endnotes for this chapter.');
    } else {
      for (const note of chapter.notes) {
        lines.push(note.number + '. ' + note.text);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Builds production/bibliography.md: every actually-cited source exactly once, in Chicago
 * bibliography form, sorted by author surname, then title, then year.
 *
 * @param {ReturnType<typeof computeApparatus>} result
 * @returns {string}
 */
export function buildBibliographyMarkdown(result) {
  const lines = [];
  lines.push('# Bibliography');
  lines.push('');
  lines.push(
    'Chicago-style bibliography generated from `research/sources.md`, limited to sources actually ' +
    'cited by a `[claim: EV-nnnn]` anchor somewhere in `chapters/`. Do not hand-edit; regenerate ' +
    'with `ns-notes`. Sorted by author surname, then title, then year.'
  );

  if (result.bibliography.length === 0) {
    lines.push('');
    lines.push('No sources are cited yet.');
  } else {
    for (const entry of result.bibliography) {
      lines.push('');
      lines.push(entry.text);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Builds production/index-candidates.md: candidate index terms (source author surnames, source
 * short titles, and evidence-log entry handles) paired with the chapters where a citing anchor
 * appears. Documents its own derivation rule in the file header, per OPP-D05.
 *
 * @param {ReturnType<typeof computeApparatus>} result
 * @returns {string}
 */
export function buildIndexCandidatesMarkdown(result) {
  const headingByFile = new Map(result.chapters.map((c) => [c.file, c.heading]));
  const lines = [];
  lines.push('# Index Candidates');
  lines.push('');
  lines.push(
    'Candidate index terms derived deterministically from `research/evidence-log.md` and ' +
    '`research/sources.md`: every distinct source author surname, every distinct source short ' +
    'title (the same derivation the endnotes use for Chicago short-form citations), and every ' +
    'evidence-log entry handle, each paired with the chapter(s) where a citing `[claim: EV-nnnn]` ' +
    'anchor appears. Author and title terms require the underlying source to be fully resolvable; ' +
    'a claim-handle term requires only that its evidence-log entry exist. These are candidates for ' +
    'a human to curate into a real index, not a finished index: nothing here implies a page number ' +
    'or a decision about which terms belong in the final book. Do not hand-edit; regenerate with ' +
    '`ns-notes`.');
  lines.push('');

  if (result.indexCandidates.length === 0) {
    lines.push('No candidate terms yet.');
  } else {
    lines.push('| Term | Type | Chapters |');
    lines.push('|---|---|---|');
    for (const row of result.indexCandidates) {
      const chapterList = row.chapters.map((f) => headingByFile.get(f) || f).join('; ');
      lines.push(
        '| ' + escapeTableCell(row.term) + ' | ' + escapeTableCell(row.type) + ' | ' +
        escapeTableCell(chapterList) + ' |'
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Builds production/apparatus-attention.md: the honesty mechanism. Every gap the generator found
 * while building notes, the bibliography, and index candidates, one row per gap, naming the EV
 * or SRC ID, the chapter, and what is missing. Empty means clean.
 *
 * @param {ReturnType<typeof computeApparatus>} result
 * @returns {string}
 */
export function buildAttentionMarkdown(result) {
  const headingByFile = new Map(result.chapters.map((c) => [c.file, c.heading]));
  const lines = [];
  lines.push('# Apparatus Attention');
  lines.push('');
  lines.push(
    'Ledger and source-record gaps `ns-notes` found while building the endnotes, bibliography, ' +
    'and index candidates. Nothing here was silently dropped: a citation with any one of these ' +
    'problems produces no note and no bibliography entry until the gap is fixed in ' +
    '`research/evidence-log.md` or `research/sources.md` and `ns-notes` is run again. Empty means ' +
    'clean.'
  );
  lines.push('');

  if (result.attention.length === 0) {
    lines.push('No items. The apparatus is clean.');
  } else {
    lines.push('| ID | Chapter | Issue |');
    lines.push('|---|---|---|');
    for (const row of result.attention) {
      const chapterLabel = headingByFile.get(row.chapter) || row.chapter;
      lines.push(
        '| ' + escapeTableCell(row.evId) + ' | ' + escapeTableCell(chapterLabel) + ' | ' +
        escapeTableCell(row.reason) + ' |'
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}
