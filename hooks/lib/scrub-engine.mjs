// what-it-is:   AI-injection, prompt-injection, and continuity quick-scan engine
// what-it-does: exports scanInjection(text), scanPromptInjection(text), scanContinuity(chapters),
//               and scrub(chapters, modes).
//               scanInjection detects three finding types: injection.pattern-match (compound
//               sentence-initial verb + editorial object), scrub.template-marker (unclosed
//               draft markers), and scrub.agent-self-reference (fixed case-insensitive
//               phrase lexicon from S-07). It answers "did an AI leave editorial scaffolding
//               in the AUTHOR'S OWN manuscript prose" and is tuned against that corpus, where
//               ordinary words like "ignore" and "override" must not false-positive.
//               scanPromptInjection answers a DIFFERENT question over a DIFFERENT corpus
//               (fetched web content, not the author's prose): does the text contain
//               imperative instruction-override phrasing directed at an assistant (see its
//               own doc comment for the four pattern categories and the false-positive
//               guards). It is advisory defense in depth, not a security boundary; see
//               docs/formats/fetch-log.md.
//               scanContinuity detects continuity.name-mismatch (symmetric cross-chapter
//               case-folded identity mismatches, with sub-phrase deduplication).
//               scrub combines the scanInjection and scanContinuity passes under a modes
//               parameter; scanPromptInjection is not part of scrub (it has its own caller).
// why:          the engine logic lives in a lib module so every caller shares the same
//               computation path per S-07 section 4 (one implementation, multiple callers,
//               not independent copies)
// used-by:      bin/ns-scrub and hooks/stop-gate.mjs (scanInjection, scanContinuity, scrub);
//               hooks/post-tool-use.mjs (scanPromptInjection, alongside scanInjection)

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

// ---- PROMPT INJECTION (INSTRUCTION-OVERRIDE) DETECTION ------------------------
//
// Added per the OPP-P04 (untrusted-source envelope) review round: scanInjection above does
// NOT catch classic "ignore your instructions" style prompt injection, and reusing its
// lexicon (or widening it to catch that phrasing) would cause false positives on ordinary
// book prose, where "ignore", "disregard", and "override" are everyday words. This is a
// SEPARATE detector answering a SEPARATE question, over a SEPARATE corpus (fetched web
// content, not the author's manuscript). Two functions, two questions, one module.
//
// ADVISORY DEFENSE IN DEPTH, NOT A SECURITY BOUNDARY. Pattern matching cannot enumerate
// every phrasing an injection attempt could take; this is a signal surfaced to a human
// (the flag line, the fetch log), not a gate, and it does not block anything. The actual
// defense against a hostile fetched page is the wrapping and fencing
// hooks/post-tool-use.mjs applies to EVERY fetch unconditionally: the preamble and the
// per-fetch random-nonce fence make it structurally true that the content arrives labeled
// and boundaried regardless of what it says, whether or not this scanner recognizes it. A
// false negative here does not weaken that fence, and this comment (plus the one repeated
// in docs/formats/fetch-log.md) exists specifically so nothing about this function is ever
// read as a stronger claim than that.
//
// Four pattern categories, each independently sufficient to produce a finding. Each is
// built from a STRUCTURAL shape (an imperative verb in a specific role, combined with an
// object that scopes it to the assistant's own instruction/configuration state), not a flat
// "bad word" list, because the shape is what a benign sentence sharing the same vocabulary
// is unlikely to also share:
//
//   A. injection.prompt-override.countermand - a sentence-initial imperative verb from
//      COUNTERMAND_VERBS (ignore, disregard, forget, discard, override, bypass, disable)
//      whose object names the assistant's OWN instruction state (INSTRUCTION_OBJECT_RE:
//      "your/the system/all previous/prior/... instructions/prompt/rules/..."). Requiring
//      BOTH the verb to be sentence-initial (an imperative reads as a command; the same verb
//      mid-sentence in a narrative report, "the committee voted to disregard prior
//      guidelines," does not) AND the object to specifically name an instruction/prompt/rule
//      (not any noun) is what keeps "Ignore the noise and focus on the signal" or "Disregard
//      rumors and focus on verified primary sources" from flagging: neither sentence's
//      object matches INSTRUCTION_OBJECT_RE.
//   B. injection.prompt-override.role-redefinition - the text asserts the assistant now
//      operates under a different persona, mode, or rule set: ROLE_REDEFINITION_RE ("you are
//      now [in a/an] ... mode/persona/...") or a short list of highly specific standalone
//      phrases (ROLE_PHRASES: "developer mode", "jailbreak", "DAN mode", ...) that have no
//      plausible benign reading, the same technique SELF_REF_PHRASES above already uses for
//      a different lexicon. Checked on every sentence fragment, not gated to sentence-initial
//      position, since "you are now in developer mode" does not read as ordinary narrative in
//      ANY position within a sentence.
//   C. injection.prompt-override.extraction - a sentence-initial imperative verb from
//      EXTRACTION_VERBS (reveal, output, print, disclose, leak, expose) whose object names a
//      secret or the assistant's own configuration (SECRET_OBJECT_RE: "system prompt", "api
//      key", "password", "credentials", ...).
//   D. injection.prompt-override.forged-role - a line beginning with "System:", "Assistant:",
//      or "Admin:" (FORGED_ROLE_PREFIX_RE), mimicking a real conversation-role message. This
//      is checked per LINE, not per sentence, since it is a formatting convention (how a
//      forged message announces itself), not a grammatical sentence.
//
// Lexicons here are NOT under the same "fixed by adjudication" governance the scanInjection
// lexicons carry (that governance is specific to scanInjection's own manuscript-prose
// corpus and false-positive history); they may be extended by a future task with test
// evidence for both a new true positive and no new false positive, the same bar this file's
// existing self-reference lexicon was held to.

const COUNTERMAND_VERBS = new Set(['ignore', 'disregard', 'forget', 'discard', 'override', 'bypass', 'disable']);

const INSTRUCTION_OBJECT_RE =
  /\b(your|my|the system'?s?|the original|all previous|the previous|prior|earlier|above|these|those|all)\b[^.!?]{0,25}\b(instructions?|prompts?|directives?|rules?|guidelines?|programming|guardrails|system prompt)\b/i;

const ROLE_REDEFINITION_RE =
  /\byou('re| are) now\b[^.!?]{0,30}\b(mode|persona|character|assistant|unrestricted|unfiltered|unbound)\b/i;

const ROLE_PHRASES = [
  'developer mode', 'jailbreak', 'dan mode', 'no longer bound by',
  'without any restrictions', 'without restrictions', 'act as if you have no',
  'pretend you are not', 'ignore your programming', 'this is a system override',
  'system override:', 'admin override', 'you have no restrictions'
];
const ROLE_PHRASES_LOWER = ROLE_PHRASES.map(p => p.toLowerCase());

const EXTRACTION_VERBS = new Set(['reveal', 'output', 'print', 'disclose', 'leak', 'expose']);

const SECRET_OBJECT_RE =
  /\b(system prompt|api keys?|passwords?|credentials?|secret keys?|configuration|your instructions|your prompt)\b/i;

const FORGED_ROLE_PREFIX_RE = /^(system|assistant|admin)\s*:/i;

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
 * Scans text for instruction-override prompt-injection phrasing (see the "PROMPT INJECTION
 * (INSTRUCTION-OVERRIDE) DETECTION" section above for the four pattern categories and the
 * false-positive reasoning). A SEPARATE detector from scanInjection: it answers a different
 * question (does this text try to hijack an assistant reading it) over a different corpus
 * (fetched web content, not the author's own manuscript prose).
 *
 * ADVISORY DEFENSE IN DEPTH, NOT A SECURITY BOUNDARY: pattern matching cannot enumerate every
 * phrasing an injection attempt could take. This is a signal for a human, surfaced via the
 * caller's flag line and fetch log; it never blocks anything. The actual defense against a
 * hostile fetched page is the wrapping and fencing hooks/post-tool-use.mjs applies to every
 * fetch unconditionally, independent of whether this function recognizes the content.
 *
 * Like scanInjection, this deliberately does not guard against `text` being a non-string: a
 * throw here is expected to propagate to the caller's own fail-open boundary (this mirrors
 * scanInjection's own established behavior, and hooks/post-tool-use.mjs's fail-open path is
 * already proven against exactly this shape of failure).
 *
 * Finding types: injection.prompt-override.countermand, injection.prompt-override.role-redefinition,
 * injection.prompt-override.extraction, injection.prompt-override.forged-role.
 *
 * @param {string} text - raw text to scan (fetched web content, not manuscript prose)
 * @returns {{line: number, type: string, excerpt: string}[]} findings
 */
export function scanPromptInjection(text) {
  const findings = [];
  const lines = text.split('\n');

  // Sentence-initial tracking mirrors scanInjection's own technique: position matters for
  // the imperative-verb categories (A and C below), since the same verb read as a command
  // (sentence-initial) versus embedded in a narrative report means something different.
  let atSentenceStart = true;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    // Strip Markdown block-quote prefix: injected text hides here too (the same Darkhollow
    // failure class scanInjection's own comments describe).
    const line = lines[i].replace(/^(>\s*)+/, '');
    const trimmed = line.trim();

    if (!trimmed) {
      atSentenceStart = true;
      continue;
    }

    // Category D: forged role-prefix, checked per line (a formatting convention, not a
    // sentence).
    if (FORGED_ROLE_PREFIX_RE.test(trimmed)) {
      findings.push({ line: lineNum, type: 'injection.prompt-override.forged-role', excerpt: makeExcerpt(trimmed) });
    }

    // Category B (phrase-list form): position-independent standalone phrases with no
    // plausible benign reading in any sentence position.
    const lowerLine = trimmed.toLowerCase();
    for (const phrase of ROLE_PHRASES_LOWER) {
      if (lowerLine.includes(phrase)) {
        findings.push({ line: lineNum, type: 'injection.prompt-override.role-redefinition', excerpt: makeExcerpt(trimmed) });
        break;
      }
    }

    // Sentence-fragment scan for categories A, B (regex form), and C.
    const fragments = trimmed.split(/(?<=[.!?])\s+/);
    for (let j = 0; j < fragments.length; j++) {
      const frag = fragments[j].trim();
      if (!frag) continue;
      const isSentInit = (j === 0) ? atSentenceStart : true;

      // Category B (regex form): position-independent, checked on every fragment (see the
      // section comment above for why sentence-initial gating is not needed here).
      if (ROLE_REDEFINITION_RE.test(frag)) {
        findings.push({ line: lineNum, type: 'injection.prompt-override.role-redefinition', excerpt: makeExcerpt(frag) });
      }

      if (!isSentInit) continue;

      const firstWordMatch = frag.match(/^([a-zA-Z]+)/);
      const firstWord = firstWordMatch ? firstWordMatch[1].toLowerCase() : '';

      if (COUNTERMAND_VERBS.has(firstWord) && INSTRUCTION_OBJECT_RE.test(frag)) {
        findings.push({ line: lineNum, type: 'injection.prompt-override.countermand', excerpt: makeExcerpt(frag) });
      } else if (EXTRACTION_VERBS.has(firstWord) && SECRET_OBJECT_RE.test(frag)) {
        findings.push({ line: lineNum, type: 'injection.prompt-override.extraction', excerpt: makeExcerpt(frag) });
      }
    }

    atSentenceStart = /[.!?]\s*$/.test(trimmed);
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
