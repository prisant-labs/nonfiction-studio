// tests/hooks/pre-tool-use.test.mjs
// what-it-is:   behaviour tests for hooks/pre-tool-use.mjs (TSK-032; extended by
//               task 1, agent identity enforcement, for F-AG-01/F-AG-02/F8)
// what-it-does: spawns the real script with crafted snake_case PreToolUse events and
//               imports the exported guard functions directly, covering the TSK-032
//               brief cases plus 13 further cases covering agent write-scope enforcement
//               (F-AG-01), the web-research gate (F-AG-02), and the F8
//               corrupt-config-suppresses-the-caution carry
// runner:       node --test "tests/hooks/*.test.mjs"
//
// Synthetic events copy the shape captured live in the TSK-030 report (snake_case stdin):
//   { session_id, transcript_path, cwd, prompt_id, permission_mode, effort,
//     hook_event_name, tool_name, tool_input, tool_use_id }
//   plus agent_id/agent_type when a subagent fired the call, shaped like the
//   2026-08-09 platform probe (captured locally, not published; see ADR-0007).
//
// Never mutates committed fixtures. Temp clones are used for write-tool cases.
// pickSnapshotName and foldForCompare are imported directly from
// hooks/pre-tool-use.mjs (top-level await; the isMain guard there prevents
// stdin/exit side-effects on import). checkAgentWriteConstraint is imported
// the same way from hooks/lib/agent-identity.mjs, where it and
// resolveActiveAgent/resolveAgentLabel/isWebGatedAgent now live (ADR-0007).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  cpSync,
  unlinkSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'hooks', 'pre-tool-use.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Import the module directly for the exported-function test (case j).
// isMain is false here (process.argv[1] is the test runner, not the hook script)
// so no stdin reads or process.exit() calls happen during import.
// ---------------------------------------------------------------------------
const { pickSnapshotName, foldForCompare } = await import('../../hooks/pre-tool-use.mjs');
// checkResearchAgentConstraint was renamed checkAgentWriteConstraint and moved to
// hooks/lib/agent-identity.mjs (brief 1c): its contract widened from three
// hardcoded research agents to the five-agent AGENT_WRITE_SCOPES table (brief 1b).
const { checkAgentWriteConstraint } = await import('../../hooks/lib/agent-identity.mjs');
// Task 8 (dispatch routing enforcement): the pure comparison function, imported directly for the
// model-comparison mutation-proof test below (a direct call pinpoints that one comparison, immune
// to any wiring change elsewhere); readAgentModel and clearRoutingCaches, imported directly for
// the cache-per-process design-pin test. Every OTHER Task 8 case below - including the readers'
// actual use inside the shipped hook, the chain reader, and the namespace-guard mutation proof -
// is exercised only through the spawned hook (runHook), proving the WIRING, not just the isolated
// function, matching this suite's existing convention.
const { modelMismatchMessage, readAgentModel, clearRoutingCaches, readChainPermitted } = await import('../../hooks/lib/routing.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(label) {
  const dir = join(tmpdir(), 'ns-tsk032-' + label + '-' + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-tsk032-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

/** Spawn the hook with the given stdin string and optional extra env overrides.
 *  NS_HOOK_TRACE is cleared from the parent env by default. */
function runHook(input, extraEnv = {}) {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined || v === '') {
      delete env[k];
    } else {
      env[k] = String(v);
    }
  }
  return spawnSync('node', [SCRIPT], { input, encoding: 'utf8', env });
}

/** Build a synthetic Write/Edit event (snake_case shape per TSK-030 firing proof).
 *  agentType, when given, adds agent_id/agent_type fields shaped like the
 *  2026-08-09 platform probe (captured locally, not published; see ADR-0007): present
 *  on subagent-fired envelopes, absent on main-session ones. Omitting it (the
 *  default) reproduces today's main-session envelope shape exactly. */
function makeWriteEvent(cwd, filePath, toolName = 'Write', agentType = null) {
  const event = {
    session_id: 'test-session-032',
    transcript_path: '/tmp/t.jsonl',
    cwd,
    prompt_id: 'p-032',
    permission_mode: 'default',
    effort: { level: 'medium' },
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: { file_path: filePath, content: 'test content from tsk-032 test suite' },
    tool_use_id: 'toolu_test032'
  };
  if (agentType) {
    event.agent_id = 'atest0000agentidentity1';
    event.agent_type = agentType;
  }
  return JSON.stringify(event);
}

/** Build a synthetic Bash event. */
function makeBashEvent(cwd, command) {
  return JSON.stringify({
    session_id: 'test-session-032',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: 'toolu_test032'
  });
}

/** Build a synthetic PowerShell event (F-HK-07: PowerShell is a first-class
 *  peer of Bash on Windows sessions and carries its command the same way). */
function makePowerShellEvent(cwd, command) {
  return JSON.stringify({
    session_id: 'test-session-032',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'PowerShell',
    tool_input: { command },
    tool_use_id: 'toolu_test032'
  });
}

/** Build a synthetic Agent/Task dispatch event (Task 8: dispatch routing enforcement).
 *  subagentType lands in tool_input.subagent_type verbatim (namespaced or not, per the case under
 *  test); model, when given, lands in tool_input.model (a genuine override request per the
 *  2026-09-04 platform probe - omitted entirely, not null, when not given, matching the probe's
 *  captured "absent key, not present-but-null" shape). dispatcherType, when given, adds
 *  agent_id/agent_type shaped like a plugin agent ITSELF making the dispatch call (the chain
 *  rule's "DISPATCHING context"), same convention as makeWriteEvent's agentType parameter. */
function makeDispatchEvent(cwd, { toolName = 'Agent', subagentType, model, dispatcherType } = {}) {
  const toolInput = {
    description: 'test dispatch from the Task 8 suite',
    prompt: 'reply with the single word done',
    subagent_type: subagentType
  };
  if (model !== undefined) toolInput.model = model;
  const event = {
    session_id: 'test-session-t8',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'toolu_test_t8'
  };
  if (dispatcherType) {
    event.agent_id = 'atest0000dispatcher00001';
    event.agent_type = dispatcherType;
  }
  return JSON.stringify(event);
}

/** Writes .claude/nonfiction-studio.local.md under dir with the given raw text content (Task 8
 *  routing_enforce mode tests; mirrors tests/engines/settings.test.mjs's own writeSettingsFile). */
function writeRoutingSettings(dir, text) {
  const settingsDir = join(dir, '.claude');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, 'nonfiction-studio.local.md'), text, 'utf8');
}

/** Build a synthetic Read event (read-only; should be a no-op). */
function makeReadEvent(cwd) {
  return JSON.stringify({
    session_id: 'test-session-032',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: join(cwd, 'chapters', '01.md') },
    tool_use_id: 'toolu_test032'
  });
}

/** Count snapshot files in .studio/snapshots/ that belong to the given slug. */
function countSnapshots(bookRoot, slug) {
  const dir = join(bookRoot, '.studio', 'snapshots');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.startsWith(slug + '.') && f.endsWith('.md')).length;
}

/** F-HK-13 (case-differing drive letter or path): flip the case of an ASCII drive
 *  letter (if present, e.g. "C:" -> "c:") and invert the case of every other ASCII
 *  letter in the path. Produces a path that refers to the SAME file on a
 *  case-insensitive filesystem but differs textually in both the drive letter and
 *  the rest of the path, matching that scenario. */
function flipCase(p) {
  const driveMatch = p.match(/^([a-zA-Z]):(.*)$/);
  let drive = '';
  let rest = p;
  if (driveMatch) {
    const letter = driveMatch[1];
    drive = (letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase()) + ':';
    rest = driveMatch[2];
  }
  const flippedRest = rest.replace(/[a-zA-Z]/g, (ch) => (
    ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()
  ));
  return drive + flippedRest;
}

// ---------------------------------------------------------------------------
// (a) chapter Write on existing file: flag written, snapshot created, allow
// ---------------------------------------------------------------------------
test('(a) chapter Write existing file: flag + snapshot written, empty stdout, exit 0', () => {
  const book = cloneSampleBook('a-existing');
  const target = join(book, 'chapters', '01-listening-before-speaking.md');
  const slug = '01-listening-before-speaking';
  const snapshotsBefore = countSnapshots(book, slug);

  const result = runHook(makeWriteEvent(book, target));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (allow path)');
  assert.equal(result.stderr, '', 'no stderr');

  // Session-write flag must exist and contain an ISO timestamp
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');
  assert.ok(existsSync(flagPath), 'session-write flag was written');
  const flagContent = readFileSync(flagPath, 'utf8').trim();
  assert.ok(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/.test(flagContent),
    'flag content is a bare ISO 8601 UTC timestamp'
  );

  // Exactly one new snapshot must be created
  const snapshotsAfter = countSnapshots(book, slug);
  assert.equal(snapshotsAfter, snapshotsBefore + 1, 'exactly one new snapshot was added');

  // Snapshot name must match <slug>.<YYYYMMDDTHHMMSSZ>.md
  const allSnapshots = readdirSync(join(book, '.studio', 'snapshots'))
    .filter(f => f.startsWith(slug + '.') && f.endsWith('.md'));
  allSnapshots.sort();
  const newestSnapshot = allSnapshots[allSnapshots.length - 1];
  assert.ok(
    /^01-listening-before-speaking\.\d{8}T\d{9}Z\.md$/.test(newestSnapshot),
    'newest snapshot filename matches <slug>.<YYYYMMDDTHHMMSSmmmZ>.md (F-HK-03: milliseconds added)'
  );
});

// ---------------------------------------------------------------------------
// (b) chapter Write on NEW file: flag written, NO snapshot
// ---------------------------------------------------------------------------
test('(b) chapter Write new file: flag written, no snapshot created', () => {
  const book = cloneSampleBook('b-new');
  const target = join(book, 'chapters', '99-new-chapter.md');

  // Confirm the target file does not exist in the clone
  assert.ok(!existsSync(target), 'precondition: target file does not exist before hook run');

  const result = runHook(makeWriteEvent(book, target));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (allow path)');

  // Flag must be written even for a new file
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');
  assert.ok(existsSync(flagPath), 'session-write flag written for new chapter file');

  // No snapshot should exist for the new (never-before-written) file
  assert.equal(
    countSnapshots(book, '99-new-chapter'),
    0,
    'no snapshot created when target file is new (does not exist yet)'
  );
});

// ---------------------------------------------------------------------------
// (c) snapshot prune: seed 10 snapshots, overwrite, newest 10 survive
// ---------------------------------------------------------------------------
test('(c) snapshot prune: 10 seeded + 1 new = 11, prune to newest 10', () => {
  const book = cloneSampleBook('c-prune');
  const slug = '01-listening-before-speaking';
  const snapshotsDir = join(book, '.studio', 'snapshots');
  const target = join(book, 'chapters', slug + '.md');

  // Remove any existing snapshots for this slug from the clone so we start clean
  readdirSync(snapshotsDir)
    .filter(f => f.startsWith(slug + '.') && f.endsWith('.md'))
    .forEach(f => unlinkSync(join(snapshotsDir, f)));

  // Seed 10 snapshots with known past timestamps: t1 (oldest) through t10
  const seedTimestamps = [];
  for (let i = 1; i <= 10; i++) {
    const ts = '20200101T0000' + String(i).padStart(2, '0') + 'Z';
    seedTimestamps.push(ts);
    writeFileSync(join(snapshotsDir, slug + '.' + ts + '.md'), 'seed snapshot ' + i, 'utf8');
  }
  assert.equal(countSnapshots(book, slug), 10, 'precondition: exactly 10 seeded snapshots');

  // Run hook: target exists, so a new snapshot is created (11 total before prune)
  const result = runHook(makeWriteEvent(book, target));
  assert.equal(result.status, 0, 'exit code is 0');

  // After prune: exactly 10 snapshots survive per the S-08 section 10 retention rule
  assert.equal(countSnapshots(book, slug), 10, 'exactly 10 snapshots survive after prune');

  // The oldest seeded snapshot (t1) must have been pruned
  const t1 = join(snapshotsDir, slug + '.' + seedTimestamps[0] + '.md');
  assert.ok(!existsSync(t1), 'oldest seeded snapshot was deleted by prune');

  // The 10th seeded snapshot (t10) must still exist
  const t10 = join(snapshotsDir, slug + '.' + seedTimestamps[9] + '.md');
  assert.ok(existsSync(t10), '10th seeded snapshot survives (newest seeded)');
});

// ---------------------------------------------------------------------------
// (d) write outside root: deny JSON with path-guard reason
// ---------------------------------------------------------------------------
test('(d) write outside root: deny JSON with path-guard reason, exit 0', () => {
  const book = cloneSampleBook('d-outside');
  // Use a path in os.tmpdir() which is guaranteed to be outside the book root
  const outsidePath = join(tmpdir(), 'ns-tsk032-outside-' + Date.now() + '.md');

  const result = runHook(makeWriteEvent(book, outsidePath));

  assert.equal(result.status, 0, 'exit code is 0 even on deny');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PreToolUse', 'hookEventName is PreToolUse');
  assert.equal(hso.permissionDecision, 'deny', 'permissionDecision is deny');
  assert.ok(
    typeof hso.permissionDecisionReason === 'string' && hso.permissionDecisionReason.length > 0,
    'permissionDecisionReason is a non-empty string'
  );
  assert.ok(
    hso.permissionDecisionReason.toLowerCase().includes('outside'),
    'deny reason mentions that target is outside the bible root'
  );
});

// ---------------------------------------------------------------------------
// (e) .studio/ write: allowed (empty stdout), no snapshot, no session-write flag
// ---------------------------------------------------------------------------
test('(e) .studio/ write: empty stdout, no snapshot, no session-write flag', () => {
  const book = cloneSampleBook('e-studio');
  const studioTarget = join(book, '.studio', 'progress.json');
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');

  // Confirm no flag pre-exists in the fresh clone
  const flagBefore = existsSync(flagPath);

  const result = runHook(makeWriteEvent(book, studioTarget));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (allow) for .studio/ write');

  // Flag must not have been written by this hook run
  if (!flagBefore) {
    assert.ok(!existsSync(flagPath), 'session-write flag NOT written for .studio/ target');
  }

  // No snapshot for .studio/ target (progress.json snapshot would be named progress.*.md)
  const studioSnapshots = readdirSync(join(book, '.studio', 'snapshots'))
    .filter(f => f.startsWith('progress.') && f.endsWith('.md'));
  assert.equal(studioSnapshots.length, 0, 'no snapshot created for .studio/ write');
});

// ---------------------------------------------------------------------------
// (f) Read tool: empty stdout, exit 0, nothing written
// ---------------------------------------------------------------------------
test('(f) Read tool: empty stdout, exit 0, no flag written', () => {
  const book = cloneSampleBook('f-read');
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');
  const result = runHook(makeReadEvent(book));

  assert.equal(result.status, 0, 'exit code is 0 for Read tool');
  assert.equal(result.stdout.trim(), '', 'stdout is empty for Read tool');
  assert.ok(!existsSync(flagPath), 'Read tool does not write the session-write flag');
});

// ---------------------------------------------------------------------------
// (g) Bash rm -rf and git reset --hard: additionalContext caution, no decision
// ---------------------------------------------------------------------------
test('(g) Bash rm -rf: additionalContext caution, no permissionDecision', () => {
  const book = cloneSampleBook('g-bash-rmrf');
  const result = runHook(makeBashEvent(book, 'rm -rf /tmp/foo'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PreToolUse', 'hookEventName is PreToolUse');
  assert.ok(
    typeof hso.additionalContext === 'string' && hso.additionalContext.includes('rm -rf'),
    'additionalContext names the rm -rf pattern'
  );
  assert.equal(hso.permissionDecision, undefined, 'no permissionDecision field for caution');
});

test('(g) Bash git reset --hard: additionalContext caution, no permissionDecision', () => {
  const book = cloneSampleBook('g-bash-reset');
  const result = runHook(makeBashEvent(book, 'git reset --hard HEAD~1'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');

  const hso = out.hookSpecificOutput;
  assert.ok(
    typeof hso.additionalContext === 'string' && hso.additionalContext.includes('git reset --hard'),
    'additionalContext names the git reset --hard pattern'
  );
  assert.equal(hso.permissionDecision, undefined, 'no permissionDecision field for caution');
});

// ---------------------------------------------------------------------------
// (h) benign Bash: empty stdout (allow)
// ---------------------------------------------------------------------------
test('(h) benign Bash: empty stdout, exit 0', () => {
  const book = cloneSampleBook('h-bash-benign');
  const result = runHook(makeBashEvent(book, 'ls -la'));

  assert.equal(result.status, 0, 'exit code is 0 for benign Bash');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (allow) for benign Bash');
});

// ---------------------------------------------------------------------------
// (i) no book root: empty stdout, exit 0
// ---------------------------------------------------------------------------
test('(i) no book root: empty stdout, exit 0', () => {
  const emptyDir = makeTmpDir('i-no-root');
  const outsideTarget = join(emptyDir, 'chapters', 'test.md');

  const event = JSON.stringify({
    session_id: 'test-session-032',
    cwd: emptyDir,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: outsideTarget, content: 'x' },
    tool_use_id: 'toolu_test032'
  });

  const result = runHook(event);

  assert.equal(result.status, 0, 'exit code is 0 when no book root is found');
  assert.equal(result.stdout.trim(), '', 'stdout is empty when no book root found (no-op path)');
});

// ---------------------------------------------------------------------------
// (j) exported agent write-scope guard function: direct call with injected slug.
//
// Ported from the OQ-14 dormant-seam version of this test. The function was
// renamed checkResearchAgentConstraint -> checkAgentWriteConstraint and moved
// to hooks/lib/agent-identity.mjs (brief 1c) because its contract widened
// from three hardcoded research agents to the five-agent AGENT_WRITE_SCOPES
// table (brief 1b). fact-checker and citation-manager, used by the original
// version of this test, are now DELIBERATELY absent from that table (their
// prose cites no path guard), so the deny-side assertions are ported to
// research-librarian and drafting-partner, which preserve the same
// denied/allowed verdicts this test always meant to prove; fact-checker is
// kept as the untabled-agent example, now expected to ALLOW rather than deny.
// Full coverage of checkAgentWriteConstraint itself lives in
// tests/hooks/agent-identity.test.mjs; this test's own purpose is narrower:
// pinning that this file's fixtures exercise the same function the shipped
// hook now calls at its Step 5 call site.
// ---------------------------------------------------------------------------
test('(j) agent write-scope guard: research-librarian denied chapters/, allowed research/ and .studio/', () => {
  const chaptersTarget = join(SAMPLE_BOOK, 'chapters', '01-listening-before-speaking.md');
  const researchTarget = join(SAMPLE_BOOK, 'research', 'evidence-log.md');
  const studioTarget = join(SAMPLE_BOOK, '.studio', 'progress.json');

  // research-librarian trying to write to chapters/ must be denied
  const denyReason = checkAgentWriteConstraint('research-librarian', chaptersTarget, SAMPLE_BOOK);
  assert.ok(
    typeof denyReason === 'string' && denyReason.length > 0,
    'research-librarian gets a deny reason for chapters/ write'
  );
  assert.ok(denyReason.includes('research-librarian'), 'deny reason names the agent slug');

  // research-librarian writing to research/ must be allowed (null)
  const researchAllow = checkAgentWriteConstraint('research-librarian', researchTarget, SAMPLE_BOOK);
  assert.equal(researchAllow, null, 'research-librarian allowed (null) for research/ write');

  // research-librarian writing to .studio/ must also be allowed (null)
  const studioAllow = checkAgentWriteConstraint('research-librarian', studioTarget, SAMPLE_BOOK);
  assert.equal(studioAllow, null, 'research-librarian allowed (null) for .studio/ write');

  // An untabled agent (fact-checker, deliberately absent from AGENT_WRITE_SCOPES)
  // always returns null regardless of target: unconstrained, not denied.
  const untabled = checkAgentWriteConstraint('fact-checker', chaptersTarget, SAMPLE_BOOK);
  assert.equal(untabled, null, 'untabled agent (fact-checker) returns null: always allowed, unconstrained');

  // Null agent slug always returns null
  const nullAgent = checkAgentWriteConstraint(null, chaptersTarget, SAMPLE_BOOK);
  assert.equal(nullAgent, null, 'null agentSlug returns null (always allowed)');

  // drafting-partner (a DIFFERENT table agent, chapters/-only) is denied for a
  // research/ write: proves the table is per-agent, not one shared scope.
  const draftingDeny = checkAgentWriteConstraint('drafting-partner', researchTarget, SAMPLE_BOOK);
  assert.ok(
    typeof draftingDeny === 'string' && draftingDeny.length > 0,
    'drafting-partner (chapters/-only) is denied for a research/ write'
  );
});

// ---------------------------------------------------------------------------
// Separator-boundary containment
//
// The guard decides membership with startsWith(root + sep + 'research' + sep).
// The trailing separator is the whole defense: without it, any sibling whose
// name merely BEGINS with an allowed segment would be treated as inside it.
// These cases pin that boundary and, because the paths are built with join(),
// they exercise the platform's native separator, which is the backslash on
// Windows and the forward slash on the CI ubuntu leg.
// ---------------------------------------------------------------------------

test('agent write-scope containment: a sibling whose name merely prefixes an allowed directory is denied', () => {
  // "research-notes" shares the "research" prefix but is a different directory.
  const prefixCollision = join(SAMPLE_BOOK, 'research-notes', 'scratch.md');
  const denied = checkAgentWriteConstraint('research-librarian', prefixCollision, SAMPLE_BOOK);
  assert.ok(
    typeof denied === 'string' && denied.length > 0,
    'research-notes/ must be denied; it is a sibling of research/, not inside it'
  );

  // Same boundary on the .studio side.
  const studioCollision = join(SAMPLE_BOOK, '.studio-backup', 'progress.json');
  const studioDenied = checkAgentWriteConstraint('research-librarian', studioCollision, SAMPLE_BOOK);
  assert.ok(
    typeof studioDenied === 'string' && studioDenied.length > 0,
    '.studio-backup/ must be denied; it is a sibling of .studio/, not inside it'
  );

  // The genuine directories still pass, so the boundary is not simply rejecting
  // everything. Without this pair the assertions above would survive a guard
  // that denied all writes.
  assert.equal(
    checkAgentWriteConstraint('research-librarian', join(SAMPLE_BOOK, 'research', 'sources.md'), SAMPLE_BOOK),
    null,
    'research/ itself is still allowed'
  );
  assert.equal(
    checkAgentWriteConstraint('research-librarian', join(SAMPLE_BOOK, '.studio', 'progress.json'), SAMPLE_BOOK),
    null,
    '.studio/ itself is still allowed'
  );
});

test('agent write-scope containment: a traversal that escapes the book root is denied', () => {
  // Resolves to a sibling of the book root, reached by climbing out of research/.
  // Uses research-librarian (a table agent); fact-checker (used here before the
  // table narrowed) is now deliberately untabled and would allow, not deny.
  const escape = join(SAMPLE_BOOK, 'research', '..', '..', 'outside-the-book.md');
  const denied = checkAgentWriteConstraint('research-librarian', escape, SAMPLE_BOOK);
  assert.ok(
    typeof denied === 'string' && denied.length > 0,
    'a path resolving outside the book root must be denied even though it is written through research/'
  );
});

// ---------------------------------------------------------------------------
// AGENT WRITE-SCOPE GUARD, integration (F-AG-01, agents claim enforcement
// that does not exist): now LIVE per ADR-0007 (agent identity resolution) and
// the 2026-08-09 platform probe (captured locally, not published; see ADR-0007).
// These cases spawn the real hook with a synthetic agent_type field on the
// envelope, proving resolveActiveAgent + checkAgentWriteConstraint are wired
// at the Step 5 call site, not just directly callable (the (j) test and the
// two containment tests above prove the function itself; these prove the
// hook actually calls it with the right arguments in the right order).
// Roadmap row 1.1's "no false denies under ambiguity" acceptance criterion is
// a first-class requirement here, not a footnote: absent, unnamespaced, and
// untabled agent_type values must all leave today's verdict unchanged.
// The numbered cases below exercise AGENT_WRITE_SCOPES per agent slug, each agent's
// allowed-prefix boundary in both directions (denied outside it, allowed inside it), and
// the agents deliberately absent from the table (unconstrained, per roadmap row 1.1's
// "no false denies under ambiguity").
// ---------------------------------------------------------------------------

test('case 1: research-librarian write to chapters/ DENIES, reason names the slug', () => {
  const book = cloneSampleBook('scope-rl-deny-chapters');
  const target = join(book, 'chapters', '01-listening-before-speaking.md');
  const result = runHook(makeWriteEvent(book, target, 'Write', 'nonfiction-studio:research-librarian'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  const hso = out.hookSpecificOutput;
  assert.equal(hso.permissionDecision, 'deny', 'research-librarian denied for a chapters/ write');
  assert.ok(hso.permissionDecisionReason.includes('research-librarian'), 'deny reason names the agent slug');
});

test('case 2: research-librarian write under research/ ALLOWS, and under .studio/ ALLOWS', () => {
  const bookA = cloneSampleBook('scope-rl-allow-research');
  const targetA = join(bookA, 'research', 'sources.md');
  const resultA = runHook(makeWriteEvent(bookA, targetA, 'Write', 'nonfiction-studio:research-librarian'));
  assert.equal(resultA.status, 0, 'exit code is 0');
  assert.equal(resultA.stdout.trim(), '', 'empty stdout: research-librarian allowed under research/');

  const bookB = cloneSampleBook('scope-rl-allow-studio');
  const targetB = join(bookB, '.studio', 'progress.json');
  const resultB = runHook(makeWriteEvent(bookB, targetB, 'Write', 'nonfiction-studio:research-librarian'));
  assert.equal(resultB.status, 0, 'exit code is 0');
  assert.equal(resultB.stdout.trim(), '', 'empty stdout: research-librarian allowed under .studio/');
});

test('case 3: drafting-partner write to structure/ DENIES (proves the generalization beyond research paths)', () => {
  const book = cloneSampleBook('scope-dp-deny-structure');
  const target = join(book, 'structure', 'outline.md');
  const result = runHook(makeWriteEvent(book, target, 'Write', 'nonfiction-studio:drafting-partner'));
  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  const hso = out.hookSpecificOutput;
  assert.equal(hso.permissionDecision, 'deny', 'drafting-partner denied for a structure/ write');
  assert.ok(hso.permissionDecisionReason.includes('drafting-partner'), 'deny reason names the agent slug');
});

test('case 4: main-session write (no agent_type) to structure/ ALLOWS (contrast with the drafting-partner deny in case 3)', () => {
  const book = cloneSampleBook('scope-main-session-structure');
  const target = join(book, 'structure', 'outline.md');
  const result = runHook(makeWriteEvent(book, target));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout: main session is never subject to the per-agent write-scope table'
  );
});

test('case 5: generic subagent (agent_type "general-purpose") write to structure/ is unaffected', () => {
  const book = cloneSampleBook('scope-generic-subagent');
  const target = join(book, 'structure', 'outline.md');
  const result = runHook(makeWriteEvent(book, target, 'Write', 'general-purpose'));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout: an unnamespaced agent_type is never a plugin agent, regardless of target'
  );
});

test('case 6: nonfiction-studio:interviewer (namespaced but absent from the table) write to chapters/ is unaffected', () => {
  const book = cloneSampleBook('scope-interviewer-untabled');
  const target = join(book, 'chapters', '01-listening-before-speaking.md');
  const result = runHook(makeWriteEvent(book, target, 'Write', 'nonfiction-studio:interviewer'));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout: interviewer is a namespaced plugin agent but absent from AGENT_WRITE_SCOPES, so it stays unconstrained'
  );
});

// Case 7 (symlink evasion) lives in tests/hooks/pre-tool-use-symlink.test.mjs,
// alongside the other symlink-capability-probed cases it is modeled on.
// Case 8 (platform folding) is a direct-call unit test of checkAgentWriteConstraint
// in tests/hooks/agent-identity.test.mjs, portable to any host OS without needing
// a real case-insensitive filesystem.

// ---------------------------------------------------------------------------
// (k) NS_HOOK_TRACE inert when unset, one line written when set
// ---------------------------------------------------------------------------
test('(k) NS_HOOK_TRACE unset: no trace file created', () => {
  const tmpDir = makeTmpDir('k-trace-unset');
  const traceFile = join(tmpDir, 'trace.jsonl');
  // Use a Read event so the hook exits quickly; trace check still fires first
  const result = runHook(makeReadEvent(tmpDir));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(!existsSync(traceFile), 'no trace file created when NS_HOOK_TRACE is unset');
});

test('(k) NS_HOOK_TRACE set: exactly one line written with event PreToolUse', () => {
  const tmpDir = makeTmpDir('k-trace-set');
  const traceFile = join(tmpDir, 'trace.jsonl');

  const result = runHook(makeReadEvent(tmpDir), { NS_HOOK_TRACE: traceFile });
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(existsSync(traceFile), 'trace file created when NS_HOOK_TRACE is set');

  const lines = readFileSync(traceFile, 'utf8').split('\n').filter(l => l.trim());
  assert.equal(lines.length, 1, 'exactly one trace line was written');

  const trace = JSON.parse(lines[0]);
  assert.equal(trace.event, 'PreToolUse', 'trace record event field is PreToolUse');
  assert.ok(typeof trace.script === 'string', 'trace record carries the script path');
  assert.ok(typeof trace.stdinRaw === 'string', 'trace record carries stdinRaw');
});

// ---------------------------------------------------------------------------
// (l) malformed stdin: exit 0, empty stdout (fail-open)
// ---------------------------------------------------------------------------
test('(l) malformed stdin: exit 0, empty stdout', () => {
  const result = runHook('{not valid json {{{{');

  assert.equal(result.status, 0, 'exit code is 0 for malformed stdin (fail-open)');
  assert.equal(result.stdout.trim(), '', 'stdout is empty for malformed stdin');
});

// ---------------------------------------------------------------------------
// F-HK-01: corrupt-config discrimination.
//
// findBookRoot throws a BibleError with code CONFIG_READ_ERROR when a book
// root is found but .studio/config.json is syntactically invalid JSON. The
// pre-fix hook caught ANY findBookRoot error identically to NO_BOOK_ROOT and
// exited 0 with empty stdout, silently disabling the containment guard for
// every write while the config is broken. The fix discriminates the error
// code (mirrors hooks/stop-gate.mjs and hooks/session-start.mjs): write tools
// fail closed (deny); non-write tools and Bash are unaffected.
// ---------------------------------------------------------------------------

test('F-HK-01 (a) corrupt config.json + Write outside the book root: deny naming the corrupt config, not silent exit 0', () => {
  const book = cloneSampleBook('fhk01-a-outside');
  writeFileSync(join(book, '.studio', 'config.json'), 'not valid json {{', 'utf8');
  const outsidePath = join(tmpdir(), 'ns-tsk032-fhk01-outside-' + Date.now() + '.md');

  const result = runHook(makeWriteEvent(book, outsidePath));

  assert.equal(result.status, 0, 'exit code is 0 (deny travels in JSON, not exit code)');

  let out;
  assert.doesNotThrow(
    () => { out = JSON.parse(result.stdout.trim()); },
    'stdout is valid JSON, NOT empty (the pre-fix bug produced empty stdout here)'
  );

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PreToolUse', 'hookEventName is PreToolUse');
  assert.equal(hso.permissionDecision, 'deny', 'permissionDecision is deny (fails closed on corrupt config)');
  assert.ok(
    typeof hso.permissionDecisionReason === 'string' && hso.permissionDecisionReason.includes('config.json'),
    'deny reason names the corrupt config.json; got: ' + hso.permissionDecisionReason
  );
});

test('F-HK-01 (b) corrupt config.json + Write inside the book tree: still deny (fail closed)', () => {
  const book = cloneSampleBook('fhk01-b-inside');
  writeFileSync(join(book, '.studio', 'config.json'), 'not valid json {{', 'utf8');
  const insideTarget = join(book, 'chapters', '01-listening-before-speaking.md');

  const result = runHook(makeWriteEvent(book, insideTarget));

  assert.equal(result.status, 0, 'exit code is 0 (deny travels in JSON, not exit code)');

  let out;
  assert.doesNotThrow(
    () => { out = JSON.parse(result.stdout.trim()); },
    'stdout is valid JSON, NOT empty (the pre-fix bug allowed this write silently)'
  );

  const hso = out.hookSpecificOutput;
  assert.equal(
    hso.permissionDecision, 'deny',
    'permissionDecision is deny even for an in-tree target: containment cannot be verified while the config is corrupt'
  );
  assert.ok(
    typeof hso.permissionDecisionReason === 'string' && hso.permissionDecisionReason.includes('config.json'),
    'deny reason names the corrupt config.json; got: ' + hso.permissionDecisionReason
  );
});

test('F-HK-01 (c) corrupt config.json + Edit and NotebookEdit also deny (all three WRITE_TOOLS)', () => {
  const bookEdit = cloneSampleBook('fhk01-c-edit');
  writeFileSync(join(bookEdit, '.studio', 'config.json'), 'not valid json {{', 'utf8');
  const editTarget = join(bookEdit, 'chapters', '01-listening-before-speaking.md');
  const editResult = runHook(makeWriteEvent(bookEdit, editTarget, 'Edit'));
  assert.equal(editResult.status, 0, 'exit code is 0 for Edit');
  let editOut;
  assert.doesNotThrow(() => { editOut = JSON.parse(editResult.stdout.trim()); }, 'Edit stdout is valid JSON');
  assert.equal(editOut.hookSpecificOutput.permissionDecision, 'deny', 'Edit denied on corrupt config');

  const bookNb = cloneSampleBook('fhk01-c-notebook');
  writeFileSync(join(bookNb, '.studio', 'config.json'), 'not valid json {{', 'utf8');
  const nbEvent = JSON.stringify({
    session_id: 'test-session-032',
    cwd: bookNb,
    hook_event_name: 'PreToolUse',
    tool_name: 'NotebookEdit',
    tool_input: { notebook_path: join(bookNb, 'chapters', 'nb.ipynb'), cell_id: '1' },
    tool_use_id: 'toolu_test032'
  });
  const nbResult = runHook(nbEvent);
  assert.equal(nbResult.status, 0, 'exit code is 0 for NotebookEdit');
  let nbOut;
  assert.doesNotThrow(() => { nbOut = JSON.parse(nbResult.stdout.trim()); }, 'NotebookEdit stdout is valid JSON');
  assert.equal(nbOut.hookSpecificOutput.permissionDecision, 'deny', 'NotebookEdit denied on corrupt config');
});

test('F-HK-01 (d) corrupt config.json + Read: exit 0, empty stdout (non-write tools unaffected)', () => {
  const book = cloneSampleBook('fhk01-d-read');
  writeFileSync(join(book, '.studio', 'config.json'), 'not valid json {{', 'utf8');

  const result = runHook(makeReadEvent(book));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'stdout is empty for Read tool even with corrupt config (unchanged)');
});

test('F-HK-01 (f) NO_BOOK_ROOT (no book project at all) stays silent exit 0 for Write, unlike a corrupt config', () => {
  const emptyDir = makeTmpDir('fhk01-f-no-root');
  const target = join(emptyDir, 'chapters', 'test.md');

  const result = runHook(makeWriteEvent(emptyDir, target));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'NO_BOOK_ROOT is a normal no-op (no book project here at all), not a corrupt-config deny'
  );
});

// ---------------------------------------------------------------------------
// F8 (corrupt config suppresses the shell caution): carried from Wave 0's
// final review into this task (brief section 1f). findBookRoot's catch block
// used to call process.exit(0) unconditionally right after the write-tool
// deny check, so when .studio/config.json was corrupt, Bash and PowerShell
// never reached the destructive-command caution logic below - the safety
// message vanished exactly when the project was already in a bad state. The
// fix lets non-write tools fall through to the caution logic instead of
// exiting early; the write-tool deny behavior proven in F-HK-01 (a)/(b)/(c)
// above is unchanged.
//
// The test that occupied this slot before the fix was titled "benign Bash"
// but its command was `rm -rf /tmp/foo` and it asserted EMPTY stdout - that
// was the bug manifesting as a passing test, not a benign case. It is
// retitled and re-asserted below to prove the caution now fires; a genuinely
// benign case is added alongside it, since retitling revealed that coverage
// was missing.
// ---------------------------------------------------------------------------

test('F8 (a) corrupt config.json + Bash rm -rf: caution still fires (corrupt config must not suppress the shell caution)', () => {
  const book = cloneSampleBook('f8-a-bash-rmrf');
  writeFileSync(join(book, '.studio', 'config.json'), 'not valid json {{', 'utf8');

  const result = runHook(makeBashEvent(book, 'rm -rf /tmp/foo'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(
    () => { out = JSON.parse(result.stdout.trim()); },
    'stdout is valid JSON (caution), NOT empty - the pre-fix bug produced empty stdout here'
  );
  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PreToolUse', 'hookEventName is PreToolUse');
  assert.ok(
    typeof hso.additionalContext === 'string' && hso.additionalContext.includes('rm -rf'),
    'additionalContext still names the rm -rf pattern even with a corrupt config'
  );
  assert.equal(hso.permissionDecision, undefined, 'still a caution, never a deny (write-tool deny behavior is unchanged)');
});

test('F8 (b) corrupt config.json + genuinely benign Bash: exit 0, empty stdout (coverage added; the old test at this name was not actually benign)', () => {
  const book = cloneSampleBook('f8-b-bash-benign');
  writeFileSync(join(book, '.studio', 'config.json'), 'not valid json {{', 'utf8');

  const result = runHook(makeBashEvent(book, 'ls -la'));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'stdout is empty for a genuinely benign Bash command even with corrupt config: no caution, no deny'
  );
});

test('F8 (c) corrupt config.json + PowerShell destructive command: caution still fires (PowerShell is a first-class peer of Bash per F-HK-07)', () => {
  const book = cloneSampleBook('f8-c-powershell');
  writeFileSync(join(book, '.studio', 'config.json'), 'not valid json {{', 'utf8');

  const result = runHook(makePowerShellEvent(book, 'Remove-Item -Recurse -Force C:\\Temp\\scratch'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (caution)');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' && out.hookSpecificOutput.additionalContext.length > 0,
    'PowerShell caution also survives a corrupt config, same as Bash'
  );
});

test('F8 (d) regression: corrupt config.json + Write still DENIES exactly as before (write-tool behavior untouched)', () => {
  const book = cloneSampleBook('f8-d-write-regression');
  writeFileSync(join(book, '.studio', 'config.json'), 'not valid json {{', 'utf8');
  const target = join(book, 'chapters', '01-listening-before-speaking.md');

  const result = runHook(makeWriteEvent(book, target));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  assert.equal(
    out.hookSpecificOutput.permissionDecision, 'deny',
    'a write tool still denies on corrupt config, unchanged from F-HK-01 (a)/(b)/(c) above'
  );
});

// ---------------------------------------------------------------------------
// F-HK-03: same-second snapshot overwrite.
//
// compactUtcNow() previously truncated to whole seconds, so two overwrites of
// the same chapter within one second produced the same snapshot filename and
// the second write silently destroyed the first rollback point. The fix adds
// milliseconds to the timestamp AND a deterministic -2/-3 collision counter
// (belt and suspenders) via the exported pickSnapshotName, then prunes with a
// comparator that understands the counter suffix instead of a raw string sort.
// ---------------------------------------------------------------------------

test('F-HK-03 (a) pickSnapshotName: collision at the base name escalates to -2, then -3, deterministically', () => {
  const existing = new Set(['01-slug.20260807T154012123Z.md']);
  const existsFn = (name) => existing.has(name);

  const first = pickSnapshotName('01-slug', '20260807T154012123Z', existsFn);
  assert.equal(
    first, '01-slug.20260807T154012123Z-2.md',
    'base name already taken: first collision escalates to a -2 suffix'
  );

  existing.add(first);
  const second = pickSnapshotName('01-slug', '20260807T154012123Z', existsFn);
  assert.equal(
    second, '01-slug.20260807T154012123Z-3.md',
    'base name and -2 both taken: second collision escalates to -3'
  );

  // No collision at all: the plain base name is returned unchanged.
  const clear = pickSnapshotName('01-slug', '20260807T999999999Z', existsFn);
  assert.equal(
    clear, '01-slug.20260807T999999999Z.md',
    'no collision: plain <slug>.<timestamp>.md name is used, no counter suffix'
  );
});

test('F-HK-03 (b) two rapid writes to the same chapter in the same second: two distinct snapshots survive', () => {
  const book = cloneSampleBook('fhk03-b-rapid');
  const slug = '01-listening-before-speaking';
  const target = join(book, 'chapters', slug + '.md');
  const snapshotsBefore = countSnapshots(book, slug);

  // Two writes back-to-back, no delay: reproduces the same-second collision
  // window the audit found (pre-fix, whole-second timestamps made these
  // indistinguishable and the second write silently clobbered the first).
  const result1 = runHook(makeWriteEvent(book, target));
  const result2 = runHook(makeWriteEvent(book, target));

  assert.equal(result1.status, 0, 'first write exit code is 0');
  assert.equal(result2.status, 0, 'second write exit code is 0');

  const snapshotsAfter = countSnapshots(book, slug);
  assert.equal(
    snapshotsAfter, snapshotsBefore + 2,
    'both writes produced a surviving snapshot (no silent same-second overwrite)'
  );

  const allNames = readdirSync(join(book, '.studio', 'snapshots'))
    .filter(f => f.startsWith(slug + '.') && f.endsWith('.md'));
  const newest = allNames.slice(-2);
  assert.notEqual(
    newest[0], newest[1],
    'the two newest snapshot filenames are distinct from each other'
  );
});

test('F-HK-03 (c) prune ordering with a same-timestamp collision pair: base is older, -2 is newer, deterministic', () => {
  const book = cloneSampleBook('fhk03-c-prune-collision');
  const slug = '01-listening-before-speaking';
  const snapshotsDir = join(book, '.studio', 'snapshots');
  const target = join(book, 'chapters', slug + '.md');

  // Clean slate for this slug.
  readdirSync(snapshotsDir)
    .filter(f => f.startsWith(slug + '.') && f.endsWith('.md'))
    .forEach(f => unlinkSync(join(snapshotsDir, f)));

  // Seed the OLDEST entry as a same-timestamp collision pair: the base file
  // (no counter, created "first") and its -2 sibling (created "second" at the
  // identical nominal timestamp). A naive default string sort ranks "-2" as
  // LESS than the bare base name (ASCII '-' < '.'), which would treat the
  // second-written file as the older one - backwards. The correct comparator
  // must treat -2 as newer than the base.
  const collideTs = '20200101T000001000Z';
  const pairBase = slug + '.' + collideTs + '.md';
  const pairNewer = slug + '.' + collideTs + '-2.md';
  writeFileSync(join(snapshotsDir, pairBase), 'collision pair: base (older)', 'utf8');
  writeFileSync(join(snapshotsDir, pairNewer), 'collision pair: -2 (newer)', 'utf8');

  // Seed 8 more, distinct, all strictly newer than the collision pair.
  const seededNewer = [];
  for (let i = 2; i <= 9; i++) {
    const ts = '20200101T00000' + i + '000Z';
    const fname = slug + '.' + ts + '.md';
    seededNewer.push(fname);
    writeFileSync(join(snapshotsDir, fname), 'seed ' + i, 'utf8');
  }

  // Pre-write total: 2 (pair) + 8 (distinct newer) = 10.
  assert.equal(countSnapshots(book, slug), 10, 'precondition: 10 snapshots seeded (2 pair + 8 distinct)');

  // Trigger one real write: creates an 11th snapshot, newer than everything
  // seeded (real "now" vs synthetic 2020 dates), and fires the prune (keep 10).
  const result = runHook(makeWriteEvent(book, target));
  assert.equal(result.status, 0, 'exit code is 0');

  assert.equal(countSnapshots(book, slug), 10, 'exactly 10 snapshots survive after prune');

  // The pair's BASE (older) must be the one dropped; its -2 sibling (newer)
  // and all 8 distinct-newer seeds plus the fresh write must survive.
  assert.ok(
    !existsSync(join(snapshotsDir, pairBase)),
    'collision pair base (older, no counter) was pruned as the true oldest entry'
  );
  assert.ok(
    existsSync(join(snapshotsDir, pairNewer)),
    'collision pair -2 sibling (newer, created second) survives the prune'
  );
  for (const fname of seededNewer) {
    assert.ok(existsSync(join(snapshotsDir, fname)), fname + ' (distinct, newer than the pair) survives');
  }
});

// ---------------------------------------------------------------------------
// F-HK-07: PowerShell destructive-op caution.
//
// The early exit used to read "not a WRITE_TOOL and not Bash -> exit 0", so
// the PowerShell tool (a first-class peer of Bash on Windows sessions)
// bypassed the destructive-op caution entirely, no matter what the command
// did. The fix treats PowerShell like Bash in the early exit and adds a
// PowerShell-shaped caution pattern set (checked independently of Bash's -
// Bash's own two patterns must stay byte-unchanged).
// ---------------------------------------------------------------------------

test('F-HK-07 (a) PowerShell Remove-Item -Recurse -Force: additionalContext caution, no permissionDecision', () => {
  const book = cloneSampleBook('fhk07-a-removeitem');
  const result = runHook(makePowerShellEvent(book, 'Remove-Item -Recurse -Force C:\\Temp\\scratch'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PreToolUse', 'hookEventName is PreToolUse');
  assert.ok(
    typeof hso.additionalContext === 'string' && hso.additionalContext.length > 0,
    'additionalContext is a non-empty caution string'
  );
  assert.equal(hso.permissionDecision, undefined, 'no permissionDecision field for caution (never a deny)');
});

test('F-HK-07 (b) PowerShell Remove-Item -Force -Recurse (reversed flag order): still cautioned', () => {
  const book = cloneSampleBook('fhk07-b-reversed');
  const result = runHook(makePowerShellEvent(book, 'Remove-Item -Force -Recurse -Path C:\\Temp\\scratch'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'flag order (-Force before -Recurse) does not evade the caution'
  );
});

test('F-HK-07 (c) PowerShell remove-item -recurse -force (lowercase): still cautioned (case-insensitive per PowerShell convention)', () => {
  const book = cloneSampleBook('fhk07-c-lowercase');
  const result = runHook(makePowerShellEvent(book, 'remove-item -recurse -force C:\\Temp\\scratch'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'lowercase cmdlet/flags still trigger the caution'
  );
});

test('F-HK-07 (d) PowerShell git reset --hard: cautioned', () => {
  const book = cloneSampleBook('fhk07-d-gitreset');
  const result = runHook(makePowerShellEvent(book, 'git reset --hard HEAD~1'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.includes('git reset --hard'),
    'additionalContext names the git reset --hard pattern'
  );
});

test('F-HK-07 (e) PowerShell git clean -fd: cautioned', () => {
  const book = cloneSampleBook('fhk07-e-gitclean');
  const result = runHook(makePowerShellEvent(book, 'git clean -fd'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.includes('git clean -fd'),
    'additionalContext names the git clean -fd pattern'
  );
});

test('F-HK-07 (f) PowerShell Format-Volume: cautioned', () => {
  const book = cloneSampleBook('fhk07-f-formatvolume');
  const result = runHook(makePowerShellEvent(book, 'Format-Volume -DriveLetter D -FileSystem NTFS'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'Format-Volume triggers the caution'
  );
});

test('F-HK-07 (g) PowerShell format D: (legacy format targeting a drive): cautioned', () => {
  const book = cloneSampleBook('fhk07-g-formatdrive');
  const result = runHook(makePowerShellEvent(book, 'format D:'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'format targeting a drive letter triggers the caution'
  );
});

test('F-HK-07 (h) benign PowerShell Get-ChildItem: exits silently (empty stdout)', () => {
  const book = cloneSampleBook('fhk07-h-benign');
  const result = runHook(makePowerShellEvent(book, 'Get-ChildItem -Path .'));

  assert.equal(result.status, 0, 'exit code is 0 for benign PowerShell');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (allow) for benign PowerShell');
});

test('F-HK-07 (i) benign PowerShell Get-Date -Format with no drive letter: not a false positive for the format pattern', () => {
  const book = cloneSampleBook('fhk07-i-getdate');
  const result = runHook(makePowerShellEvent(book, 'Get-Date -Format "yyyy-MM-dd"'));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'a -Format parameter with no drive-letter pattern must not be mistaken for the destructive format command'
  );
});

test('F-HK-07 (j) regression: Bash git clean -fd is NOT cautioned (Bash pattern set stays byte-unchanged)', () => {
  const book = cloneSampleBook('fhk07-j-bash-unchanged');
  const result = runHook(makeBashEvent(book, 'git clean -fd'));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'Bash only ever had rm -rf and git reset --hard; git clean -fd is a PowerShell-set addition only, ' +
    'proving this fix did not silently widen the Bash pattern set'
  );
});

test('F-HK-07 (k) regression: Bash rm -rf and git reset --hard cautions unchanged after adding the PowerShell branch', () => {
  const book1 = cloneSampleBook('fhk07-k-bash-rmrf');
  const r1 = runHook(makeBashEvent(book1, 'rm -rf /tmp/foo'));
  assert.equal(r1.status, 0, 'exit code is 0');
  let out1;
  assert.doesNotThrow(() => { out1 = JSON.parse(r1.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(out1.hookSpecificOutput.additionalContext.includes('rm -rf'), 'Bash rm -rf still cautioned');

  const book2 = cloneSampleBook('fhk07-k-bash-reset');
  const r2 = runHook(makeBashEvent(book2, 'git reset --hard HEAD~1'));
  assert.equal(r2.status, 0, 'exit code is 0');
  let out2;
  assert.doesNotThrow(() => { out2 = JSON.parse(r2.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    out2.hookSpecificOutput.additionalContext.includes('git reset --hard'),
    'Bash git reset --hard still cautioned'
  );
});

// ---------------------------------------------------------------------------
// F-HK-07 fix round 1: Remove-Item's built-in destructive aliases.
//
// The original pattern matched only the literal cmdlet name "Remove-Item".
// PowerShell's built-in aliases (rm, rd, rmdir, del, erase) evade it entirely -
// reviewer proved live that `rm -Recurse -Force ...` and `rd -Recurse -Force
// ...` both produced empty stdout (no caution), and `rm` is exactly what a
// Unix-habituated author types in PowerShell. The fix extends the cmdlet
// portion of the pattern to an alternation over Remove-Item and all five
// built-in aliases, word-boundary-anchored on BOTH sides so short alias names
// cannot match inside longer tokens (e.g. "confirm", "term-notes.md").
// ---------------------------------------------------------------------------

test('F-HK-07 (l) PowerShell rm -Recurse -Force (Unix-habit alias): cautioned', () => {
  const book = cloneSampleBook('fhk07-l-rm-alias');
  const result = runHook(makePowerShellEvent(book, 'rm -Recurse -Force C:\\Temp\\scratch'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'the rm alias with both destructive flags triggers the caution, same as Remove-Item'
  );
});

test('F-HK-07 (m) PowerShell rd -Recurse -Force (alias): cautioned', () => {
  const book = cloneSampleBook('fhk07-m-rd-alias');
  const result = runHook(makePowerShellEvent(book, 'rd -Recurse -Force C:\\Temp\\scratch'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'the rd alias with both destructive flags triggers the caution'
  );
});

test('F-HK-07 (n) PowerShell rmdir -Recurse -Force (alias): cautioned', () => {
  const book = cloneSampleBook('fhk07-n-rmdir-alias');
  const result = runHook(makePowerShellEvent(book, 'rmdir -Force -Recurse C:\\Temp\\scratch'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'the rmdir alias (reversed flag order) triggers the caution'
  );
});

test('F-HK-07 (o) PowerShell del -Recurse -Force (alias): cautioned', () => {
  const book = cloneSampleBook('fhk07-o-del-alias');
  const result = runHook(makePowerShellEvent(book, 'del -Recurse -Force C:\\Temp\\scratch'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'the del alias triggers the caution'
  );
});

test('F-HK-07 (p) PowerShell ERASE -recurse -force (alias, mixed case): cautioned', () => {
  const book = cloneSampleBook('fhk07-p-erase-alias');
  const result = runHook(makePowerShellEvent(book, 'ERASE -recurse -force C:\\Temp\\scratch'));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON');
  assert.ok(
    typeof out.hookSpecificOutput.additionalContext === 'string' &&
    out.hookSpecificOutput.additionalContext.length > 0,
    'the erase alias, any case, triggers the caution'
  );
});

test('F-HK-07 (q) PowerShell rm without both destructive flags: stays silent (no false positive from the new alias)', () => {
  const book = cloneSampleBook('fhk07-q-rm-benign');
  const result = runHook(makePowerShellEvent(book, 'rm oldfile.txt'));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'rm alone (no -Recurse, no -Force) must not be cautioned - both flags are still required'
  );
});

test('F-HK-07 (r) PowerShell word-boundary: "-Confirm" (contains the substring "rm") plus both flags must not false-trigger the alias pattern', () => {
  const book = cloneSampleBook('fhk07-r-confirm-boundary');
  // Deliberately includes BOTH -Recurse and -Force elsewhere in the command, so
  // only the word-boundary anchoring (not a missing flag) can be what keeps this
  // silent: "-Confirm" contains the substring "rm" but is not the rm alias token.
  const result = runHook(makePowerShellEvent(
    book, 'Copy-Item -Recurse -Force -Confirm:$false -Path safe-file.txt -Destination backup\\'
  ));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    '"-Confirm" must not be mistaken for the "rm" alias even though both destructive flags are present ' +
    'elsewhere in the command - the alias needs word boundaries on both sides, not just a substring match'
  );
});

test('F-HK-07 (s) PowerShell word-boundary: a filename containing "rm" ("term-notes.md") plus both flags must not false-trigger the alias pattern', () => {
  const book = cloneSampleBook('fhk07-s-filename-boundary');
  // Same isolation as (r): both flags are genuinely present, so only the
  // boundary anchoring can be what keeps this silent, not a missing flag.
  const result = runHook(makePowerShellEvent(book, 'Copy-Item -Recurse -Force -Path term-notes.md -Destination backup\\'));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    '"term-notes.md" contains the substring "rm" inside "term" but is not the rm alias token; with both ' +
    'flags genuinely present, only correct word-boundary anchoring keeps this silent'
  );
});

// ---------------------------------------------------------------------------
// F-HK-13: unconditional case folding.
//
// The containment guard used to lowercase both sides of the prefix comparison
// unconditionally. On a case-sensitive filesystem (POSIX) that WIDENS what
// counts as "contained" - the wrong direction for a security guard, since a
// path differing only in case from an allowed prefix is a DIFFERENT path on
// Linux/macOS and must not be treated as the same one. The fix folds case
// only when process.platform === 'win32'.
// ---------------------------------------------------------------------------

test('F-HK-13 (a) foldForCompare: win32 folds case, non-win32 preserves case (both branches, platform-injected)', () => {
  const mixed = '/Book/CHAPTERS/Foo.MD';

  assert.equal(
    foldForCompare(mixed, 'win32'),
    '/book/chapters/foo.md',
    'win32: case-folded for comparison (matches the case-insensitive-filesystem behavior)'
  );
  assert.equal(
    foldForCompare(mixed, 'linux'),
    mixed,
    'linux (non-win32): case is PRESERVED - folding here would widen matching the wrong way'
  );
  assert.equal(
    foldForCompare(mixed, 'darwin'),
    mixed,
    'darwin (non-win32): case is preserved too'
  );
});

test('F-HK-13 (b) containment guard on win32: a case-differing drive letter or path still matches (current behavior kept)', (t) => {
  if (process.platform !== 'win32') {
    t.skip('win32-only assertion; this leg is ' + process.platform + ' (case-sensitive filesystem)');
    return;
  }
  const book = cloneSampleBook('fhk13-b-win32-case');
  const target = join(book, 'chapters', '01-listening-before-speaking.md');
  const caseFlipped = flipCase(target);
  assert.notEqual(caseFlipped, target, 'precondition: the flipped path is textually different from the original');

  const result = runHook(makeWriteEvent(book, caseFlipped));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'win32: a case-differing path (including drive letter) is still treated as contained; empty stdout (allow)'
  );
});

test('F-HK-13 (c) containment guard on a case-sensitive filesystem: a case-differing path is NOT treated as contained', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX-only assertion (case-sensitive filesystem); this leg is win32');
    return;
  }
  const book = cloneSampleBook('fhk13-c-posix-case');
  const target = join(book, 'chapters', '01-listening-before-speaking.md');
  const caseFlipped = flipCase(target);
  assert.notEqual(caseFlipped, target, 'precondition: the flipped path is textually different from the original');

  const result = runHook(makeWriteEvent(book, caseFlipped));

  assert.equal(result.status, 0, 'exit code is 0 (deny travels in JSON, not exit code)');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny), not empty');
  assert.equal(
    out.hookSpecificOutput.permissionDecision, 'deny',
    'non-win32: case-widened matching must NOT occur - a case-differing path is a different, uncontained path'
  );
});

// ---------------------------------------------------------------------------
// WEB GATE (F-AG-02, web gate unenforced): now LIVE per ADR-0007 (agent
// identity resolution). WebSearch and WebFetch from a web-gated agent
// (isWebGatedAgent: research-librarian, fact-checker, citation-manager) are
// denied unless research.web_enabled is exactly the boolean true in
// .studio/config.json. The rule for what counts as open is binding at
// docs/reference/agents/research-librarian.md:135-149: an absent key, the
// string "true", false, and null all leave the gate CLOSED. Main-session
// calls and non-gated agents are entirely unaffected regardless of config.
// The numbered cases below exercise the gate per web-gated agent slug (research-librarian,
// fact-checker, citation-manager), each of the closed-gate config shapes (absent, string
// "true", false, null), the open-gate boolean-true shape, and confirm main-session calls
// and non-gated agents are unaffected regardless of config.
// ---------------------------------------------------------------------------

/** Build a synthetic WebSearch/WebFetch event, optionally carrying agent_type
 *  shaped like the platform probe (see makeWriteEvent above for the same
 *  convention). */
function makeWebEvent(cwd, toolName, agentType = null) {
  const event = {
    session_id: 'test-session-032',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolName === 'WebSearch'
      ? { query: 'test query from the web-gate test suite' }
      : { url: 'https://example.invalid/source', prompt: 'summarize the page' },
    tool_use_id: 'toolu_webgate'
  };
  if (agentType) {
    event.agent_id = 'atest0000agentidentity1';
    event.agent_type = agentType;
  }
  return JSON.stringify(event);
}

/** Overwrite .studio/config.json in a cloned book, adding a "research" block
 *  whose web_enabled value is exactly the given rawValue (JSON-serialized
 *  as-is, so passing the JS string "true" produces the JSON STRING "true",
 *  deliberately exercising the wrong-type case from the brief). */
function setWebEnabled(book, rawValue) {
  const configPath = join(book, '.studio', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.research = { web_enabled: rawValue };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

test('case 9 (a): WebFetch from research-librarian with no research key DENIES', () => {
  const book = cloneSampleBook('webgate-rl-no-key');
  // Sample-book config.json has no "research" key at all (precondition; matches
  // templates/book-scaffold/.studio/config.json's own default, which also carries no
  // research key).
  const result = runHook(makeWebEvent(book, 'WebFetch', 'nonfiction-studio:research-librarian'));
  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  const hso = out.hookSpecificOutput;
  assert.equal(hso.permissionDecision, 'deny', 'no research key: gate is closed by default');
  assert.ok(
    /web_enabled/i.test(hso.permissionDecisionReason),
    'deny reason names the research.web_enabled config key'
  );
});

test('case 9 (b): WebFetch from research-librarian with research.web_enabled: true ALLOWS', () => {
  const book = cloneSampleBook('webgate-rl-true');
  setWebEnabled(book, true);
  const result = runHook(makeWebEvent(book, 'WebFetch', 'nonfiction-studio:research-librarian'));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'empty stdout: gate is open, boolean true');
});

test('case 9 (c): WebFetch from research-librarian with the STRING "true" DENIES (wrong type, not the boolean)', () => {
  const book = cloneSampleBook('webgate-rl-string-true');
  setWebEnabled(book, 'true');
  const result = runHook(makeWebEvent(book, 'WebFetch', 'nonfiction-studio:research-librarian'));
  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  assert.equal(
    out.hookSpecificOutput.permissionDecision, 'deny',
    'the STRING "true" is not the boolean true; gate stays closed'
  );
});

test('case 9 (d): WebFetch from research-librarian with web_enabled: false DENIES', () => {
  const book = cloneSampleBook('webgate-rl-false');
  setWebEnabled(book, false);
  const result = runHook(makeWebEvent(book, 'WebFetch', 'nonfiction-studio:research-librarian'));
  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny', 'false leaves the gate closed');
});

test('case 9 (e): WebFetch from research-librarian with web_enabled: null DENIES', () => {
  const book = cloneSampleBook('webgate-rl-null');
  setWebEnabled(book, null);
  const result = runHook(makeWebEvent(book, 'WebFetch', 'nonfiction-studio:research-librarian'));
  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny', 'null leaves the gate closed');
});

test('case 10: WebSearch from the main session (no agent_type) ALLOWS regardless of config', () => {
  const book = cloneSampleBook('webgate-mainsession-nokey');
  // No research key at all: would deny a gated agent, but main session is unaffected.
  const result = runHook(makeWebEvent(book, 'WebSearch'));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'empty stdout: main-session WebSearch is never gated');
});

test('case 10 (b): WebSearch from the main session ALLOWS even with web_enabled explicitly false', () => {
  const book = cloneSampleBook('webgate-mainsession-false');
  setWebEnabled(book, false);
  const result = runHook(makeWebEvent(book, 'WebSearch'));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'empty stdout: main-session WebSearch is never gated, regardless of config');
});

test('case 11: WebFetch from nonfiction-studio:drafting-partner (not web-gated) ALLOWS regardless of config', () => {
  const book = cloneSampleBook('webgate-draftingpartner-nokey');
  // No research key: would deny a gated agent, but drafting-partner does not ship web tools.
  const result = runHook(makeWebEvent(book, 'WebFetch', 'nonfiction-studio:drafting-partner'));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout: drafting-partner is not in the web-gated agent set, so the gate never applies to it'
  );
});

test('web gate: no book root found DENIES a web-gated agent (fail-closed; there is no config to verify open)', () => {
  const emptyDir = makeTmpDir('webgate-no-root');
  const result = runHook(makeWebEvent(emptyDir, 'WebFetch', 'nonfiction-studio:research-librarian'));
  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  assert.equal(
    out.hookSpecificOutput.permissionDecision, 'deny',
    'no book root means no config.json to verify open, so a web-gated agent is denied (D-13 fail-closed)'
  );
});

test('web gate: no book root found ALLOWS a non-gated call (main session) unaffected', () => {
  const emptyDir = makeTmpDir('webgate-no-root-mainsession');
  const result = runHook(makeWebEvent(emptyDir, 'WebSearch'));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'empty stdout: main session is unaffected even with no book root');
});

test('web gate: corrupt config.json DENIES a web-gated agent (fail-closed, same posture as F-HK-01)', () => {
  const book = cloneSampleBook('webgate-corrupt-config');
  writeFileSync(join(book, '.studio', 'config.json'), 'not valid json {{', 'utf8');
  const result = runHook(makeWebEvent(book, 'WebFetch', 'nonfiction-studio:fact-checker'));
  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  assert.equal(
    out.hookSpecificOutput.permissionDecision, 'deny',
    'a corrupt config.json cannot be verified open, so a web-gated agent is denied'
  );
});

// ---------------------------------------------------------------------------
// TASK 8: dispatch routing enforcement (model-tier + chain-edge), warn-only by
// default, deny behind the routing_enforce settings opt-in, fail-open on every
// internal error. Fires on tool_name "Agent" OR "Task" (both, per the v2.1.63
// rename precedent and the 2026-09-04 platform probe's live capture, which only
// ever produced "Agent" live but confirmed the installed binary's own
// attribution helper still checks "Task" too). Uses the REAL, shipped agents/*.md and
// agents/_chain-permitted.yaml for the model/chain-rule cases below (their
// declared models and the one drafting-partner -> research-librarian edge are
// fixed facts about this repo, not test fixtures); the fail-open cases that
// need a genuinely broken file use the NS_AGENTS_DIR test-only override
// (hooks/lib/routing.mjs) to point at a throwaway fixture directory instead.
// ---------------------------------------------------------------------------

// --- Model rule (D-18 in-plugin model routing) ------------------------------

test('Task 8 (a) Agent dispatch of nonfiction-studio:line-editor with model opus warns citing the declared sonnet tier', () => {
  const dir = makeTmpDir('t8-a-model-mismatch');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor', model: 'opus' }));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (warn)');
  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'PreToolUse', 'hookEventName is PreToolUse');
  assert.equal(
    hso.additionalContext,
    'Routing: line-editor declares model sonnet (D-18 in-plugin model routing); this dispatch requests opus.',
    'additionalContext is the exact routing warn sentence, citing the declaration'
  );
  assert.equal(hso.permissionDecision, undefined, 'never a deny under the default warn mode');
});

test('Task 8 (b) tool_name "Task" is matched the same as "Agent" (v2.1.63 rename precedent, both captured live by the platform probe)', () => {
  const dir = makeTmpDir('t8-b-task-toolname');
  const result = runHook(makeDispatchEvent(dir, {
    toolName: 'Task', subagentType: 'nonfiction-studio:line-editor', model: 'opus'
  }));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (warn)');
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes('line-editor declares model sonnet'),
    'tool_name "Task" reaches the same routing branch as "Agent"'
  );
});

test('Task 8 (c) same dispatch with no model field: silence (the platform resolves to the declaration)', () => {
  const dir = makeTmpDir('t8-c-no-model');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor' }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'empty stdout: no tool_input.model means silence');
});

test('Task 8 (d) matching model tier (sonnet requested, sonnet declared): silence, not a false warn', () => {
  const dir = makeTmpDir('t8-d-model-match');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor', model: 'sonnet' }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'empty stdout: a matching tier is not a mismatch');
});

test('Task 8 (e) an agent declaring inherit never warns on model, regardless of the requested tier', () => {
  const dir = makeTmpDir('t8-e-inherit-never-warns');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:research-librarian', model: 'haiku' }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout: research-librarian declares model: inherit, which never warns'
  );
});

// --- Namespace guard (no false denies under ambiguity) ----------------------

test('Task 8 (f) unnamespaced subagent_type "line-editor" (no plugin prefix), no dispatcher: silence even with a model override', () => {
  const dir = makeTmpDir('t8-f-bare-nodispatcher');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'line-editor', model: 'opus' }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'a bare (unnamespaced) subagent_type is never judged, even when it collides with a real agent slug'
  );
});

test('Task 8 (g) mutation proof (namespace guard): a plugin-agent dispatcher targeting an unnamespaced subagent_type stays silent, never falling through to the chain check', () => {
  const dir = makeTmpDir('t8-g-namespace-mutation-proof');
  // drafting-partner (a real dispatcher slug, chain-permitted only to research-librarian)
  // dispatches the BUILT-IN "general-purpose" agent - not a plugin agent at all, and not
  // namespaced. If the namespace guard (the `if (!targetSlug) process.exit(0);` early return in
  // hooks/pre-tool-use.mjs, right after stripPluginNamespace) were deleted, targetSlug would stay
  // null and fall through to the chain check, which would then warn
  // "drafting-partner -> null is not a declared edge" - a false positive the guard exists
  // specifically to prevent. This is the named mutation proof for that guard.
  const result = runHook(makeDispatchEvent(dir, {
    subagentType: 'general-purpose',
    dispatcherType: 'nonfiction-studio:drafting-partner'
  }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout: a plugin-agent dispatcher targeting a non-plugin agent must never reach the chain check'
  );
});

test('Task 8 (h) foreign-namespace subagent_type ("other-plugin:some-agent"): silence', () => {
  const dir = makeTmpDir('t8-h-foreign-namespace');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'other-plugin:some-agent', model: 'opus' }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'empty stdout: a foreign plugin namespace is never judged');
});

test('Task 8 (i2) mutation proof (model comparison, direct-call): matching models stay silent; mismatched models warn', () => {
  assert.equal(
    modelMismatchMessage('line-editor', 'sonnet', 'sonnet'),
    null,
    'matching declared and requested models must return null - inverting the equality check would warn here'
  );
  assert.equal(
    modelMismatchMessage('line-editor', 'sonnet', 'opus'),
    'Routing: line-editor declares model sonnet (D-18 in-plugin model routing); this dispatch requests opus.',
    'mismatched models must return the warn sentence - inverting the equality check would stay silent here'
  );
});

// --- Chain rule (agents/_chain-permitted.yaml, now also a runtime contract) -

test('Task 8 (i) chain rule: a declared edge (drafting-partner -> research-librarian) is silent', () => {
  const dir = makeTmpDir('t8-i-chain-declared');
  const result = runHook(makeDispatchEvent(dir, {
    subagentType: 'nonfiction-studio:research-librarian',
    dispatcherType: 'nonfiction-studio:drafting-partner'
    // No model override: research-librarian is model: inherit, so the model rule stays silent
    // regardless, isolating this case to the chain rule alone.
  }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'empty stdout: a declared chain edge produces no output');
});

test('Task 8 (j) chain rule: an undeclared edge (drafting-partner -> line-editor) warns naming both slugs', () => {
  const dir = makeTmpDir('t8-j-chain-undeclared');
  const result = runHook(makeDispatchEvent(dir, {
    subagentType: 'nonfiction-studio:line-editor',
    model: 'sonnet', // matches line-editor's own declaration: isolates this case to the chain rule
    dispatcherType: 'nonfiction-studio:drafting-partner'
  }));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (warn)');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('drafting-partner'), 'names the dispatcher slug');
  assert.ok(ctx.includes('line-editor'), 'names the target slug');
  assert.ok(ctx.includes('_chain-permitted.yaml'), 'cites the contract file');
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, 'never a deny under the default warn mode');
});

test('Task 8 (k) chain rule: a main-session dispatch (no agent_type) never chain-warns', () => {
  const dir = makeTmpDir('t8-k-mainsession-nochainwarn');
  const result = runHook(makeDispatchEvent(dir, {
    subagentType: 'nonfiction-studio:line-editor',
    model: 'sonnet'
    // No dispatcherType: main-session dispatch.
  }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'empty stdout: a main-session dispatch (null active agent) never triggers the chain rule'
  );
});

// --- routing_enforce modes (off | warn | block; absent settings = warn) -----

test('Task 8 (l) routing_enforce: block turns the model warning into a deny with the same sentence', () => {
  const dir = makeTmpDir('t8-l-block-mode');
  writeRoutingSettings(dir, '---\nrouting_enforce: block\n---\nHouse notes.\n');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor', model: 'opus' }));

  assert.equal(result.status, 0, 'exit code is 0 (deny travels in JSON, not exit code)');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  const hso = out.hookSpecificOutput;
  assert.equal(hso.permissionDecision, 'deny', 'routing_enforce: block denies instead of warning');
  assert.equal(
    hso.permissionDecisionReason,
    'Routing: line-editor declares model sonnet (D-18 in-plugin model routing); this dispatch requests opus.',
    'block-mode deny reason is the exact same sentence the warn mode would have used'
  );
});

test('Task 8 (l2) routing_enforce: block also turns the chain warning into a deny with the same sentence (both warns, not just the model one)', () => {
  const dir = makeTmpDir('t8-l2-block-mode-chain');
  writeRoutingSettings(dir, '---\nrouting_enforce: block\n---\nHouse notes.\n');
  const result = runHook(makeDispatchEvent(dir, {
    subagentType: 'nonfiction-studio:line-editor',
    model: 'sonnet', // matches line-editor's own declaration: isolates this case to the chain rule
    dispatcherType: 'nonfiction-studio:drafting-partner'
  }));

  assert.equal(result.status, 0, 'exit code is 0 (deny travels in JSON, not exit code)');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (deny)');
  const hso = out.hookSpecificOutput;
  assert.equal(hso.permissionDecision, 'deny', 'routing_enforce: block denies the chain warning too, not just the model one');
  assert.ok(hso.permissionDecisionReason.includes('drafting-partner'), 'deny reason names the dispatcher slug');
  assert.ok(hso.permissionDecisionReason.includes('line-editor'), 'deny reason names the target slug');
  assert.ok(hso.permissionDecisionReason.includes('_chain-permitted.yaml'), 'deny reason cites the contract file');
});

test('Task 8 (m) routing_enforce: off silences the branch entirely, even for what would otherwise warn', () => {
  const dir = makeTmpDir('t8-m-off-mode');
  writeRoutingSettings(dir, '---\nrouting_enforce: off\n---\nHouse notes.\n');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor', model: 'opus' }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'routing_enforce: off produces no output');
});

// --- Fail-open: missing agent file, unparseable frontmatter, unreadable -----
// --- agents/_chain-permitted.yaml, corrupt settings (four named cases) -----

test('Task 8 (n) fail-open: dispatching a slug with no agents/<slug>.md file produces silence', () => {
  const dir = makeTmpDir('t8-n-missing-agent-file');
  const result = runHook(makeDispatchEvent(dir, {
    subagentType: 'nonfiction-studio:totally-not-a-real-agent', model: 'opus'
  }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'a missing agent file fails open to silence, not a crash');
});

test('Task 8 (o) fail-open: unparseable agent frontmatter produces silence', () => {
  const agentsDir = mkdtempSync(join(tmpdir(), 'ns-t8-agents-'));
  writeFileSync(join(agentsDir, 'line-editor.md'), '---\nmodel: {unclosed\n---\nbody\n', 'utf8');
  const dir = makeTmpDir('t8-o-unparseable-frontmatter');

  const result = runHook(
    makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor', model: 'opus' }),
    { NS_AGENTS_DIR: agentsDir }
  );

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stdout.trim(), '', 'unparseable frontmatter fails open to silence, not a crash');
});

test('Task 8 (p) fail-open: an unreadable agents/_chain-permitted.yaml produces silence for the chain rule', () => {
  const agentsDir = mkdtempSync(join(tmpdir(), 'ns-t8-agents-'));
  writeFileSync(join(agentsDir, 'line-editor.md'), '---\nmodel: sonnet\n---\nbody\n', 'utf8');
  writeFileSync(join(agentsDir, '_chain-permitted.yaml'), 'drafting-partner: [unterminated\n', 'utf8');
  const dir = makeTmpDir('t8-p-unreadable-chain-yaml');

  const result = runHook(
    makeDispatchEvent(dir, {
      subagentType: 'nonfiction-studio:line-editor',
      model: 'sonnet', // matches the fixture's declared model: isolates this case to the chain rule
      dispatcherType: 'nonfiction-studio:drafting-partner'
    }),
    { NS_AGENTS_DIR: agentsDir }
  );

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'an unreadable chain contract fails open to silence, even though this edge would otherwise be undeclared'
  );
});

test('readChainPermitted on a chain file with a duplicated caller key fails open with a descriptive error, never throws', () => {
  const agentsDir = mkdtempSync(join(tmpdir(), 'ns-chain-dupe-key-'));
  writeFileSync(
    join(agentsDir, '_chain-permitted.yaml'),
    'drafting-partner:\n  - line-editor\ndrafting-partner:\n  - research-librarian\n',
    'utf8'
  );

  const result = readChainPermitted(agentsDir);

  assert.strictEqual(result.contract, null, 'a duplicate-key chain file yields no usable contract, not a guessed merge');
  assert.ok(result.error, 'the reader must carry a descriptive error string for this failure');
  assert.ok(result.error.includes('not valid YAML'), 'got: ' + result.error);
  assert.ok(result.error.includes('drafting-partner'), 'the error names the duplicated key; got: ' + result.error);
});

test('a chain file with a duplicated caller key fails open to silence at the dispatch hook, exactly like any other unparseable chain contract', () => {
  const agentsDir = mkdtempSync(join(tmpdir(), 'ns-t8-agents-'));
  writeFileSync(join(agentsDir, 'line-editor.md'), '---\nmodel: sonnet\n---\nbody\n', 'utf8');
  writeFileSync(
    join(agentsDir, '_chain-permitted.yaml'),
    'drafting-partner:\n  - line-editor\ndrafting-partner:\n  - research-librarian\n',
    'utf8'
  );
  const dir = makeTmpDir('chain-dupe-key-dispatch');

  const result = runHook(
    makeDispatchEvent(dir, {
      subagentType: 'nonfiction-studio:line-editor',
      model: 'sonnet', // matches the fixture's declared model: isolates this case to the chain rule
      dispatcherType: 'nonfiction-studio:drafting-partner'
    }),
    { NS_AGENTS_DIR: agentsDir }
  );

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'a duplicate-key chain contract fails open to silence, never a deny and never a lockout'
  );
});

// ---------------------------------------------------------------------------
// The chain rule's fail-open silence above is only safe because the SHIPPED contract itself is
// known-good: silence on a malformed chain file is the right behavior for an unforeseen local
// corruption, but a malformed file shipped IN the plugin tree would silently disable chain-edge
// validation for every author, with nothing in CI ever turning red. This pins that the real,
// checked-in agents/_chain-permitted.yaml parses cleanly through the exact same library reader
// the dispatch hook uses (no directory override), so a future edit that breaks it fails this
// suite instead of failing open in silence.
// ---------------------------------------------------------------------------

test('the shipped agents/_chain-permitted.yaml parses cleanly through the library reader the dispatch hook uses', () => {
  const result = readChainPermitted();

  assert.strictEqual(
    result.error, null,
    'the shipped chain contract must parse with no error; a malformed shipped copy would silently ' +
    'disable chain-edge validation for every author, since the dispatch hook fails open to silence'
  );
  assert.ok(
    result.contract && typeof result.contract === 'object' && !Array.isArray(result.contract),
    'a clean parse must yield a usable contract object'
  );
  assert.ok(Object.keys(result.contract).length > 0, 'the shipped contract is not empty');
});

test('Task 8 (q) fail-open ruling 1: a WHOLE-FILE-unparseable settings file produces silence for what would otherwise warn', () => {
  const dir = makeTmpDir('t8-q-corrupt-settings');
  writeRoutingSettings(dir, '---\nrouting_enforce: [unterminated\n---\nHouse notes.\n');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor', model: 'opus' }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'a whole-file parse failure fails open to total silence, not the "warn" default'
  );
});

// ---------------------------------------------------------------------------
// Fix round 2 (settings-silencing ruling, revising the original "any warning
// silences" interpretation): a live-review finding proved that interpretation
// let an explicitly configured routing_enforce: block go silently dark
// whenever ANY unrelated settings key was also invalid in the same file - an
// explicit block control silently failing open is worse than the narrower
// fail-open behavior it replaces. The revised ruling, keyed off loadSettings'
// new droppedKeys array (hooks/lib/settings.mjs):
//   1. Whole-file failure (settings came back empty with a warning, droppedKeys
//      empty): stays silent - unchanged from before this fix, see (q) above.
//   2. routing_enforce ITSELF was dropped as invalid (droppedKeys includes
//      "routing_enforce"): stays silent - author intent unknown, do not guess.
//   3. routing_enforce parsed VALID, or is absent entirely from an otherwise
//      valid file (droppedKeys does NOT include "routing_enforce"): a warning
//      about a DIFFERENT key must not silence the branch - the valid value
//      (or the "warn" default) governs.
// ---------------------------------------------------------------------------

test('Task 8 (q2) fail-open ruling 2: routing_enforce ITSELF dropped as invalid stays silent (author intent unknown)', () => {
  const dir = makeTmpDir('t8-q2-routing-enforce-itself-dropped');
  writeRoutingSettings(dir, '---\nrouting_enforce: loud\n---\nHouse notes.\n');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor', model: 'opus' }));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(
    result.stdout.trim(), '',
    'routing_enforce itself failing validation and being dropped fails open to silence'
  );
});

test('Task 8 (q3) ruling 3, the reviewer\'s exact live-reproduced scenario: an unrelated invalid key (gate_mode: bogus) must NOT silence a VALID routing_enforce: block - emitDeny fires', () => {
  const dir = makeTmpDir('t8-q3-unrelated-key-must-not-silence-block');
  writeRoutingSettings(dir, '---\ngate_mode: bogus\nrouting_enforce: block\n---\nHouse notes.\n');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor', model: 'opus' }));

  assert.equal(result.status, 0, 'exit code is 0 (deny travels in JSON, not exit code)');
  let out;
  assert.doesNotThrow(
    () => { out = JSON.parse(result.stdout.trim()); },
    'stdout is valid JSON (deny) - NOT empty; the pre-fix bug produced empty stdout here, silently going dark'
  );
  const hso = out.hookSpecificOutput;
  assert.equal(
    hso.permissionDecision, 'deny',
    'an unrelated dropped key (gate_mode) must not silence an explicitly configured, validly-parsed routing_enforce: block'
  );
  assert.equal(
    hso.permissionDecisionReason,
    'Routing: line-editor declares model sonnet (D-18 in-plugin model routing); this dispatch requests opus.',
    'deny reason is the ordinary model-mismatch sentence, proving the block control fired normally'
  );
});

test('Task 8 (q4) ruling 3, warn mode variant: an unrelated invalid key (gate_mode: bogus) must not silence the default warn behavior either', () => {
  const dir = makeTmpDir('t8-q4-unrelated-key-must-not-silence-warn');
  writeRoutingSettings(dir, '---\ngate_mode: bogus\n---\nHouse notes.\n');
  const result = runHook(makeDispatchEvent(dir, { subagentType: 'nonfiction-studio:line-editor', model: 'opus' }));

  assert.equal(result.status, 0, 'exit code is 0');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout is valid JSON (warn), not silenced');
  assert.equal(
    out.hookSpecificOutput.additionalContext,
    'Routing: line-editor declares model sonnet (D-18 in-plugin model routing); this dispatch requests opus.',
    'an unrelated dropped key does not suppress the default warn behavior (routing_enforce absent, but not itself invalid)'
  );
});

// --- Ordering: runs before, and cannot affect, the write-tools guard --------

test('Task 8 (r) regression: a Write following a dispatch in the same book behaves byte-identically to today', () => {
  const book = cloneSampleBook('t8-r-write-after-dispatch');

  // Fire a dispatch first (a declared edge, no model override): must be silent and side-effect-free.
  const dispatchResult = runHook(makeDispatchEvent(book, {
    subagentType: 'nonfiction-studio:research-librarian',
    dispatcherType: 'nonfiction-studio:drafting-partner'
  }));
  assert.equal(dispatchResult.status, 0, 'dispatch exit code is 0');
  assert.equal(dispatchResult.stdout.trim(), '', 'dispatch produces no output');

  // Now the existing (a)-style Write scenario, run against the SAME book directory.
  const target = join(book, 'chapters', '01-listening-before-speaking.md');
  const slug = '01-listening-before-speaking';
  const snapshotsBefore = countSnapshots(book, slug);
  const writeResult = runHook(makeWriteEvent(book, target));

  assert.equal(writeResult.status, 0, 'write exit code is 0');
  assert.equal(writeResult.stdout.trim(), '', 'Write after a prior dispatch still allows with empty stdout');
  const flagPath = join(book, '.studio', 'gate', '.session-write-flag');
  assert.ok(existsSync(flagPath), 'session-write flag still written after a prior dispatch call');
  assert.equal(
    countSnapshots(book, slug), snapshotsBefore + 1,
    'snapshot still created after a prior dispatch call, exactly as without one'
  );
});

// --- Design pin: frontmatter reads are cached per process -------------------

test('Task 8 (s) design pin: readAgentModel caches per resolved path within one process', () => {
  const agentsDir = mkdtempSync(join(tmpdir(), 'ns-t8-cache-'));
  writeFileSync(join(agentsDir, 'cache-test-agent.md'), '---\nmodel: sonnet\n---\nbody\n', 'utf8');
  clearRoutingCaches();

  const first = readAgentModel('cache-test-agent', agentsDir);
  assert.equal(first.model, 'sonnet', 'first read returns the file as currently written');

  writeFileSync(join(agentsDir, 'cache-test-agent.md'), '---\nmodel: opus\n---\nbody\n', 'utf8');
  const second = readAgentModel('cache-test-agent', agentsDir);
  assert.equal(
    second.model, 'sonnet',
    'cached: a second read of the same path within the same process still returns the first value'
  );

  clearRoutingCaches();
  const third = readAgentModel('cache-test-agent', agentsDir);
  assert.equal(third.model, 'opus', 'after clearRoutingCaches, a fresh read picks up the new content');
});
