// tests/hooks/agent-identity.test.mjs
// what-it-is:   unit tests for hooks/lib/agent-identity.mjs (ADR-0007, F-AG-01, F-AG-02)
// what-it-does: direct-call tests of every exported member: PLUGIN_NAMESPACE,
//               resolveActiveAgent, resolveAgentLabel, AGENT_WRITE_SCOPES,
//               checkAgentWriteConstraint (including platform folding), and
//               isWebGatedAgent. hooks/pre-tool-use.mjs and hooks/post-tool-batch.mjs
//               each get their own integration-level coverage in their own test
//               files; this file is the single source of truth for the shared
//               module's own behavior.
// runner:       node --test "tests/hooks/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PLUGIN_NAMESPACE,
  resolveActiveAgent,
  resolveAgentLabel,
  AGENT_WRITE_SCOPES,
  checkAgentWriteConstraint,
  isWebGatedAgent
} from '../../hooks/lib/agent-identity.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// PLUGIN_NAMESPACE
// ---------------------------------------------------------------------------

test('PLUGIN_NAMESPACE is the exact plugin.json name field', () => {
  // Reads the real file rather than comparing against a second hardcoded
  // literal: a hardcoded-vs-hardcoded comparison never catches the cross-file
  // drift this test exists to guard against. If .claude-plugin/plugin.json's
  // "name" ever changes without PLUGIN_NAMESPACE changing to match, the
  // platform starts sending a prefix resolveActiveAgent no longer matches,
  // and the entire write-scope and web-gate enforcement layer silently
  // reverts to the dormant F-AG-01 (agents claim enforcement that does not
  // exist) condition this task was created to eliminate - with every
  // "allow" test in this suite still passing, since the code path this
  // constant feeds is designed to fail open on any mismatch.
  const pluginManifest = JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(
    PLUGIN_NAMESPACE, pluginManifest.name,
    'PLUGIN_NAMESPACE must equal the real .claude-plugin/plugin.json "name" field, not merely a string literal chosen to match it'
  );
});

// ---------------------------------------------------------------------------
// resolveActiveAgent: enforcement-facing resolution.
// ---------------------------------------------------------------------------

test('resolveActiveAgent: namespaced agent_type returns the slug after the prefix', () => {
  assert.equal(
    resolveActiveAgent({ agent_type: 'nonfiction-studio:research-librarian' }),
    'research-librarian'
  );
  assert.equal(
    resolveActiveAgent({ agent_type: 'nonfiction-studio:voice-capture' }),
    'voice-capture',
    'matches PF-2 probe evidence verbatim'
  );
});

test('resolveActiveAgent: field absent returns null (main-session action, no false attribution)', () => {
  assert.equal(resolveActiveAgent({}), null);
  assert.equal(resolveActiveAgent({ tool_name: 'Write' }), null);
});

test('resolveActiveAgent: field present but not a string returns null', () => {
  assert.equal(resolveActiveAgent({ agent_type: 42 }), null);
  assert.equal(resolveActiveAgent({ agent_type: null }), null);
  assert.equal(resolveActiveAgent({ agent_type: { nested: true } }), null);
});

test('resolveActiveAgent: empty string agent_type returns null', () => {
  assert.equal(resolveActiveAgent({ agent_type: '' }), null);
});

test('resolveActiveAgent: unnamespaced agent_type ("general-purpose") returns null (PF-1 probe evidence)', () => {
  assert.equal(resolveActiveAgent({ agent_type: 'general-purpose' }), null);
});

test('resolveActiveAgent: an unrelated namespace prefix does not match', () => {
  assert.equal(resolveActiveAgent({ agent_type: 'some-other-plugin:research-librarian' }), null);
});

test('resolveActiveAgent: called with no event object at all does not throw', () => {
  assert.equal(resolveActiveAgent(undefined), null);
  assert.equal(resolveActiveAgent(null), null);
});

test('resolveActiveAgent: namespace prefix with nothing after the colon returns null, not an empty string', () => {
  assert.equal(resolveActiveAgent({ agent_type: 'nonfiction-studio:' }), null);
});

// ---------------------------------------------------------------------------
// resolveAgentLabel: attribution-facing resolution (D-10 compliance layer).
// Deliberately keeps the namespace prefix and unnamespaced types.
// ---------------------------------------------------------------------------

test('resolveAgentLabel: namespaced agent_type returns the RAW string, namespace included', () => {
  assert.equal(
    resolveAgentLabel({ agent_type: 'nonfiction-studio:voice-capture' }),
    'nonfiction-studio:voice-capture',
    'label keeps the namespace prefix, unlike resolveActiveAgent'
  );
});

test('resolveAgentLabel: unnamespaced agent_type ("general-purpose") is returned as-is', () => {
  assert.equal(
    resolveAgentLabel({ agent_type: 'general-purpose' }),
    'general-purpose',
    'label keeps unnamespaced types, unlike resolveActiveAgent'
  );
});

test('resolveAgentLabel: field absent or empty returns null', () => {
  assert.equal(resolveAgentLabel({}), null);
  assert.equal(resolveAgentLabel({ agent_type: '' }), null);
});

test('resolveAgentLabel: field present but not a string returns null', () => {
  assert.equal(resolveAgentLabel({ agent_type: 42 }), null);
});

// ---------------------------------------------------------------------------
// AGENT_WRITE_SCOPES: the exact five-agent table (brief section 1b).
// ---------------------------------------------------------------------------

test('AGENT_WRITE_SCOPES: exactly the five table agents with their exact allowed prefixes', () => {
  assert.deepEqual(
    AGENT_WRITE_SCOPES['research-librarian'],
    ['research/', '.studio/'],
    'research-librarian per agents/research-librarian.md:73-74'
  );
  assert.deepEqual(
    AGENT_WRITE_SCOPES['drafting-partner'],
    ['chapters/'],
    'drafting-partner per agents/drafting-partner.md:69-71'
  );
  assert.deepEqual(
    AGENT_WRITE_SCOPES['line-editor'],
    ['chapters/'],
    'line-editor per agents/line-editor.md:62-64'
  );
  assert.deepEqual(
    AGENT_WRITE_SCOPES['structure-architect'],
    ['structure/', 'research/'],
    'structure-architect per agents/structure-architect.md:67-69'
  );
  assert.deepEqual(
    AGENT_WRITE_SCOPES['thesis-architect'],
    ['context/', 'structure/'],
    'thesis-architect per agents/thesis-architect.md:64-66'
  );
});

test('AGENT_WRITE_SCOPES: fact-checker, interviewer, voice-capture, citation-manager are deliberately absent', () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(AGENT_WRITE_SCOPES, 'fact-checker'), false,
    'fact-checker prose cites no path guard; constraining it would be an unauthorized behavior change'
  );
  assert.equal(Object.prototype.hasOwnProperty.call(AGENT_WRITE_SCOPES, 'interviewer'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(AGENT_WRITE_SCOPES, 'voice-capture'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(AGENT_WRITE_SCOPES, 'citation-manager'), false,
    'citation-manager is a Phase 2 agent that does not exist on disk yet'
  );
});

test('AGENT_WRITE_SCOPES: exactly five keys total (no accidental extra entries)', () => {
  assert.equal(Object.keys(AGENT_WRITE_SCOPES).length, 5);
});

// ---------------------------------------------------------------------------
// isWebGatedAgent (F-AG-02): a DIFFERENT membership question from
// AGENT_WRITE_SCOPES - the former RESEARCH_AGENTS set, moved here unchanged.
// ---------------------------------------------------------------------------

test('isWebGatedAgent: true for research-librarian, fact-checker, citation-manager', () => {
  assert.equal(isWebGatedAgent('research-librarian'), true);
  assert.equal(isWebGatedAgent('fact-checker'), true);
  assert.equal(isWebGatedAgent('citation-manager'), true, 'gated even though absent from AGENT_WRITE_SCOPES');
});

test('isWebGatedAgent: false for agents that do not ship web tools, and for null/undefined/empty', () => {
  assert.equal(isWebGatedAgent('drafting-partner'), false);
  assert.equal(isWebGatedAgent('interviewer'), false);
  assert.equal(isWebGatedAgent('voice-capture'), false);
  assert.equal(isWebGatedAgent(null), false);
  assert.equal(isWebGatedAgent(undefined), false);
  assert.equal(isWebGatedAgent(''), false);
});

// ---------------------------------------------------------------------------
// checkAgentWriteConstraint: the enforcement function.
// ---------------------------------------------------------------------------

test('checkAgentWriteConstraint: falsy or absent agentSlug always allows (null)', () => {
  const target = join(SAMPLE_BOOK, 'chapters', 'x.md');
  assert.equal(checkAgentWriteConstraint(null, target, SAMPLE_BOOK), null);
  assert.equal(checkAgentWriteConstraint(undefined, target, SAMPLE_BOOK), null);
  assert.equal(checkAgentWriteConstraint('', target, SAMPLE_BOOK), null);
});

test('checkAgentWriteConstraint: a slug absent from the table always allows (unconstrained)', () => {
  const target = join(SAMPLE_BOOK, 'chapters', 'x.md');
  assert.equal(
    checkAgentWriteConstraint('fact-checker', target, SAMPLE_BOOK), null,
    'fact-checker is deliberately untabled and stays unconstrained'
  );
  assert.equal(checkAgentWriteConstraint('interviewer', target, SAMPLE_BOOK), null);
});

test('checkAgentWriteConstraint: research-librarian allowed under both of its prefixes (research/, .studio/)', () => {
  assert.equal(
    checkAgentWriteConstraint('research-librarian', join(SAMPLE_BOOK, 'research', 'sources.md'), SAMPLE_BOOK),
    null
  );
  assert.equal(
    checkAgentWriteConstraint('research-librarian', join(SAMPLE_BOOK, '.studio', 'progress.json'), SAMPLE_BOOK),
    null
  );
});

test('checkAgentWriteConstraint: research-librarian denied outside its prefixes, reason names the slug and the prefixes', () => {
  const target = join(SAMPLE_BOOK, 'chapters', 'x.md');
  const reason = checkAgentWriteConstraint('research-librarian', target, SAMPLE_BOOK);
  assert.ok(typeof reason === 'string' && reason.length > 0, 'deny reason is a non-empty string');
  assert.ok(reason.includes('research-librarian'), 'names the agent slug');
  assert.ok(reason.includes('research/'), 'names the allowed prefixes');
  assert.ok(reason.includes('.studio/'), 'names the allowed prefixes');
});

test('checkAgentWriteConstraint: drafting-partner (single-prefix agent) denied outside chapters/', () => {
  const target = join(SAMPLE_BOOK, 'structure', 'outline.md');
  const reason = checkAgentWriteConstraint('drafting-partner', target, SAMPLE_BOOK);
  assert.ok(typeof reason === 'string' && reason.length > 0);
  assert.ok(reason.includes('drafting-partner'), 'names the agent slug');
});

test('checkAgentWriteConstraint: a sibling directory that merely prefixes an allowed one is still denied (boundary check)', () => {
  // "research-notes" shares the "research" prefix textually but is a sibling
  // directory, not a subdirectory of research/.
  const prefixCollision = join(SAMPLE_BOOK, 'research-notes', 'scratch.md');
  const denied = checkAgentWriteConstraint('research-librarian', prefixCollision, SAMPLE_BOOK);
  assert.ok(
    typeof denied === 'string' && denied.length > 0,
    'research-notes/ must be denied; it is a sibling of research/, not inside it'
  );
});

test('checkAgentWriteConstraint: platform folding - a case-differing path is in-scope under a win32 override, not under a posix override', () => {
  const root = SAMPLE_BOOK;
  // "CHAPTERS" (uppercase) differs in case from the "chapters/" scope prefix.
  const target = join(SAMPLE_BOOK, 'CHAPTERS', 'x.md');

  const win32Result = checkAgentWriteConstraint('drafting-partner', target, root, 'win32');
  assert.equal(
    win32Result, null,
    'win32 override: case-differing "CHAPTERS" folds to match the "chapters/" scope prefix -> allowed'
  );

  const posixResult = checkAgentWriteConstraint('drafting-partner', target, root, 'linux');
  assert.ok(
    typeof posixResult === 'string' && posixResult.length > 0,
    'posix override: case is preserved, "CHAPTERS" does not match "chapters" -> denied'
  );
});

test('checkAgentWriteConstraint: platform folding does not affect an already-matching-case path on either override', () => {
  const root = SAMPLE_BOOK;
  const target = join(SAMPLE_BOOK, 'chapters', 'x.md');
  assert.equal(checkAgentWriteConstraint('drafting-partner', target, root, 'win32'), null);
  assert.equal(checkAgentWriteConstraint('drafting-partner', target, root, 'linux'), null);
});

test('checkAgentWriteConstraint: normalizes a ".." traversal before the prefix check, so a lexically in-scope-looking path that really resolves out of scope is denied', () => {
  // Built with raw string concatenation, NOT path.join/path.resolve, so the
  // literal ".." segment survives into the argument exactly as a careless
  // future caller (one that does not realpath first) might pass it. This
  // reproduces the review finding: without resolve() before the prefix
  // check, targetNorm.startsWith(root + sep + "chapters" + sep) is a naive
  // STRING match that succeeds on this unnormalized text even though the
  // path really resolves to research/, outside drafting-partner's
  // chapters/-only scope.
  const chaptersPrefix = join(SAMPLE_BOOK, 'chapters');
  const rawTraversal = chaptersPrefix + sep + '..' + sep + 'research' + sep + 'x.md';

  assert.ok(
    rawTraversal.startsWith(chaptersPrefix + sep),
    'precondition: the unnormalized string textually looks like a chapters/ path'
  );

  const result = checkAgentWriteConstraint('drafting-partner', rawTraversal, SAMPLE_BOOK);
  assert.ok(
    typeof result === 'string' && result.length > 0,
    'a ".." traversal that really resolves outside the agent scope must be denied, ' +
    'not silently allowed by a naive string-prefix match on the unnormalized path'
  );
});
