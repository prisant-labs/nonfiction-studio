// what-it-is:   PreToolUse guard and snapshot hook; replaces the TSK-030 stub per TSK-032 (pre-tool-use hook)
// what-it-does: (a) denies writes outside the bible root (containment guard, fail-closed per D-13),
//               (b) exempts .studio/ from snapshot and flag writes,
//               (c) writes the session-write flag and a pre-write snapshot for chapters/ overwrites,
//               (d) injects an additionalContext caution for destructive Bash patterns,
//               (e) exports resolveActiveAgent (dormant OQ-14 seam) and checkResearchAgentConstraint
//               (dormant path; tested directly so it is proven wired).
//
// stdin:  platform PreToolUse event (snake_case: session_id, transcript_path, cwd, prompt_id,
//         permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id)
//         - field names verified live by TSK-030 (hooks.json Phase 1 wiring)
// stdout: EMPTY for the allow path (platform treats empty stdout as allow per the convention
//         confirmed at TSK-030); JSON deny envelope when the containment guard fires;
//         JSON additionalContext envelope for Bash destructive-pattern cautions.
//
// NS_HOOK_TRACE: when set, appends one trace line (event, own path, raw stdin) to the named file
//                before any other logic; inert when unset (preserved from TSK-030 stub convention)
//
// Failure modes:
//   - Path guard violations: FAIL-CLOSED (emit deny JSON, exit 0) per D-13 (security posture)
//   - Snapshot and session-write flag errors: FAIL-OPEN (append to .studio/logs/errors.jsonl, allow)
//   - Malformed stdin: FAIL-OPEN (exit 0, empty stdout; cannot identify a write)

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync
} from 'node:fs';
import { join, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBookRoot } from './lib/bible.mjs';

// ---------------------------------------------------------------------------
// Helper: compact UTC timestamp for snapshot filenames (YYYYMMDDTHHMMSSmmmZ)
// F-HK-03: milliseconds are now included (previously truncated to whole
// seconds), which is the primary defense against same-second snapshot
// collisions - two overwrites of the same chapter within one second almost
// always land in different milliseconds.
// Example: "2026-07-17T15:40:12.123Z" -> "20260717T154012123Z"
// ---------------------------------------------------------------------------
function compactUtcNow() {
  return new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace('.', '');
}

// ---------------------------------------------------------------------------
// Helper: pick a collision-free snapshot filename (F-HK-03 belt and
// suspenders). Milliseconds make same-name collisions rare but not
// impossible (coarse OS clock resolution, or two writes landing in the same
// tick); if <slug>.<timestamp>.md is already taken, this deterministically
// escalates to a -2, -3, ... suffix until a free name is found.
// existsFn is injected (rather than calling existsSync directly) so tests can
// drive the escalation deterministically without needing real collisions.
// Exported for direct testing.
// ---------------------------------------------------------------------------
export function pickSnapshotName(slug, timestamp, existsFn) {
  const base = slug + '.' + timestamp;
  let name = base + '.md';
  let counter = 2;
  while (existsFn(name)) {
    name = base + '-' + counter + '.md';
    counter++;
  }
  return name;
}

// ---------------------------------------------------------------------------
// Helper: parse a snapshot filename for a known slug into { timestamp, counter }.
// Filenames are <slug>.<timestamp>.md (counter 1, implicit) or
// <slug>.<timestamp>-<N>.md (counter N, from pickSnapshotName's collision
// escalation). The timestamp itself never contains a hyphen (compactUtcNow
// strips them), so any hyphen in the remainder is unambiguously the counter
// separator. Returns null if fname does not belong to slug.
// ---------------------------------------------------------------------------
function parseSnapshotName(fname, slug) {
  const prefix = slug + '.';
  const suffix = '.md';
  if (!fname.startsWith(prefix) || !fname.endsWith(suffix)) return null;
  const middle = fname.slice(prefix.length, fname.length - suffix.length);
  const m = middle.match(/^(.*)-(\d+)$/);
  if (m) {
    return { timestamp: m[1], counter: parseInt(m[2], 10) };
  }
  return { timestamp: middle, counter: 1 };
}

// ---------------------------------------------------------------------------
// Helper: chronological comparator for snapshot filenames (F-HK-03).
// A default lexicographic string sort breaks once a -N counter suffix
// exists: ASCII '-' (0x2D) sorts BEFORE '.' (0x2E), so "<ts>-2.md" would sort
// as OLDER than the plain "<ts>.md" it was actually created after. This
// comparator parses out (timestamp, counter) and compares each field
// explicitly so prune's "newest 10" selection stays correct even when the
// belt-and-suspenders counter fires.
// ---------------------------------------------------------------------------
function compareSnapshotNames(a, b, slug) {
  const pa = parseSnapshotName(a, slug);
  const pb = parseSnapshotName(b, slug);
  if (pa.timestamp !== pb.timestamp) return pa.timestamp < pb.timestamp ? -1 : 1;
  return pa.counter - pb.counter;
}

// ---------------------------------------------------------------------------
// Helper: emit deny JSON (PF-10 verified output shape) to stdout and exit 0.
// Used both by the containment guard (fail-closed) and the research-agent
// constraint (dormant seam).
// ---------------------------------------------------------------------------
function emitDeny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    }) + '\n'
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helper: append one JSONL error record to .studio/logs/errors.jsonl (fail-open;
// never throws; used for snapshot and flag write failures).
// ---------------------------------------------------------------------------
function logError(root, msg, err) {
  try {
    const logsDir = join(root, '.studio', 'logs');
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(
      join(logsDir, 'errors.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hook: 'PreToolUse',
        msg,
        err: String(err)
      }) + '\n',
      'utf8'
    );
  } catch {
    // Cannot write error log; nothing further to do.
  }
}

// ---------------------------------------------------------------------------
// OQ-14 seam: resolveActiveAgent(event) - dormant, returns null today.
//
// Context: the live PreToolUse envelope captured by TSK-030 (hooks.json Phase 1
// wiring) carries no agent identity field. OQ-14 (agent identity in hook events)
// defers resolution to Phase 1 agent tasks (TSK-036 onward): extend the firing
// probe to a subagent-spawned session and confirm whether the envelope gains
// an agent identity field. When that field is confirmed, wire it here so the
// research-agent constraint below activates without further changes downstream.
// The seam is exported and the constraint function is tested directly with an
// injected slug so the dormant path is proven wired per the TSK-032 brief.
// ---------------------------------------------------------------------------
export function resolveActiveAgent(_event) {
  // OQ-14: no agent identity field in the live PreToolUse envelope today.
  return null;
}

// ---------------------------------------------------------------------------
// Research-agent constraint guard (D-13 security posture).
// Exported so tests can drive the dormant path directly with an injected slug
// without needing resolveActiveAgent to return a non-null value.
//
// agentSlug:     string|null - active agent slug (from resolveActiveAgent)
// targetAbsPath: string      - absolute resolved write target path
// bibleRoot:     string      - absolute bible root directory
// returns:       string (deny reason) when the constraint fires, null to allow
//
// Research-facing agents (research-librarian, fact-checker, citation-manager)
// may only write under research/ or .studio/. Writes anywhere else are denied
// per D-13 (security posture).
// ---------------------------------------------------------------------------
export function checkResearchAgentConstraint(agentSlug, targetAbsPath, bibleRoot) {
  const RESEARCH_AGENTS = new Set(['research-librarian', 'fact-checker', 'citation-manager']);
  if (!agentSlug || !RESEARCH_AGENTS.has(agentSlug)) return null;

  const rootNorm = resolve(bibleRoot).toLowerCase();
  const targetNorm = resolve(targetAbsPath).toLowerCase();

  const inResearch =
    targetNorm === rootNorm + sep + 'research' ||
    targetNorm.startsWith(rootNorm + sep + 'research' + sep);
  const inStudio =
    targetNorm === rootNorm + sep + '.studio' ||
    targetNorm.startsWith(rootNorm + sep + '.studio' + sep);

  if (!inResearch && !inStudio) {
    return (
      'Agent ' + agentSlug + ' (research-facing) may only write under research/ or ' +
      '.studio/; attempted write to ' + targetAbsPath + ' denied per D-13 (security posture)'
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main logic block. Guard: runs only when this script is the direct entry point,
// not when the module is imported. This lets tests import the exported functions
// (resolveActiveAgent, checkResearchAgentConstraint) without triggering stdin
// reads or process.exit() calls.
// ---------------------------------------------------------------------------
const isMain =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (isMain) {
  // -------------------------------------------------------------------------
  // Drain stdin first - the platform delivers event JSON here on every invocation.
  // -------------------------------------------------------------------------
  const raw = readFileSync(0, 'utf8');

  // -------------------------------------------------------------------------
  // NS_HOOK_TRACE (opt-in firing proof, preserved from TSK-030 stub convention).
  // Inert when unset.
  // -------------------------------------------------------------------------
  if (process.env.NS_HOOK_TRACE) {
    const ownPath = fileURLToPath(import.meta.url);
    const traceRecord = JSON.stringify({ event: 'PreToolUse', script: ownPath, stdinRaw: raw.trim() });
    appendFileSync(process.env.NS_HOOK_TRACE, traceRecord + '\n', 'utf8');
  }

  // -------------------------------------------------------------------------
  // Parse stdin. Fail-open: malformed JSON exits 0 with empty stdout.
  // Cannot identify a write, so no deny and no snapshot. (Brief case l.)
  // -------------------------------------------------------------------------
  let event = {};
  try {
    event = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Extract snake_case fields (field names resolved live by TSK-030 proof).
  // -------------------------------------------------------------------------
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';
  const toolInput =
    event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  const cwd = typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd();

  // WRITE_TOOLS is declared ahead of book-root detection: the corrupt-config
  // discrimination below (F-HK-01) needs it to decide fail-closed vs silent exit.
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

  // -------------------------------------------------------------------------
  // Book root detection. No root found: no-op (exit 0, empty stdout).
  //
  // Error discrimination (F-HK-01; mirrors hooks/stop-gate.mjs and
  // hooks/session-start.mjs): BibleError code NO_BOOK_ROOT is normal (no book
  // project anywhere in the ancestor chain) and stays silent. Any other code
  // (CONFIG_READ_ERROR, META_READ_ERROR, ...) means a book root WAS found but
  // its bible files are corrupt, so containment cannot be verified. Write
  // tools fail closed (deny) per D-13 (security posture); non-write tools and
  // Bash are unaffected (exit 0, unchanged from today).
  // -------------------------------------------------------------------------
  let bookRoot = null;
  try {
    const found = findBookRoot(cwd);
    bookRoot = found.root;
  } catch (err) {
    if (err && err.code && err.code !== 'NO_BOOK_ROOT' && WRITE_TOOLS.has(toolName)) {
      emitDeny(
        'Cannot verify write safety: bible files are corrupt (' + err.message + '). ' +
        'Repair .studio/config.json then retry; bin/ns-doctor reports the parse error. ' +
        'Denied per D-13 (security posture, fail-closed).'
      );
    }
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // No-op for tools this hook does not handle.
  // Read, Grep, Glob, WebFetch and others exit here with empty stdout.
  // -------------------------------------------------------------------------
  if (!WRITE_TOOLS.has(toolName) && toolName !== 'Bash') {
    process.exit(0);
  }

  // =========================================================================
  // BASH path (S-07 step 4)
  // When tool_name is Bash and the command matches a destructive pattern,
  // inject a one-line caution via additionalContext; no permissionDecision.
  // Benign Bash exits with empty stdout (allow).
  // =========================================================================
  if (toolName === 'Bash') {
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';
    const CAUTION_PATTERNS = [
      { re: /rm\s+-rf\b/, name: 'rm -rf' },
      { re: /git\s+reset\s+--hard\b/, name: 'git reset --hard' }
    ];
    for (const { re, name } of CAUTION_PATTERNS) {
      if (re.test(command)) {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              additionalContext:
                'Caution: destructive command pattern detected (' + name + '). ' +
                'Verify this is intentional before proceeding.'
            }
          }) + '\n'
        );
        process.exit(0);
      }
    }
    // Benign Bash: empty stdout (allow).
    process.exit(0);
  }

  // =========================================================================
  // WRITE TOOLS path (Write, Edit, NotebookEdit)
  // Steps follow S-07 PreToolUse internal steps, re-read 2026-07-18 under the
  // flattened layout where .studio/ and research/ are direct children of the
  // bible root, so the old explicit allowlist is subsumed by the root check.
  // =========================================================================

  // Step 3a: extract and resolve the write target path.
  // Write/Edit: tool_input.file_path; NotebookEdit: tool_input.notebook_path.
  const rawTarget =
    toolName === 'NotebookEdit'
      ? (typeof toolInput.notebook_path === 'string' ? toolInput.notebook_path : null)
      : (typeof toolInput.file_path === 'string' ? toolInput.file_path : null);

  // Fail-closed: missing or unresolvable target => deny (D-13 security posture).
  let resolvedTarget = null;
  try {
    if (!rawTarget) throw new Error('no target path in tool_input (file_path or notebook_path missing)');
    resolvedTarget = resolve(cwd, rawTarget);
  } catch (err) {
    emitDeny(
      'Cannot resolve write target for ' + toolName + ': ' + String(err) +
      ' (fail-closed per D-13 security posture)'
    );
  }

  // Step 3b: CONTAINMENT GUARD.
  // [S-07 step 3, re-read 2026-07-18 under the flattened layout: the old explicit
  // allowlist (.studio/, research/) is subsumed because both directories live
  // inside the root in the committed layout. The guard now simply checks whether
  // the resolved target falls inside the bible root subtree. FAIL-CLOSED.]
  const resolvedRoot = resolve(bookRoot);
  const targetNorm = resolvedTarget.toLowerCase();
  const rootNorm = resolvedRoot.toLowerCase();
  const rootPrefix = rootNorm + sep;

  if (targetNorm !== rootNorm && !targetNorm.startsWith(rootPrefix)) {
    emitDeny(
      'Write target ' + resolvedTarget + ' is outside the bible root ' + resolvedRoot +
      '; denied per D-13 (security posture)'
    );
  }

  // Step 5: OQ-14 dormant research-agent constraint (S-07 step 5).
  // resolveActiveAgent returns null today; the constraint fires automatically
  // when it returns a slug, so the path is proven live even before OQ-14 resolves.
  const activeAgent = resolveActiveAgent(event);
  const researchDenyReason = checkResearchAgentConstraint(activeAgent, resolvedTarget, resolvedRoot);
  if (researchDenyReason) {
    emitDeny(researchDenyReason);
  }

  // Step 3c: .studio/ targets are machine state.
  // Allowed with no snapshot and no session-write flag (S-07 no-op row).
  if (
    targetNorm === rootNorm + sep + '.studio' ||
    targetNorm.startsWith(rootNorm + sep + '.studio' + sep)
  ) {
    process.exit(0);
  }

  // Step 3d: chapters/ targets - session-write flag plus optional snapshot.
  if (
    targetNorm === rootNorm + sep + 'chapters' ||
    targetNorm.startsWith(rootNorm + sep + 'chapters' + sep)
  ) {
    // --- Session-write flag (.studio/gate/.session-write-flag) ---
    // Atomic write-then-rename; creating .studio/gate/ if needed.
    // Fail-open: flag write error is logged and the write is still allowed.
    try {
      const gateDir = join(resolvedRoot, '.studio', 'gate');
      mkdirSync(gateDir, { recursive: true });
      const tmpFlagPath = join(gateDir, '.session-write-flag.tmp');
      writeFileSync(tmpFlagPath, new Date().toISOString() + '\n', 'utf8');
      renameSync(tmpFlagPath, join(gateDir, '.session-write-flag'));
    } catch (flagErr) {
      logError(bookRoot, 'session-write flag write failed', flagErr);
    }

    // --- Snapshot (only when the target file already EXISTS = an overwrite) ---
    // S-08 section 10: full-copy snapshot, named <slug>.<YYYYMMDDTHHMMSSZ>.md,
    // pruned after creation to the newest 10 per slug.
    if (existsSync(resolvedTarget)) {
      try {
        const snapshotsDir = join(resolvedRoot, '.studio', 'snapshots');
        mkdirSync(snapshotsDir, { recursive: true });

        const fileBase = basename(resolvedTarget);
        const slug = fileBase.endsWith('.md') ? fileBase.slice(0, -3) : fileBase;
        const timestamp = compactUtcNow();
        const snapshotName = pickSnapshotName(
          slug, timestamp, (name) => existsSync(join(snapshotsDir, name))
        );

        writeFileSync(
          join(snapshotsDir, snapshotName),
          readFileSync(resolvedTarget, 'utf8'),
          'utf8'
        );

        // Prune: keep newest 10 per slug. F-HK-03: sort with compareSnapshotNames
        // (timestamp then counter), NOT a raw lexicographic string sort - a -N
        // collision suffix would otherwise sort before its unsuffixed base name.
        try {
          const allForSlug = readdirSync(snapshotsDir)
            .filter(f => f.startsWith(slug + '.') && f.endsWith('.md'));
          allForSlug.sort((a, b) => compareSnapshotNames(a, b, slug)); // ascending = oldest first
          if (allForSlug.length > 10) {
            const toDelete = allForSlug.slice(0, allForSlug.length - 10);
            for (const fname of toDelete) {
              try {
                unlinkSync(join(snapshotsDir, fname));
              } catch (delErr) {
                logError(bookRoot, 'snapshot prune failed deleting ' + fname, delErr);
              }
            }
          }
        } catch (pruneErr) {
          logError(bookRoot, 'snapshot prune listing failed', pruneErr);
        }
      } catch (snapshotErr) {
        logError(bookRoot, 'snapshot write failed for ' + resolvedTarget, snapshotErr);
        // Fail-open: allow the write to proceed even though the snapshot failed.
      }
    }
  }

  // Step 3e: exit 0 with empty stdout (allow) for all in-root paths that were
  // not denied above. The platform treats empty stdout as allow.
  process.exit(0);
}
