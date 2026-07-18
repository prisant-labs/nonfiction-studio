// what-it-is:   SessionStart orientation hook; replaces the TSK-030 stub per TSK-031 (session-start hook)
// what-it-does: reads the platform SessionStart event from stdin, locates the book root via
//               findBookRoot (the sole authority), assembles a five-element orientation block
//               (gate debt, thesis one-liner, active chapter and title, top three style rules,
//               open-claims count) and emits hookSpecificOutput.additionalContext with sessionTitle.
//               When no book root is found the script emits a two-sentence D-17 (guided front door)
//               empty-state message instead. Fail-open: any read or parse error after root detection
//               appends one JSONL record to .studio/logs/errors.jsonl and the script continues with
//               whatever partial block it has assembled. Exits 0 unconditionally.
//
// stdin:  platform SessionStart event (snake_case: session_id, transcript_path, cwd,
//         hook_event_name, source) - verified live by TSK-030 (hooks.json Phase 1 wiring)
// stdout: {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<block>",
//          "sessionTitle":"<book title>"}}  (PF-10 verified surface; no sessionTitle on empty-state path)
//
// NS_HOOK_TRACE: when set, appends one trace line (event, own path, raw stdin) to the named file
//                before any other logic; inert when unset (preserved from TSK-030 stub convention)

import { readFileSync, appendFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBookRoot, readProgress } from './lib/bible.mjs';
import { parseEvidenceLog, resolvedStatuses } from './lib/ledger.mjs';

// ---------------------------------------------------------------------------
// Drain stdin first - the platform delivers event JSON here on every invocation.
// ---------------------------------------------------------------------------
const raw = readFileSync(0, 'utf8');

// ---------------------------------------------------------------------------
// NS_HOOK_TRACE (opt-in firing proof, preserved from TSK-030 stub convention).
// ---------------------------------------------------------------------------
if (process.env.NS_HOOK_TRACE) {
  const ownPath = fileURLToPath(import.meta.url);
  const record = JSON.stringify({ event: 'SessionStart', script: ownPath, stdinRaw: raw.trim() });
  appendFileSync(process.env.NS_HOOK_TRACE, record + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Parse stdin - snake_case per the TSK-030 resolved field names.
// Tolerate missing or malformed JSON (fail-open: treat as empty event).
// ---------------------------------------------------------------------------
let event = {};
try {
  event = JSON.parse(raw);
} catch {
  // Malformed stdin: proceed with empty event; cwd falls back to process.cwd().
}

// cwd field drives book detection; fall back to process.cwd() when absent.
const cwd = (typeof event.cwd === 'string' && event.cwd) ? event.cwd : process.cwd();

// ---------------------------------------------------------------------------
// Helper: append a single JSONL error record to .studio/logs/errors.jsonl.
// Only callable once a book root is known.
// This is the ONLY write this script may make (besides the NS_HOOK_TRACE path).
// ---------------------------------------------------------------------------
function logError(root, msg, err) {
  try {
    const logsDir = join(root, '.studio', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      hook: 'SessionStart',
      msg,
      err: String(err)
    });
    appendFileSync(join(logsDir, 'errors.jsonl'), record + '\n', 'utf8');
  } catch {
    // Cannot write the error log; nothing further to do.
  }
}

// ---------------------------------------------------------------------------
// Book detection - findBookRoot is the sole authority per TSK-031 controller resolution 3.
// Null root (thrown) means empty-state path.
// ---------------------------------------------------------------------------
let bookRoot = null;
let meta = null;
try {
  const found = findBookRoot(cwd);
  bookRoot = found.root;
  meta = found.meta;
} catch {
  // No book root found; take the empty-state path below.
}

if (!bookRoot) {
  // D-17 (guided front door): exactly two sentences.
  // Sentence 1: states no book project exists here.
  // Sentence 2: names the way in via the init-project flow through the studio skill.
  const emptyMsg =
    'No book project was found in this directory. ' +
    'To start one, run the init-project flow through the studio skill.';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: emptyMsg
      }
    }) + '\n'
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Five orientation elements assembled in specification order.
// Each element runs in its own try/catch so a single failure cannot suppress the others.
// ---------------------------------------------------------------------------
const lines = [];

// --- Element 1: Gate debt ---------------------------------------------------
// Gate debt is present when last-gate.json is absent or its newest "ts" value
// (across all chapter entries in the map) is older than the most recent
// chapters/*.md mtime. Extraction rule (stated for fail-open auditability):
//   - Read .studio/gate/last-gate.json as JSON; derive gate_ts_ms as the
//     maximum Date.parse(entry.ts) across all Object.values of the map.
//     A missing or unreadable file leaves gate_ts_ms at 0 (absent state).
//   - stat each file in chapters/ matching "*.md"; compute max mtime.
//   - If max_chapter_mtime_ms > 0 and gate_ts_ms < max_chapter_mtime_ms,
//     emit the debt line naming run-quality-gate as the remediation action.
try {
  const lastGatePath = join(bookRoot, '.studio', 'gate', 'last-gate.json');
  const chaptersDir = join(bookRoot, 'chapters');

  let gateTsMs = 0; // 0 means absent or unreadable
  try {
    const lastGate = JSON.parse(readFileSync(lastGatePath, 'utf8'));
    for (const entry of Object.values(lastGate)) {
      if (entry && typeof entry.ts === 'string') {
        const ms = Date.parse(entry.ts);
        if (Number.isFinite(ms) && ms > gateTsMs) {
          gateTsMs = ms;
        }
      }
    }
  } catch {
    // Missing or unreadable last-gate.json: gateTsMs stays 0 (no gate on record).
  }

  let maxChapterMtimeMs = 0;
  try {
    const chapterFiles = readdirSync(chaptersDir).filter(f => f.endsWith('.md'));
    for (const f of chapterFiles) {
      const mtimeMs = statSync(join(chaptersDir, f)).mtimeMs;
      if (mtimeMs > maxChapterMtimeMs) maxChapterMtimeMs = mtimeMs;
    }
  } catch {
    // No chapters directory or unreadable: skip debt check, no max mtime.
  }

  if (maxChapterMtimeMs > 0 && gateTsMs < maxChapterMtimeMs) {
    lines.push(
      'Gate debt: last-gate.json is missing or predates a chapter write; ' +
      'run run-quality-gate to clear the debt.'
    );
  }
} catch (err) {
  logError(bookRoot, 'gate-debt check failed', err);
}

// --- Element 2: Thesis one-liner from context/brief.md ---------------------
// Extraction rule: find the first line equal to "## 2. Thesis" (trimmed),
// then take the next non-empty, non-heading line. Fail-open to omission if
// the file or the section heading is absent.
try {
  const briefPath = join(bookRoot, 'context', 'brief.md');
  const briefLines = readFileSync(briefPath, 'utf8').split('\n');
  let thesis = null;
  let inThesis = false;
  for (const line of briefLines) {
    if (line.trim() === '## 2. Thesis') {
      inThesis = true;
      continue;
    }
    if (inThesis) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        thesis = trimmed;
        break;
      }
    }
  }
  if (thesis) {
    lines.push('Thesis: ' + thesis);
  }
} catch (err) {
  logError(bookRoot, 'thesis read failed', err);
}

// --- Element 3: Active chapter and its promise from .studio/progress.json --
// Extraction rule: via readProgress; the "promise" is the chapter title field
// (the closest committed field name to what a chapter promises the reader).
// Active chapter = the last chapter in the chapters array with status in
// [outlined, drafting, drafted, revised], falling back to the last chapter
// in the array when none match those statuses.
try {
  const progress = readProgress(bookRoot);
  const chapters = Array.isArray(progress.chapters) ? progress.chapters : [];
  const workingStatuses = new Set(['outlined', 'drafting', 'drafted', 'revised']);
  let active = [...chapters].reverse().find(ch => workingStatuses.has(ch.status));
  if (!active) active = chapters[chapters.length - 1];
  if (active) {
    const slug = active.slug || '(unknown)';
    const title = active.title || slug;
    lines.push('Active chapter: ' + slug + ' - ' + title);
  }
} catch (err) {
  logError(bookRoot, 'progress read failed', err);
}

// --- Element 4: Top three style rules from context/style-profile.md --------
// Extraction rule (S-08 section 9 format): collect bullet lines (lines starting
// with "- ") that appear under the "## Do" heading first, then under the
// "## Do not" heading, in document order. Take the first three across both
// sections. Any other heading exits both collection windows.
try {
  const stylePath = join(bookRoot, 'context', 'style-profile.md');
  const styleLines = readFileSync(stylePath, 'utf8').split('\n');
  const rules = [];
  let inRuleSection = false;
  for (const line of styleLines) {
    const trimmed = line.trim();
    if (trimmed === '## Do' || trimmed === '## Do not') {
      inRuleSection = true;
      continue;
    }
    if (trimmed.startsWith('## ') && trimmed !== '## Do' && trimmed !== '## Do not') {
      inRuleSection = false;
      continue;
    }
    if (inRuleSection && line.startsWith('- ')) {
      rules.push(line.slice(2).trim());
      if (rules.length === 3) break;
    }
  }
  if (rules.length > 0) {
    const formatted = rules.map((r, i) => '(' + (i + 1) + ') ' + r).join(' ');
    lines.push('Style rules: ' + formatted);
  }
} catch (err) {
  logError(bookRoot, 'style-profile read failed', err);
}

// --- Element 5: Open-claims count from research/evidence-log.md ------------
// Extraction rule: parseEvidenceLog on the file text; count entries whose
// status is NOT in resolvedStatuses (the sole authority from ledger.mjs;
// no local status list). resolvedStatuses = new Set(['verified', 'interpretation']).
try {
  const logPath = join(bookRoot, 'research', 'evidence-log.md');
  const logText = readFileSync(logPath, 'utf8');
  const entries = parseEvidenceLog(logText);
  const openCount = entries.filter(e => !resolvedStatuses.has(e.status)).length;
  lines.push('Open claims: ' + openCount);
} catch (err) {
  logError(bookRoot, 'evidence-log read failed', err);
}

// ---------------------------------------------------------------------------
// Compose and emit output JSON (PF-10 verified surface: additionalContext + sessionTitle).
// Nothing else may appear on stdout.
// ---------------------------------------------------------------------------
const output = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n')
  }
};

// sessionTitle from meta.json book_title field (fail-open: omit when unreadable or absent).
if (meta && typeof meta.book_title === 'string') {
  output.hookSpecificOutput.sessionTitle = meta.book_title;
}

process.stdout.write(JSON.stringify(output) + '\n');
process.exit(0);
