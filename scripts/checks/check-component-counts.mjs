#!/usr/bin/env node
// scripts/checks/check-component-counts.mjs
// what-it-is:   component-count claim checker
// what-it-does: derives the plugin's true CLI count (files under bin/ starting with "ns-", not
//               ending in ".cmd") and true skill count (subdirectories of skills/ that contain
//               SKILL.md) from the tree at run time, using the exact discovery approach
//               scripts/checks/check-inventory.mjs already uses - never a constant in this file.
//               Then scans the shipped tree for a cardinal number (a digit or a spelled-out
//               number word, zero through twenty) directly adjacent to the plural noun "CLIs" or
//               "skills" (also "CLI(s)"/"skill(s)", the check-scripts' own stdout convention),
//               allowing one optional bridge word, "shipped" (the only bridge word with a real
//               instance in the tree). Every such candidate is a live claim about the plugin's
//               current total component count and is checked against the true count; a mismatch
//               is a named finding. Every finding is reported, not only the first.
//               The plural-only noun requirement is deliberate and load-bearing, not an
//               oversight: a historical-ordinal statement ("ns-statusline is the sixth CLI
//               shipped", "ns-status is the eighth CLI shipped") always pairs an ordinal word
//               with a SINGULAR noun, so it never matches this pattern at all - no ordinal-word
//               list is needed to exempt that class - the survey behind this design covered
//               every real instance of this shape in the tree at the time it was written.
//               Two further exemption classes are checked structurally before a candidate is
//               compared against the true count:
//                 - decision identifier: a reference-ID-shaped token (D-05, TSK-029b, ADR-0009,
//                   OPP-D05, ...) immediately opening a parenthetical, a colon, or a
//                   comma-appositive right before the count phrase, per this repository's own
//                   convention that every reference ID carries a human-readable handle (a locked
//                   decision's own proper name, such as D-05 (five shipped CLIs), is retained
//                   deliberately even after the list it names has grown). Checked against the
//                   text immediately preceding a candidate - the previous line joined with the
//                   current line up to the match, not a same-line-only regex lookbehind, because
//                   a handle can wrap across a markdown line break (a real instance in the tree
//                   opens its parenthetical at the end of one line and states the count phrase on
//                   the next) - after normalizing away markdown formatting that carries no
//                   meaning to a human reader but would otherwise defeat a literal-text match: a
//                   reference link is resolved to its label ([D-05](url) -> D-05, this
//                   repository's own convention for citing a reference ID - docs/reference/cli/
//                   ns-notes.md, ns-status.md, and ns-statusline.md alone each carry multiple
//                   such links), a backtick-wrapped ID is unwrapped, and bold/italic emphasis
//                   markers around either the ID or the handle are stripped.
//                 - dated historical record: any file under docs/adr/ or docs/gates/ is skipped
//                   entirely. Both are point-in-time records by genre - an ADR's own Date: field
//                   fixes what it describes to that date; a gate doc records what was true at a
//                   named past gate - not living documents that track the current tree, and a
//                   real instance in each genre is saved only by this rule (an ADR context
//                   section stating a plain past-tense count with no adjacent decision ID at
//                   all; a gate doc's already-stale-today count table). The same genre applies at
//                   SECTION scope, not file scope, to CHANGELOG.md and RELEASE-NOTES.md: a dated
//                   release section in either file is skipped, but neither file is skipped
//                   wholesale, because both always carry a live, non-dated section too (CHANGELOG.
//                   md's "## Unreleased"; RELEASE-NOTES.md's "## Format of a release entry" and
//                   "## Cutting a release (maintainer runbook)"), and RELEASE-NOTES.md is
//                   published verbatim as the GitHub release body. See the dedicated comment
//                   block above the scan loop below for the exact toggle mechanism.
//               A third construction, "the other N CLIs" (a claim about the complement of the
//               subject, not the total itself), is a genuine live claim and IS checked, against
//               trueCount - 1 rather than trueCount: a CLI's own self-referential comment naming
//               how many sibling CLIs share its pattern is true today precisely because it
//               excludes itself from the total, and goes stale the instant the total grows, in
//               the same commit that makes every bare-total claim go stale - a checker that left
//               this construction permanently unmatched would have the exact same blind spot the
//               four prior human sweeps had, on the exact lines those sweeps missed
//               (bin/ns-notes, bin/ns-statusline, hooks/lib/status-engine.mjs). A hypothetical
//               future decision-identifier parenthetical that itself opens with a stale total
//               would still be swallowed by the decision-identifier rule below with no live-claim
//               check ever applied to it; no such text exists in the tree today.
//               A fourth construction, "Phase N skills"/"Phase N agents" (a project-phase label
//               immediately followed by a plural component noun - e.g.
//               scripts/check-frontmatter.mjs: "all Phase 1 skills and agents exist on disk"), is
//               also left unmatched: "Phase" immediately before the number is not a count claim
//               at all. Found by running this checker's own test suite against the real tree, not
//               by inspection.
//               Scope: CLIs and skills only. Agent and hook counts are deliberately out of scope:
//               only CLI and skill counts have ever actually gone stale in this tree, and a real,
//               currently-shipped line - agents/_chain-permitted.yaml's "Phase 3 agents appear
//               here" - would be a live false-positive risk for "agents" with no existing
//               exemption class to cover it, for a component kind that has never gone stale.
// why:          the previous wave's own stale-component-count defect recurred four times across
//               four separate human sweeps, each competent on its own terms; this is the durable,
//               machine-enforced replacement for prose enforcement, the same remedy
//               scripts/checks/check-workspace-refs.mjs already proved for a different rule that
//               had failed the same way.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-component-counts]';

function fatal(message) {
  process.stderr.write(PREFIX + ' FATAL: ' + message + '\n');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// True-count derivation: plain filesystem reads, never git-tracked-based, so
// this works in a bare directory copy with no .git present - mirrors
// scripts/checks/check-inventory.mjs's discoverClis()/discoverSkills() exactly.
// ---------------------------------------------------------------------------

const BIN_DIR = join(REPO_ROOT, 'bin');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

function discoverClis() {
  let entries;
  try {
    entries = readdirSync(BIN_DIR, { withFileTypes: true });
  } catch (err) {
    fatal('cannot read bin/ directory: ' + err.message);
  }
  return entries
    .filter((e) => e.isFile() && e.name.startsWith('ns-') && !e.name.endsWith('.cmd'))
    .map((e) => e.name)
    .sort();
}

function discoverSkills() {
  let entries;
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch (err) {
    fatal('cannot read skills/ directory: ' + err.message);
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .sort();
}

const discoveredClis = discoverClis();
const discoveredSkills = discoverSkills();

const TRUE_COUNTS = {
  CLI: discoveredClis.length,
  skill: discoveredSkills.length,
};

// ---------------------------------------------------------------------------
// Tracked-file discovery (git ls-files -z), with a plain filesystem-walk
// fallback when git is unavailable or REPO_ROOT is not a git repository -
// mirrors scripts/checks/check-workspace-refs.mjs and
// scripts/checks/check-skill-cli-targets.mjs, so a temp clone with no .git
// present still scans correctly in degraded mode.
// ---------------------------------------------------------------------------

function getGitTrackedFiles(repoRoot) {
  let gitRootRaw;
  try {
    gitRootRaw = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null;
  }
  if (!gitRootRaw) return null;
  const gitRoot = resolve(gitRootRaw);

  let listing;
  try {
    listing = execFileSync('git', ['ls-files', '-z'], {
      cwd: gitRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }

  return { gitRoot, relPaths: listing.toString('utf8').split('\0').filter(Boolean) };
}

// Fallback walk: each known scan-prefix directory, recursively, plus
// root-level files (non-recursive). Deliberately not a whole-REPO_ROOT walk
// (unlike check-workspace-refs.mjs's fallback): every prefix here is a
// legitimate source directory, none is ever a dependency or build directory,
// so there is no node_modules-class hazard to guard against with a
// .gitignore-derived exclusion set.
function walkDirRecursive(absDir, baseDir, out = []) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(absDir, e.name);
    if (e.isDirectory()) {
      walkDirRecursive(full, baseDir, out);
    } else if (e.isFile()) {
      out.push(full.slice(baseDir.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

function walkRootLevelFiles(baseDir, out = []) {
  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isFile()) out.push(e.name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scan scope: bin/, hooks/, scripts/, skills/, agents/, docs/, examples/,
// templates/, evals/, tests/, and root-level files - mirrors
// check-workspace-refs.mjs's scan scope. docs/adr/ and docs/gates/ are
// excluded entirely (dated historical record, see header comment above).
// ---------------------------------------------------------------------------

const SCAN_PREFIXES = [
  'bin/', 'hooks/', 'scripts/', 'skills/', 'agents/', 'docs/',
  'examples/', 'templates/', 'evals/', 'tests/',
];

const HISTORICAL_RECORD_PREFIXES = ['docs/adr/', 'docs/gates/'];

function isRootLevelFile(rel) {
  return !rel.includes('/');
}

function inScanScope(rel) {
  if (HISTORICAL_RECORD_PREFIXES.some((p) => rel.startsWith(p))) return false;
  if (isRootLevelFile(rel)) return true;
  return SCAN_PREFIXES.some((p) => rel.startsWith(p));
}

const gitInfo = getGitTrackedFiles(REPO_ROOT);
let scanRoot;
let scanModeLabel;
let allRelPaths;
if (gitInfo) {
  scanRoot = gitInfo.gitRoot;
  scanModeLabel = 'git-tracked';
  allRelPaths = gitInfo.relPaths;
} else {
  scanRoot = REPO_ROOT;
  scanModeLabel = 'filesystem-walk (git unavailable or ' + REPO_ROOT + ' is not a git repository)';
  allRelPaths = walkRootLevelFiles(REPO_ROOT);
  for (const prefix of SCAN_PREFIXES) {
    walkDirRecursive(join(REPO_ROOT, prefix.slice(0, -1)), REPO_ROOT, allRelPaths);
  }
}

const filesToScan = allRelPaths.filter(inScanScope).sort();

if (filesToScan.length === 0) {
  fatal(
    'zero files matched the scan scope (bin/, hooks/, scripts/, skills/, agents/, docs/, ' +
    'examples/, templates/, evals/, tests/, root-level files) under ' + scanRoot +
    '. This indicates a broken checkout or a resolution bug, not a clean pass.'
  );
}

// ---------------------------------------------------------------------------
// Candidate pattern: a cardinal number (word zero-twenty, or 1-3 digits)
// directly followed by an optional " shipped" bridge word and then directly
// the plural component noun. Deliberately plural-only - see header comment
// for why this structurally exempts every historical-ordinal instance with
// no ordinal-word list. The trailing negative lookahead (not \b) is required
// because \b never matches directly after ")" in the CLI(s)/skill(s) branch
// (")" is already a non-word character, so \b only fires there if the next
// character is a word character, which never legitimately happens).
// ---------------------------------------------------------------------------

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};

const NUMBER_ALT = Object.keys(NUMBER_WORDS).join('|');

const NOUN_KIND_BY_TEXT = new Map([
  ['clis', 'CLI'], ['cli(s)', 'CLI'],
  ['skills', 'skill'], ['skill(s)', 'skill'],
]);

const CANDIDATE_RE = new RegExp(
  '\\b(' + NUMBER_ALT + '|\\d{1,3})\\b(?:\\s+shipped)?\\s+(CLIs|CLI\\(s\\)|skills|skill\\(s\\))(?![A-Za-z0-9_-])',
  'gi'
);

function resolveNumber(text) {
  const lower = text.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, lower)) return NUMBER_WORDS[lower];
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

function pluralize(kind, n) {
  return kind + (n === 1 ? '' : 's');
}

// ---------------------------------------------------------------------------
// Structural exemptions, checked against the text immediately before a
// candidate match (previous line + "\n" + current line up to the match
// start), tested with an end-anchored regex so a decision-identifier handle
// that wraps across a markdown line break is still recognized (a real
// instance in the tree opens its parenthetical at the end of one line and
// states the count phrase on the next).
// ---------------------------------------------------------------------------

// Decision identifier: a reference-ID-shaped token immediately opening a
// parenthetical ("D-05 (five shipped CLIs)"), a possessive-parenthetical
// ("D-05's (Five Shipped CLIs)"), a colon ("D-05: five shipped CLIs"), or a
// comma-appositive ("D-05, five shipped CLIs,"). Deliberately case-sensitive
// (every reference ID in this repository's convention is upper-case) and
// deliberately general rather than a hardcoded ID list, so a future decision
// ID that also carries a count-shaped handle is exempted with no code
// change here. Tested against normalizeMarkdown's output (see below), so a
// markdown-linked, backtick-wrapped, or emphasis-wrapped ID or handle is
// recognized the same as a plain one.
const ID_HANDLE_OPEN_RE = /[A-Z]{1,8}-[A-Za-z0-9]{1,6}(?:'s)?\s*[(,:]\s*$/;

// "the other N CLIs" is a genuine live claim about the complement of the
// subject (true value = trueCount - 1), not a total-count claim - checked
// against that arithmetic below rather than skipped. See header comment.
// Case-insensitive: "other" can open a sentence.
const OTHER_PRECEDES_RE = /\bother\s+$/i;

// "Phase N skills"/"Phase N agents" is a project-phase label immediately
// followed by a plural component noun, not a total-count claim (e.g.
// scripts/check-frontmatter.mjs: "now that all Phase 1 skills and agents
// exist on disk"). Not one of the decision-identifier / dated-historical-
// record / historical-ordinal exempt classes above - this is a not-a-claim
// shape, structurally identical to the reasoning that kept "agents" out of
// this checker's noun scope entirely (see header comment), applied here
// because "skills" is in scope and a real "Phase 1 skills" instance exists
// outside the docs/adr/ path exemption. Case-insensitive: "Phase" can open
// a sentence.
const PHASE_PRECEDES_RE = /\bphase\s+$/i;

// Markdown-syntax normalization applied to the preceding-text window before
// any exemption regex above runs, so a formatting choice that does not
// change what a human reader parses ("ID (handle)") does not defeat the
// exemption either: a reference link is resolved to its label
// ([D-05](url) -> D-05, this repository's own convention for citing a
// reference ID), a backtick-wrapped ID is unwrapped, and bold/italic
// emphasis markers around either the ID or the handle are stripped. Order
// matters - the link is resolved first, so its own brackets are gone before
// the emphasis strip runs. Applied to the whole joined previous-line/
// current-line window; every regex above is end-anchored, so removing
// formatting noise earlier in that window can only reveal a real match at
// the tail, never manufacture a false one.
// A fourth step handles a shape the full-link regex above cannot: the
// handle-opening parenthetical itself wrapped as a markdown link's label,
// e.g. "D-05 ([five shipped CLIs](url))". The candidate match starts INSIDE
// the link label, so the preceding-text window only ever contains the
// truncated opening "D-05 ([" - the link's own closing "](url)" comes after
// the match and is never part of the window, so the full-link regex above
// (which requires both the closing "]" and the trailing "(url)") never
// fires. Stripping a trailing, otherwise-unmatched "[" (with only
// whitespace after it) restores the visible "D-05 (" the exemption regex
// expects, without touching a "[" that opens real unresolved bracket text
// anywhere else in the window (this step is anchored to the very end).
function normalizeMarkdown(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\*+|_+/g, '')
    .replace(/\[\s*$/, '');
}

function isFullyExempt(precedingText) {
  return ID_HANDLE_OPEN_RE.test(precedingText) || PHASE_PRECEDES_RE.test(precedingText);
}

function isOtherPreceded(precedingText) {
  return OTHER_PRECEDES_RE.test(precedingText);
}

// The portion of the CURRENT line strictly before a match start is joined
// onto the previous line to build the text a structural exemption is tested
// against (see below). In a source-code file that portion can begin with a
// line-comment marker - "//" in a .mjs file, "#" in a .yaml/.yml file (both
// occur in this checker's own scan scope, e.g. agents/_chain-permitted.yaml)
// - when the exempt construction itself wraps across two comment lines (a
// real instance: bin/ns-statusline's other-precedes-the-count-phrase
// construction wraps its "the other" / "CLIs" pair across a "//"-prefixed
// continuation line). Neither marker is whitespace, so left unstripped
// either would break the end-anchored exemption regexes above even though
// the two lines form one continuous sentence to a human reader. Only the
// leading marker is stripped (not indentation in general), so a markdown
// continuation line's leading spaces are untouched and still consumed by
// \s*/\s+ as before.
function stripLeadingLineComment(prefixText) {
  return prefixText.replace(/^(\s*)(?:\/\/|#)\s?/, '$1');
}

// Bounded backward walk building the preceding-text window from more than
// one prior line, so a decision-identifier handle can wrap across two line
// breaks, not only one - the shape a single-previous-line join misses: an
// ID token on one line, its opening punctuation alone on the next, and the
// count phrase only on the third. Walks back at most MAX_PRECEDING_JOIN_LINES
// lines and stops (without including it) at the first blank line, so a
// paragraph break can never be silently crossed - every exemption regex
// above is end-anchored, so if a blank line's worth of nothing were joined
// in, \s* would absorb it and manufacture an exemption for text that a human
// reader would never read as one continuous construction (proven by the
// mutation test below: deleting this stop turns exactly that shape from a
// real finding into a silently exempt one). 3 is chosen with headroom over
// the 2-line case that already exists in the tree; the residual gap this
// still does not reach is a wrap of four or more lines, unobserved in the
// tree today.
const MAX_PRECEDING_JOIN_LINES = 3;

function buildPrecedingWindow(lines, i) {
  const collected = [];
  for (let back = 1; back <= MAX_PRECEDING_JOIN_LINES && i - back >= 0; back++) {
    const priorLine = lines[i - back];
    if (priorLine.trim() === '') break;
    collected.unshift(priorLine);
  }
  return collected.join('\n');
}

// ---------------------------------------------------------------------------
// CHANGELOG.md / RELEASE-NOTES.md section-scoped dated-heading toggle.
// Both files are Keep a Changelog format documents where a DATED release
// section is a point-in-time historical record - the same genre as
// docs/adr/ and docs/gates/ (see header comment) - but unlike those two
// directories, neither file can be path-exempted wholesale: CHANGELOG.md
// always carries a live "## Unreleased" section, and RELEASE-NOTES.md
// always carries two live, non-dated sections ("## Format of a release
// entry", "## Cutting a release (maintainer runbook)") that document
// current, live procedure and are never replaced by a release. RELEASE-
// NOTES.md is additionally published verbatim as the GitHub release body by
// .github/workflows/release.yml, so a blanket path exemption would blind
// this checker on the most public artifact of a release. Instead, only the
// text under a DATED H2 heading ("## 1.0.0 - 2026-08-21", "## [1.0.0] -
// 2026-08-21") is skipped; any OTHER H2 heading - a plain or compare-link
// "## Unreleased" heading, or one of RELEASE-NOTES.md's named meta-section
// headings - resumes scanning, so a stale count claim in a live section
// underneath a dated one is still caught. The live-heading match is
// deliberately general (any H2 that is not itself dated), not a literal
// "Unreleased"-only string, so the canonical Keep a Changelog compare-link
// form ("## [Unreleased](https://.../compare/v0.1.0...HEAD)", which this
// file's own line 3 commits this project to) resets to live exactly the
// same as the plain form - a dated heading that fails to match fails SAFE
// (content under it stays checked), but a live-reset heading that fails to
// match would fail OPEN (the rest of the file goes silently exempt), so
// this side is deliberately the more general, harder-to-miss pattern.
// Fenced code blocks are tracked and never toggle this state, so a fenced
// worked example that itself documents a dated heading shape - RELEASE-
// NOTES.md's own "Format of a release entry" section does exactly this,
// lines 11-32 - cannot silently exempt the real content that follows it.
// Only these two root-level files carry this state; every other scanned
// file is unaffected.
// ---------------------------------------------------------------------------

const CHANGELOG_SCOPED_FILES = new Set(['CHANGELOG.md', 'RELEASE-NOTES.md']);
const CHANGELOG_DATED_HEADING_RE = /^##\s+.*\b\d{4}-\d{2}-\d{2}\b/;
const CHANGELOG_LIVE_HEADING_RE = /^##\s+/;
const FENCE_MARKER_RE = /^\s*```/;

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const findings = [];

for (const rel of filesToScan) {
  const abs = join(scanRoot, ...rel.split('/'));
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue; // unreadable entry - skip, not fatal
  }
  const lines = text.split('\n');
  const trackSections = CHANGELOG_SCOPED_FILES.has(rel);
  let insideFence = false;
  let inHistoricalSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (trackSections) {
      if (FENCE_MARKER_RE.test(line)) {
        insideFence = !insideFence;
      } else if (!insideFence) {
        if (CHANGELOG_DATED_HEADING_RE.test(line)) {
          inHistoricalSection = true;
        } else if (CHANGELOG_LIVE_HEADING_RE.test(line)) {
          inHistoricalSection = false;
        }
      }
      if (inHistoricalSection) continue;
    }
    CANDIDATE_RE.lastIndex = 0;
    let m;
    while ((m = CANDIDATE_RE.exec(line)) !== null) {
      const matchStart = m.index;
      const numberText = m[1];
      const nounText = m[2];
      const currentPrefix = stripLeadingLineComment(line.slice(0, matchStart));
      const precedingText = normalizeMarkdown(buildPrecedingWindow(lines, i) + '\n' + currentPrefix);

      if (!isFullyExempt(precedingText)) {
        const kind = NOUN_KIND_BY_TEXT.get(nounText.toLowerCase());
        const claimed = resolveNumber(numberText);
        const trueCount = TRUE_COUNTS[kind];
        const other = isOtherPreceded(precedingText);
        const expected = other ? trueCount - 1 : trueCount;
        if (claimed !== null && claimed !== expected) {
          const label = other ? 'other ' : '';
          const totalNote = other ? ' (' + trueCount + ' ' + pluralize(kind, trueCount) + ' total)' : '';
          findings.push(
            rel + ':' + (i + 1) + ': stale component-count claim "' + m[0].trim() + '" - claims ' +
            claimed + ' ' + label + pluralize(kind, claimed) + ' but the tree currently has ' +
            expected + ' ' + label + pluralize(kind, expected) + totalNote
          );
        }
      }

      if (m.index === CANDIDATE_RE.lastIndex) CANDIDATE_RE.lastIndex++;
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

process.stdout.write(
  PREFIX + ' mode: ' + scanModeLabel + ' (' + filesToScan.length + ' file(s) scanned); true counts: ' +
  TRUE_COUNTS.CLI + ' CLI(s), ' + TRUE_COUNTS.skill + ' skill(s)\n'
);

if (findings.length === 0) {
  process.stdout.write(PREFIX + ' pass: no stale component-count claims found\n');
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
