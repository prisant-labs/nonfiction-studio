// tests/checks/check-state-folder-stanza.test.mjs
// what-it-is:   tests for scripts/checks/check-state-folder-stanza.mjs, the checker that locks the
//               shared "Locate the state folder" stanza (ADR-0015, state folder name)
// what-it-does: runs the checker against a temp clone of the real tree, then plants one defect per
//               test and proves the checker names it: a drifted copy, an identical drift in every
//               copy, a resolver rule the prose does not follow, a placeholder with no stanza, a
//               dead stanza, a misplaced stanza, a literal folder name in a skill or an agent, and
//               an agent that names the placeholder without the shared note. Two further tests
//               prove the exemptions (a "/"-prefixed path, and the doctor's allowlist entry).
// runner:       node --test "tests/checks/*.test.mjs" (picked up by scripts/test-engines.mjs)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-state-folder-stanza.mjs';
const HEADING = '## Locate the state folder';

// The skills that read or write the state folder themselves, and so carry the stanza.
const CARRIERS = [
  'nfs-capture-voice', 'nfs-check-chapter', 'nfs-draft', 'nfs-fact-check', 'nfs-interview',
  'nfs-new-book', 'nfs-outline', 'nfs-research', 'nfs-start',
];

after(() => {
  cleanupGoldenClone();
});

/** Copies a repo-relative file from the working tree into a clone (the clone is tracked files only). */
function copyFromRepo(root, rel) {
  const dst = join(root, ...rel.split('/'));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(join(REPO_ROOT, ...rel.split('/'))));
}

function cloneRealRepo(label) {
  const clone = cloneRepoToTemp(label);
  copyFromRepo(clone.root, SCRIPT);
  copyFromRepo(clone.root, 'hooks/lib/bible.mjs');
  return clone;
}

/** Applies fn to a clone file's text and asserts the edit changed something. */
function mutate(root, rel, fn) {
  const path = join(root, ...rel.split('/'));
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, 'the mutation must change ' + rel);
  writeFileSync(path, after);
}

function withClone(label, body) {
  const { root, cleanup } = cloneRealRepo(label);
  try {
    body(root);
  } finally {
    cleanup();
  }
}

test('real repo: exits 0 and names every skill that carries the stanza', () => {
  withClone('stanza-clean', (root) => {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 on the real tree; got: ' + result.combined);
    assert.match(result.combined, /9 skill\(s\) carry the stanza/);
    for (const name of CARRIERS) assert.match(result.combined, new RegExp(name));
  });
});

test('mutation proof: one drifted copy is named as a byte-identical mismatch', () => {
  withClone('stanza-drift-one', (root) => {
    mutate(root, 'skills/nfs-research/SKILL.md', (t) =>
      t.replace('Resolve it once, before any step below.', 'Resolve it before any step below.'));
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-research\/SKILL\.md: the stanza differs from/);
  });
});

test('mutation proof: dropping a reserved name from every copy alike is still caught', () => {
  withClone('stanza-drift-all', (root) => {
    for (const name of CARRIERS) {
      mutate(root, 'skills/' + name + '/SKILL.md', (t) => t.replace(' or `.claude`', ''));
    }
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /the stanza is missing required text: `\.claude`/);
    assert.doesNotMatch(result.combined, /differs from/, 'the copies still agree with each other');
  });
});

test('derivation proof: a reserved name added in bible.mjs fails the unchanged prose', () => {
  withClone('stanza-derived', (root) => {
    mutate(root, 'hooks/lib/bible.mjs', (t) => t.replace("'.git', '.claude']", "'.git', '.claude', 'manuscript']"));
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /missing required text: `manuscript`/);
  });
});

test('a skill that names <state-dir> without the stanza is named', () => {
  withClone('stanza-missing', (root) => {
    mutate(root, 'skills/nfs-status-dashboard/SKILL.md', (t) => t + '\nRead `<state-dir>/progress.json`.\n');
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /nfs-status-dashboard\/SKILL\.md: names <state-dir> but lacks/);
  });
});

test('a stanza in a skill that names <state-dir> nowhere else is a dead stanza', () => {
  withClone('stanza-dead', (root) => {
    const draft = readFileSync(join(root, 'skills', 'nfs-draft', 'SKILL.md'), 'utf8');
    const start = draft.indexOf(HEADING);
    const stanza = draft.slice(start, draft.indexOf('\n---\n', start));
    mutate(root, 'skills/nfs-quick-scan/SKILL.md', (t) => t + '\n' + stanza + '\n');
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /nfs-quick-scan\/SKILL\.md: carries the .* stanza but names <state-dir> nowhere outside it/);
  });
});

test('a stanza placed after the first step heading is named', () => {
  withClone('stanza-placement', (root) => {
    mutate(root, 'skills/nfs-draft/SKILL.md', (t) => {
      const start = t.indexOf(HEADING);
      const step = t.indexOf('## Step 1');
      const block = t.slice(start, step);
      const without = t.slice(0, start) + t.slice(step);
      const eol = without.indexOf('\n', without.indexOf('## Step 1'));
      return without.slice(0, eol + 1) + '\n' + block + without.slice(eol + 1);
    });
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /nfs-draft\/SKILL\.md: the .* stanza must come before the first "## Step" heading/);
  });
});

test('a literal default folder path in a skill is named with its line', () => {
  withClone('stanza-literal-skill', (root) => {
    mutate(root, 'skills/nfs-draft/SKILL.md', (t) => t + '\nRead `_nonfiction-studio/progress.json`.\n');
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-draft\/SKILL\.md:\d+: names the state folder "_nonfiction-studio" literally/);
  });
});

test('a literal legacy folder path in an agent is named with its line', () => {
  withClone('stanza-literal-agent', (root) => {
    mutate(root, 'agents/line-editor.md', (t) => t + '\nNever write to `.studio/`.\n');
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /agents\/line-editor\.md:\d+: names the state folder "\.studio" literally/);
  });
});

test('an agent that names <state-dir> without the shared note is named', () => {
  withClone('stanza-agent-note', (root) => {
    mutate(root, 'agents/fact-checker.md', (t) =>
      t.replace(/`<state-dir>` stands for the book's state folder\./, '`<state-dir>` is the state folder.'));
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /agents\/fact-checker\.md: names <state-dir> but lacks the shared agent note/);
  });
});

test('exemption: the default name inside a longer path, preceded by "/", is not a finding', () => {
  withClone('stanza-exempt-slash', (root) => {
    mutate(root, 'skills/nfs-draft/SKILL.md', (t) =>
      t + '\nSee `templates/book-scaffold/_nonfiction-studio/` and `<tour-dir>/_nonfiction-studio/`.\n');
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, result.combined);
  });
});

test('the legacy name inside a longer path is still a finding, because no shipped tree uses it', () => {
  withClone('stanza-legacy-slash', (root) => {
    mutate(root, 'skills/nfs-tour/SKILL.md', (t) => t + '\nRead `<tour-dir>/.studio/config.json`.\n');
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-tour\/SKILL\.md:\d+: names the state folder "\.studio" literally/);
  });
});

test('exemption: the doctor may name the default and the legacy folder', () => {
  withClone('stanza-exempt-doctor', (root) => {
    mutate(root, 'skills/nfs-doctor/SKILL.md', (t) =>
      t + '\nA legacy `.studio/` folder moves to `_nonfiction-studio/`.\n');
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, result.combined);
  });
});
