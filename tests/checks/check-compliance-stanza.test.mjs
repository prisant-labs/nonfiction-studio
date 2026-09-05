// tests/checks/check-compliance-stanza.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-compliance-stanza.mjs
// what-it-does: runs the real checker script (a standalone process) against isolated fixtures.
//               Two fixture styles, mirroring tests/checks/check-workspace-refs.test.mjs:
//                 (1) real-repo clones (clone-helper.mjs's cloneRepoToTemp): proves the checker
//                     passes on the actual shipped six-skill tree, and that a mutation planted
//                     into a CLONE (never the working tree) turns it red -- the mutation proofs
//                     named in Task 5's brief;
//                 (2) a synthetic fixture (buildSyntheticRoot below): a from-scratch skills/ tree
//                     proving genericity -- the dispatching set is derived from each skill's own
//                     frontmatter `chain:` list, not a hardcoded name list, so an invented seventh
//                     skill with a `chain:` entry and no stanza is still caught, and a skill with
//                     no `chain:` at all is correctly ignored.
// why:          chat compliance parity acceptance criteria: exit 0 on the six-skill tree; exit 1
//               naming the file when any of the six lacks the core or a seventh dispatching skill
//               appears without it; a named mutation proof (see the two "mutation proof:" tests
//               below).
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-compliance-stanza.mjs';

after(() => {
  cleanupGoldenClone();
});

function safeRemove(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup only
  }
}

/** Copies a repo-relative file from the real, current working tree into a fixture root. */
function copyFromRepo(fixtureRoot, relPath) {
  const src = join(REPO_ROOT, ...relPath.split('/'));
  const dst = join(fixtureRoot, ...relPath.split('/'));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(src));
}

/** cloneRepoToTemp, but with this repo's CURRENT on-disk checker script copied over
 *  whatever the git-tracked snapshot provided -- the checker is new/uncommitted while
 *  this task is in flight, so clone-helper's git-ls-files-only clone would not carry it
 *  at all otherwise. Mirrors tests/checks/check-workspace-refs.test.mjs's cloneRealRepo. */
function cloneRealRepo(label) {
  const { root, cleanup } = cloneRepoToTemp(label);
  copyFromRepo(root, SCRIPT);
  return { root, cleanup };
}

// ---------------------------------------------------------------------------
// Real-repo clone tests
// ---------------------------------------------------------------------------

test('real repo: exits 0 on the actual six-skill tree', () => {
  const { root, cleanup } = cloneRealRepo('compliance-clean');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 on the real, unmodified tree; got: ' + result.combined);
    assert.match(result.combined, /6 dispatching skill\(s\) found/, 'reports six dispatching skills');
    for (const slug of [
      'nfs-capture-voice', 'nfs-draft', 'nfs-fact-check',
      'nfs-interview', 'nfs-outline', 'nfs-research',
    ]) {
      assert.match(result.combined, new RegExp(slug), 'names ' + slug + ' as a dispatching skill');
    }
  } finally {
    cleanup();
  }
});

test('mutation proof: breaking one skill\'s core sentence turns the checker red, naming that file', () => {
  const { root, cleanup } = cloneRealRepo('compliance-mutate-one');
  try {
    const target = join(root, 'skills', 'nfs-fact-check', 'SKILL.md');
    const original = readFileSync(target, 'utf8');
    const mutated = original.replace(
      'This skill never appends twice for the same write.',
      'This skill may append more than once for the same write.'
    );
    assert.notEqual(mutated, original, 'the mutation must actually change the file (sentence not found)');
    writeFileSync(target, mutated);

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 once one skill\'s core sentence is broken; got: ' + result.combined);
    assert.match(
      result.combined, /nfs-fact-check\/SKILL\.md/,
      'finding must name the mutated file'
    );
  } finally {
    cleanup();
  }
});

test('mutation proof: a core paragraph that diverges from the other five (not just a missing sentinel) is caught as a byte-identical mismatch', () => {
  const { root, cleanup } = cloneRealRepo('compliance-mutate-diverge');
  try {
    const target = join(root, 'skills', 'nfs-interview', 'SKILL.md');
    const original = readFileSync(target, 'utf8');
    // Reorder two clauses within the shared paragraph -- still contains every sentinel
    // substring, but the extracted core no longer matches the other five skills byte for byte.
    const mutated = original.replace(
      'Hold that starting count per file.',
      'Hold that starting count per file, and note it down.'
    );
    assert.notEqual(mutated, original, 'the mutation must actually change the file');
    writeFileSync(target, mutated);

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a core that diverges from the shared text; got: ' + result.combined);
    assert.match(result.combined, /nfs-interview\/SKILL\.md/, 'finding must name the diverged file');
    assert.match(result.combined, /differs from/, 'finding explains it is a byte-identical mismatch, not a missing core');
  } finally {
    cleanup();
  }
});

test('a dispatching skill missing the core entirely is named (heading removed)', () => {
  const { root, cleanup } = cloneRealRepo('compliance-missing-core');
  try {
    const target = join(root, 'skills', 'nfs-outline', 'SKILL.md');
    const original = readFileSync(target, 'utf8');
    const mutated = original.replace('### Compliance append (verify-then-append)', '### Something else entirely');
    assert.notEqual(mutated, original, 'the mutation must actually remove the heading');
    writeFileSync(target, mutated);

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 when the heading is gone; got: ' + result.combined);
    assert.match(result.combined, /nfs-outline\/SKILL\.md/, 'finding must name the file missing the core');
    assert.match(result.combined, /lacks the shared compliance-stanza core/, 'finding explains the core is entirely absent');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Synthetic fixture: genericity proof (dispatching set derived from frontmatter
// `chain:`, never a hardcoded six-name list).
// ---------------------------------------------------------------------------

const VALID_CORE = [
  '### Compliance append (verify-then-append)',
  '',
  "This flow's writes may already be logged automatically by a hook on this surface; " +
    'this skill never assumes which surfaces do or do not fire that hook, and it never ' +
    'assumes the flow is running on any particular surface. Before this flow\'s first write, ' +
    'read `.studio/ai-use-log.jsonl` and count how many records currently target each file ' +
    "this flow is about to write (the file's path appearing in that record's `targets` array). " +
    'Hold that starting count per file. After this flow\'s writes complete, re-read ' +
    '`.studio/ai-use-log.jsonl` and count the records targeting each of those files again. ' +
    'For each file: if the count increased between the two reads, a hook already appended a ' +
    'record for this write on this surface, and this skill appends nothing further for that ' +
    'file. If the count did not increase, append the flow\'s record or records for that file to ' +
    '`.studio/ai-use-log.jsonl`, per the record template below, using the six-field shape in ' +
    '`docs/formats/ai-use-log.md` (S-08 section 5): `ts`, `agent`, `surface`, `scope`, `targets`, ' +
    '`summary` - with `surface` set honestly to the surface this flow is actually running on. ' +
    'A record already sitting in the log before this flow started, from an earlier session, ' +
    "does not by itself suppress the append; only a count increase observed between this flow's " +
    'own two reads does. This skill never appends twice for the same write.',
  '',
  '**Record template for this flow.**',
  '',
  '```json',
  '{"ts":"<RFC 3339 UTC>","agent":"synthetic-agent","surface":"<actual surface>","scope":"generated","targets":["some/file.md"],"summary":"Did something."}',
  '```',
].join('\n');

function skillMd({ name, chain, includeCore }) {
  const fm = ['---', 'name: ' + name, 'user-invocable: true'];
  if (chain) {
    fm.push('chain:');
    for (const a of chain) fm.push('  - ' + a);
  }
  fm.push('---', '');
  const body = includeCore ? VALID_CORE + '\n' : 'No compliance section here at all.\n';
  return fm.join('\n') + '\n' + body;
}

/** Builds a from-scratch skills/ tree plus a fresh copy of the checker script (a
 *  zero-npm-dependency standalone script, so no node_modules resolution is needed),
 *  so the synthetic tree exercises the real, current on-disk script rather than a
 *  git-staged snapshot. */
function buildSyntheticSkillsTree(label, skillsSpec) {
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-compliance-synth-' + label + '-'));
  const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const src = join(REPO_ROOT, ...SCRIPT.split('/'));
  const dst = join(root, ...SCRIPT.split('/'));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(src));
  for (const [dirName, spec] of Object.entries(skillsSpec)) {
    const dst = join(root, 'skills', dirName, 'SKILL.md');
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, skillMd(spec));
  }
  return { root, cleanup: () => safeRemove(root) };
}

test('synthetic: a skill with an empty chain: (or none) is correctly ignored, even if it lacks the core', () => {
  const { root, cleanup } = buildSyntheticSkillsTree('non-dispatching', {
    'a-dispatcher': { name: 'a-dispatcher', chain: ['some-agent'], includeCore: true },
    'not-a-dispatcher': { name: 'not-a-dispatcher', chain: [], includeCore: false },
    'also-not-a-dispatcher': { name: 'also-not-a-dispatcher', chain: null, includeCore: false },
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0: only the chain-bearing skill is in scope; got: ' + result.combined);
    assert.match(result.combined, /1 dispatching skill\(s\) found/, 'only one skill counted as dispatching');
  } finally {
    cleanup();
  }
});

test('synthetic: a seventh (invented) dispatching skill with a chain: but no stanza is caught by name, not by a hardcoded six-name list', () => {
  const { root, cleanup } = buildSyntheticSkillsTree('seventh', {
    'nfs-capture-voice': { name: 'nfs-capture-voice', chain: ['voice-capture'], includeCore: true },
    'nfs-draft': { name: 'nfs-draft', chain: ['drafting-partner', 'line-editor'], includeCore: true },
    'nfs-fact-check': { name: 'nfs-fact-check', chain: ['fact-checker'], includeCore: true },
    'nfs-interview': { name: 'nfs-interview', chain: ['interviewer'], includeCore: true },
    'nfs-outline': { name: 'nfs-outline', chain: ['thesis-architect', 'structure-architect'], includeCore: true },
    'nfs-research': { name: 'nfs-research', chain: ['research-librarian'], includeCore: true },
    'nfs-invented-seventh': { name: 'nfs-invented-seventh', chain: ['some-new-agent'], includeCore: false },
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1: the seventh skill declares agents but carries no stanza; got: ' + result.combined);
    assert.match(result.combined, /7 dispatching skill\(s\) found/, 'derives seven from frontmatter, not a hardcoded six');
    assert.match(result.combined, /nfs-invented-seventh\/SKILL\.md/, 'finding names the seventh skill by file path');
  } finally {
    cleanup();
  }
});

test('synthetic: byte-identical cores across an invented set exit 0', () => {
  const { root, cleanup } = buildSyntheticSkillsTree('synthetic-clean', {
    'skill-one': { name: 'skill-one', chain: ['agent-a'], includeCore: true },
    'skill-two': { name: 'skill-two', chain: ['agent-b'], includeCore: true },
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'identical cores across two dispatching skills must pass; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('operational error: zero dispatching skills found exits 2', () => {
  const { root, cleanup } = buildSyntheticSkillsTree('zero-dispatching', {
    'no-chain-at-all': { name: 'no-chain-at-all', chain: null, includeCore: false },
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 2, 'zero dispatching skills is an operational error, not a clean pass; got: ' + result.combined);
  } finally {
    cleanup();
  }
});
