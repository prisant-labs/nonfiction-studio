// what-it-is:   PreToolUse guard and snapshot hook; replaces the TSK-030 stub per TSK-032 (pre-tool-use hook)
// what-it-does: (a) denies writes outside the bible root (containment guard, fail-closed per D-13),
//               (b) exempts .studio/ from snapshot and flag writes,
//               (c) writes the session-write flag and a pre-write snapshot for chapters/ overwrites,
//               (d) injects an additionalContext caution for destructive Bash/PowerShell patterns,
//               (e) enforces the per-agent write-scope constraint (F-AG-01) and the web research
//               gate (F-AG-02) using shared identity resolution from hooks/lib/agent-identity.mjs,
//               now LIVE per ADR-0007 (agent identity resolution) and the 2026-08-09 platform probe.
//
// stdin:  platform PreToolUse event (snake_case: session_id, transcript_path, cwd, prompt_id,
//         permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id,
//         and agent_id/agent_type when a plugin or generic subagent fired the call)
//         - field names verified live by TSK-030 (hooks.json Phase 1 wiring); agent_id/agent_type
//         verified live by the 2026-08-09 probe, (local working notes, not published)
// stdout: EMPTY for the allow path (platform treats empty stdout as allow per the convention
//         confirmed at TSK-030); JSON deny envelope when a guard fires;
//         JSON additionalContext envelope for Bash/PowerShell destructive-pattern cautions.
//
// NS_HOOK_TRACE: when set, appends one trace line (event, own path, raw stdin) to the named file
//                before any other logic; inert when unset (preserved from TSK-030 stub convention)
//
// Failure modes:
//   - Path guard and web gate violations: FAIL-CLOSED (emit deny JSON, exit 0) per D-13 (security posture)
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
  unlinkSync,
  realpathSync
} from 'node:fs';
import { join, resolve, sep, basename, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBookRoot } from './lib/bible.mjs';
import {
  resolveActiveAgent,
  checkAgentWriteConstraint,
  isWebGatedAgent,
  foldForCompare
} from './lib/agent-identity.mjs';

// Re-exported so existing callers importing foldForCompare from this file
// (e.g. tests/hooks/pre-tool-use.test.mjs) are unaffected by the move to
// hooks/lib/agent-identity.mjs, the single home for this helper.
export { foldForCompare };

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
// Helper: realpath the nearest EXISTING ancestor of absPath, then rejoin the
// remaining (not-yet-created) path segments (F-HK-04 symlink containment
// bypass). Write targets are often new files that do not exist yet, so a
// plain realpathSync on the full path would throw ENOENT; this walks up
// until it finds a real ancestor, resolves THAT natively, and re-attaches
// the rest lexically (a symlink cannot live inside a path segment that has
// not been created yet, so the remainder is safe to re-attach as-is).
// ---------------------------------------------------------------------------
function realpathNearestExisting(absPath) {
  let current = absPath;
  const remainder = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      // Reached the filesystem root without finding an existing ancestor.
      // The bible root itself always exists (findBookRoot verified it), so
      // this should be unreachable in practice; fail closed defensively.
      throw new Error('no existing ancestor found for ' + absPath);
    }
    remainder.unshift(basename(current));
    current = parent;
  }
  const realBase = realpathSync.native(current);
  return remainder.length > 0 ? join(realBase, ...remainder) : realBase;
}

// ---------------------------------------------------------------------------
// foldForCompare (F-HK-13 case-fold helper) now lives in
// hooks/lib/agent-identity.mjs, the single home for it, imported above and
// re-exported below under the same name so existing callers of
// `import('../../hooks/pre-tool-use.mjs')` are unaffected. It used to be
// defined here and re-implemented (not imported) inside
// checkAgentWriteConstraint in agent-identity.mjs; that duplication is what
// moving it here fixes - one definition, both call sites.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: identify the shallowest path component between rootPath and
// targetPath whose real path diverges from its lexical path (F-HK-04) - i.e.
// the symlink (or symlinked ancestor) responsible for a containment escape.
// Used only to make the deny reason legible; returns null when no divergence
// is found among existing ancestors (e.g. nothing on the path exists yet, or
// targetPath is not lexically under rootPath at all).
// ---------------------------------------------------------------------------
function findSymlinkedComponent(rootPath, targetPath) {
  const relPath = relative(rootPath, targetPath);
  if (!relPath || relPath.startsWith('..')) return null;
  const parts = relPath.split(sep).filter(Boolean);
  let lexicalSoFar = rootPath;
  for (const part of parts) {
    lexicalSoFar = join(lexicalSoFar, part);
    if (!existsSync(lexicalSoFar)) break;
    let real;
    try {
      real = realpathSync.native(lexicalSoFar);
    } catch {
      break;
    }
    if (foldForCompare(resolve(real)) !== foldForCompare(resolve(lexicalSoFar))) {
      return lexicalSoFar;
    }
  }
  return null;
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
// Web gate (F-AG-02, web gate unenforced): decides whether WebSearch/WebFetch
// may proceed for a web-gated agent, given the book-root lookup outcome and
// its parsed config (both already computed by the caller via findBookRoot,
// which is also this hook's own book-root authority, so this reads no file
// of its own). Fail-closed per D-13 (security posture): every ambiguous or
// error case denies. The rule for "open" is binding and documented at
// docs/reference/agents/research-librarian.md:135-149 (see ADR-0007,
// agent identity resolution): research.web_enabled must be exactly the
// boolean true; an absent key, the string "true", false, and null all leave
// the gate CLOSED.
// ---------------------------------------------------------------------------
function checkWebGateConstraint(agentSlug, bookRootError, bookConfig) {
  if (bookRootError) {
    return (
      'Web gate closed for agent ' + agentSlug + ': ' +
      (bookRootError.code === 'NO_BOOK_ROOT'
        ? 'no book root could be found'
        : 'bible files are corrupt (' + bookRootError.message + ')') +
      ', so research.web_enabled cannot be verified. Set research.web_enabled to the boolean ' +
      'true in .studio/config.json once the book project is available. Denied per D-13 ' +
      '(security posture, fail-closed).'
    );
  }

  const research = bookConfig && typeof bookConfig === 'object' ? bookConfig.research : undefined;
  const webEnabled = research && typeof research === 'object' ? research.web_enabled : undefined;

  if (webEnabled === true) return null;

  return (
    'Web gate closed for agent ' + agentSlug + ': research.web_enabled must be exactly the ' +
    'boolean true in .studio/config.json (got ' + JSON.stringify(webEnabled) + '). Denied per ' +
    'D-13 (security posture, fail-closed).'
  );
}

// ---------------------------------------------------------------------------
// Main logic block. Guard: runs only when this script is the direct entry point,
// not when the module is imported. This lets tests import the exported functions
// (pickSnapshotName, foldForCompare) without triggering stdin reads or
// process.exit() calls. resolveActiveAgent and checkAgentWriteConstraint are
// no longer defined or exported here; they live in hooks/lib/agent-identity.mjs
// and are imported above like any other dependency.
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
  // Book root detection. Captures the root, its config, and any lookup error
  // without exiting yet - the WEB GATE branch immediately below needs to see
  // a NO_BOOK_ROOT or corrupt-config error too (it fails closed on both,
  // unlike every other tool family), so the exit decision for those errors is
  // deferred to the book-root error handling block that follows the web gate.
  // -------------------------------------------------------------------------
  let bookRoot = null;
  let bookConfig = null;
  let bookRootError = null;
  try {
    const found = findBookRoot(cwd);
    bookRoot = found.root;
    bookConfig = found.config;
  } catch (err) {
    bookRootError = err;
  }

  // -------------------------------------------------------------------------
  // WEB GATE (F-AG-02, web gate unenforced): WebSearch/WebFetch from a
  // web-gated agent (isWebGatedAgent) are denied unless research.web_enabled
  // is exactly the boolean true in .studio/config.json. Runs before the
  // generic book-root error handling below because "no book root" is itself a
  // fail-closed DENY for a web-gated agent here (unlike the silent no-op
  // every other tool gets for NO_BOOK_ROOT): there is no config to read, so
  // the gate cannot be verified open, and D-13 (security posture) says fail
  // closed rather than guess. Main-session calls and non-gated agents are
  // entirely unaffected: this whole branch is a no-op for them.
  // -------------------------------------------------------------------------
  if (toolName === 'WebSearch' || toolName === 'WebFetch') {
    const webGateAgent = resolveActiveAgent(event);
    if (isWebGatedAgent(webGateAgent)) {
      const webGateDenyReason = checkWebGateConstraint(webGateAgent, bookRootError, bookConfig);
      if (webGateDenyReason) {
        emitDeny(webGateDenyReason);
      }
    }
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Book-root error handling for the remaining tool families (write tools,
  // Bash/PowerShell caution, and everything else).
  //
  // Error discrimination (F-HK-01; mirrors hooks/stop-gate.mjs and
  // hooks/session-start.mjs): BibleError code NO_BOOK_ROOT is normal (no book
  // project anywhere in the ancestor chain) and stays silent. Any other code
  // (CONFIG_READ_ERROR, META_READ_ERROR, ...) means a book root WAS found but
  // its bible files are corrupt, so containment cannot be verified. Write
  // tools fail closed (deny) per D-13 (security posture). F8 (corrupt config
  // suppresses the shell caution): non-write tools (Bash/PowerShell) fall
  // through to the destructive-command caution logic below instead of exiting
  // here, so a corrupt config no longer silently swallows that caution.
  // -------------------------------------------------------------------------
  if (bookRootError) {
    if (bookRootError.code && bookRootError.code !== 'NO_BOOK_ROOT') {
      if (WRITE_TOOLS.has(toolName)) {
        emitDeny(
          'Cannot verify write safety: bible files are corrupt (' + bookRootError.message + '). ' +
          'Repair .studio/config.json then retry; bin/ns-doctor reports the parse error. ' +
          'Denied per D-13 (security posture, fail-closed).'
        );
      }
      // Non-write tools (Bash/PowerShell) fall through to the caution logic
      // below; anything else falls through to the generic no-op check next.
    } else {
      process.exit(0);
    }
  }

  // -------------------------------------------------------------------------
  // No-op for tools this hook does not handle.
  // Read, Grep, Glob and others exit here with empty stdout.
  // (WebSearch/WebFetch are handled and always exit in the branch above.)
  // F-HK-07: PowerShell is a first-class peer of Bash on Windows sessions, so
  // it must reach the destructive-op caution below rather than bypass it here.
  // -------------------------------------------------------------------------
  if (!WRITE_TOOLS.has(toolName) && toolName !== 'Bash' && toolName !== 'PowerShell') {
    process.exit(0);
  }

  // =========================================================================
  // BASH / POWERSHELL path (S-07 step 4; F-HK-07 extends it to PowerShell)
  // When tool_name is Bash or PowerShell and the command matches that shell's
  // destructive pattern set, inject a one-line caution via additionalContext;
  // no permissionDecision (never a deny). Benign commands exit with empty
  // stdout. The two pattern sets are independent: Bash's stays exactly as it
  // was (byte-unchanged) and PowerShell gets its own shape.
  // =========================================================================
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';

    // Bash: unchanged from before F-HK-07.
    const BASH_CAUTION_PATTERNS = [
      { re: /rm\s+-rf\b/, name: 'rm -rf' },
      { re: /git\s+reset\s+--hard\b/, name: 'git reset --hard' }
    ];

    // PowerShell (F-HK-07): cmdlet/flag names are matched case-insensitively
    // per PowerShell's own convention; git subcommands stay case-sensitive
    // (git.exe itself is case-sensitive regardless of the invoking shell).
    // Remove-Item -Recurse -Force: lookaheads accept either flag order and
    // flexible whitespace/args between the cmdlet and the two flags. The
    // cmdlet portion also covers PowerShell's built-in destructive aliases
    // (rm, rd, rmdir, del, erase) - fix round 1 (F-HK-07): the literal
    // cmdlet name alone missed `rm -Recurse -Force`, which is exactly what a
    // Unix-habituated author types. \b on BOTH sides of the alternation
    // keeps the short aliases from matching inside longer tokens (e.g.
    // "confirm", "term-notes.md", "-Confirm").
    const POWERSHELL_CAUTION_PATTERNS = [
      {
        re: /\b(?:Remove-Item|rmdir|rm|rd|del|erase)\b(?=[\s\S]*-Recurse\b)(?=[\s\S]*-Force\b)/i,
        name: 'Remove-Item -Recurse -Force (or a built-in alias: rm, rd, rmdir, del, erase)'
      },
      { re: /git\s+reset\s+--hard\b/, name: 'git reset --hard' },
      { re: /git\s+clean\s+-fd\b/, name: 'git clean -fd' },
      { re: /Format-Volume\b/i, name: 'Format-Volume' },
      // "format" targeting a drive: the bare word "format" alone is too common
      // (e.g. a -Format parameter) to flag on its own, so this also requires a
      // drive-letter-shaped token (e.g. "D:", "D:\") somewhere in the command.
      { re: /\bformat\b(?=[\s\S]*\b[a-zA-Z]:(?:[\\/]|\s|$))/i, name: 'format (drive)' }
    ];

    const CAUTION_PATTERNS = toolName === 'Bash' ? BASH_CAUTION_PATTERNS : POWERSHELL_CAUTION_PATTERNS;

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
    // Benign Bash/PowerShell: empty stdout (allow).
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
  // F-HK-13: case-fold only on win32 (foldForCompare) - unconditional folding
  // widens matching in the wrong direction on a case-sensitive filesystem.
  const resolvedRoot = resolve(bookRoot);
  const targetNorm = foldForCompare(resolvedTarget);
  const rootNorm = foldForCompare(resolvedRoot);
  const rootPrefix = rootNorm + sep;

  if (targetNorm !== rootNorm && !targetNorm.startsWith(rootPrefix)) {
    emitDeny(
      'Write target ' + resolvedTarget + ' is outside the bible root ' + resolvedRoot +
      '; denied per D-13 (security posture)'
    );
  }

  // Step 3b-2: REAL-PATH re-verification (F-HK-04 symlink containment bypass).
  // The lexical check above resolves the target textually only (resolve() never
  // follows symlinks), so a path component inside the root that symlinks OUTSIDE
  // it passes that check while the write actually lands outside. Re-resolve both
  // sides to their real (symlink-free) paths with fs.realpathSync.native and
  // re-verify containment; deny on mismatch. Unresolvable paths fail closed,
  // matching the existing posture for this guard.
  let realRoot;
  let realTarget;
  try {
    realRoot = realpathSync.native(resolvedRoot);
    realTarget = realpathNearestExisting(resolvedTarget);
  } catch (err) {
    emitDeny(
      'Cannot verify write target is contained in the bible root (real-path resolution failed: ' +
      String(err) + '); denied per D-13 (security posture, fail-closed)'
    );
  }
  // F-HK-13: same platform-conditional folding as the lexical check above.
  const realRootNorm = foldForCompare(realRoot);
  const realTargetNorm = foldForCompare(realTarget);
  const realRootPrefix = realRootNorm + sep;

  if (realTargetNorm !== realRootNorm && !realTargetNorm.startsWith(realRootPrefix)) {
    const symlinkComponent = findSymlinkedComponent(resolvedRoot, resolvedTarget);
    emitDeny(
      'Write target ' + resolvedTarget + ' resolves outside the bible root ' + resolvedRoot +
      ' once symlinks are followed (real path ' + realTarget + ')' +
      (symlinkComponent ? '; symlinked path component: ' + symlinkComponent : '') +
      '; denied per D-13 (security posture, fail-closed)'
    );
  }

  // Step 5: agent write-scope constraint (F-AG-01), now LIVE per ADR-0007
  // (agent identity resolution) and the 2026-08-09 platform probe. Runs AFTER
  // the lexical and real-path containment checks above, so a write already
  // denied for escaping the book root keeps that deny reason (brief 1c-3).
  // Evaluated against realTarget AND realRoot, the F-HK-04 symlink-resolved
  // values computed above, not resolvedTarget/resolvedRoot (the lexical ones)
  // - per the Wave 0 park (brief 1c-1), so a symlink cannot carry a
  // constrained agent's write outside its scope while passing only a lexical
  // check. Both sides must be real, matching the realRootNorm/realTargetNorm
  // comparison immediately above: comparing a real target against a lexical
  // root would misfire if the book root itself is reached via a symlink.
  // checkAgentWriteConstraint's platformOverride defaults to process.platform
  // (F-HK-13 convention).
  const activeAgent = resolveActiveAgent(event);
  const agentDenyReason = checkAgentWriteConstraint(activeAgent, realTarget, realRoot);
  if (agentDenyReason) {
    emitDeny(agentDenyReason);
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
