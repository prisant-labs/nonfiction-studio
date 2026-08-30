// tests/checks/studio-routing-pin.test.mjs
// what-it-is:   a pin test for skills/nfs-start/SKILL.md's dispatcher routing table
// what-it-does: reads the real, current skills/nfs-start/SKILL.md at HEAD (not a fixture or a
//               clone - the actual dispatcher an author's session loads) and extracts every
//               skill name named on its "Skills routed to (by path)." summary line (the intro's
//               own canonical, single-line manifest of every route the dispatcher offers, stated
//               before Step 1). That
//               extracted list is asserted, in order, against EXPECTED_ROUTING_TARGETS below, a
//               literal, hand-written pin. If a future edit to SKILL.md drops a route, renames
//               one, or adds a new path with a new target, the extracted list no longer matches
//               the pin and this test fails loudly, by construction - the whole point of a pin
//               test: it does not merely check that the dispatcher is internally consistent
//               (which a self-referential assertion could pass vacuously), it checks that the
//               dispatcher still says what a human maintainer last confirmed it says. A second
//               assertion, independent of the pin, confirms every extracted name resolves to a
//               real shipped skill (skills/<name>/SKILL.md exists) - so a routing-table typo
//               that happens to also get hand-copied into the pin would still be caught.
//               This checker file deliberately never edits skills/nfs-start/SKILL.md to make it
//               match a pre-decided list; the pin is derived from reading the dispatcher as it
//               actually is, not the reverse.
// why:          F-CI-07 (dispatcher and CLI-wrapper skills uncovered)'s remaining half. The
//               CLI-wrapper half (a skill's own bin/ns-<name> routing target) closed in tranche
//               2 via scripts/checks/check-skill-cli-targets.mjs; nothing previously pinned the
//               dispatcher's OWN routing table itself, so a route silently dropped, renamed, or
//               retargeted during an edit to skills/nfs-start/SKILL.md would ship with no test
//               ever noticing. Kept in its own file rather than folded into
//               check-advertised-invocations.test.mjs because it tests dispatcher CONTENT
//               directly (what routes exist), not the general advertised-invocation-resolution
//               MECHANISM check-advertised-invocations.mjs enforces across the whole shipped
//               tree; the two are complementary, not overlapping; both must pass.
// runner:       node --test "tests/checks/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './clone-helper.mjs';

// ---------------------------------------------------------------------------
// The pin. Derived by reading skills/nfs-start/SKILL.md's "Skills routed to (by
// path)." summary line at HEAD: Path 1 nfs-new-book, then nfs-interview;
// Path 2 nfs-outline or nfs-draft; Path 3 nfs-research or
// nfs-fact-check; Path 4 nfs-status-dashboard, then nfs-check-chapter; Path 5
// nfs-doctor (general questions get a direct answer, no skill); Path 6
// nfs-quick-scan or nfs-tour. Eleven names, matching order of first mention on that
// line. "revise-pass" is deliberately absent: Step 4.2b and the Failure
// behavior section both state it is a Phase 2 skill "not available in v1"
// and it is never named on the routing summary line itself.
// ---------------------------------------------------------------------------

const EXPECTED_ROUTING_TARGETS = [
  'nfs-new-book',
  'nfs-interview',
  'nfs-outline',
  'nfs-draft',
  'nfs-research',
  'nfs-fact-check',
  'nfs-status-dashboard',
  'nfs-check-chapter',
  'nfs-doctor',
  'nfs-quick-scan',
  'nfs-tour',
];

const SKILL_MD_PATH = join(REPO_ROOT, 'skills', 'nfs-start', 'SKILL.md');
const SUMMARY_MARKER = 'Skills routed to (by path)';

function extractRoutingSummaryTargets(text) {
  const lines = text.split('\n');
  const summaryLine = lines.find((l) => l.includes(SUMMARY_MARKER));
  assert.ok(
    summaryLine,
    'skills/nfs-start/SKILL.md must carry a line containing "' + SUMMARY_MARKER + '" for this pin ' +
    'to derive from; the dispatcher summary format has changed and this pin needs a maintainer to ' +
    're-derive it by hand'
  );

  const tokenRe = /`([a-z][a-z0-9-]*)`/g;
  const seen = new Set();
  const extracted = [];
  let m;
  while ((m = tokenRe.exec(summaryLine)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      extracted.push(m[1]);
    }
  }
  return extracted;
}

test('skills/nfs-start/SKILL.md routing summary matches the pinned target set exactly, in order', () => {
  const text = readFileSync(SKILL_MD_PATH, 'utf8');
  const extracted = extractRoutingSummaryTargets(text);
  assert.deepEqual(
    extracted, EXPECTED_ROUTING_TARGETS,
    'the dispatcher\'s routing summary no longer matches the pinned target set - a route was ' +
    'dropped, renamed, reordered, or added; update EXPECTED_ROUTING_TARGETS only after confirming ' +
    'the new routing table is intentional, not update-to-pass'
  );
});

test('every pinned routing target exists as a shipped skill (skills/<name>/SKILL.md)', () => {
  const text = readFileSync(SKILL_MD_PATH, 'utf8');
  const extracted = extractRoutingSummaryTargets(text);
  for (const name of extracted) {
    const skillMd = join(REPO_ROOT, 'skills', name, 'SKILL.md');
    assert.ok(existsSync(skillMd), 'routing target "' + name + '" must exist as skills/' + name + '/SKILL.md; got no such file');
  }
});

test('revise-pass is deliberately absent from the routing summary (Phase 2, not available in v1)', () => {
  const text = readFileSync(SKILL_MD_PATH, 'utf8');
  const extracted = extractRoutingSummaryTargets(text);
  assert.ok(
    !extracted.includes('revise-pass'),
    'revise-pass must not appear as a routing target on the summary line; it is a Phase 2 skill, ' +
    'not shipped in v1 - see Step 4.2b and the Failure behavior section of skills/nfs-start/SKILL.md'
  );
});
