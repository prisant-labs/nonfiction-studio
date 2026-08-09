// scripts/checks/check-inventory.mjs
// what-it-is:   component inventory equality and manifest name-equality checker
// what-it-does: two duties.
//               (1) Inventory equality (F-ST-03): discovers the shipped component set
//               directly from the tree - agents/*.md (top-level files, excluding any
//               leading-underscore file such as agents/_chain-permitted.yaml),
//               skills/*/SKILL.md directories, the hook events actually declared as keys
//               of the "hooks" object in hooks/hooks.json, and bin/ns-* executables
//               excluding .cmd Windows shims - and asserts it EXACTLY equals
//               library.json's "components" object, both directions: a component present
//               in the tree but missing from the declaration fails, and a component
//               declared in library.json but missing from the tree fails. Every mismatch
//               is named individually.
//               (2) Name equality (F-ST-04, the ADR-0006 (manifest authority split)
//               release-gate rule that nothing previously enforced): asserts
//               .claude-plugin/plugin.json "name" == library.json "name" ==
//               .claude-plugin/marketplace.json top-level "name", and that the
//               marketplace.json plugins[] entry for THIS plugin (identified by
//               `"source": "./"`, the self-marketplace entry per ADR-0006's central-
//               marketplace amendment) carries that same name.
// why:          F-ST-03 (component inventory) and F-ST-04 (name equality) - library.json
//               is declared authoritative for the component inventory but nothing checked
//               it against the tree, and the name-equality rule the release gate is
//               supposed to enforce was never wired into any check script.
// design note:  discovery here is a plain filesystem read (readdirSync / readFileSync),
//               never git-tracked-file based. Unlike check-plugin-root.mjs (which scans a
//               large tracked-file set for a text pattern and so cares whether a stray
//               local file is actually shipped), this check's job is to catch an
//               undeclared file the moment it exists on disk - including in a bare
//               directory copy with no .git present at all - so a git-tracked filter
//               would hide exactly the drift this check exists to name.
// exit taxonomy: 0 = discovered set equals declared set and all names agree;
//               1 = named mismatch(es) (missing declaration, phantom declaration, or a
//               name disagreement);
//               2 = operational error (a required file/directory is missing, unreadable,
//               not valid JSON, or library.json "components" is not a plain object keyed
//               by kind with array values) - a broken precondition, not a content mismatch.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-inventory]';

const AGENTS_DIR = join(REPO_ROOT, 'agents');
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const BIN_DIR = join(REPO_ROOT, 'bin');
const HOOKS_JSON = join(REPO_ROOT, 'hooks', 'hooks.json');
const LIBRARY_JSON = join(REPO_ROOT, 'library.json');
const PLUGIN_JSON = join(REPO_ROOT, '.claude-plugin', 'plugin.json');
const MARKETPLACE_JSON = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');

function fatal(message) {
  process.stderr.write(PREFIX + ' FATAL: ' + message + '\n');
  process.exit(2);
}

function readJson(absPath, label) {
  if (!existsSync(absPath)) {
    fatal(label + ' not found at ' + absPath);
  }
  let raw;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err) {
    fatal('cannot read ' + label + ': ' + err.message);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fatal(label + ' is not valid JSON: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Tree discovery
// ---------------------------------------------------------------------------

function discoverAgents() {
  let entries;
  try {
    entries = readdirSync(AGENTS_DIR);
  } catch (err) {
    fatal('cannot read agents/ directory: ' + err.message);
  }
  return entries
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => basename(f, '.md'))
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

function discoverHooks() {
  const data = readJson(HOOKS_JSON, 'hooks/hooks.json');
  if (!data || typeof data.hooks !== 'object' || data.hooks === null || Array.isArray(data.hooks)) {
    fatal('hooks/hooks.json has no top-level "hooks" object');
  }
  return Object.keys(data.hooks).sort();
}

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

// ---------------------------------------------------------------------------
// Findings (deferred: accumulated during the checks below, printed in Report)
// ---------------------------------------------------------------------------

const findings = [];

function addFinding(msg) {
  findings.push(msg);
}

// ---------------------------------------------------------------------------
// Duty 1: inventory equality (F-ST-03)
// ---------------------------------------------------------------------------

function compareKind(kind, discovered, declaredRaw) {
  if (declaredRaw !== undefined && !Array.isArray(declaredRaw)) {
    fatal('library.json components.' + kind + ' must be an array (got ' + typeof declaredRaw + ')');
  }
  const declared = Array.isArray(declaredRaw) ? declaredRaw : [];
  const declaredSet = new Set(declared);
  const discoveredSet = new Set(discovered);

  for (const name of discovered) {
    if (!declaredSet.has(name)) {
      addFinding(
        'components.' + kind + ': "' + name + '" exists in the tree but is not declared in library.json'
      );
    }
  }
  for (const name of declared) {
    if (!discoveredSet.has(name)) {
      addFinding(
        'components.' + kind + ': library.json declares "' + name + '" but it does not exist in the tree'
      );
    }
  }
}

const library = readJson(LIBRARY_JSON, 'library.json');
const components = library.components;
if (components === undefined || typeof components !== 'object' || components === null || Array.isArray(components)) {
  fatal('library.json has no usable "components" object (ADR-0006 (manifest authority split) requires it as the component-inventory source of truth)');
}

const discoveredAgents = discoverAgents();
const discoveredSkills = discoverSkills();
const discoveredHooks = discoverHooks();
const discoveredClis = discoverClis();

compareKind('agents', discoveredAgents, components.agents);
compareKind('skills', discoveredSkills, components.skills);
compareKind('hooks', discoveredHooks, components.hooks);
compareKind('clis', discoveredClis, components.clis);

// ---------------------------------------------------------------------------
// Duty 2: name equality (F-ST-04)
// ---------------------------------------------------------------------------

const pluginJson = readJson(PLUGIN_JSON, '.claude-plugin/plugin.json');
const marketplaceJson = readJson(MARKETPLACE_JSON, '.claude-plugin/marketplace.json');

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value === '') {
    addFinding(label + ' is missing or not a non-empty string (got ' + JSON.stringify(value) + ')');
    return false;
  }
  return true;
}

const libraryNameOk = requireNonEmptyString(library.name, 'library.json "name"');
const pluginNameOk = requireNonEmptyString(pluginJson.name, '.claude-plugin/plugin.json "name"');
const marketplaceNameOk = requireNonEmptyString(marketplaceJson.name, '.claude-plugin/marketplace.json top-level "name"');

if (libraryNameOk && pluginNameOk && library.name !== pluginJson.name) {
  addFinding(
    '.claude-plugin/plugin.json name "' + pluginJson.name + '" does not equal library.json name "' + library.name + '"'
  );
}
if (libraryNameOk && marketplaceNameOk && library.name !== marketplaceJson.name) {
  addFinding(
    '.claude-plugin/marketplace.json top-level name "' + marketplaceJson.name +
    '" does not equal library.json name "' + library.name + '"'
  );
}

const plugins = Array.isArray(marketplaceJson.plugins) ? marketplaceJson.plugins : null;
if (!plugins) {
  addFinding('.claude-plugin/marketplace.json "plugins" is missing or not an array');
} else {
  const selfEntry = plugins.find((p) => p && p.source === './');
  if (!selfEntry) {
    addFinding('.claude-plugin/marketplace.json has no plugins[] entry with source "./" (the self-marketplace entry for this plugin, per ADR-0006)');
  } else if (requireNonEmptyString(selfEntry.name, '.claude-plugin/marketplace.json plugins[] self entry "name"') && libraryNameOk && selfEntry.name !== library.name) {
    addFinding(
      '.claude-plugin/marketplace.json plugins[] self entry name "' + selfEntry.name +
      '" does not equal library.json name "' + library.name + '"'
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (findings.length === 0) {
  process.stdout.write(
    PREFIX + ' pass: ' + discoveredAgents.length + ' agent(s), ' + discoveredSkills.length +
    ' skill(s), ' + discoveredHooks.length + ' hook(s), ' + discoveredClis.length +
    ' cli(s) match library.json components; name equality holds across plugin.json, ' +
    'library.json, and marketplace.json\n'
  );
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
