// what-it-is:   agent-dispatch routing enforcement readers (Task 8, D-18 in-plugin model routing
//               + the agents/_chain-permitted.yaml chain contract, now also enforced at dispatch)
// what-it-does: reads a plugin agent's declared `model:` frontmatter field from agents/<slug>.md
//               and the chain-permitted edge table from agents/_chain-permitted.yaml, both from
//               the PLUGIN's own directory tree (not the book/bible root - an unrelated concept),
//               caching each per resolved file path for the lifetime of one hook process; and the
//               two pure comparison functions (model-tier mismatch, chain-edge lookup) that decide
//               whether a dispatch should be warned about. hooks/pre-tool-use.mjs is the only
//               caller; it owns the routing_enforce mode (off|warn|block) and the JSON output
//               shape - this module owns only the file reads and the two comparisons.
// why:          this plugin declares a model per agent (D-18, in-plugin model routing) and a
//               permitted invocation graph (agents/_chain-permitted.yaml, Standard sec 3.6) but
//               neither was ever checked at dispatch time before this task - an author or an
//               orchestrating skill could silently dispatch any agent at any model tier, or along
//               any edge, with no signal.
// fail-open:    every read here can fail (file missing, YAML unreadable, frontmatter not a
//               key/value map) and none of those failures throw - each returns a { ..., error }
//               shape the caller treats as "cannot judge this, stay silent", matching
//               hooks/lib/settings.mjs's own fail-open contract (same rationale: a corrupt or
//               absent file must never crash a hook or force a false decision). YAML parsing goes
//               through hooks/lib/mini-yaml.mjs, a vendored zero-dependency parser (C1, Wave 1
//               exit final review) - there is no longer a "parser unavailable" failure mode, since
//               that module ships in this plugin's own tree rather than depending on node_modules.
// override:     NS_AGENTS_DIR (test-only, mirrors the NS_HOOK_TRACE convention in
//               hooks/pre-tool-use.mjs) redirects both readers at a fixture directory instead of
//               this plugin's own shipped agents/ tree, so fail-open cases (unparseable
//               frontmatter, unreadable chain contract) can be tested without corrupting a
//               committed file. Inert when unset.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMiniYaml } from './mini-yaml.mjs';

// hooks/lib/routing.mjs -> hooks/lib -> hooks -> plugin root -> agents/
// (the plugin root is this repo's own root; hooks are invoked as
// `node ${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs`, so this module's own file location is
// always two directories below the plugin root, regardless of the caller's cwd.)
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_AGENTS_DIR = join(PLUGIN_ROOT, 'agents');

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

/**
 * Resolves the agents/ directory to read from: NS_AGENTS_DIR when set (test-only override), else
 * this plugin's own shipped agents/ tree. Evaluated fresh on every call (not cached) so a test can
 * set and unset the env var around individual runHook() calls.
 */
function resolveAgentsDir() {
  return process.env.NS_AGENTS_DIR ? resolve(process.env.NS_AGENTS_DIR) : DEFAULT_AGENTS_DIR;
}

// ---------------------------------------------------------------------------
// readAgentModel(slug, agentsDir?): reads agents/<slug>.md's frontmatter `model:` field.
//
// Cached per resolved absolute path for the lifetime of one hook process: a repeat read of the
// same file within one process returns the FIRST result, even if the file changes on disk
// afterward. Production never notices this (each hook invocation is already a fresh process, so
// the cache starts empty every real run); a direct-call test exercises it explicitly.
//
// Returns { model: string|null, error: string|null }. Every failure path (file missing, no fence,
// invalid YAML, non-object frontmatter, yaml module unavailable) returns model: null with a
// non-null error. A syntactically fine file whose frontmatter simply has no `model:` key (or a
// non-string one) also returns model: null, but with error: null - not itself a failure, just
// nothing to compare against.
// ---------------------------------------------------------------------------
const modelCache = new Map();

export function readAgentModel(slug, agentsDir = resolveAgentsDir()) {
  const absPath = join(resolve(agentsDir), slug + '.md');
  if (modelCache.has(absPath)) return modelCache.get(absPath);

  const result = parseAgentModel(absPath);
  modelCache.set(absPath, result);
  return result;
}

function parseAgentModel(absPath) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (err) {
    return { model: null, error: 'agent file unreadable: ' + err.message };
  }

  const m = text.match(FENCE);
  if (!m) {
    return { model: null, error: 'agent file has no YAML frontmatter fence (--- fenced block at top)' };
  }

  let data;
  try {
    data = parseMiniYaml(m[1]);
  } catch (err) {
    return { model: null, error: 'invalid YAML frontmatter: ' + err.message };
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { model: null, error: 'frontmatter is not a key/value map' };
  }

  const model = typeof data.model === 'string' ? data.model : null;
  return { model, error: null };
}

// ---------------------------------------------------------------------------
// readChainPermitted(agentsDir?): reads and parses agents/_chain-permitted.yaml - the same file
// scripts/checks/chain-contract.mjs (S4) validates at lint time; this is its first runtime reader.
// Cached per resolved absolute path, same rationale as readAgentModel.
//
// Returns { contract: object|null, error: string|null }.
// ---------------------------------------------------------------------------
const chainCache = new Map();

export function readChainPermitted(agentsDir = resolveAgentsDir()) {
  const absPath = join(resolve(agentsDir), '_chain-permitted.yaml');
  if (chainCache.has(absPath)) return chainCache.get(absPath);

  const result = parseChainPermitted(absPath);
  chainCache.set(absPath, result);
  return result;
}

function parseChainPermitted(absPath) {
  if (!existsSync(absPath)) {
    return { contract: null, error: 'agents/_chain-permitted.yaml does not exist' };
  }

  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (err) {
    return { contract: null, error: 'agents/_chain-permitted.yaml unreadable: ' + err.message };
  }

  let data;
  try {
    data = parseMiniYaml(text);
  } catch (err) {
    return { contract: null, error: 'agents/_chain-permitted.yaml is not valid YAML: ' + err.message };
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { contract: null, error: 'agents/_chain-permitted.yaml is not a key/value map' };
  }

  return { contract: data, error: null };
}

// ---------------------------------------------------------------------------
// clearRoutingCaches(): test-only reset of both per-process caches. Production code (the hook
// script) never calls this - each hook invocation is already a fresh process, so both caches
// start empty every real run. Only a test that imports this module directly and reuses the same
// resolved path across cases (to prove caching, then prove the cache can be cleared) needs this.
// ---------------------------------------------------------------------------
export function clearRoutingCaches() {
  modelCache.clear();
  chainCache.clear();
}

// ---------------------------------------------------------------------------
// modelMismatchMessage(slug, declaredModel, requestedModel): the model rule's one comparison.
// Returns the exact warn sentence (also reused verbatim as the block-mode deny reason) or null
// when nothing should fire:
//   - no requestedModel (tool_input.model absent): the platform resolves to the declaration ->
//     silence, per design.
//   - no declaredModel (missing/unparseable agent file), or declaredModel === 'inherit': an
//     inherit declaration never warns, and an unknown declaration cannot be compared.
//   - declaredModel === requestedModel: no mismatch.
// ---------------------------------------------------------------------------
export function modelMismatchMessage(slug, declaredModel, requestedModel) {
  if (!requestedModel) return null;
  if (!declaredModel || declaredModel === 'inherit') return null;
  if (declaredModel === requestedModel) return null;
  return (
    'Routing: ' + slug + ' declares model ' + declaredModel +
    ' (D-18 in-plugin model routing); this dispatch requests ' + requestedModel + '.'
  );
}

// ---------------------------------------------------------------------------
// chainEdgeMessage(dispatcherSlug, targetSlug, contract): the chain rule's one lookup. contract is
// the parsed agents/_chain-permitted.yaml object (or null, from readChainPermitted's fail-open
// error path). Returns null (silent) when the contract is unreadable, when dispatcherSlug has no
// entry, or when targetSlug IS in its permitted list; otherwise a warn sentence naming both slugs.
// ---------------------------------------------------------------------------
export function chainEdgeMessage(dispatcherSlug, targetSlug, contract) {
  if (!contract || typeof contract !== 'object') return null;
  const permitted = Array.isArray(contract[dispatcherSlug])
    ? contract[dispatcherSlug].filter((x) => typeof x === 'string')
    : [];
  if (permitted.includes(targetSlug)) return null;
  return (
    'Routing: ' + dispatcherSlug + ' -> ' + targetSlug +
    ' is not a declared edge in agents/_chain-permitted.yaml; add it there if this dispatch is intentional.'
  );
}
