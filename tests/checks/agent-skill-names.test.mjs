// tests/checks/agent-skill-names.test.mjs
// what-it-is:   a tree test that every agent's frontmatter names its invoking skills by
//               their current nfs- names.
// what-it-does: reads the skill-to-agent edges from agents/_chain-permitted.yaml and
//               checks two things in each agent's whitespace-normalized frontmatter:
//               (1) the agent names every skill that the chain contract says invokes it;
//               (2) every hyphenated "<name> skill" phrase names a directory under skills/.
//               Planted-text tests prove that both rules fail on a stale name.
// why:          the model reads an agent's description when it picks which component to
//               call. Six agents still named skills by their pre-rename names (for example
//               "the draft-chapter skill") long after the nfs- rename, and no check saw it.
// runner:       node --test "tests/checks/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseMiniYaml } from '../../hooks/lib/mini-yaml.mjs';
import { REPO_ROOT } from './clone-helper.mjs';

const AGENTS_DIR = join(REPO_ROOT, 'agents');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

function skillNames() {
  return new Set(
    readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(SKILLS_DIR, e.name, 'SKILL.md')))
      .map((e) => e.name),
  );
}

// The frontmatter block, with every run of whitespace collapsed to one space, so a name
// or phrase that wraps across lines is still found.
export function frontmatterText(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('no frontmatter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('unterminated frontmatter');
  return lines.slice(1, end).join(' ').replace(/\s+/g, ' ');
}

// True when `name` appears as a whole component name: not inside a longer hyphenated
// name, so "capture-voice" does not match inside "nfs-capture-voice".
export function namesComponent(text, name) {
  const escaped = name.replace(/[-]/g, '\\-');
  return new RegExp('(?<![a-z0-9-])' + escaped + '(?![a-z0-9-])').test(text);
}

// Every hyphenated "<name> skill" phrase whose name is not a real skill.
export function unknownSkillPhrases(text, known) {
  const out = [];
  for (const m of text.matchAll(/(?<![a-z0-9-])([a-z][a-z0-9]*(?:-[a-z0-9]+)+) skill\b/g)) {
    if (!known.has(m[1])) out.push(m[1]);
  }
  return out;
}

// Skill-to-agent edges from the chain contract: [skill, agent] pairs whose caller is a
// skill directory and whose callee is an agent file.
function skillToAgentEdges(known) {
  const contract = parseMiniYaml(readFileSync(join(AGENTS_DIR, '_chain-permitted.yaml'), 'utf8'));
  const edges = [];
  for (const [caller, callees] of Object.entries(contract)) {
    if (!known.has(caller) || !Array.isArray(callees)) continue;
    for (const callee of callees) {
      if (existsSync(join(AGENTS_DIR, callee + '.md'))) edges.push([caller, callee]);
    }
  }
  return edges;
}

function agentFrontmatter(agent) {
  return frontmatterText(readFileSync(join(AGENTS_DIR, agent + '.md'), 'utf8'));
}

test('each agent names every skill the chain contract says invokes it', () => {
  const known = skillNames();
  const edges = skillToAgentEdges(known);
  // Eight skill-to-agent edges exist today; a parse that silently finds none must fail.
  assert.ok(edges.length >= 8, 'expected at least 8 skill-to-agent edges, found ' + edges.length);
  const missing = edges
    .filter(([skill, agent]) => !namesComponent(agentFrontmatter(agent), skill))
    .map(([skill, agent]) => agent + ' does not name ' + skill);
  assert.deepEqual(missing, []);
});

test('every hyphenated "<name> skill" phrase in agent frontmatter names a real skill', () => {
  const known = skillNames();
  const agents = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));
  assert.ok(agents.length >= 8, 'expected at least 8 agent files');
  const bad = [];
  for (const f of agents) {
    for (const name of unknownSkillPhrases(frontmatterText(readFileSync(join(AGENTS_DIR, f), 'utf8')), known)) {
      bad.push(f + ': "' + name + ' skill"');
    }
  }
  assert.deepEqual(bad, []);
});

test('planted text: both rules catch a stale name and pass the current one', () => {
  const known = new Set(['nfs-draft', 'nfs-capture-voice']);
  const stale = frontmatterText('---\ndescription: >-\n  Invoked via the draft-chapter\n  skill.\n---\n');
  const fresh = frontmatterText('---\ndescription: >-\n  Invoked via the nfs-draft\n  skill.\n---\n');
  assert.equal(namesComponent(stale, 'nfs-draft'), false);
  assert.equal(namesComponent(fresh, 'nfs-draft'), true);
  assert.deepEqual(unknownSkillPhrases(stale, known), ['draft-chapter']);
  assert.deepEqual(unknownSkillPhrases(fresh, known), []);
  // A retired name inside a current one is not a match.
  assert.equal(namesComponent('the nfs-capture-voice skill', 'capture-voice'), false);
});
