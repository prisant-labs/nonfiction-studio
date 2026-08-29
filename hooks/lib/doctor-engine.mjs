// what-it-is:   bible integrity validation engine (TSK-028, ns-doctor)
// what-it-does: runs every check in the TSK-028 check inventory:
//               structure, progress.json schema, meta/config shapes, EV/SRC grammar,
//               orphan claim markers, orphan SRC refs, word-count coherence, config
//               coercion notice, snapshot naming conformance, schema-version check, and
//               style-profile structure and baseline-consistency (F-CI-08, voice quality
//               unchecked, deterministic half: closes docs/formats/style-profile.md's two
//               previously-unbuilt promises, config agreement and Exemplars path resolution)
// why:          one engine module isolates all logic for testing without CLI overhead;
//               integrates ledger.mjs parsers, claims-engine.mjs marker scan, and
//               stylometry-engine.mjs word counter as the single word-counting authority
// used-by:      bin/ns-doctor, and hooks/lib/gate-engine.mjs, which imports
//               checkWordCountCoherence directly
//
// READ-ONLY COVENANT: this module NEVER writes to any bible file or directory.
// All filesystem access is readFileSync / readdirSync / existsSync only.
// No writeFileSync, renameSync, mkdirSync, appendFileSync, or writeFile calls exist here.
// Proof: grep -n "writeFileSync\|renameSync\|mkdirSync\|appendFileSync\|writeFile"
//        hooks/lib/doctor-engine.mjs  (should produce zero matches)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEvidenceLog, parseSources } from './ledger.mjs';
import { scanChapter } from './claims-engine.mjs';
import { countWords } from './stylometry-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirnameHere = dirname(__filename);

// Path to the canonical progress JSON Schema (banked adjudication: validate against
// THAT file, not a re-declaration; the schema file is the single source of truth).
const PROGRESS_SCHEMA_PATH = join(
  __dirnameHere, '..', '..', 'templates', 'book-scaffold', '.studio', 'progress.schema.json'
);

// Supported schema_version major for this plugin version.
export const SUPPORTED_MAJOR = '2';

// Scaffold-mandated paths every valid bible must contain.
// (bible.mjs isBookRoot already guarantees .studio/meta.json, context/, and chapters/
//  exist before the doctor runs; these additional paths are checked here.)
const REQUIRED_PATHS = [
  '.studio/progress.json',
  '.studio/config.json',
  '.studio/ai-use-log.jsonl',
  'research/evidence-log.md',
  'research/sources.md',
  'context/style-profile.md',
  'context/brief.md',
  'structure/thesis.md',
  'structure/outline.md',
];

// EV field validation constants (S-08 section 6, corrected 2026-07-18 adjudication).
const EV_REQUIRED_FIELDS = ['claim', 'source', 'locator', 'confidence', 'status', 'added-by', 'date'];
const EV_STATUS_VALID = new Set(['pending', 'verified', 'unverified', 'source-unverifiable', 'interpretation']);
const EV_CONFIDENCE_VALID = new Set(['high', 'medium', 'low']);

// SRC field validation constants (S-08 section 7).
const SRC_TYPE_VALID = new Set(['book', 'article', 'web', 'interview', 'dataset', 'report', 'other']);
const SRC_RETRIEVAL_VALID = new Set(['stable', 'unstable', 'unverifiable']);

// Snapshot naming pattern: <slug>.<YYYYMMDDTHHMMSSZ>.md
const SNAPSHOT_NAME_RE = /^[a-z0-9][a-z0-9-]*\.[0-9]{8}T[0-9]{6}Z\.md$/;

// Source-ID pattern
const SRC_ID_RE = /^SRC-\d{4}$/;

// ---------------------------------------------------------------------------
// Lightweight JSON Schema validator (handles the keywords used in progress.schema.json)
// Rule 2 (forward-compatibility): additionalProperties is always treated as true;
// unknown fields are never rejected, satisfying the banked adjudication for unknow-fields.
// ---------------------------------------------------------------------------

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function checkTypes(value, types) {
  return types.some(t => {
    if (t === 'integer') return Number.isInteger(value);
    if (t === 'null') return value === null;
    if (t === 'array') return Array.isArray(value);
    if (t === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    return typeof value === t;
  });
}

/**
 * Recursively validates value against schema, accumulating violations.
 * Only the keywords used in progress.schema.json are handled.
 * additionalProperties is intentionally ignored per S-08 Rule 2.
 *
 * @param {object} schema - JSON Schema fragment
 * @param {*} value       - the value to validate
 * @param {string} path   - dot-path for error messages (e.g. 'chapters[0].word_count')
 * @returns {{ path: string, message: string }[]} array of violations
 */
function validateAgainstSchema(schema, value, path) {
  const errors = [];

  // Type check
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!checkTypes(value, types)) {
      const expected = types.join('|');
      const actual = typeOf(value);
      errors.push({
        path,
        message: 'field "' + path + '": expected ' + expected + ', got ' + actual
      });
      // Stop deeper validation when the type is wrong (avoids misleading cascades).
      return errors;
    }
  }

  // const check
  if (schema.const !== undefined && value !== schema.const) {
    errors.push({
      path,
      message: 'field "' + path + '": expected const ' + JSON.stringify(schema.const) + ', got ' + JSON.stringify(value)
    });
  }

  // enum check
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push({
      path,
      message: 'field "' + path + '": expected one of [' + schema.enum.join(', ') + '], got ' + JSON.stringify(value)
    });
  }

  // Numeric bounds
  if (typeof value === 'number' || Number.isInteger(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: 'field "' + path + '": value ' + value + ' is below minimum ' + schema.minimum });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: 'field "' + path + '": value ' + value + ' is above maximum ' + schema.maximum });
    }
  }

  // String pattern
  if (schema.pattern !== undefined && typeof value === 'string') {
    if (!new RegExp(schema.pattern).test(value)) {
      errors.push({
        path,
        message: 'field "' + path + '": value "' + value + '" does not match pattern ' + schema.pattern
      });
    }
  }

  const isObj = typeof value === 'object' && value !== null && !Array.isArray(value);

  // Required fields
  if (schema.required !== undefined && isObj) {
    for (const req of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(value, req)) {
        const fieldPath = path ? path + '.' + req : req;
        errors.push({ path: fieldPath, message: 'required field "' + fieldPath + '" is missing' });
      }
    }
  }

  // Properties recursion
  if (schema.properties !== undefined && isObj) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const fieldPath = path ? path + '.' + key : key;
        const sub = validateAgainstSchema(propSchema, value[key], fieldPath);
        errors.push(...sub);
      }
    }
  }

  // Array items recursion
  if (schema.items !== undefined && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const sub = validateAgainstSchema(schema.items, value[i], (path || '') + '[' + i + ']');
      errors.push(...sub);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Checks whether the meta.json schema_version is supported by this doctor version.
 * Returns { ok: true } when supported, { ok: false, current, supported, message }
 * when the version is older (exit-2 class: migration required).
 *
 * @param {object} meta - parsed .studio/meta.json
 * @returns {{ ok: boolean, current?: string, supported?: string, message?: string }}
 */
export function checkSchemaVersion(meta) {
  const current = meta && meta.schema_version != null ? String(meta.schema_version) : null;
  if (current === SUPPORTED_MAJOR) return { ok: true };
  const message = current === null
    ? 'meta.json missing schema_version field; supported major is "' + SUPPORTED_MAJOR + '"'
    : 'bible schema version "' + current + '" requires migration to supported major "' + SUPPORTED_MAJOR +
      '"; run ns-doctor --migrate to apply the migration';
  return { ok: false, current, supported: SUPPORTED_MAJOR, message };
}

/**
 * Checks word-count coherence between chapter files and progress.json.
 * The stylometry engine's tokenizer (countWords) is the SINGLE word-counting
 * authority (banked adjudication 2). Compares the recorded word_count in
 * progress.json against each chapter file's actual count. Tolerance: zero.
 *
 * Used by runChecks (section 8) and imported by gate-engine.mjs (state_coherence
 * check): one implementation, two callers, per TSK-029b (state-coherence gate check).
 *
 * [Extracted 2026-07-18 by TSK-029b (state-coherence gate check) per OQ-13
 *  (gate coherence check) decision: adding the check to the gate's deterministic
 *  set required an exported function so runChecks and the gate share one implementation.]
 *
 * @param {string} root - absolute path to the bible root
 * @returns {{ type: string, path: string, message: string }[]} findings array
 */
export function checkWordCountCoherence(root) {
  const findings = [];
  const progressPath = join(root, '.studio', 'progress.json');
  if (!existsSync(progressPath)) return findings;

  let progress;
  try {
    progress = JSON.parse(readFileSync(progressPath, 'utf8'));
  } catch {
    return findings;
  }

  if (!progress || !Array.isArray(progress.chapters)) return findings;

  const chaptersDir = join(root, 'chapters');
  for (const chEntry of progress.chapters) {
    if (!chEntry.slug || typeof chEntry.word_count !== 'number') continue;
    const chFile = join(chaptersDir, chEntry.slug + '.md');
    if (!existsSync(chFile)) continue;
    let chText;
    try {
      chText = readFileSync(chFile, 'utf8');
    } catch {
      continue;
    }
    const actualCount = countWords(chText);
    if (actualCount !== chEntry.word_count) {
      findings.push({
        type: 'coherence.word-count-mismatch',
        path: 'chapters/' + chEntry.slug + '.md',
        message:
          'chapter ' + chEntry.slug + ': progress.json records ' + chEntry.word_count +
          ' words but the file contains ' + actualCount + ' words (by stylometry tokenizer)'
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Style profile structure and baseline-consistency check (F-CI-08, voice
// quality unchecked, deterministic half). Validates context/style-profile.md
// against the seven-section grammar in docs/formats/style-profile.md, honors
// the pre-capture stub state, and closes the format doc's two previously
// unbuilt promises: config.json agreement on the Baseline reference block,
// and Exemplars path resolution. Parsing is tolerant on purpose: a heading
// scan plus a small field-block parse, not a full Markdown parser.
// ---------------------------------------------------------------------------

const STYLE_PROFILE_SECTIONS = [
  '## Voice',
  '## Diction',
  '## Rhythm',
  '## Do',
  '## Do not',
  '## Exemplars',
  '## Baseline reference',
];

const STYLE_PROFILE_BASELINE_FIELDS = ['vector', 'captured', 'sample_count'];

const STYLE_PROFILE_REL_PATH = 'context/style-profile.md';

// Matches the top-level heading only when it is the sole content on its own
// line (a real H1, not a substring inside other text).
const STYLE_PROFILE_H1_RE = /^# Style profile\s*$/m;

function styleProfileExtractH2Headings(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('## '));
}

// Returns the body lines of the named H2 section (everything after the
// heading line up to, but not including, the next '## ' heading or EOF), or
// null when the heading itself is absent (callers skip field/path checks in
// that case; the missing-section finding above already covers it).
function styleProfileSectionBody(text, heading) {
  const lines = text.split(/\r?\n/);
  const startIdx = lines.findIndex(line => line.trim() === heading);
  if (startIdx === -1) return null;
  const body = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('## ')) break;
    body.push(lines[i]);
  }
  return body;
}

// Parses "- field: value" bullet lines into a { field: value } map. Tolerant:
// non-matching lines (blank lines, prose) are simply ignored.
function styleProfileParseFieldBlock(bodyLines) {
  const fields = {};
  const re = /^-\s*([A-Za-z_]+):\s*(.*)$/;
  for (const raw of bodyLines) {
    const m = re.exec(raw.trim());
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

// A stylometry.baseline object counts as an actual captured baseline only if
// it carries at least one of the fields a real capture run would set. Without
// this, `stylometry.baseline: {}` (present but empty) would read as "config
// carries a baseline" for the stub rule below, when nothing has actually been
// captured. captured/sample_count are the fields this check itself compares;
// markers/marker_set_version are included too because voice-capture's current
// write contract (agents/voice-capture.md) sets only those two, not
// captured/sample_count - a real, current baseline that has never carried the
// two temporal fields must still count as substantive.
function styleProfileConfigBaselineHasSubstance(baseline) {
  return baseline.captured !== undefined ||
    baseline.sample_count !== undefined ||
    baseline.markers !== undefined ||
    baseline.marker_set_version !== undefined;
}

// Parses "- <path>" bullet lines into a plain array of trimmed path strings.
function styleProfileParseBulletPaths(bodyLines) {
  const paths = [];
  for (const raw of bodyLines) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('- ')) {
      paths.push(trimmed.slice(2).trim());
    }
  }
  return paths;
}

function checkStyleProfile(root, config, findings, notices) {
  const absPath = join(root, 'context', 'style-profile.md');
  // Absence is already a structure.missing-path finding (REQUIRED_PATHS); this
  // check only validates CONTENT, so it has nothing to do when the file is gone.
  if (!existsSync(absPath)) return;

  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return;
  }

  const rawConfigBaseline =
    config && config.stylometry && config.stylometry.baseline &&
    typeof config.stylometry.baseline === 'object' && config.stylometry.baseline !== null
      ? config.stylometry.baseline
      : null;
  // An empty (or field-less) baseline object is treated as no baseline at
  // all: nothing has actually been captured yet, so it must not trip the
  // stub-with-baseline finding below (see styleProfileConfigBaselineHasSubstance).
  const configBaseline =
    rawConfigBaseline && styleProfileConfigBaselineHasSubstance(rawConfigBaseline)
      ? rawConfigBaseline
      : null;

  const hasH1 = STYLE_PROFILE_H1_RE.test(text);

  if (!hasH1) {
    // Pre-capture stub state (e.g. templates/book-scaffold's HTML-comment
    // stub): legitimate on its own, but only when config.json has not already
    // captured a baseline. capture-voice writes the profile and the baseline
    // together, so a baseline with no captured profile is inconsistent state.
    if (configBaseline) {
      findings.push({
        type: 'style-profile.stub-with-baseline',
        path: STYLE_PROFILE_REL_PATH,
        message:
          STYLE_PROFILE_REL_PATH + ' has no "# Style profile" heading (an uncaptured stub) but ' +
          '.studio/config.json already carries a stylometry baseline; capture-voice writes both ' +
          'together, so a baseline with no captured profile is inconsistent state. Run capture-voice ' +
          'to write the profile, or clear the baseline.'
      });
    } else {
      notices.push({
        type: 'style-profile.not-captured',
        path: STYLE_PROFILE_REL_PATH,
        message: 'style profile not yet captured; run capture-voice'
      });
    }
    return;
  }

  // ---- Populated state: seven required sections, present and in order -----
  const headings = styleProfileExtractH2Headings(text);
  const presentSet = new Set(headings);

  for (const section of STYLE_PROFILE_SECTIONS) {
    if (!presentSet.has(section)) {
      findings.push({
        type: 'style-profile.missing-section',
        path: STYLE_PROFILE_REL_PATH,
        message: STYLE_PROFILE_REL_PATH + ' is missing required section "' + section + '"'
      });
    }
  }

  // Order check, restricted to whichever expected sections are actually
  // present (a missing section is already reported above; this only catches
  // sections that exist but are sequenced wrong relative to each other).
  const seen = new Set();
  const actualOrder = [];
  for (const h of headings) {
    if (STYLE_PROFILE_SECTIONS.includes(h) && !seen.has(h)) {
      seen.add(h);
      actualOrder.push(h);
    }
  }
  const expectedOrder = STYLE_PROFILE_SECTIONS.filter(s => seen.has(s));
  if (actualOrder.join('|') !== expectedOrder.join('|')) {
    findings.push({
      type: 'style-profile.section-order',
      path: STYLE_PROFILE_REL_PATH,
      message:
        STYLE_PROFILE_REL_PATH + ' sections are out of order: expected order ' +
        expectedOrder.join(', ') + ' but found ' + actualOrder.join(', ')
    });
  }

  // ---- Baseline reference: required fields, then config agreement ---------
  const baselineBody = styleProfileSectionBody(text, '## Baseline reference');
  if (baselineBody !== null) {
    const baselineFields = styleProfileParseFieldBlock(baselineBody);

    for (const field of STYLE_PROFILE_BASELINE_FIELDS) {
      if (baselineFields[field] === undefined || baselineFields[field] === '') {
        findings.push({
          type: 'style-profile.baseline-field-missing',
          path: STYLE_PROFILE_REL_PATH,
          message:
            STYLE_PROFILE_REL_PATH + ' Baseline reference section is missing required field "' +
            field + '"'
        });
      }
    }

    // Config agreement (the format doc's first promised behavior): only
    // checked when config.json actually carries a baseline to compare against,
    // AND only per-field when config's own baseline actually carries that
    // field. voice-capture's current write contract (agents/voice-capture.md)
    // sets only markers/marker_set_version, not captured/sample_count, so a
    // real, current baseline commonly has neither; comparing against an
    // absent config field would otherwise report a false "disagrees with ...
    // undefined" finding on an otherwise-correct profile.
    if (configBaseline) {
      if (configBaseline.captured !== undefined &&
          baselineFields.captured !== undefined &&
          String(baselineFields.captured) !== String(configBaseline.captured)) {
        findings.push({
          type: 'style-profile.captured-disagreement',
          path: STYLE_PROFILE_REL_PATH,
          message:
            STYLE_PROFILE_REL_PATH + ' Baseline reference captured "' + baselineFields.captured +
            '" disagrees with .studio/config.json stylometry.baseline.captured "' +
            configBaseline.captured + '"'
        });
      }
      if (configBaseline.sample_count !== undefined && baselineFields.sample_count !== undefined) {
        const profileCount = Number(baselineFields.sample_count);
        if (profileCount !== configBaseline.sample_count) {
          findings.push({
            type: 'style-profile.sample-count-disagreement',
            path: STYLE_PROFILE_REL_PATH,
            message:
              STYLE_PROFILE_REL_PATH + ' Baseline reference sample_count "' +
              baselineFields.sample_count + '" disagrees with .studio/config.json ' +
              'stylometry.baseline.sample_count "' + configBaseline.sample_count + '"'
          });
        }
      }
    }
  }

  // ---- Exemplars: every listed path must resolve (the format doc's second
  //      promised behavior) ------------------------------------------------
  const exemplarsBody = styleProfileSectionBody(text, '## Exemplars');
  if (exemplarsBody !== null) {
    const exemplarPaths = styleProfileParseBulletPaths(exemplarsBody);
    for (const p of exemplarPaths) {
      const normalized = p.split('\\').join('/');
      const segments = normalized.split('/').filter(Boolean);
      if (segments.length === 0) continue;
      const absExemplar = join(root, ...segments);
      if (!existsSync(absExemplar)) {
        findings.push({
          type: 'style-profile.broken-exemplar-path',
          path: STYLE_PROFILE_REL_PATH,
          message:
            STYLE_PROFILE_REL_PATH + ' Exemplars section lists "' + normalized +
            '" but that path does not exist relative to the book root'
        });
      }
    }
  }
}

/**
 * Runs all checks in the TSK-028 check inventory against the given bible root.
 *
 * Returns { findings, notices } where:
 *   findings - exit-1 class issues (array of { type, path, message })
 *   notices  - informational coercion reports that do NOT affect exit code
 *              (array of { type, path, message })
 *
 * Checks run in order:
 *   1. Bible structure (scaffold-mandated paths)
 *   2. progress.json schema (via committed progress.schema.json)
 *   3. meta.json / config.json shape (required fields, enums; additionalProperties-tolerant)
 *   4. EV grammar (required fields, enum validation)
 *   5. SRC grammar (required fields, enum validation)
 *   6. Orphan claim markers (chapter markers referencing absent EV IDs)
 *   7. Orphan SRC references (SRC IDs in EV entries absent from sources.md, and vice versa)
 *   8. Word-count coherence (via checkWordCountCoherence; one implementation shared with gate)
 *   9. Config coercion notice (thesis_alignment mode block; REPORT only, not a finding)
 *  10. Snapshot naming conformance
 *  11. Style profile structure and baseline consistency (context/style-profile.md; F-CI-08,
 *      voice quality unchecked, deterministic half): seven required sections present and in
 *      order once the profile is populated; a pre-capture stub is a NOTICE, not a finding,
 *      unless config.json already carries a stylometry baseline (then it is a finding); the
 *      Baseline reference block's three required fields; captured/sample_count agreement with
 *      config.json's stylometry baseline when one exists; and Exemplars path resolution.
 *
 * @param {string} root - absolute path to the bible root
 * @returns {{ findings: object[], notices: object[] }}
 */
export function runChecks(root) {
  const findings = [];
  const notices = [];

  // ---- 1. Bible structure ---------------------------------------------------
  for (const rel of REQUIRED_PATHS) {
    const parts = rel.split('/');
    if (!existsSync(join(root, ...parts))) {
      findings.push({
        type: 'structure.missing-path',
        path: rel,
        message: 'required bible path is absent: ' + rel
      });
    }
  }

  // ---- 2. progress.json schema validation -----------------------------------
  const progressPath = join(root, '.studio', 'progress.json');
  let progress = null;
  if (existsSync(progressPath)) {
    let progressRaw;
    try {
      progressRaw = JSON.parse(readFileSync(progressPath, 'utf8'));
    } catch (err) {
      findings.push({
        type: 'schema.invalid-json',
        path: '.studio/progress.json',
        message: 'progress.json is not valid JSON: ' + err.message
      });
    }
    if (progressRaw !== undefined) {
      progress = progressRaw;
      // Validate against the committed progress.schema.json (banked adjudication).
      let schema = null;
      if (existsSync(PROGRESS_SCHEMA_PATH)) {
        try {
          schema = JSON.parse(readFileSync(PROGRESS_SCHEMA_PATH, 'utf8'));
        } catch {
          // Schema file unreadable; skip schema validation, don't fail doctor itself.
        }
      }
      if (schema) {
        const schemaErrors = validateAgainstSchema(schema, progressRaw, '');
        for (const e of schemaErrors) {
          findings.push({
            type: 'schema.progress-violation',
            path: '.studio/progress.json#' + e.path,
            message: e.message
          });
        }
      }
    }
  }

  // ---- 3. meta.json and config.json shape checks ----------------------------
  // meta.json is already confirmed readable (findBookRoot guarantees it); re-read for shape.
  const metaPath = join(root, '.studio', 'meta.json');
  let meta = null;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    // parse failure caught below
  }
  if (meta) {
    if (typeof meta.schema_version !== 'string') {
      findings.push({
        type: 'shape.meta-violation',
        path: '.studio/meta.json#schema_version',
        message: 'meta.json: schema_version must be a string; got ' + typeOf(meta.schema_version)
      });
    }
    if (typeof meta.created !== 'string') {
      findings.push({
        type: 'shape.meta-violation',
        path: '.studio/meta.json#created',
        message: 'meta.json: created must be a string (RFC 3339 UTC); got ' + typeOf(meta.created)
      });
    }
    if (typeof meta.plugin_version_at_creation !== 'string') {
      findings.push({
        type: 'shape.meta-violation',
        path: '.studio/meta.json#plugin_version_at_creation',
        message: 'meta.json: plugin_version_at_creation must be a string; got ' +
                 typeOf(meta.plugin_version_at_creation)
      });
    }
    // additionalProperties: unknown fields are tolerated per S-08 Rule 2 and banked adjudication 1.
  }

  const configPath = join(root, '.studio', 'config.json');
  let config = null;
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      findings.push({
        type: 'shape.config-violation',
        path: '.studio/config.json',
        message: 'config.json is not valid JSON: ' + err.message
      });
    }
    if (config) {
      if (!Number.isInteger(config.version)) {
        findings.push({
          type: 'shape.config-violation',
          path: '.studio/config.json#version',
          message: 'config.json: version must be an integer; got ' + typeOf(config.version)
        });
      }
      if (typeof config.gate !== 'object' || config.gate === null || Array.isArray(config.gate)) {
        findings.push({
          type: 'shape.config-violation',
          path: '.studio/config.json#gate',
          message: 'config.json: gate must be an object'
        });
      } else {
        const validGateModes = new Set(['off', 'warn', 'block']);
        if (config.gate.mode !== undefined && !validGateModes.has(config.gate.mode)) {
          findings.push({
            type: 'shape.config-violation',
            path: '.studio/config.json#gate.mode',
            message: 'config.json: gate.mode must be one of off, warn, block; got "' + config.gate.mode + '"'
          });
        }
      }
      // additionalProperties: unknown fields tolerated per banked adjudication 1.

      // ---- 9. Config coercion notice (thesis_alignment mode block) ----------
      // READ-ONLY SEMANTICS: the doctor REPORTS the coercion but does NOT rewrite
      // config.json. The coercion notice is informational; exit code is NOT affected.
      // This implements the D-03 (layered Stop gate) invariant: judgment checks
      // never block in v1. bin/ns-gate performs the actual coercion at gate time.
      if (
        config.gate &&
        config.gate.checks &&
        config.gate.checks.thesis_alignment &&
        config.gate.checks.thesis_alignment.mode === 'block'
      ) {
        notices.push({
          type: 'config-coercion.thesis-alignment',
          path: '.studio/config.json#gate.checks.thesis_alignment.mode',
          message:
            '[D-03 notice] thesis_alignment mode "block" will be coerced to "warn" at gate time ' +
            'per D-03 (layered Stop gate): judgment checks never block in v1. ' +
            'The doctor does not rewrite your config; this is an informational report only.'
        });
      }
    }
  }

  // ---- 4. EV grammar validation ---------------------------------------------
  const ledgerPath = join(root, 'research', 'evidence-log.md');
  let evEntries = [];
  if (existsSync(ledgerPath)) {
    let ledgerText;
    try {
      ledgerText = readFileSync(ledgerPath, 'utf8');
    } catch {
      ledgerText = null;
    }
    if (ledgerText !== null) {
      evEntries = parseEvidenceLog(ledgerText);
      for (const entry of evEntries) {
        const bad = [];
        // Required field presence (empty is allowed for locator; all others must be present)
        for (const field of EV_REQUIRED_FIELDS) {
          if (field === 'locator') continue; // locator may be blank (empty value)
          const val = entry[field];
          if (val === undefined || val === null || val === '') {
            bad.push('missing required field "' + field + '"');
          }
        }
        // Enum checks
        if (entry.confidence !== undefined && entry.confidence !== '' &&
            !EV_CONFIDENCE_VALID.has(entry.confidence)) {
          bad.push('confidence "' + entry.confidence + '" is not one of: ' +
                   [...EV_CONFIDENCE_VALID].join(', '));
        }
        if (entry.status !== undefined && entry.status !== '' &&
            !EV_STATUS_VALID.has(entry.status)) {
          bad.push('status "' + entry.status + '" is not one of: ' +
                   [...EV_STATUS_VALID].join(', '));
        }
        // Source ID format: must be SRC-nnnn or literal 'none'
        if (entry.source !== undefined && entry.source !== '' &&
            entry.source !== 'none' && !SRC_ID_RE.test(entry.source)) {
          bad.push('source "' + entry.source + '" is not a valid SRC ID (SRC-nnnn) or "none"');
        }
        if (bad.length > 0) {
          findings.push({
            type: 'ev-grammar.malformed-entry',
            path: 'research/evidence-log.md#' + entry.id,
            message: entry.id + ': ' + bad.join('; ')
          });
        }
      }
    }
  }

  // ---- 5. SRC grammar validation -------------------------------------------
  const sourcesPath = join(root, 'research', 'sources.md');
  let srcEntries = [];
  if (existsSync(sourcesPath)) {
    let sourcesText;
    try {
      sourcesText = readFileSync(sourcesPath, 'utf8');
    } catch {
      sourcesText = null;
    }
    if (sourcesText !== null) {
      srcEntries = parseSources(sourcesText);
      for (const entry of srcEntries) {
        const bad = [];
        if (!entry.type || entry.type === '') {
          bad.push('missing required field "type"');
        } else if (!SRC_TYPE_VALID.has(entry.type)) {
          bad.push('type "' + entry.type + '" is not one of: ' + [...SRC_TYPE_VALID].join(', '));
        }
        const rs = entry['retrieval-status'];
        if (rs !== undefined && rs !== '' && !SRC_RETRIEVAL_VALID.has(rs)) {
          bad.push('retrieval-status "' + rs + '" is not one of: ' + [...SRC_RETRIEVAL_VALID].join(', '));
        }
        if (bad.length > 0) {
          findings.push({
            type: 'src-grammar.malformed-entry',
            path: 'research/sources.md#' + entry.id,
            message: entry.id + ': ' + bad.join('; ')
          });
        }
      }
    }
  }

  // ---- 6. Orphan claim markers ----------------------------------------------
  // Uses claims-engine.mjs scanChapter to find [claim: EV-nnnn] markers that
  // reference EV IDs absent from the ledger (same logic as ns-claims coverage).
  const chaptersDir = join(root, 'chapters');
  let chapterFiles = [];
  if (existsSync(chaptersDir)) {
    try {
      chapterFiles = readdirSync(chaptersDir)
        .filter(f => f.endsWith('.md'))
        .sort();
    } catch {
      chapterFiles = [];
    }
  }

  for (const filename of chapterFiles) {
    const absPath = join(chaptersDir, filename);
    let chText;
    try {
      chText = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }
    // scanChapter resolves [claim: EV-nnnn] markers against the ledger.
    // Unresolved markers with reason containing "not found" are orphan references.
    const markers = scanChapter(chText, evEntries);
    for (const m of markers) {
      if (!m.resolved && m.form === 'claim' && m.reason && m.reason.includes('not found')) {
        findings.push({
          type: 'claim-marker.orphan-ev',
          path: 'chapters/' + filename + ':' + m.line,
          message: 'chapter ' + filename + ' line ' + m.line + ': [claim: ' + m.id +
                   '] references ' + m.id + ' which is absent from research/evidence-log.md'
        });
      }
    }
  }

  // ---- 7. Orphan SRC references --------------------------------------------
  // Check: SRC IDs referenced in EV entries but absent from sources.md
  const srcIdSet = new Set(srcEntries.map(e => e.id));
  const referencedSrcIds = new Set();
  for (const ev of evEntries) {
    if (ev.source && ev.source !== 'none' && SRC_ID_RE.test(ev.source)) {
      referencedSrcIds.add(ev.source);
    }
  }
  for (const srcId of referencedSrcIds) {
    if (!srcIdSet.has(srcId)) {
      findings.push({
        type: 'src-ref.orphan-referenced',
        path: 'research/sources.md',
        message: 'SRC ID ' + srcId + ' is referenced in research/evidence-log.md but absent from research/sources.md'
      });
    }
  }
  // Check: SRC IDs defined in sources.md but referenced by no EV entry
  for (const src of srcEntries) {
    if (!referencedSrcIds.has(src.id)) {
      findings.push({
        type: 'src-ref.orphan-defined',
        path: 'research/sources.md#' + src.id,
        message: 'SRC ID ' + src.id + ' is defined in research/sources.md but referenced by no evidence entry'
      });
    }
  }

  // ---- 8. Word-count coherence (shared with gate-engine.mjs via export) ----
  // [TSK-029b (state-coherence gate check) 2026-07-18: extracted to checkWordCountCoherence
  //  above; gate-engine.mjs imports and calls the same export. One implementation, two callers.]
  for (const f of checkWordCountCoherence(root)) {
    findings.push(f);
  }

  // ---- 10. Snapshot naming conformance ------------------------------------
  const snapshotDir = join(root, '.studio', 'snapshots');
  if (existsSync(snapshotDir)) {
    let snapshotFiles;
    try {
      snapshotFiles = readdirSync(snapshotDir);
    } catch {
      snapshotFiles = [];
    }
    for (const fname of snapshotFiles) {
      // Skip .gitkeep and other housekeeping files
      if (fname.startsWith('.')) continue;
      if (!SNAPSHOT_NAME_RE.test(fname)) {
        findings.push({
          type: 'snapshot.bad-name',
          path: '.studio/snapshots/' + fname,
          message: 'snapshot file "' + fname + '" does not match naming convention ' +
                   '<slug>.<YYYYMMDDTHHMMSSZ>.md'
        });
      }
    }
  }

  // ---- 11. Style profile structure and baseline consistency ---------------
  checkStyleProfile(root, config, findings, notices);

  return { findings, notices };
}
