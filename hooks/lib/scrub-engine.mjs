// what-it-is:   AI-injection and continuity quick-scan engine
// what-it-does: exports scanInjection(text), scanContinuity(chapters), and scrub(chapters, modes).
//               scanInjection detects three finding types: injection.pattern-match (compound
//               sentence-initial verb + editorial object), scrub.template-marker (unclosed
//               draft markers), and scrub.agent-self-reference (fixed case-insensitive
//               phrase lexicon from S-07). It answers "did an AI leave editorial scaffolding
//               in the AUTHOR'S OWN manuscript prose" and is tuned against that corpus, where
//               ordinary words like "ignore" and "override" must not false-positive.
//               scanContinuity detects continuity.name-mismatch (symmetric cross-chapter
//               case-folded identity mismatches, with sub-phrase deduplication).
//               scrub combines the scanInjection and scanContinuity passes under a modes
//               parameter.
//
//               A THIRD function, scanPromptInjection(text), was built, adversarially tested,
//               and REMOVED across four OPP-P04 (untrusted-source envelope) review rounds. It
//               attempted to detect instruction-override phrasing ("ignore your instructions...")
//               directed at an assistant, a different question from scanInjection's, over
//               fetched web content rather than manuscript prose. Every narrowing, down to its
//               tightest ("your instructions"/"your prompt" adjacency, the one pattern with a
//               clean record through three rounds of adversarial testing), was shown to
//               false-positive on realistic content in the exact domains this hook scans
//               (support FAQs, changelogs, security blogs, and - the case that closed the
//               question - ordinary developer documentation where "your prompt" means a SHELL
//               prompt, not an AI one). No pattern-matching design closed the class; each fix
//               closed the reported cases and a fresh adversarial pass found new ones, four
//               times in a row. Removed rather than shipped narrower still, per the standing
//               rule that a flag nobody should trust is worse than no flag. See
//               hooks/post-tool-use.mjs's header and docs/formats/fetch-log.md for the
//               consequence (the wrap-and-fence mechanism is unaffected and remains the actual
//               defense) and git history on this file for the four-round record, if it is ever
//               useful to a future attempt: know going in that the failure mode was not any one
//               lexicon choice, it was pattern-matching's inability to distinguish an imperative
//               ADDRESSED TO an assistant from the same words used to describe, report, or
//               instruct a HUMAN reader, at any level of narrowing tried.
// why:          the engine logic lives in a lib module so every caller shares the same
//               computation path per S-07 section 4 (one implementation, multiple callers,
//               not independent copies)
// used-by:      bin/ns-scrub and hooks/stop-gate.mjs (scanInjection, scanContinuity, scrub);
//               hooks/post-tool-use.mjs (scanInjection)

// ---- HELPERS ------------------------------------------------------------------

/** Escapes special regex metacharacters in a literal string for use in a RegExp. */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Truncates text to a short excerpt for display in finding records.
 * @param {string} text
 * @param {number} [maxLen=80]
 * @returns {string}
 */
function makeExcerpt(text, maxLen = 80) {
  const t = text.trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen - 3) + '...';
}

// ---- INJECTION MECHANISM ------------------------------------------------------
//
// Adjudicated during TSK-023 (ai-injection fixture) review and written as LAW in
// the TSK-027 brief. Compound signal: a sentence whose FIRST word is an imperative
// editing verb from the fixed lexicon below, AND whose body contains an editorial
// object from the fixed lexicon below. Case-insensitive on the verb. Scanning
// covers block-quoted content (the Darkhollow failure class: a planted instruction
// inside a block quote was shipped in the published chapter text). This compound
// was verified zero-false-positive on golden prose during the TSK-023 review.
//
// Finding type: injection.pattern-match
//
// Lexicons are FIXED by adjudication. Do not expand without a new adjudication.

// Fixed lexicon: sentence-initial imperative editing verbs.
// Source: TSK-027 brief (adjudicated during TSK-023 review). Exact set is LAW.
// No hyphens or special characters in the lexicon entries.
const INJECTION_VERBS = new Set([
  'deepen', 'rewrite', 'revise', 'expand', 'add', 'insert',
  'strengthen', 'shorten', 'adjust', 'improve', 'polish',
  'rework', 'tighten', 'clarify', 'emphasize',
]);

// Fixed lexicon: editorial objects that identify an instruction target.
// Source: TSK-027 brief (adjudicated during TSK-023 review). Exact set is LAW.
const EDITORIAL_OBJECTS = [
  'this section', 'this chapter', 'this paragraph', 'this passage',
  'the section', 'the chapter', 'a specific example',
  'the tone', 'the style', 'the voice',
];

// Pre-built case-insensitive regex for editorial object detection.
const EDITORIAL_OBJ_RE = new RegExp(
  '\\b(' + EDITORIAL_OBJECTS.map(escapeRe).join('|') + ')\\b',
  'i'
);

// ---- TEMPLATE MARKER DETECTION ------------------------------------------------
//
// S-07 section 4 ns-scrub finding type 2: unclosed template markers.
// Mechanism: exact case-sensitive string match for the four marker strings defined
// in S-07 section 4. These markers are left in manuscript text as drafting
// placeholders; their presence in a chapter file means work is incomplete.
// Finding type: scrub.template-marker
//
// Note: [UNVERIFIED] is NOT scanned here; it is covered by the claims engine
// (ns-claims) which resolves [UNVERIFIED] anchors against the evidence ledger.
const TEMPLATE_MARKERS = ['[DRAFT]', '[VERIFY]', '[INSERT CITATION]', '[TODO]'];

// ---- AGENT SELF-REFERENCE MECHANISM -------------------------------------------
//
// S-07 section 4 ns-scrub finding type 3: agent self-references. Mechanism: a fixed
// case-insensitive phrase lexicon transcribed exactly from S-07 section 4 as adjudicated
// on 2026-07-18. Any occurrence of any lexicon phrase in prose fires a
// scrub.agent-self-reference finding. Block-quoted content is in scope (same Darkhollow
// failure class as injection.pattern-match). One finding per line.
// Lexicon is FIXED by S-07 adjudication. Do not expand without a new adjudication
// and S-07 amendment.
//
// Finding type: scrub.agent-self-reference
const SELF_REF_PHRASES = [
  'as an AI',
  'as a language model',
  'as an AI language model',
  'as an assistant',
  'I cannot generate',
  'I cannot browse',
  'I do not have access',
  'my training data',
  'my knowledge cutoff',
  'here is a draft',
  'here is the revised',
  'I hope this helps',
];

// Pre-built lowercase forms for case-insensitive matching
const SELF_REF_PHRASES_LOWER = SELF_REF_PHRASES.map(p => p.toLowerCase());

// ---- CONTINUITY MECHANISM -----------------------------------------------------
//
// Adjudicated during TSK-021 (continuity-error fixture) and defined as LAW in
// S-07 (ns-claims section, invoked by ns-scrub continuity mode). Mechanism:
// index recurring multi-word terms (2 or more words appearing 2 or more times
// book-wide) and capitalized proper-noun sequences by case-folded identity;
// emit continuity.name-mismatch when one case-folded identity has DIFFERENT
// surface casings in DIFFERENT chapters.
//
// Sentence-initial normalization rule (required by TSK-027 brief):
//   When a multi-word term's first word is sentence-initial (the first token after
//   a blank line, the start of the file, or sentence-ending punctuation), its
//   capitalization is positional rather than intentional. Before comparing surface
//   forms across chapters, the first word of any sentence-initial occurrence is
//   lowercased. This prevents natural sentence capitalization (e.g., "The phrase"
//   at sentence start vs. "the phrase" mid-sentence) from firing as a mismatch.
//   The planted continuity error ("Personal Learning Network" inside a quoted phrase
//   mid-sentence in chapter 2 vs. "personal learning network" mid-sentence in
//   chapter 1) is correctly NOT sentence-initial in either chapter and is therefore
//   not normalized, causing it to fire as intended.
//
// Scope: typos and plural drift are OUTSIDE v1 deterministic scope (they break
// case-folded identity). Those are covered by the continuity-checker agent's
// semantic pass in Phase 2.
//
// Finding type: continuity.name-mismatch

// ---- INTERNAL: word token extraction ------------------------------------------

/**
 * Tokenizes a chapter text into word tokens, each carrying the line number
 * and a sentence-initial flag.
 *
 * Sentence-initial detection rules:
 *   A word is sentence-initial when it is the first word token encountered
 *   after one of:
 *     - the beginning of the text (file start)
 *     - a blank line (paragraph break)
 *     - a sequence of sentence-ending punctuation ([.!?]+) within the same line
 *
 * Block quote prefixes (> and >> etc.) and Markdown heading markers (# ## etc.)
 * are stripped before tokenizing. Bracket content such as [claim: EV-NNNN],
 * [UNVERIFIED], [SOURCE-UNVERIFIABLE], and similar is skipped (not tokenized)
 * to prevent claim markers between a sentence period and the next word from
 * being mistaken for word tokens.
 *
 * @param {string} text - raw chapter file content
 * @returns {{word: string, line: number, isSentenceInitial: boolean}[]}
 */
function extractWordTokens(text) {
  const tokens = [];
  const lines = text.split('\n');

  // atSentenceStart: true when the very next word token will be sentence-initial.
  // Starts true because the first word of the file is sentence-initial.
  let atSentenceStart = true;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;

    // Strip block quote prefix (one or more '>' optionally followed by whitespace)
    let line = lines[i].replace(/^(>\s*)+/, '');
    // Strip Markdown heading prefix
    line = line.replace(/^#{1,6}\s+/, '');

    const trimmed = line.trim();

    // Blank line: next word starts a new paragraph sentence
    if (!trimmed) {
      atSentenceStart = true;
      continue;
    }

    // Scan the line for three token classes:
    //   group 1: word token ([a-zA-Z]+ optionally joined by hyphens)
    //   group 2: sentence-ending punctuation ([.!?]+)
    //   group 3: bracket content (claim markers, template markers, etc.) to skip
    const TOKEN_RE = /([a-zA-Z]+(?:-[a-zA-Z]+)*)|([.!?]+)|(\[[^\]]*\])/g;
    let m;

    // Track sentence-initial state within this line, starting from the
    // cross-line state inherited in atSentenceStart.
    let lineAtSentenceStart = atSentenceStart;
    let pendingEnd = false; // true after seeing [.!?]+, cleared on next word

    while ((m = TOKEN_RE.exec(trimmed)) !== null) {
      if (m[3]) {
        // Bracket content: skip entirely; does not affect sentence state
        continue;
      }
      if (m[2]) {
        // Sentence-ending punctuation: next word will be sentence-initial
        pendingEnd = true;
        lineAtSentenceStart = false;
        continue;
      }
      if (m[1]) {
        // Word token
        const isSentInit = lineAtSentenceStart || pendingEnd;
        tokens.push({ word: m[1], line: lineNum, isSentenceInitial: isSentInit });
        lineAtSentenceStart = false;
        pendingEnd = false;
      }
    }

    // Carry sentence state to the next line:
    // pendingEnd=true means this line ended with sentence-final punctuation
    atSentenceStart = pendingEnd;
  }

  return tokens;
}

// ---- INTERNAL: sub-phrase deduplication ----------------------------------------

/**
 * Returns true when `sub` (a word array) appears as a strict contiguous sub-array
 * inside `sup` (also a word array). Strict means sub.length < sup.length.
 *
 * @param {string[]} sub
 * @param {string[]} sup
 * @returns {boolean}
 */
function isContiguousSubsequence(sub, sup) {
  if (sub.length >= sup.length) return false;
  for (let i = 0; i <= sup.length - sub.length; i++) {
    let match = true;
    for (let j = 0; j < sub.length; j++) {
      if (sup[i + j] !== sub[j]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Suppresses any finding whose excerpt is a strict word-wise contiguous sub-sequence
 * of another finding's excerpt when both share the same file and line.
 *
 * This collapses sub-phrase n-gram findings (for example "Personal Learning") that
 * are dominated by a longer phrase finding ("Personal Learning Network") at the same
 * file and line. The result is the minimal non-redundant finding set.
 *
 * @param {{file: string, line: number, type: string, excerpt: string}[]} findings
 * @returns {{file: string, line: number, type: string, excerpt: string}[]}
 */
function dedupeBySubphrase(findings) {
  return findings.filter(f => {
    const fWords = f.excerpt.split(' ');
    return !findings.some(other => {
      if (other === f || other.file !== f.file || other.line !== f.line) return false;
      return isContiguousSubsequence(fWords, other.excerpt.split(' '));
    });
  });
}

// ---- PUBLIC API ---------------------------------------------------------------

/**
 * Scans a single chapter text for AI-injection and template-marker findings.
 *
 * Implements two S-07 section 4 ns-scrub finding types:
 *
 * injection.pattern-match: compound pattern - the sentence's FIRST word is an
 *   imperative editing verb from INJECTION_VERBS (case-insensitive) AND the
 *   sentence body contains an editorial object from EDITORIAL_OBJECTS.
 *   Scans ALL prose including block-quoted lines (Darkhollow failure class).
 *
 * scrub.template-marker: exact string match for any of the four markers in
 *   TEMPLATE_MARKERS ([DRAFT], [VERIFY], [INSERT CITATION], [TODO]).
 *
 * scrub.agent-self-reference: case-insensitive phrase scan against the SELF_REF_PHRASES
 *   lexicon defined above. Block-quoted content is in scope. One finding per line.
 *
 * @param {string} text - raw chapter file content
 * @returns {{line: number, type: string, excerpt: string}[]} findings
 */
export function scanInjection(text) {
  const findings = [];
  const lines = text.split('\n');

  // Track sentence-initial state across lines (same rules as extractWordTokens)
  let atSentenceStart = true;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;

    // Strip Markdown block-quote prefix to scan injections inside block quotes
    const line = lines[i].replace(/^(>\s*)+/, '');
    const trimmed = line.trim();

    if (!trimmed) {
      atSentenceStart = true;
      continue;
    }

    // ---- Template marker check (before any stripping) ----
    // Scan for each template marker; emit one finding per occurrence per line.
    // We stop after the first matching marker per line to avoid duplicate findings
    // for the same physical line, but report all four marker types independently.
    for (const marker of TEMPLATE_MARKERS) {
      if (trimmed.includes(marker)) {
        findings.push({
          line: lineNum,
          type: 'scrub.template-marker',
          excerpt: makeExcerpt(trimmed),
        });
        // Only one finding per line for template markers (avoid duplicates
        // when multiple markers appear on the same line)
        break;
      }
    }

    // ---- Agent self-reference check ----
    // Case-insensitive scan for any phrase from SELF_REF_PHRASES. Scans the
    // already-stripped line (block-quote prefix removed above) so that self-framing
    // text inside block quotes is also caught.
    const lowerLine = trimmed.toLowerCase();
    for (const phrase of SELF_REF_PHRASES_LOWER) {
      if (lowerLine.includes(phrase)) {
        findings.push({
          line: lineNum,
          type: 'scrub.agent-self-reference',
          excerpt: makeExcerpt(trimmed),
        });
        break; // one finding per line per type
      }
    }

    // ---- Injection pattern check ----
    // Strip Markdown heading prefix for the injection scan (headings can carry
    // planted instructions just as block quotes can)
    const prose = trimmed.replace(/^#{1,6}\s+/, '');

    // Remove bracket content (claim markers, template markers, etc.) so that
    // "[claim: EV-0001] Adjust the tone..." does not misread the first word.
    const cleanedProse = prose.replace(/\[[^\]]*\]/g, '').trim();

    if (!cleanedProse) {
      atSentenceStart = true;
      continue;
    }

    // Split the cleaned prose line into sentence fragments at in-line sentence
    // boundaries ([.!?] followed by whitespace). Uses lookbehind to split AFTER
    // the punctuation, keeping it attached to the preceding fragment.
    const fragments = cleanedProse.split(/(?<=[.!?])\s+/);

    for (let j = 0; j < fragments.length; j++) {
      // The first fragment of the line is sentence-initial only when the global
      // state says so; every subsequent fragment (after an in-line sentence end)
      // is always sentence-initial.
      const isSentInit = (j === 0) ? atSentenceStart : true;

      if (!isSentInit) continue;

      const frag = fragments[j].trim();
      if (!frag) continue;

      // Check: first word is an imperative editing verb (case-insensitive)
      const firstWordMatch = frag.match(/^([a-zA-Z]+)/);
      if (!firstWordMatch) continue;

      const firstWord = firstWordMatch[1].toLowerCase();
      if (!INJECTION_VERBS.has(firstWord)) continue;

      // Check: sentence body contains an editorial object phrase
      if (!EDITORIAL_OBJ_RE.test(frag)) continue;

      findings.push({
        line: lineNum,
        type: 'injection.pattern-match',
        excerpt: makeExcerpt(frag),
      });
    }

    // Update sentence-start state for the next line:
    // true when this line's prose ends with sentence-final punctuation
    atSentenceStart = /[.!?]\s*$/.test(cleanedProse);
  }

  return findings;
}

/**
 * Scans multiple chapters for continuity name-mismatch findings.
 *
 * Algorithm:
 *   1. Extract word tokens from every chapter with sentence-initial flags.
 *   2. Generate n-grams (n = 2 to 5) from consecutive tokens on the same line.
 *   3. Index n-grams by case-folded identity.
 *   4. Apply sentence-initial normalization: when an occurrence's first word is
 *      sentence-initial, lowercase that first word before comparison (positional
 *      capitalization is not intentional casing).
 *   5. For each case-folded identity with 2+ total occurrences: collect the set
 *      of normalized surface forms per chapter. When any two chapters have form-sets
 *      that differ in either direction (symmetric check), emit continuity.name-mismatch
 *      pointing to the minority (variant) occurrence with detail naming both forms
 *      and chapters.
 *   6. Apply sub-phrase dedupe: suppress any finding whose excerpt is a strict
 *      word-wise contiguous sub-sequence of another finding at the same file+line.
 *
 * Symmetric cross-chapter detection: the check runs in both directions. A chapter
 * containing both the majority form and a minority variant correctly fires even
 * though the majority form is shared with the other chapter (the one-direction
 * check would miss this case).
 *
 * Same-chapter casing variance never fires: a mismatch is only recorded when the
 * differing surface forms are found in DIFFERENT chapters.
 *
 * @param {{file: string, text: string}[]} chapters
 * @returns {{file: string, line: number, type: string, excerpt: string, detail: string}[]}
 */
export function scanContinuity(chapters) {
  // termIndex: case-folded form -> list of occurrences
  // Each occurrence: { surface, chapter, line, isSentenceInitial }
  const termIndex = new Map();

  for (const { file, text } of chapters) {
    const wordTokens = extractWordTokens(text);

    for (let i = 0; i < wordTokens.length; i++) {
      for (let n = 2; n <= 5; n++) {
        if (i + n > wordTokens.length) break;

        // Do not generate n-grams that span line breaks: multi-word terms
        // appear on a single line in prose
        if (wordTokens[i].line !== wordTokens[i + n - 1].line) break;

        const gram = wordTokens.slice(i, i + n);
        const surface = gram.map(t => t.word).join(' ');
        const caseFolded = surface.toLowerCase();

        if (!termIndex.has(caseFolded)) {
          termIndex.set(caseFolded, []);
        }
        termIndex.get(caseFolded).push({
          surface,
          chapter: file,
          line: gram[0].line,
          isSentenceInitial: gram[0].isSentenceInitial,
        });
      }
    }
  }

  const findings = [];

  for (const [caseFolded, occurrences] of termIndex) {
    // Must appear 2 or more times book-wide to qualify as a recurring term
    if (occurrences.length < 2) continue;

    // Sentence-initial normalization (see module header for rationale):
    // lowercase the first word of any sentence-initial occurrence before comparing.
    const normOccs = occurrences.map(occ => {
      if (occ.isSentenceInitial) {
        const words = occ.surface.split(' ');
        words[0] = words[0].toLowerCase();
        return Object.assign({}, occ, { normSurface: words.join(' ') });
      }
      return Object.assign({}, occ, { normSurface: occ.surface });
    });

    // Group unique normalized surface forms by chapter
    // chapterForms: chapter -> Set<normSurface>
    const chapterForms = new Map();
    for (const occ of normOccs) {
      if (!chapterForms.has(occ.chapter)) {
        chapterForms.set(occ.chapter, new Set());
      }
      chapterForms.get(occ.chapter).add(occ.normSurface);
    }

    // If only one chapter has this term, no cross-chapter comparison is possible
    if (chapterForms.size < 2) continue;

    // Collect all unique normalized forms across all chapters
    const allForms = new Set();
    for (const forms of chapterForms.values()) {
      for (const f of forms) allForms.add(f);
    }

    // If all chapters use the same normalized form, no mismatch
    if (allForms.size < 2) continue;

    // Verify that the mismatch is cross-chapter: at least one chapter has a form
    // that at least one other chapter does not have.
    //
    // Symmetric check: the one-direction loop (does formsI contain anything missing
    // from formsJ?) fails to detect the case where ch2 contains BOTH the majority
    // form AND a minority variant while ch1 contains only the majority form.
    // In that case ch1's single form IS present in ch2, so the one-direction check
    // returns false. The reverse direction (does formsJ contain anything missing from
    // formsI?) correctly fires on the minority variant. Both directions must be
    // evaluated for every pair of chapters.
    const chapterList = [...chapterForms.entries()];
    let hasCrossChapterMismatch = false;

    outer:
    for (let i = 0; i < chapterList.length; i++) {
      const [, formsI] = chapterList[i];
      for (let j = i + 1; j < chapterList.length; j++) {
        const [, formsJ] = chapterList[j];
        for (const f of formsI) {
          if (!formsJ.has(f)) {
            hasCrossChapterMismatch = true;
            break outer;
          }
        }
        for (const f of formsJ) {
          if (!formsI.has(f)) {
            hasCrossChapterMismatch = true;
            break outer;
          }
        }
      }
    }

    if (!hasCrossChapterMismatch) continue;

    // Determine the dominant (most frequent) normalized form across all chapters
    const formCount = new Map();
    for (const occ of normOccs) {
      formCount.set(occ.normSurface, (formCount.get(occ.normSurface) || 0) + 1);
    }

    let dominantForm = '';
    let dominantChapter = '';
    let maxCount = 0;
    for (const [form, count] of formCount) {
      if (count > maxCount) {
        maxCount = count;
        dominantForm = form;
      }
    }

    // Find a chapter that holds the dominant form (for naming in the detail)
    for (const [chap, forms] of chapterForms) {
      if (forms.has(dominantForm)) {
        dominantChapter = chap;
        break;
      }
    }

    // Emit one finding per case-folded term: point to the first variant occurrence
    // (the occurrence whose normalized form differs from the dominant form)
    for (const occ of normOccs) {
      if (occ.normSurface !== dominantForm) {
        findings.push({
          file: occ.chapter,
          line: occ.line,
          type: 'continuity.name-mismatch',
          excerpt: occ.surface,
          detail:
            'surface "' + occ.surface + '" (' + occ.chapter + ')' +
            ' differs from established form "' + dominantForm + '" (' + dominantChapter + ')',
        });
        break; // one finding per case-folded term
      }
    }
  }

  return dedupeBySubphrase(findings);
}

/**
 * Combined scrub pass over a set of chapters.
 *
 * Runs the requested mode(s) and returns a unified findings array.
 * All findings carry file, line, type, excerpt, and detail fields.
 *
 * @param {{file: string, text: string}[]} chapters
 * @param {'injection'|'continuity'|'all'} modes
 * @returns {{file: string, line: number, type: string, excerpt: string, detail: string}[]}
 */
export function scrub(chapters, modes) {
  const runInjection = modes === 'injection' || modes === 'all';
  const runContinuity = modes === 'continuity' || modes === 'all';

  const findings = [];

  if (runInjection) {
    for (const { file, text } of chapters) {
      const injFindings = scanInjection(text);
      for (const f of injFindings) {
        findings.push({
          file,
          line: f.line,
          type: f.type,
          excerpt: f.excerpt,
          detail: '',
        });
      }
    }
  }

  if (runContinuity) {
    const contFindings = scanContinuity(chapters);
    for (const f of contFindings) {
      findings.push(f);
    }
  }

  return findings;
}
