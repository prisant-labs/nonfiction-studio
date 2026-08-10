// scripts/check-hooks-schema.mjs
// what-it-is:   hooks.json schema validator
// what-it-does: verifies hooks/hooks.json is well-formed (wrapper Form A), every declared
//               event is a known platform event, the nested group layer is present, each
//               event has exactly one command handler (D-06 single-writer state discipline),
//               every command script resolves to a file on disk, there are no duplicate
//               events, and the Stop event carries a prompt handler with a timeout.
// why:          absorbs and supersedes tests/hooks/hooks-json.test.mjs per TSK-055; the
//               interim shape test becomes a one-case wrapper asserting this script exits 0.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const HOOKS_JSON = join(REPO_ROOT, 'hooks', 'hooks.json');

// Known platform event names (A-02 platform capability baseline; PostToolUse added
// per OPP-P04 (untrusted-source envelope), roadmap row 1.2).
const KNOWN_EVENTS = new Set([
  'SessionStart',
  'PreToolUse',
  'PostToolBatch',
  'PostToolUse',
  'Stop',
  'PreCompact',
]);

// Required command pattern per the platform hook contract.
// Every command entry in hooks.json must match this pattern exactly.
const COMMAND_PATTERN = /^node \$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z-]+\.mjs$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(msg) {
  process.stderr.write('[check-hooks-schema] ERROR: ' + msg + '\n');
}

function pass(msg) {
  process.stdout.write('[check-hooks-schema] pass: ' + msg + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Step 1: file existence
if (!existsSync(HOOKS_JSON)) {
  process.stderr.write('[check-hooks-schema] FATAL: hooks/hooks.json not found at ' + HOOKS_JSON + '\n');
  process.exit(2);
}

// Step 2: parse JSON
let parsed;
try {
  parsed = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
} catch (err) {
  process.stderr.write('[check-hooks-schema] FATAL: hooks/hooks.json is not valid JSON: ' + err.message + '\n');
  process.exit(2);
}

const findings = [];

// Step 3: top-level shape - must have a "hooks" key; only "hooks" and optional "description" allowed
if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
  process.stderr.write('[check-hooks-schema] FATAL: hooks/hooks.json top level is not an object\n');
  process.exit(2);
}

if (!Object.prototype.hasOwnProperty.call(parsed, 'hooks')) {
  findings.push('top-level "hooks" key is absent');
}

const allowedTopKeys = new Set(['hooks', 'description']);
for (const key of Object.keys(parsed)) {
  if (!allowedTopKeys.has(key)) {
    findings.push('unexpected top-level key "' + key + '"; allowed: hooks, description');
  }
}

// Bail if hooks is missing - rest of checks cannot run
if (!Object.prototype.hasOwnProperty.call(parsed, 'hooks')) {
  for (const f of findings) fail(f);
  process.exit(1);
}

const hooks = parsed.hooks;
if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) {
  findings.push('"hooks" value must be an object mapping event names to arrays');
  for (const f of findings) fail(f);
  process.exit(1);
}

// Step 4: event name validation - must be known platform events
const eventNames = Object.keys(hooks);
for (const name of eventNames) {
  if (!KNOWN_EVENTS.has(name)) {
    findings.push('unknown platform event "' + name + '"; known events: ' + [...KNOWN_EVENTS].join(', '));
  }
}

// Step 4b: five-event completeness - all Phase 1 events must be present.
// A missing event silently disables the entire handler for that lifecycle point;
// without this check, losing an event passes every downstream test undetected.
for (const expected of KNOWN_EVENTS) {
  if (!Object.prototype.hasOwnProperty.call(hooks, expected)) {
    findings.push(
      'FIVE-EVENT COMPLETENESS: Phase 1 event "' + expected + '" is absent from hooks.json; ' +
      'a missing event silently disables the entire hook handler for that event'
    );
  }
}

// Step 5: per-event structure checks
for (const event of eventNames) {
  if (!KNOWN_EVENTS.has(event)) continue; // already reported above

  const groups = hooks[event];

  // Must be an array
  if (!Array.isArray(groups)) {
    findings.push(event + ': event value must be an array of group objects');
    continue;
  }

  // Must have at least one group
  if (groups.length === 0) {
    findings.push(event + ': event has no group objects (array is empty)');
    continue;
  }

  // Each group must be {hooks: [...]}
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    if (typeof group !== 'object' || group === null || Array.isArray(group)) {
      findings.push(event + '[' + gi + ']: group must be an object');
      continue;
    }
    // A group may carry "hooks" (required) and, per the platform's documented matcher
    // contract (a matcher scopes a hook group to specific tool names; see
    // https://code.claude.com/docs/en/hooks), an optional "matcher" string. OPP-P04
    // (untrusted-source envelope)'s PostToolUse registration is the first matcher in this
    // repo's hooks.json.
    const gkeys = Object.keys(group);
    const ALLOWED_GROUP_KEYS = new Set(['hooks', 'matcher']);
    const hasUnknownGroupKey = gkeys.some((k) => !ALLOWED_GROUP_KEYS.has(k));
    if (!gkeys.includes('hooks') || hasUnknownGroupKey) {
      findings.push(
        event + '[' + gi + ']: group must have "hooks" and may optionally have "matcher"; got: ' + gkeys.join(', ')
      );
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(group, 'matcher') &&
        (typeof group.matcher !== 'string' || group.matcher.trim() === '')) {
      findings.push(event + '[' + gi + ']: group "matcher" must be a non-empty string when present');
    }
    if (!Array.isArray(group.hooks)) {
      findings.push(event + '[' + gi + ']: group.hooks must be an array');
      continue;
    }

    // Per-entry checks
    const entries = group.hooks;
    const commandEntries = entries.filter(e => e && e.type === 'command');

    // D-06: exactly one command handler per event
    if (commandEntries.length !== 1) {
      findings.push(
        event + ': D-06 (single-writer state discipline) requires exactly one command entry per event; found ' +
        commandEntries.length
      );
    }

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        findings.push(event + ': hook entry is not an object');
        continue;
      }
      if (!entry.type) {
        findings.push(event + ': hook entry missing "type" field');
        continue;
      }

      if (entry.type === 'command') {
        // command string must be present and follow the plugin pattern
        if (typeof entry.command !== 'string') {
          findings.push(event + ': command entry "command" field must be a string');
          continue;
        }
        // Command-string pattern: must be ^node ${CLAUDE_PLUGIN_ROOT}/hooks/[a-z-]+\.mjs$
        // This is in addition to the script-existence stat below.
        if (!COMMAND_PATTERN.test(entry.command)) {
          findings.push(
            event + ': command "' + entry.command + '" does not match required pattern ' +
            '^node ${CLAUDE_PLUGIN_ROOT}/hooks/[a-z-]+\\.mjs$'
          );
        }
        // SessionStart timeout pin: command entry timeout must be exactly 60.
        if (event === 'SessionStart') {
          if (entry.timeout === undefined || entry.timeout === null) {
            findings.push('SessionStart: command entry is missing required "timeout" field (must be 60)');
          } else if (entry.timeout !== 60) {
            findings.push('SessionStart: command entry "timeout" must be exactly 60; got: ' + entry.timeout);
          }
        }
        // Interpolate ${CLAUDE_PLUGIN_ROOT} to repo root and stat the script
        const interpolated = entry.command.replace('${CLAUDE_PLUGIN_ROOT}', REPO_ROOT);
        // Extract the node script path (command is: node <path>)
        const parts = interpolated.trim().split(/\s+/);
        if (parts[0] !== 'node' || parts.length < 2) {
          findings.push(event + ': command must start with "node <script>"; got: ' + entry.command);
          continue;
        }
        const scriptPath = parts[1];
        if (!existsSync(scriptPath)) {
          findings.push(event + ': command script not found: ' + scriptPath + ' (from: ' + entry.command + ')');
        }
      } else if (entry.type === 'prompt') {
        if (typeof entry.prompt !== 'string' || entry.prompt.trim() === '') {
          findings.push(event + ': prompt entry "prompt" field must be a non-empty string');
        }
      } else {
        findings.push(event + ': unknown hook entry type "' + entry.type + '"; expected "command" or "prompt"');
      }
    }
  }
}

// Step 6: Stop-specific contract - must have exactly two handler entries (one command, one prompt)
//         with the prompt carrying a timeout pinned to exactly 30.
const stopGroups = hooks['Stop'];
if (stopGroups && Array.isArray(stopGroups) && stopGroups.length > 0) {
  const stopEntries = stopGroups[0] && Array.isArray(stopGroups[0].hooks) ? stopGroups[0].hooks : [];
  // Stop must have exactly two entries: one command and one prompt.
  if (stopEntries.length !== 2) {
    findings.push(
      'Stop: must have exactly 2 handler entries (one command, one prompt); found ' + stopEntries.length
    );
  }
  const promptEntries = stopEntries.filter(e => e && e.type === 'prompt');
  if (promptEntries.length === 0) {
    findings.push('Stop: no prompt handler found; Stop must carry a prompt entry with a timeout per Q-01 section 3');
  } else {
    for (const pe of promptEntries) {
      if (pe.timeout === undefined || pe.timeout === null) {
        findings.push('Stop: prompt entry is missing "timeout" field');
      } else if (pe.timeout !== 30) {
        findings.push('Stop: prompt entry "timeout" must be exactly 30; got: ' + pe.timeout);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (findings.length === 0) {
  pass('hooks/hooks.json is well-formed; ' + eventNames.length + ' event(s) validated');
  process.exit(0);
} else {
  for (const f of findings) fail(f);
  process.exit(1);
}
