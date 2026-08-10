// tests/hooks/pre-tool-use-symlink.test.mjs
// what-it-is:   F-HK-04 symlink containment bypass tests for hooks/pre-tool-use.mjs
// what-it-does: proves a symlinked path component inside the book root that points
//               OUTSIDE it is DENIED once real-path re-verification runs (previously
//               only a lexical resolve() check ran, which a symlink defeats trivially
//               since the write lands outside while the lexical path looks contained);
//               also proves ordinary writes through a plain, non-symlinked nested
//               directory and through a symlink that stays INSIDE the root still ALLOW.
// runner:       node --test "tests/hooks/*.test.mjs" (glob picks this file up automatically)
//
// Windows note: creating a new symlink can require elevated privileges or Developer
// Mode. The escape-path and inside-link tests probe capability first and skip cleanly
// (node:test t.skip) with a stated reason when creation is denied. The
// Ubuntu CI leg (unprivileged symlink creation allowed) always proves these cases;
// Windows proves them whenever the runner has the privilege or Developer Mode enabled.
// The plain-directory control test needs no symlink capability and always runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  existsSync,
  symlinkSync,
  cpSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'hooks', 'pre-tool-use.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-w3-symlink-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

function makeTmpDir(label) {
  const dir = join(tmpdir(), 'ns-w3-symlink-' + label + '-' + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Spawn the hook with the given stdin string. NS_HOOK_TRACE cleared by default. */
function runHook(input) {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;
  return spawnSync('node', [SCRIPT], { input, encoding: 'utf8', env });
}

/** Build a synthetic Write event (snake_case shape per TSK-030 firing proof).
 *  agentType, when given, adds agent_id/agent_type fields shaped like the
 *  2026-08-09 platform probe (captured locally, not published; see ADR-0007).
 *  Omitting it (the default) reproduces today's main-session envelope shape. */
function makeWriteEvent(cwd, filePath, agentType = null) {
  const event = {
    session_id: 'test-session-w3-symlink',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: 'w3 symlink test content' },
    tool_use_id: 'toolu_w3symlink'
  };
  if (agentType) {
    event.agent_id = 'atest0000agentidentity1';
    event.agent_type = agentType;
  }
  return JSON.stringify(event);
}

/** Capability probe: attempt to create a real directory symlink. Returns true
 *  on success (fixture left in place for the caller to use), false on any
 *  failure (EPERM/EACCES on Windows without privilege/Developer Mode, etc.)
 *  so the caller can skip cleanly instead of failing. */
function tryCreateDirSymlink(target, linkPath) {
  try {
    symlinkSync(target, linkPath, 'dir');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// F-HK-04 (a): a symlinked subdirectory inside chapters/ that points OUTSIDE
// the book root must DENY a write through it, even though the lexical path
// (before symlinks are followed) looks safely contained inside chapters/.
// ---------------------------------------------------------------------------
test('F-HK-04 (a) write through a symlink escaping the book root is DENIED', (t) => {
  const book = cloneSampleBook('a-escape');
  const outsideDir = makeTmpDir('a-escape-outside-target');
  const linkPath = join(book, 'chapters', 'escape-link');

  if (!tryCreateDirSymlink(outsideDir, linkPath)) {
    t.skip('cannot create a directory symlink on this host (no privilege / Developer Mode); ' +
      'the Ubuntu CI leg proves this case unprivileged');
    return;
  }

  const target = join(linkPath, 'malicious.md');
  const result = runHook(makeWriteEvent(book, target));

  assert.equal(result.status, 0, 'exit code is 0 (deny travels in JSON, not exit code)');

  let out;
  assert.doesNotThrow(
    () => { out = JSON.parse(result.stdout.trim()); },
    'stdout is valid JSON (deny), not empty - a lexical-only check would have allowed this silently'
  );

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PreToolUse', 'hookEventName is PreToolUse');
  assert.equal(
    hso.permissionDecision, 'deny',
    'permissionDecision is deny: the lexical path looked contained but the real path escapes via the symlink'
  );
  assert.ok(
    typeof hso.permissionDecisionReason === 'string' && /symlink/i.test(hso.permissionDecisionReason),
    'deny reason names the symlink as the cause; got: ' + hso.permissionDecisionReason
  );
});

// ---------------------------------------------------------------------------
// F-HK-04 (b): a symlinked subdirectory that points to another location
// INSIDE the book root must still ALLOW - the real-path re-check must not
// over-deny legitimate in-root symlinks.
// ---------------------------------------------------------------------------
test('F-HK-04 (b) write through a symlink that stays INSIDE the book root still ALLOWS', (t) => {
  const book = cloneSampleBook('b-inside-link');
  const insideTargetDir = join(book, 'research');
  const linkPath = join(book, 'chapters', 'inside-link');

  if (!tryCreateDirSymlink(insideTargetDir, linkPath)) {
    t.skip('cannot create a directory symlink on this host (no privilege / Developer Mode); ' +
      'the Ubuntu CI leg proves this case unprivileged');
    return;
  }

  const target = join(linkPath, 'via-link.md');
  const result = runHook(makeWriteEvent(book, target));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout (allow): the symlink resolves inside the book root, so containment holds'
  );
});

// ---------------------------------------------------------------------------
// F-HK-04 (c) control: a PLAIN (non-symlinked) nested directory, including a
// not-yet-existing target file inside it, still ALLOWS. Proves the new
// nearest-existing-ancestor real-path walk does not break ordinary nested
// writes for authors who never touch symlinks at all. Needs no special
// privilege, so this always runs (no capability probe, no skip).
// ---------------------------------------------------------------------------
test('F-HK-04 (c) control: plain nested directory (no symlink), new file: still ALLOWS', () => {
  const book = cloneSampleBook('c-control-plain');
  const plainNestedDir = join(book, 'chapters', 'plain-nested-subdir');
  mkdirSync(plainNestedDir, { recursive: true });

  const target = join(plainNestedDir, 'brand-new-file.md');
  assert.ok(!existsSync(target), 'precondition: target file does not exist yet');

  const result = runHook(makeWriteEvent(book, target));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout (allow): a plain nested directory with no symlink involved is unaffected by the fix'
  );
});

// ---------------------------------------------------------------------------
// F-AG-01 (agent write-scope, symlink evasion): the cross-scope-symlink case.
// A constrained agent's write through a symlink that LEXICALLY looks in-scope
// (inside chapters/, which drafting-partner may write) but really resolves to
// a DIFFERENT in-root directory (research/, outside drafting-partner's scope)
// must be DENIED. This differs from F-HK-04 (a)/(b) above: both the real and
// lexical paths here stay INSIDE the book root, so the general root-
// containment guard alone would ALLOW this write - only evaluating the agent
// constraint against the REAL (symlink-resolved) target, per the Wave 0 park
// (brief 1c-1), catches it. This proves that specific requirement, not just
// the general containment guard's own symlink safety already proven above.
// ---------------------------------------------------------------------------
test('F-AG-01 (symlink) a constrained agent write through a symlink that lexically looks in-scope but really resolves to a different in-root directory is DENIED', (t) => {
  const book = cloneSampleBook('agent-scope-cross-link');
  // drafting-partner's scope is chapters/ only (agents/drafting-partner.md:69-71).
  // The symlink lives INSIDE chapters/ (lexically in-scope) but points at
  // research/ - a different, legitimate in-root directory outside drafting-partner's scope.
  const linkPath = join(book, 'chapters', 'cross-scope-link');
  const researchDir = join(book, 'research');

  if (!tryCreateDirSymlink(researchDir, linkPath)) {
    t.skip('cannot create a directory symlink on this host (no privilege / Developer Mode); ' +
      'the Ubuntu CI leg proves this case unprivileged');
    return;
  }

  const target = join(linkPath, 'via-cross-link.md');
  const result = runHook(makeWriteEvent(book, target, 'nonfiction-studio:drafting-partner'));

  assert.equal(result.status, 0, 'exit code is 0 (deny travels in JSON, not exit code)');

  let out;
  assert.doesNotThrow(
    () => { out = JSON.parse(result.stdout.trim()); },
    'stdout is valid JSON (deny), not empty - evaluating against the lexical path would have allowed this'
  );

  const hso = out.hookSpecificOutput;
  assert.equal(
    hso.permissionDecision, 'deny',
    'denied: the real target resolves to research/, outside the chapters/-only scope drafting-partner is allowed'
  );
  assert.ok(
    hso.permissionDecisionReason.includes('drafting-partner'),
    'deny reason names the agent slug'
  );
});

// ---------------------------------------------------------------------------
// F-AG-01 control: the same cross-directory symlink, written by an
// UNCONSTRAINED caller (no agent_type), still ALLOWS. Without this pair, the
// test above would pass even if checkAgentWriteConstraint denied every write
// unconditionally once wired, which is not the behavior being proven here.
// ---------------------------------------------------------------------------
test('F-AG-01 (symlink) control: the same cross-directory symlink write with no agent_type still ALLOWS', (t) => {
  const book = cloneSampleBook('agent-scope-cross-link-control');
  const linkPath = join(book, 'chapters', 'cross-scope-link-control');
  const researchDir = join(book, 'research');

  if (!tryCreateDirSymlink(researchDir, linkPath)) {
    t.skip('cannot create a directory symlink on this host (no privilege / Developer Mode); ' +
      'capability already probed by the primary test above, which reports the same skip reason');
    return;
  }

  const target = join(linkPath, 'via-cross-link-control.md');
  const result = runHook(makeWriteEvent(book, target));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout (allow): main-session writes are never subject to the per-agent write-scope table'
  );
});
