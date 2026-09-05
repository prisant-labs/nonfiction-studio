// what-it-is:   per-project studio settings reader (P1/P2, Wave 1 exit Task 2)
// what-it-does: walks UP from a start directory (same walk shape as findBookRoot in
//               hooks/lib/bible.mjs) looking for .claude/nonfiction-studio.local.md; parses its
//               YAML frontmatter with the yaml package (the same runtime dependency
//               scripts/lib/frontmatter.mjs already uses, loaded lazily here so a missing
//               node_modules/yaml cannot crash any hook at import time); validates the P2 schema
//               keys individually, dropping only the offending key on a type mismatch and
//               keeping valid siblings; returns { settings, body, warning, path }.
// why:          a corrupt or absent settings file must never break a session (hooks fail open)
//               and must never silently disable a guard -- corruption always warns loudly and
//               defaults to empty settings, never a thrown error and never a false pass.
// used-by:      hooks/lib/gate-engine.mjs (loadGateConfig overlay), hooks/session-start.mjs
//               (house-notes pointer line); a later wave task also reads routing_enforce for the
//               PreToolUse dispatch guard.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

// The YAML frontmatter fence, matching scripts/lib/frontmatter.mjs's own FENCE exactly (same
// format contract; this module does not import that one directly since hooks/ and scripts/ are
// separate boundaries with no cross-import precedent elsewhere in the repo -- see bible.mjs's
// used-by comment on keeping one implementation per boundary).
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

const SETTINGS_DIR = '.claude';
const SETTINGS_FILENAME = 'nonfiction-studio.local.md';

const MODE_ENUM = new Set(['off', 'warn', 'block']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Collapses embedded newlines/runs of whitespace to a single space, keeping every warning
 * sentence a single printable line for stderr consumers. */
function singleLine(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

// P2 schema v1: each key's own type/enum validator plus a one-clause description used in the
// per-key drop warning. Unknown keys are NOT in this table -- they are preserved on the returned
// settings object without validation (S-08 Rule 2 style forward-compat), per P1.
const KEY_SCHEMA = {
  gate_mode: {
    valid: v => typeof v === 'string' && MODE_ENUM.has(v),
    describe: 'must be one of "off", "warn", "block"',
  },
  thresholds: {
    valid: isPlainObject,
    describe: 'must be an object',
  },
  // Consumed by a later wave task (PreToolUse dispatch guard); this task only validates and
  // passes it through.
  routing_enforce: {
    valid: v => typeof v === 'string' && MODE_ENUM.has(v),
    describe: 'must be one of "off", "warn", "block"',
  },
  // Consumed by a later wave task (output-style offer record); this task only validates and
  // passes it through. A plain string record ("manuscript" | "review" | "declined"), so only
  // the type is checked here -- the specific enum belongs to the task that writes it.
  output_style: {
    valid: v => typeof v === 'string',
    describe: 'must be a string',
  },
};

/**
 * Lazily loads the yaml package's parse function. Loaded via createRequire (not a static
 * top-of-file import) so a checkout missing node_modules/yaml cannot crash gate-engine.mjs (and
 * therefore stop-gate.mjs and every ns-gate invocation) at MODULE LOAD time -- fail-open extends
 * to the dependency itself, not just to file-read/parse errors. Cached after first attempt.
 *
 * @returns {{ parse: Function|null, error: Error|null }}
 */
let _yamlAttempted = false;
let _yamlParse = null;
let _yamlError = null;
function loadYamlParse() {
  if (_yamlAttempted) return { parse: _yamlParse, error: _yamlError };
  _yamlAttempted = true;
  try {
    const req = createRequire(import.meta.url);
    const mod = req('yaml');
    _yamlParse = mod.parse;
  } catch (err) {
    _yamlError = err;
  }
  return { parse: _yamlParse, error: _yamlError };
}

/**
 * Validates the P2 schema keys on a parsed frontmatter object. Unknown keys are copied through
 * unvalidated (preserved and ignored, per P1). A known key with the wrong type/value is dropped
 * individually -- one warning sentence per dropped key, and the key name recorded in droppedKeys
 * -- and every valid key (known or unknown) survives.
 *
 * droppedKeys (Wave 1 exit Task 8 fix round 2) exists so a caller with more than one settings
 * key in play -- the PreToolUse dispatch-routing branch is the first such caller -- can tell "the
 * key I care about was itself invalid and dropped" apart from "some OTHER key was invalid, but
 * mine parsed fine (or was simply absent)". A single shared `warning` string cannot make that
 * distinction; droppedKeys can, by name.
 *
 * @param {object} data - parsed YAML frontmatter (already confirmed to be a plain object)
 * @param {string} path - absolute settings file path, named in each warning sentence
 * @returns {{ settings: object, warnings: string[], droppedKeys: string[] }}
 */
function validateKnownKeys(data, path) {
  const settings = {};
  const warnings = [];
  const droppedKeys = [];
  for (const key of Object.keys(data)) {
    const schema = KEY_SCHEMA[key];
    if (!schema) {
      settings[key] = data[key];
      continue;
    }
    if (schema.valid(data[key])) {
      settings[key] = data[key];
    } else {
      droppedKeys.push(key);
      warnings.push(
        singleLine(
          'Settings file at ' + path + ': "' + key + '" ' + schema.describe +
          '; got ' + JSON.stringify(data[key]) + '; key dropped.'
        )
      );
    }
  }
  return { settings, warnings, droppedKeys };
}

/**
 * Reads and parses one confirmed-present settings file. Every WHOLE-FILE failure path (unreadable
 * file, missing frontmatter fence, invalid YAML, non-object frontmatter, unavailable yaml parser)
 * returns EMPTY settings plus a one-sentence warning naming the file, and an EMPTY droppedKeys --
 * never a thrown error, and never a per-key attribution when the whole file is the casualty, not
 * any one key. A per-KEY failure (the file parsed fine; one or more known keys individually failed
 * their own schema) instead returns the surviving settings, the joined warning sentence(s), AND a
 * non-empty droppedKeys naming exactly which keys were dropped -- see validateKnownKeys' own
 * comment for why this distinction exists and who reads it.
 *
 * @param {string} path - absolute path to an existing .claude/nonfiction-studio.local.md
 * @returns {{ settings: object, body: string, warning: string|null, path: string, droppedKeys: string[] }}
 */
function parseSettingsFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return {
      settings: {},
      body: '',
      warning: 'Settings file at ' + path + ' could not be read (' + err.message + '); using defaults.',
      path,
      droppedKeys: [],
    };
  }

  const m = text.match(FENCE);
  if (!m) {
    return {
      settings: {},
      body: text,
      warning:
        'Settings file at ' + path +
        ' is missing YAML frontmatter (a --- fenced block at the top of the file); using defaults.',
      path,
      droppedKeys: [],
    };
  }

  const { parse: parseYaml, error: yamlError } = loadYamlParse();
  if (!parseYaml) {
    return {
      settings: {},
      body: m[2],
      warning:
        'Settings file at ' + path + ' could not be parsed: the yaml parser is unavailable (' +
        (yamlError ? yamlError.message : 'unknown error') + '); using defaults.',
      path,
      droppedKeys: [],
    };
  }

  let data;
  try {
    // prettyErrors: false suppresses the multi-line source-snippet code frame the yaml package
    // otherwise appends to YAMLParseError#message -- a warning naming the file must stay one
    // sentence (P1), not a code-frame dump.
    data = parseYaml(m[1], { prettyErrors: false });
  } catch (err) {
    return {
      settings: {},
      body: m[2],
      warning: 'Settings file at ' + path + ' has invalid YAML frontmatter (' + singleLine(err.message) + '); using defaults.',
      path,
      droppedKeys: [],
    };
  }

  // An empty (or comments/whitespace-only) frontmatter block parses to null -- a normal, valid
  // "no settings set" state (e.g. a copy of the example template with every key left commented
  // out), not a corruption case. This is the one place null is treated as success rather than
  // routed into the "not a key/value map" warning below: a wrong-type but DEFINED value (a
  // string, a number, a YAML list) still warns, since that is an authored mistake, not an
  // intentionally empty file.
  if (data === null) {
    return { settings: {}, body: m[2], warning: null, path, droppedKeys: [] };
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    return {
      settings: {},
      body: m[2],
      warning: 'Settings file at ' + path + ' frontmatter is not a key/value map; using defaults.',
      path,
      droppedKeys: [],
    };
  }

  const { settings, warnings, droppedKeys } = validateKnownKeys(data, path);
  return {
    settings,
    body: m[2],
    warning: warnings.length > 0 ? warnings.join(' ') : null,
    path,
    droppedKeys,
  };
}

/**
 * Locates and reads the per-project studio settings file, walking UP from startDir the same way
 * findBookRoot (hooks/lib/bible.mjs) walks up looking for the book root: the first ancestor
 * directory (including startDir itself) containing .claude/nonfiction-studio.local.md wins.
 * Absent anywhere in the ancestor chain is silent success -- empty settings, no warning, empty
 * droppedKeys, per P1 (a settings file is optional; its absence is normal, not an error).
 *
 * droppedKeys (Wave 1 exit Task 8 fix round 2, additive to this function's pre-existing contract)
 * names every KNOWN key that was present but individually dropped for failing its own schema --
 * empty when nothing was dropped, including every whole-file failure path (see parseSettingsFile).
 *
 * @param {string} startDir - directory to start walking up from
 * @returns {{ settings: object, body: string, warning: string|null, path: string|null, droppedKeys: string[] }}
 */
export function loadSettings(startDir) {
  let current = resolve(startDir);

  for (;;) {
    const candidate = join(current, SETTINGS_DIR, SETTINGS_FILENAME);
    if (existsSync(candidate)) {
      return parseSettingsFile(candidate);
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return { settings: {}, body: '', warning: null, path: null, droppedKeys: [] };
}
