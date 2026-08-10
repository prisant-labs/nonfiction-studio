// what-it-is:   Stop hook command entry - deterministic quality gate layer per TSK-034
// what-it-does: reads the platform Stop event from stdin, applies the three short-circuit
//               conditions in exact order (re-fire / no book root / flag absent), then
//               invokes bin/ns-gate as a subprocess and maps the exit code to block / warn /
//               pass output; writes last-gate.json atomically and consumes the session-write flag.
//
// ALWAYS exits 0. Blocking travels ONLY in the decision JSON per PF-01 (Stop blocking contract).
// A non-zero hook exit would be a hook failure, not a gate verdict. This comment is the
// authoritative statement of the always-exit-0 rule for this script.
//
// stdin:  platform Stop event (snake_case: session_id, transcript_path, cwd, prompt_id,
//         permission_mode, effort, hook_event_name, stop_hook_active, last_assistant_message,
//         background_tasks, session_crons) - field names verified live by TSK-030
// stdout: empty (no-op) | block decision JSON | additionalContext warn | additionalContext error
//
// Short-circuit order (S-07 section 2 Stop, internal steps 0-2):
//   0. stop_hook_active === true -> exit 0, no output, gate not run, flag not consumed
//   1. findBookRoot null         -> exit 0, no output, gate not run, flag not consumed
//   2. session-write flag absent -> exit 0, no output, gate not run, flag not consumed
//   Only after passing all three checks: run bin/ns-gate.
//
// Exit-code mapping (S-07 step 3):
//   exit 1          -> decision: "block" with reason from the report's blocking checks
//   exit 0, warn    -> additionalContext with warn summary in per-check compact form
//   exit 0, pass/skip -> empty stdout (silent success)
//   exit 2 or error -> errors.jsonl + one-line additionalContext (fall-through visible)
//
// Writes:
//   .studio/gate/last-gate.json  - verbatim gate stdout via temp+rename (step 4)
//   .studio/gate/.session-write-flag (deleted, step 5)
//   .studio/logs/errors.jsonl    - appended on error path only
//   NS_HOOK_TRACE path           - opt-in only
//
// NS_HOOK_TRACE: when set, appends one trace line (event, own path, raw stdin) to the named file
//                before any other logic; inert when unset (preserved from TSK-030 stub convention)

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  unlinkSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { findBookRoot } from './lib/bible.mjs';
import { ALL_FLAGS } from './lib/gate-engine.mjs';

// ---------------------------------------------------------------------------
// Drain stdin - the platform delivers event JSON here on every invocation.
// ---------------------------------------------------------------------------
const raw = readFileSync(0, 'utf8');

// ---------------------------------------------------------------------------
// NS_HOOK_TRACE (opt-in firing proof, preserved from TSK-030 stub convention).
// Inert when unset.
// ---------------------------------------------------------------------------
if (process.env.NS_HOOK_TRACE) {
  const ownPath = fileURLToPath(import.meta.url);
  const record = JSON.stringify({ event: 'Stop', script: ownPath, stdinRaw: raw.trim() });
  appendFileSync(process.env.NS_HOOK_TRACE, record + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Parse stdin. Malformed JSON: exit 0 (fail-open; cannot identify the event).
// ---------------------------------------------------------------------------
let event = {};
try {
  event = JSON.parse(raw);
} catch {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// SHORT-CIRCUIT 0: stop_hook_active true -> re-fire from a stop-hook-generated turn.
// RE-FIRE SEMANTICS (verified live by TSK-030): Stop fires once with stop_hook_active: false at
// natural session end, then AGAIN with stop_hook_active: true for each stop-hook-generated turn
// (the prompt handler produced two such fires in the probe). Running the gate on re-fires would
// produce duplicate records. Exit 0 immediately: no output, gate NOT run, flag NOT consumed.
// ---------------------------------------------------------------------------
if (event.stop_hook_active === true) {
  process.exit(0);
}

// cwd from the event envelope (snake_case per TSK-030 resolved field names).
const cwd = (typeof event.cwd === 'string' && event.cwd) ? event.cwd : process.cwd();

// ---------------------------------------------------------------------------
// SHORT-CIRCUIT 1: no book root found -> no studio bible project in scope.
// Exit 0 with no output. Gate NOT run.
//
// Error discrimination: BibleError code NO_BOOK_ROOT is normal (no book root
// anywhere in the ancestor chain); stays silent, exit 0, gate not run.
// Any other BibleError (CONFIG_READ_ERROR, META_READ_ERROR, etc.) means a
// book root was found but its bible files are corrupt. The gate is still
// skipped (fail-open), but one visible additionalContext line is emitted so
// the author knows config repair is needed. The flag is NOT consumed on
// either path (the gate never answered).
// ---------------------------------------------------------------------------
let bookRoot = null;
try {
  const found = findBookRoot(cwd);
  bookRoot = found.root;
} catch (err) {
  if (err && err.code && err.code !== 'NO_BOOK_ROOT') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: 'Gate skipped: ' + err.message
      }
    }) + '\n');
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// SHORT-CIRCUIT 2: session-write flag absent -> no chapter content written this session.
// Exit 0 with no output. Gate NOT run. Flag NOT consumed (it was never present).
// The flag is written by pre-tool-use.mjs when a chapter file is written; its absence
// means no gate-worthy writes occurred.
// ---------------------------------------------------------------------------
const flagPath = join(bookRoot, '.studio', 'gate', '.session-write-flag');
if (!existsSync(flagPath)) {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// All three short-circuit conditions passed. The gate runs from here on.
// ---------------------------------------------------------------------------

// Helper: append one JSONL error record to .studio/logs/errors.jsonl.
// Fail-open; never throws. The error log is the ONLY side channel for
// operational failures; it must never suppress the primary output.
function logError(msg, err) {
  try {
    const logsDir = join(bookRoot, '.studio', 'logs');
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(
      join(logsDir, 'errors.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hook: 'StopGate',
        msg,
        err: String(err)
      }) + '\n',
      'utf8'
    );
  } catch {
    // Cannot write error log; nothing further to do.
  }
}

// Resolve the absolute path to bin/ns-gate from this script's location.
// hooks/stop-gate.mjs -> hooks/ -> ../bin/ns-gate
// Using import.meta.url preserves the correct path after plugin installation.
const ownDir = fileURLToPath(new URL('.', import.meta.url));
const nsGatePath = resolve(ownDir, '..', 'bin', 'ns-gate');

// Spawn bin/ns-gate as a subprocess (Windows-safe: node spawns node directly, no shell).
// The hook passes --project to avoid relying on cwd; --json for machine-readable output.
// The hook reads NO gate config and resolves NO check modes: the policy layer lives inside
// ns-gate per TSK-029 (ns-gate orchestrator). Grep-proof: no config.json read in this file.
//
// --check is DERIVED from hooks/lib/gate-engine.mjs's own ALL_FLAGS (CHECK_REGISTRY's flag
// column), not a second, independently-hardcoded list. Before this fix the list here was
// "claims,stylometry,scrub,continuity-quick,coherence", written by hand and never updated
// when the quote_fidelity check (flag "quotes", roadmap row 1.5, quote fidelity and source
// packets) was registered in CHECK_REGISTRY: bin/ns-gate invoked with no --check flag always
// ran every registered check, but this hook's hardcoded copy silently fell out of sync, so
// quote_fidelity never fired in the actual product flow, only via a direct bin/ns-gate call.
// Deriving the list here closes that drift class the same way ADR-0007 (agent identity
// resolution) closed the platform's independent agent-list duplication.
const gateResult = spawnSync(
  process.execPath,
  [
    nsGatePath,
    '--check=' + ALL_FLAGS.join(','),
    '--project=' + bookRoot,
    '--json'
  ],
  { encoding: 'utf8', env: process.env }
);

const gateExitCode = gateResult.status;

// Parse the gate report from stdout.
// A spawn error (gateResult.error set) or unparseable stdout is treated as exit 2.
let report = null;
if (!gateResult.error) {
  try {
    const out = (gateResult.stdout || '').trim();
    if (out) {
      report = JSON.parse(out);
    }
  } catch {
    // Unparseable stdout: treated as exit 2 in the mapping below.
  }
}

// S-07 step 4: Write the gate report VERBATIM to .studio/gate/last-gate.json via temp+rename.
// Done on every gate run when a parseable report was produced (exits 0, 1, and 2 alike).
// Skipped when report is null (exit 2 with no parseable output).
// The verbatim copy preserves the ts field session-start's gate-debt check reads.
if (report !== null) {
  try {
    const gateDir = join(bookRoot, '.studio', 'gate');
    mkdirSync(gateDir, { recursive: true });
    const tmpPath = join(gateDir, 'last-gate.tmp.json');
    const stablePath = join(gateDir, 'last-gate.json');
    // gateResult.stdout is exactly what ns-gate emitted: JSON.stringify(report, null, 2) + '\n'
    writeFileSync(tmpPath, gateResult.stdout, 'utf8');
    renameSync(tmpPath, stablePath);
  } catch (err) {
    logError('last-gate.json write failed', err);
  }
}

// S-07 step 5: Consume the session-write flag after the gate run. Fail-open.
// The flag is session-consumed: the gate has answered for this session's writes.
// A later chapter write re-creates it. Delete failure is logged and the hook still exits 0.
try {
  unlinkSync(flagPath);
} catch (err) {
  logError('session-write flag deletion failed', err);
}

// ---------------------------------------------------------------------------
// Exit-code mapping (S-07 step 3).
// The hook maps the subprocess result only; it re-implements nothing:
// the policy layer lives inside ns-gate per TSK-029 (ns-gate orchestrator).
// ---------------------------------------------------------------------------

// Exit 2 (or spawn error or unparseable stdout): log to errors.jsonl and emit a single
// visible additionalContext line so the fall-through is not silent.
if (gateResult.error || gateExitCode === 2 || report === null) {
  const errDetail = gateResult.error
    ? String(gateResult.error.message)
    : ((gateResult.stderr || '').trim().split('\n')[0] || 'gate subprocess exited with code ' + gateExitCode);
  logError('ns-gate error', errDetail);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: 'Gate error (exit 2): ' + errDetail
      }
    }) + '\n'
  );
  process.exit(0);
}

// Exit 1: final verdict is block. Build the reason from the report's blocking checks.
// One compact line per blocking check: check name plus its detail.
if (gateExitCode === 1) {
  const blockingChecks = Array.isArray(report.checks)
    ? report.checks.filter(c => c.verdict === 'block')
    : [];
  const reason = blockingChecks.length > 0
    ? blockingChecks.map(c => c.check + ': ' + c.detail).join('\n')
    : 'gate blocked; see .studio/gate/last-gate.json for details';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        decision: 'block',
        reason
      }
    }) + '\n'
  );
  process.exit(0);
}

// Exit 0: check the top-level verdict.
const verdict = (report && typeof report.verdict === 'string') ? report.verdict : 'pass';

if (verdict === 'warn') {
  // Emit additionalContext with a warn summary in the same per-check compact form as block reasons.
  // Include checks with any non-passing verdict (warn or block) so the author sees the full picture.
  const warnChecks = Array.isArray(report.checks)
    ? report.checks.filter(c => c.verdict === 'warn' || c.verdict === 'block')
    : [];
  const summary = warnChecks.length > 0
    ? warnChecks.map(c => c.check + ': ' + c.detail).join('\n')
    : 'gate warn; see .studio/gate/last-gate.json for details';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: 'Gate warn:\n' + summary
      }
    }) + '\n'
  );
  process.exit(0);
}

// Pass or skip: empty stdout (silent success). The gate ran and found nothing to report.
process.exit(0);
