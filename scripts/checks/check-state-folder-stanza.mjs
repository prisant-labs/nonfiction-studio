#!/usr/bin/env node
// scripts/checks/check-state-folder-stanza.mjs
// what-it-is:   Tier A checker locking the shared "Locate the state folder" stanza across every
//               skill that reads or writes the book's state folder itself, and keeping the
//               folder's literal names out of skill and agent prose (ADR-0015, state folder name)
// what-it-does: a skill names state paths as `<state-dir>/...`, and the stanza tells the model how
//               to resolve that placeholder from the pointer file. This checker asserts:
//                 1. the stanza set is derived, never hardcoded: a SKILL.md carries the stanza
//                    exactly when it names `<state-dir>` outside the stanza. A placeholder with
//                    no stanza is a finding, and so is a stanza with no placeholder (a dead
//                    stanza that only costs the model tool calls);
//                 2. the stanza appears once, before the skill's first "## Step" heading, so the
//                    folder is resolved before any step uses it;
//                 3. every stanza is byte-identical to the first one found (skills sorted by
//                    directory name with plain code-unit comparison);
//                 4. the stanza carries sentinels derived from hooks/lib/bible.mjs - the pointer
//                    file's name, the default folder name, the name pattern's source, and every
//                    reserved name - so a change to the resolver's rule that the prose does not
//                    follow is caught even when every copy drifts identically;
//                 5. no .md file under skills/ or agents/ names the default or the legacy folder
//                    outside a stanza. The default name preceded by "/" is exempt, because a
//                    book-relative state path never is: it is part of a longer path inside a
//                    shipped tree, such as the scaffold template or the tour's copy of the sample
//                    book. The legacy name has no such exemption, since no shipped tree uses it.
//                    LITERAL_ALLOWLIST below names the files exempt in full;
//                 6. an agent that names `<state-dir>` carries AGENT_NOTE verbatim, and no agent
//                    carries the skill stanza: agents never resolve the folder themselves.
// why:          ADR-0015 (state folder name) - skills cannot import the resolver, so a prose
//               stanza stands in for it, and "a policy asserted in prose and enforced by nothing
//               is not a control" (the reasoning behind check-compliance-stanza.mjs) applies to
//               this stanza too. A literal folder name in a skill bypasses the pointer and writes
//               to the wrong folder in any book that names a different one.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STATE_DIR,
  LEGACY_STATE_DIR,
  POINTER_FILE,
  RESERVED_STATE_DIR_NAMES,
  STATE_DIR_NAME_RE
} from '../../hooks/lib/bible.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const AGENTS_DIR = join(REPO_ROOT, 'agents');

const PREFIX = '[check-state-folder-stanza]';

function fatal(message) {
  process.stderr.write(PREFIX + ' FATAL: ' + message + '\n');
  process.exit(2);
}

const STANZA_HEADING = '## Locate the state folder';
const PLACEHOLDER = '<state-dir>';

// The one sentence every agent that names the placeholder carries, so each agent knows where the
// name comes from and what to do when a brief leaves it out.
export const AGENT_NOTE =
  '`<state-dir>` stands for the book\'s state folder. The skill that dispatched you names that ' +
  'folder in your brief, and you never resolve it yourself. If your brief does not name it, read ' +
  'and write nothing under it, and say so in your reply. When you dispatch another agent, pass ' +
  'the same folder name in its brief.';

// Files that may name the default or legacy folder outside a stanza, with the reason.
const LITERAL_ALLOWLIST = new Map([
  [
    'skills/nfs-doctor/SKILL.md',
    'the doctor repairs a bad pointer and moves an unpointed folder, so it runs without the ' +
      'stanza (which stops on both) and must name the default and the legacy folder'
  ]
]);

// Sentinels the stanza must contain. Derived from bible.mjs wherever the resolver defines the
// fact, so the prose cannot keep an old rule after the code changes.
const STANZA_SENTINELS = [
  '`' + POINTER_FILE + '`',
  '`' + DEFAULT_STATE_DIR + '`',
  '`' + STATE_DIR_NAME_RE.source + '`',
  ...RESERVED_STATE_DIR_NAMES.map((name) => '`' + name + '`'),
  '`.` or `..`',
  'without regard to case',
  '`meta.json`',
  '`progress.json`',
  '/nonfiction-studio:nfs-doctor',
  'Never fall back to',
  'Never create a second state folder',
  'dispatch brief'
];

/** Escapes a string for use inside a RegExp. */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A literal folder name: not preceded by a word character, and not followed by a word character
// or "-". The default name is exempt when preceded by "/", because a book-relative state path
// never is: it is part of a longer path inside a shipped tree. The legacy name has no such
// exemption, because no shipped tree uses it any longer, so a "/"-prefixed legacy name is stale.
const LITERAL_RE = new RegExp(
  '(?<!\\w)(' + escapeRe(LEGACY_STATE_DIR) + ')(?![\\w-])|' +
    '(?<![\\w/])(' + escapeRe(DEFAULT_STATE_DIR) + ')(?![\\w-])',
  'g'
);

const toRel = (abs) => relative(REPO_ROOT, abs).split('\\').join('/');
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Finds every stanza in the text. A stanza runs from a line that is exactly STANZA_HEADING up to
 * (not including) the next line that starts with "## " or is exactly "---"; trailing whitespace
 * is trimmed. Returns [{ start, end, text }].
 */
function findStanzas(text) {
  const lines = text.split('\n');
  const stanzas = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, '') === STANZA_HEADING) {
      const start = offset;
      let end = text.length;
      let scan = offset + lines[i].length + 1;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j].replace(/\r$/, '');
        if (line.startsWith('## ') || line === '---') {
          end = scan;
          break;
        }
        scan += lines[j].length + 1;
      }
      stanzas.push({ start, end, text: text.slice(start, end).replace(/\s+$/, '') });
    }
    offset += lines[i].length + 1;
  }
  return stanzas;
}

/** Returns the text with every stanza span removed. */
function outsideStanzas(text, stanzas) {
  let out = '';
  let pos = 0;
  for (const s of stanzas) {
    out += text.slice(pos, s.start);
    pos = s.end;
  }
  return out + text.slice(pos);
}

/** Returns 1-based line numbers of LITERAL_RE matches in `text` that fall outside the stanzas. */
function literalHits(text, stanzas) {
  const hits = [];
  LITERAL_RE.lastIndex = 0;
  let m;
  while ((m = LITERAL_RE.exec(text)) !== null) {
    const idx = m.index;
    if (stanzas.some((s) => idx >= s.start && idx < s.end)) continue;
    const line = text.slice(0, idx).split('\n').length;
    hits.push({ line, name: m[1] || m[2] });
  }
  return hits;
}

/** Lists every .md file under dir, recursively, sorted by code unit. */
function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    fatal('cannot list ' + dir + ': ' + err.message);
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .sort(byCodeUnit);
}

function read(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch (err) {
    fatal('cannot read ' + abs + ': ' + err.message);
  }
}

if (!existsSync(SKILLS_DIR)) fatal('skills/ directory not found at ' + SKILLS_DIR);
if (!existsSync(AGENTS_DIR)) fatal('agents/ directory not found at ' + AGENTS_DIR);

const findings = [];
const carriers = []; // { rel, stanza }

// ---------------------------------------------------------------------------
// Skills: rules 1 to 5.
// ---------------------------------------------------------------------------
for (const abs of listMarkdown(SKILLS_DIR)) {
  const rel = toRel(abs);
  const text = read(abs);
  const stanzas = findStanzas(text);
  const isSkillFile = rel.endsWith('/SKILL.md');

  if (isSkillFile) {
    const usesPlaceholder = outsideStanzas(text, stanzas).includes(PLACEHOLDER);
    if (usesPlaceholder && stanzas.length === 0) {
      findings.push(rel + ': names ' + PLACEHOLDER + ' but lacks the "' + STANZA_HEADING + '" stanza');
    }
    if (!usesPlaceholder && stanzas.length > 0) {
      findings.push(rel + ': carries the "' + STANZA_HEADING + '" stanza but names ' + PLACEHOLDER + ' nowhere outside it');
    }
    if (stanzas.length > 1) {
      findings.push(rel + ': carries the "' + STANZA_HEADING + '" stanza ' + stanzas.length + ' times; carry it once');
    }
    if (stanzas.length > 0) {
      const firstStep = text.search(/^## Step /m);
      if (firstStep !== -1 && stanzas[0].start > firstStep) {
        findings.push(rel + ': the "' + STANZA_HEADING + '" stanza must come before the first "## Step" heading');
      }
      for (const sentinel of STANZA_SENTINELS) {
        if (!stanzas[0].text.includes(sentinel)) {
          findings.push(rel + ': the stanza is missing required text: ' + sentinel);
        }
      }
      carriers.push({ rel, stanza: stanzas[0].text });
    }
  } else if (stanzas.length > 0) {
    findings.push(rel + ': only a SKILL.md may carry the "' + STANZA_HEADING + '" stanza');
  }

  if (!LITERAL_ALLOWLIST.has(rel)) {
    for (const hit of literalHits(text, stanzas)) {
      findings.push(rel + ':' + hit.line + ': names the state folder "' + hit.name + '" literally; write ' + PLACEHOLDER + ' (after the stanza) or describe "the state folder" instead');
    }
  }
}

// Rule 3: byte-identical stanzas.
if (carriers.length > 0) {
  const reference = carriers[0];
  for (const c of carriers.slice(1)) {
    if (c.stanza !== reference.stanza) {
      findings.push(c.rel + ': the stanza differs from ' + reference.rel + '; every copy must be byte-identical');
    }
  }
}

// ---------------------------------------------------------------------------
// Agents: rules 5 and 6.
// ---------------------------------------------------------------------------
let agentsWithPlaceholder = 0;
for (const abs of listMarkdown(AGENTS_DIR)) {
  const rel = toRel(abs);
  const text = read(abs);
  const stanzas = findStanzas(text);
  if (stanzas.length > 0) {
    findings.push(rel + ': an agent never carries the "' + STANZA_HEADING + '" stanza; the dispatching skill resolves the folder');
  }
  if (text.includes(PLACEHOLDER)) {
    agentsWithPlaceholder++;
    if (!text.includes(AGENT_NOTE)) {
      findings.push(rel + ': names ' + PLACEHOLDER + ' but lacks the shared agent note: ' + AGENT_NOTE);
    }
  }
  if (!LITERAL_ALLOWLIST.has(rel)) {
    for (const hit of literalHits(text, [])) {
      findings.push(rel + ':' + hit.line + ': names the state folder "' + hit.name + '" literally; write ' + PLACEHOLDER + ' or describe "the state folder" instead');
    }
  }
}

process.stdout.write(
  PREFIX + ' ' + carriers.length + ' skill(s) carry the stanza: ' +
    (carriers.map((c) => c.rel.split('/')[1]).join(', ') || '(none)') + '\n'
);
process.stdout.write(PREFIX + ' ' + agentsWithPlaceholder + ' agent(s) name ' + PLACEHOLDER + '\n');

if (findings.length > 0) {
  for (const f of findings) process.stdout.write(PREFIX + ' FINDING: ' + f + '\n');
  process.stdout.write(PREFIX + ' FAIL: ' + findings.length + ' finding(s)\n');
  process.exit(1);
}
process.stdout.write(PREFIX + ' PASS\n');
process.exit(0);
