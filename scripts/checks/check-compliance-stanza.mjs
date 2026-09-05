#!/usr/bin/env node
// scripts/checks/check-compliance-stanza.mjs
// what-it-is:   Tier A checker locking the shared chat-compliance stanza across every
//               agent-dispatching skill (Task 5, chat compliance parity)
// what-it-does: derives the "dispatching skill" set from each skill's OWN frontmatter --
//               a skill dispatches agents iff its `chain:` list is a non-empty array (never a
//               hardcoded name list, so a future seventh skill that adds a `chain:` entry without
//               the stanza is caught automatically) -- then, for each dispatching skill, extracts
//               the shared compliance-stanza core: the text between the literal heading
//               "### Compliance append (verify-then-append)" and the literal per-flow marker
//               "**Record template" that follows it in every skill. Asserts three things:
//                 1. every dispatching skill actually carries that heading-to-marker block at all
//                    (a skill missing the block entirely is a named finding);
//                 2. the extracted core contains three fixed sentinel substrings (the six-field
//                    shape reference, the never-double-append sentence, and the stale-record-does-
//                    not-suppress clause) -- independent of the cross-skill comparison below, so a
//                    mutation that edits all six skills identically (degrading the rule while
//                    keeping them mutually equal) is still caught, not just a single-skill outlier;
//                 3. every extracted core is byte-identical to the first one found (skills sorted
//                    alphabetically by directory name) -- the shared-core acceptance criterion.
//               Per-flow record templates (the JSON block(s) after the "**Record template" marker)
//               are explicitly OUT of the comparison: those vary by design (agent slug, scope,
//               targets, summary wording per flow).
// why:          Task 5 (chat compliance parity, Wave 1 exit) - "a policy asserted in prose and
//               enforced by nothing is not a control" (C2, enforcement theater), applied to the
//               verify-then-append compliance rule the same way check-workspace-refs.mjs applies
//               it to the workspace-reference rule.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

const PREFIX = '[check-compliance-stanza]';

function fatal(message) {
  process.stderr.write(PREFIX + ' FATAL: ' + message + '\n');
  process.exit(2);
}

// The literal anchors that bound the shared core in every dispatching skill's SKILL.md.
const CORE_HEADING = '### Compliance append (verify-then-append)';
const TEMPLATE_MARKER = '**Record template';

// Sentinel substrings the shared core must always contain. These are checked independent of
// the cross-skill byte-identical comparison below: pairwise equality alone would still pass if
// every skill were mutated identically (the same find/replace degrading all six in lockstep), so
// these fixed requirements give the checker an absolute floor, not only a relative one.
const REQUIRED_SENTINELS = [
  // the six-field shape reference
  'six-field shape in `docs/formats/ai-use-log.md`',
  // the never-double-append sentence
  'This skill never appends twice for the same write.',
  // the stale-record-does-not-suppress clause (the reviewer pressure-test's second scenario)
  "only a count increase observed between this flow's own two reads does",
];

// Frontmatter fence regex, deliberately hand-rolled rather than importing scripts/lib/frontmatter.mjs
// (which depends on the "yaml" npm package): this checker stays a zero-dependency standalone
// script, matching check-workspace-refs.mjs's convention, and only ever needs one field
// (`chain:`, a flat list of bare strings) -- a full YAML parse is more machinery than that needs.
const FRONTMATTER_FENCE_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Returns the skill's declared `chain:` list as an array of trimmed strings, or [] when the
 * frontmatter is absent, malformed, or carries no `chain:` key. Only handles the flat
 * "chain:\n  - item\n  - item" shape actually used by every SKILL.md in this repo.
 */
function extractChainList(text) {
  const fenceMatch = FRONTMATTER_FENCE_RE.exec(text);
  if (!fenceMatch) return [];
  const lines = fenceMatch[1].split(/\r?\n/);
  const startIdx = lines.findIndex((l) => /^chain:\s*$/.test(l));
  if (startIdx === -1) return [];
  const items = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = /^\s*-\s*(.+?)\s*$/.exec(lines[i]);
    if (!m) break; // the list ends at the first line that isn't a "- item" entry
    items.push(m[1]);
  }
  return items;
}

/** Returns the frontmatter's `name:` value, or null when absent. */
function extractFrontmatterName(text) {
  const fenceMatch = FRONTMATTER_FENCE_RE.exec(text);
  if (!fenceMatch) return null;
  const m = /^name:\s*(.+?)\s*$/m.exec(fenceMatch[1]);
  return m ? m[1] : null;
}

/**
 * Extracts the text from CORE_HEADING (inclusive) up to TEMPLATE_MARKER (exclusive), trimmed.
 * Returns null when either anchor is absent, or the marker appears before the heading.
 */
function extractCore(text) {
  const headingIdx = text.indexOf(CORE_HEADING);
  if (headingIdx === -1) return null;
  const templateIdx = text.indexOf(TEMPLATE_MARKER, headingIdx + CORE_HEADING.length);
  if (templateIdx === -1) return null;
  return text.slice(headingIdx, templateIdx).trim();
}

// ---------------------------------------------------------------------------
// Derive the dispatching-skill set from each skill's own frontmatter `chain:` list.
// ---------------------------------------------------------------------------

if (!existsSync(SKILLS_DIR)) {
  fatal('skills/ directory not found at ' + SKILLS_DIR);
}

let skillDirNames;
try {
  skillDirNames = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
} catch (err) {
  fatal('cannot list ' + SKILLS_DIR + ': ' + err.message);
}

const dispatching = []; // { name, relPath, absPath, text }

for (const dirName of skillDirNames) {
  const absPath = join(SKILLS_DIR, dirName, 'SKILL.md');
  if (!existsSync(absPath)) continue;
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (err) {
    fatal('cannot read ' + absPath + ': ' + err.message);
  }
  const chain = extractChainList(text);
  if (chain.length === 0) continue; // not a dispatching skill
  dispatching.push({
    name: extractFrontmatterName(text) || dirName,
    relPath: 'skills/' + dirName + '/SKILL.md',
    absPath,
    text,
  });
}

if (dispatching.length === 0) {
  fatal(
    'zero agent-dispatching skills found under ' + SKILLS_DIR + ' (a skill whose frontmatter ' +
    'declares a non-empty `chain:` list). This indicates a broken checkout or a resolution bug, ' +
    'not a clean pass -- six such skills are known to exist today.'
  );
}

// ---------------------------------------------------------------------------
// Extract and validate the core block from each dispatching skill.
// ---------------------------------------------------------------------------

const findings = [];
const cores = []; // { relPath, core }

for (const skill of dispatching) {
  const core = extractCore(skill.text);
  if (core === null) {
    findings.push(
      skill.relPath + ': lacks the shared compliance-stanza core (no "' + CORE_HEADING +
      '" section followed by a "' + TEMPLATE_MARKER + '" record-template marker)'
    );
    continue;
  }
  for (const sentinel of REQUIRED_SENTINELS) {
    if (!core.includes(sentinel)) {
      findings.push(
        skill.relPath + ': compliance-stanza core is missing required text: "' + sentinel + '"'
      );
    }
  }
  cores.push({ relPath: skill.relPath, core });
}

// Byte-identical comparison: every extracted core must match the first one found
// (skills sorted alphabetically by directory name above), so a single outlier is named
// by comparison to the shared majority rather than to a hardcoded reference string.
if (cores.length > 1) {
  const [reference, ...rest] = cores;
  for (const c of rest) {
    if (c.core !== reference.core) {
      findings.push(
        c.relPath + ': compliance-stanza core differs from ' + reference.relPath +
        ' (the shared core must be byte-identical across every dispatching skill)'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

process.stdout.write(
  PREFIX + ' ' + dispatching.length + ' dispatching skill(s) found (frontmatter `chain:` non-empty): ' +
  dispatching.map((s) => s.name).sort().join(', ') + '\n'
);

if (findings.length === 0) {
  process.stdout.write(
    PREFIX + ' pass: shared compliance-stanza core is present and byte-identical across all ' +
    dispatching.length + ' dispatching skill(s)\n'
  );
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
