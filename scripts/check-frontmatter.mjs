// scripts/check-frontmatter.mjs
// what-it-is:   agent and skill frontmatter validator with S4-enforcement fold
// what-it-does: verifies every non-spike agent carries the five-key house set (name,
//               description, model, color, tools) with name matching its filename, color
//               in the eight-value enum, model in the allowed set, and memory only on the
//               D-09 roster (fact-checker); verifies no agent carries hooks, mcpServers,
//               or permissionMode; verifies every non-spike skill carries name and a boolean
//               user-invocable; enforces the S4 chain contract (TSK-044) bidirectionally
//               against agents/_chain-permitted.yaml; verifies chain endpoint existence.
// why:          Q-02 1.2 frontmatter-completeness step; resolves the phantom-caller era
//               now that all Phase 1 skills and agents exist on disk per TSK-055.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENTS_DIR = join(REPO_ROOT, 'agents');
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const CHAIN_YAML = join(AGENTS_DIR, '_chain-permitted.yaml');

// Eight-value color enum per D-19 (colors by pillar).
const COLOR_ENUM = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'cyan']);

// Allowed model values per D-18 (in-plugin model routing).
const MODEL_ALLOWED = new Set(['inherit', 'haiku', 'sonnet', 'opus', 'fable']);

// D-09 (learning checker agents): only these agents may carry memory: project.
const MEMORY_ROSTER = new Set(['fact-checker']);

// Forbidden agent frontmatter keys per A-02 (platform capability baseline).
// Platform ignores these for plugin-shipped agents; declaring them is a latent hazard.
const AGENT_FORBIDDEN_KEYS = ['hooks', 'mcpServers', 'permissionMode'];

// Required agent frontmatter keys.
const AGENT_REQUIRED_KEYS = ['name', 'description', 'model', 'color', 'tools'];

// Required skill frontmatter keys.
const SKILL_REQUIRED_KEYS = ['name', 'user-invocable'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const findings = [];

function addFinding(msg) {
  findings.push(msg);
  process.stderr.write('[check-frontmatter] ERROR: ' + msg + '\n');
}

function extractFrontmatter(text, filePath) {
  // Extract YAML between the first --- pair.
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return null;
  const endIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (endIdx === -1) return null;
  const yamlText = lines.slice(1, endIdx).join('\n');
  try {
    return parseYaml(yamlText);
  } catch (err) {
    addFinding(filePath + ': frontmatter YAML parse error: ' + err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Load chain-permitted.yaml
// ---------------------------------------------------------------------------

if (!existsSync(CHAIN_YAML)) {
  process.stderr.write('[check-frontmatter] FATAL: agents/_chain-permitted.yaml not found\n');
  process.exit(2);
}

let chainYaml;
try {
  chainYaml = parseYaml(readFileSync(CHAIN_YAML, 'utf8'));
} catch (err) {
  process.stderr.write('[check-frontmatter] FATAL: cannot parse agents/_chain-permitted.yaml: ' + err.message + '\n');
  process.exit(2);
}

// Build the chain map: caller -> Set(callees)
const chainMap = new Map();
for (const [caller, callees] of Object.entries(chainYaml || {})) {
  if (typeof caller === 'string' && Array.isArray(callees)) {
    chainMap.set(caller, new Set(callees));
  }
}

// ---------------------------------------------------------------------------
// Check endpoint existence for every yaml edge
// ---------------------------------------------------------------------------

for (const [caller, callees] of chainMap) {
  // Caller is either an agent or a skill
  const callerIsAgent = existsSync(join(AGENTS_DIR, caller + '.md'));
  const callerIsSkill = existsSync(join(SKILLS_DIR, caller, 'SKILL.md'));
  if (!callerIsAgent && !callerIsSkill) {
    addFinding(
      '_chain-permitted.yaml caller "' + caller + '" has no matching agents/' + caller +
      '.md or skills/' + caller + '/SKILL.md on disk'
    );
  }
  for (const callee of callees) {
    const calleeIsAgent = existsSync(join(AGENTS_DIR, callee + '.md'));
    const calleeIsSkill = existsSync(join(SKILLS_DIR, callee, 'SKILL.md'));
    if (!calleeIsAgent && !calleeIsSkill) {
      addFinding(
        '_chain-permitted.yaml callee "' + callee + '" (in edge ' + caller + ' -> ' + callee +
        ') has no matching agents/' + callee + '.md or skills/' + callee + '/SKILL.md on disk'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Check agents
// ---------------------------------------------------------------------------

let agentFiles;
try {
  agentFiles = readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'));
} catch (err) {
  process.stderr.write('[check-frontmatter] FATAL: cannot read agents/ directory: ' + err.message + '\n');
  process.exit(2);
}

for (const filename of agentFiles) {
  const name = basename(filename, '.md');

  // Skip spike agents (temporary stubs, not in shipped set)
  if (name.startsWith('spike-')) continue;

  const filePath = 'agents/' + filename;
  const fullPath = join(AGENTS_DIR, filename);

  let text;
  try {
    text = readFileSync(fullPath, 'utf8');
  } catch (err) {
    addFinding(filePath + ': cannot read file: ' + err.message);
    continue;
  }

  const fm = extractFrontmatter(text, filePath);
  if (!fm) continue;

  // Required keys check
  for (const key of AGENT_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(fm, key) || fm[key] === null || fm[key] === undefined) {
      addFinding(filePath + ': missing required frontmatter key "' + key + '"');
    }
  }

  // name must match filename
  if (fm.name !== undefined && fm.name !== name) {
    addFinding(
      filePath + ': "name" value "' + fm.name + '" does not match filename "' + name + '"'
    );
  }

  // color enum check
  if (fm.color !== undefined && !COLOR_ENUM.has(fm.color)) {
    addFinding(
      filePath + ': "color" value "' + fm.color + '" is not in the eight-value enum (' +
      [...COLOR_ENUM].join(', ') + ')'
    );
  }

  // model allowed-set check
  if (fm.model !== undefined && !MODEL_ALLOWED.has(fm.model)) {
    addFinding(
      filePath + ': "model" value "' + fm.model + '" is not in the allowed set (' +
      [...MODEL_ALLOWED].join(', ') + ')'
    );
  }

  // memory check: only fact-checker (and D-09 roster) may carry memory: project
  if (fm.memory !== undefined) {
    if (fm.memory !== 'project') {
      addFinding(filePath + ': "memory" must be "project" when declared; got "' + fm.memory + '"');
    } else if (!MEMORY_ROSTER.has(name)) {
      addFinding(
        filePath + ': "memory: project" is not permitted for agent "' + name +
        '"; only the D-09 roster may carry it (' + [...MEMORY_ROSTER].join(', ') + ')'
      );
    }
  }

  // Forbidden key checks (each is a named error per A-02)
  for (const forbidden of AGENT_FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fm, forbidden)) {
      addFinding(
        filePath + ': agent carries forbidden frontmatter key "' + forbidden +
        '" -- platform agents silently ignore it (A-02 platform capability baseline), making it a latent documentation hazard'
      );
    }
  }

  // S4-enforcement: chain list in frontmatter must mirror yaml both directions
  const frontmatterChain = Array.isArray(fm.chain) ? fm.chain : [];
  const yamlCallees = chainMap.has(name) ? chainMap.get(name) : new Set();

  // Forward check: every frontmatter chain entry must appear in yaml
  for (const callee of frontmatterChain) {
    if (!yamlCallees.has(callee)) {
      addFinding(
        filePath + ': frontmatter chain includes "' + callee +
        '" but agents/_chain-permitted.yaml has no edge ' + name + ' -> ' + callee
      );
    }
  }

  // Backward check: every yaml edge FROM this agent must appear in frontmatter chain
  for (const callee of yamlCallees) {
    if (!frontmatterChain.includes(callee)) {
      addFinding(
        filePath + ': agents/_chain-permitted.yaml declares edge ' + name + ' -> ' + callee +
        ' but agent frontmatter chain list does not include "' + callee + '"'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Check skills
// ---------------------------------------------------------------------------

let skillEntries;
try {
  skillEntries = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== '.gitkeep' && !e.name.startsWith('.'));
} catch (err) {
  process.stderr.write('[check-frontmatter] FATAL: cannot read skills/ directory: ' + err.message + '\n');
  process.exit(2);
}

for (const entry of skillEntries) {
  const skillName = entry.name;

  // Skip spike skills
  if (skillName.startsWith('spike-')) continue;

  const skillMdPath = join(SKILLS_DIR, skillName, 'SKILL.md');
  const filePath = 'skills/' + skillName + '/SKILL.md';

  if (!existsSync(skillMdPath)) {
    addFinding(filePath + ': SKILL.md missing for skill "' + skillName + '"');
    continue;
  }

  let text;
  try {
    text = readFileSync(skillMdPath, 'utf8');
  } catch (err) {
    addFinding(filePath + ': cannot read file: ' + err.message);
    continue;
  }

  const fm = extractFrontmatter(text, filePath);
  if (!fm) continue;

  // Required keys check
  for (const key of SKILL_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(fm, key) || fm[key] === null || fm[key] === undefined) {
      addFinding(filePath + ': missing required frontmatter key "' + key + '"');
    }
  }

  // user-invocable must be boolean
  if (Object.prototype.hasOwnProperty.call(fm, 'user-invocable') && typeof fm['user-invocable'] !== 'boolean') {
    addFinding(
      filePath + ': "user-invocable" must be a boolean; got ' + typeof fm['user-invocable']
    );
  }

  // S4-enforcement: chain list in SKILL.md frontmatter must mirror yaml both directions
  const frontmatterChain = Array.isArray(fm.chain) ? fm.chain : [];
  const yamlCallees = chainMap.has(skillName) ? chainMap.get(skillName) : new Set();

  // Forward check: every frontmatter chain entry must appear in yaml
  for (const callee of frontmatterChain) {
    if (!yamlCallees.has(callee)) {
      addFinding(
        filePath + ': frontmatter chain includes "' + callee +
        '" but agents/_chain-permitted.yaml has no edge ' + skillName + ' -> ' + callee
      );
    }
  }

  // Backward check: every yaml edge FROM this skill must appear in frontmatter chain
  for (const callee of yamlCallees) {
    if (!frontmatterChain.includes(callee)) {
      addFinding(
        filePath + ': agents/_chain-permitted.yaml declares edge ' + skillName + ' -> ' + callee +
        ' but skill frontmatter chain list does not include "' + callee + '"'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (findings.length === 0) {
  const agentCount = agentFiles.filter(f => !basename(f, '.md').startsWith('spike-')).length;
  const skillCount = skillEntries.filter(e => !e.name.startsWith('spike-')).length;
  process.stdout.write(
    '[check-frontmatter] pass: ' + agentCount + ' agent(s) and ' +
    skillCount + ' skill(s) validated; chain contract enforced\n'
  );
  process.exit(0);
} else {
  process.exit(1);
}
