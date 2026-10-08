#!/usr/bin/env node
// scripts/checks/check-agent-guide-mirror.mjs
// what-it-is:   Tier A checker locking AGENTS.md and .claude/CLAUDE.md as byte-identical mirrors
// what-it-does: AGENTS.md says it mirrors .claude/CLAUDE.md for other agent tools and that "the
//               two must change together." Nothing checked that. This script does:
//                 1. reads both files, normalizing CRLF to LF first (both files' line endings,
//                    before any other comparison);
//                 2. finds the BODY start in each file: the first line equal, verbatim, to the
//                    ANCHOR below ("Operating guide for AI coding agents (and humans) working IN
//                    this repository - the"). This is the first line both files are known to
//                    share, chosen as the split point instead of a fixed line count because it
//                    is self-documenting at the call site and survives either header being
//                    reworded without the other changing length. Everything before that line in
//                    either file - AGENTS.md's 5-line mirror-explanation header, .claude/CLAUDE.md's
//                    own 2-line header - is the one deliberate, permanent difference between the
//                    two files and is never compared;
//                 3. normalizes .claude/CLAUDE.md's body only: inside every Markdown link target
//                    (the text between "](" and the matching ")" on a line), a leading "../" is
//                    stripped, exactly once. .claude/CLAUDE.md lives one directory down from
//                    AGENTS.md, so every one of its relative links carries a "../" that AGENTS.md's
//                    copy of the identical link does not; this is the second deliberate,
//                    permanent difference, and normalizing it away is the only content rewrite
//                    this checker performs before comparing;
//                 4. requires the two normalized bodies to be byte-identical, line by line. On
//                    the first differing line, reports both files' line numbers (counted from the
//                    top of each real file, not from the body start) and both lines' text, then
//                    stops - a mirror check's job is to prove "identical" or name where it is not,
//                    not to enumerate every subsequent line a first divergence would cascade into.
// why:          a policy asserted in prose ("the two must change together") and enforced by
//               nothing is not a control - the same reasoning check-compliance-stanza.mjs and
//               check-state-folder-stanza.mjs already apply to their own shared-text invariants.
// exit taxonomy: 0 = pass; 1 = named line-level finding; 2 = operational error (either file is
//               missing or unreadable, or the anchor line is not found verbatim in one or both
//               files - in both cases the checker cannot establish where the body starts, so it
//               cannot do its job, which is a different failure shape from "the bodies differ"
//               and is reported as an operational error rather than a finding)

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-agent-guide-mirror]';

const CLAUDE_REL = '.claude/CLAUDE.md';
const AGENTS_REL = 'AGENTS.md';
const CLAUDE_PATH = resolve(REPO_ROOT, '.claude', 'CLAUDE.md');
const AGENTS_PATH = resolve(REPO_ROOT, 'AGENTS.md');

// The first line both files are known to share verbatim - see what-it-does step 2 above.
const ANCHOR = 'Operating guide for AI coding agents (and humans) working IN this repository - the';

// Matches a Markdown link target: the text between "](" and the next ")" on a line. Applied only
// to .claude/CLAUDE.md's body (see what-it-does step 3); AGENTS.md's targets are left untouched.
const LINK_TARGET_RE = /\]\(([^)]+)\)/g;

function fatal(message) {
  process.stderr.write(PREFIX + ' FATAL: ' + message + '\n');
  process.exit(2);
}

function out(line) {
  process.stdout.write(PREFIX + ' ' + line + '\n');
}

/** Reads a file, normalizing CRLF to LF, and returns its lines (no trailing line-ending chars). */
function readLines(path, rel) {
  if (!existsSync(path)) {
    fatal(rel + ' is missing; cannot run the mirror check without both files');
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    fatal('could not read ' + rel + ': ' + err.message);
  }
  return text.replace(/\r\n/g, '\n').split('\n');
}

/** Index of the first line equal, verbatim, to ANCHOR; -1 if not found. */
function findAnchor(lines) {
  return lines.findIndex((line) => line === ANCHOR);
}

/** Strips exactly one leading "../" from every Markdown link target on a line. */
function stripOneDotDotSlash(line) {
  return line.replace(LINK_TARGET_RE, (whole, target) => {
    if (target.startsWith('../')) {
      return '](' + target.slice(3) + ')';
    }
    return whole;
  });
}

function main() {
  const claudeLines = readLines(CLAUDE_PATH, CLAUDE_REL);
  const agentsLines = readLines(AGENTS_PATH, AGENTS_REL);

  const claudeAnchorIdx = findAnchor(claudeLines);
  const agentsAnchorIdx = findAnchor(agentsLines);

  if (claudeAnchorIdx === -1) {
    fatal('anchor line not found verbatim in ' + CLAUDE_REL + ': "' + ANCHOR + '"');
  }
  if (agentsAnchorIdx === -1) {
    fatal('anchor line not found verbatim in ' + AGENTS_REL + ': "' + ANCHOR + '"');
  }

  const claudeBody = claudeLines.slice(claudeAnchorIdx).map(stripOneDotDotSlash);
  const agentsBody = agentsLines.slice(agentsAnchorIdx);

  const maxLen = Math.max(claudeBody.length, agentsBody.length);
  for (let i = 0; i < maxLen; i++) {
    const claudeLine = i < claudeBody.length ? claudeBody[i] : '<no corresponding line - file ends here>';
    const agentsLine = i < agentsBody.length ? agentsBody[i] : '<no corresponding line - file ends here>';
    if (claudeLine !== agentsLine) {
      const claudeLineNo = claudeAnchorIdx + i + 1;
      const agentsLineNo = agentsAnchorIdx + i + 1;
      out('FAIL bodies diverge at ' + AGENTS_REL + ':' + agentsLineNo + ' vs ' + CLAUDE_REL + ':' + claudeLineNo);
      out('  ' + AGENTS_REL + ':' + agentsLineNo + ': ' + agentsLine);
      out('  ' + CLAUDE_REL + ':' + claudeLineNo + ' (../ -normalized): ' + claudeLine);
      process.exit(1);
    }
  }

  out('PASS: ' + AGENTS_REL + ' and ' + CLAUDE_REL + ' bodies are byte-identical (' +
    claudeBody.length + ' line(s) compared, from the shared anchor line)');
}

main();
