// what-it-is:   the ns-statusline engine (OPP-P03, studio HUD; ADR-0008, status HUD and CANON 3.5)
// what-it-does: resolves the project directory from a status-line stdin event, locates the book
//               root, reads three small .studio/ JSON files defensively (never throwing), and
//               renders either a single main-status-line string (active chapter and its promise,
//               words versus target, open claims, drift band, gate state token) or, in
//               --subagent mode, one {id, content} JSON row per task this plugin's own agents own.
// why:          the platform statusLine and subagentStatusLine contracts are read-only, stdin-
//               driven, and re-run on every assistant message (see docs/adr/ADR-0008-status-hud.md
//               for the platform constraints that shaped this design); the engine's only job is to
//               read fast and never surface an error into the user's status bar.
// used-by:      bin/ns-statusline
//
// DESIGN INVARIANT: every exported function here is defensive by construction. A missing file,
// malformed JSON, an absent book root, or an unexpected shape in any of the three source files
// (.studio/progress.json, .studio/config.json, .studio/gate/last-gate.json) must never throw past
// this module's boundary. Not in a book project is a normal state, not an error ((local working notes, not published)
// section 3a); this module has no code path that prints a stack trace or an error string.
//
// PERFORMANCE INVARIANT: this module spawns no subprocesses and performs no network I/O. It reads
// at most four small files total (meta.json and config.json via findBookRoot's own loadBible, plus
// progress.json and last-gate.json read independently here) and does no directory walk beyond the
// bounded upward walk findBookRoot already performs to locate the root itself.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findBookRoot } from './bible.mjs';

// Matches .claude-plugin/plugin.json's "name" field and the PLUGIN_NAMESPACE constant in
// hooks/lib/agent-identity.mjs (ADR-0007, agent identity resolution). Duplicated as a literal
// rather than imported: this module owns no dependency on agent-identity.mjs, and the value is
// a stable, already-shipped identifier (the plugin's own name), not something that varies
// per-task or needs a shared mutable source of truth.
export const PLUGIN_NAMESPACE = 'nonfiction-studio';

// Cap on a rendered chapter "promise" clause, so one oversized field cannot dominate a
// single-line status bar. Applies only to the promise string; every other segment is already
// bounded in practice (slugs, titles, and verdict tokens are short by construction).
const PROMISE_MAX_CHARS = 60;

/**
 * Resolves the directory the status line should treat as "current" from a parsed stdin event,
 * per (local working notes, not published) section 3a ("never rely on the process working directory") and recon
 * section Q4 ("read cwd or workspace.current_dir out of the stdin JSON"). Prefers
 * workspace.current_dir (the more specifically named field for "where the session currently is")
 * and falls back to the top-level cwd field; both are documented to carry the same value in the
 * common case. Returns null when neither is a non-empty string, so the caller can degrade to
 * silence rather than falling back to process.cwd().
 *
 * @param {object|null} event - parsed status-line stdin JSON
 * @returns {string|null}
 */
export function resolveProjectDir(event) {
  if (event && event.workspace && typeof event.workspace.current_dir === 'string' && event.workspace.current_dir) {
    return event.workspace.current_dir;
  }
  if (event && typeof event.cwd === 'string' && event.cwd) {
    return event.cwd;
  }
  return null;
}

/**
 * Reads and JSON-parses a file, returning null on ANY failure (missing file, unreadable,
 * malformed JSON) instead of throwing. This is the core of the "degrade to silence" contract
 * for the two files findBookRoot does not itself read (.studio/progress.json and
 * .studio/gate/last-gate.json).
 *
 * @param {string} absPath
 * @returns {object|null}
 */
export function readJsonSafe(absPath) {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Wraps findBookRoot so that ANY failure - no book root found (BibleError NO_BOOK_ROOT), a
 * corrupt meta.json or config.json (BibleError META_READ_ERROR / CONFIG_READ_ERROR), or any
 * other unexpected error - returns null rather than throwing. "Not in a book project is a
 * normal state, not an error" ((local working notes, not published) section 3a) is generalized here to cover every
 * failure mode this function can hit, not only the documented BibleError cases: a status line
 * script runs on every assistant message, so an uncaught exception here would be far more
 * disruptive than in a one-shot CLI invocation.
 *
 * @param {string} startDir
 * @returns {{root: string, meta: object, config: object|null}|null}
 */
export function findRootSafe(startDir) {
  try {
    return findBookRoot(startDir);
  } catch {
    return null;
  }
}

/**
 * Picks the "active" chapter from progress.json's chapters array. progress.json carries no
 * explicit active-chapter marker (verified against templates/book-scaffold/.studio/progress.schema.json
 * and the PostToolBatch hook that writes it); this is a deterministic, documented derivation
 * rule instead (recorded in docs/adr/ADR-0008-status-hud.md and docs/reference/cli/ns-statusline.md):
 *
 *   1. The first chapter (array order, which mirrors structure/chapter-list.md's registry order)
 *      whose status is "drafting" - the status the PostToolBatch hook itself assigns on a
 *      chapter's first write, so "drafting" is a first-class signal of current work.
 *   2. Failing that, the first chapter whose status is not "final" - the earliest chapter still
 *      short of done, a reasonable "what's next" proxy when nothing is mid-draft right now.
 *   3. null when the chapters array is empty, absent, or every chapter is already final.
 *
 * @param {object|null} progress - parsed progress.json, or null
 * @returns {object|null} the chapter entry, or null
 */
export function deriveActiveChapter(progress) {
  if (!progress || !Array.isArray(progress.chapters)) return null;
  const drafting = progress.chapters.find(c => c && c.status === 'drafting');
  if (drafting) return drafting;
  const notFinal = progress.chapters.find(c => c && c.status !== 'final');
  return notFinal || null;
}

/**
 * Reads an optional whole-book word-count target from config.json's `targets.word_count` field.
 *
 * HONEST GAP (see docs/adr/ADR-0008-status-hud.md and the task-3 report): no shipped writer in
 * this codebase populates config.json's `targets` object today. The brief's own worked example
 * of a book-wide target ("Target word count: 30,000 words (full book)") lives as free prose in
 * context/brief.md, not in any JSON file, and config.json's committed shape
 * (templates/config-defaults.json) has no target field at all. This function reads a specific,
 * documented, optional field that config.json's schema already permits
 * (additionalProperties: true is not declared on config.json itself, but nothing validates
 * config.json's shape as closed either) so that a future writer populating it is picked up with
 * no engine change, while today's real projects (which never populate it) render the word count
 * alone. See formatWords.
 *
 * @param {object|null} config - parsed config.json, or null
 * @returns {number|null} a positive integer target, or null
 */
export function deriveWordTarget(config) {
  if (
    config &&
    config.targets &&
    typeof config.targets.word_count === 'number' &&
    Number.isFinite(config.targets.word_count) &&
    config.targets.word_count > 0
  ) {
    return config.targets.word_count;
  }
  return null;
}

/**
 * Formats the word-count segment: "1055w" alone, or "1055/30000w" against a target.
 * Deliberately locale-independent (no thousands separators): this keeps the rendered line
 * byte-for-byte deterministic across environments, matching this codebase's general avoidance
 * of environment-dependent formatting elsewhere (no generation timestamps in deterministic
 * output, etc.), and keeps automated assertions exact-string-matchable.
 *
 * @param {number} wordCount
 * @param {number|null} target
 * @returns {string}
 */
export function formatWords(wordCount, target) {
  if (typeof target === 'number' && target > 0) {
    return wordCount + '/' + target + 'w';
  }
  return wordCount + 'w';
}

/**
 * Derives the gate state token and the drift band from a parsed last-gate.json.
 *
 * Both come from the SAME file by design ((local working notes, not published): "Gate state and drift... from
 * .studio/gate/last-gate.json"): the HUD's job is to surface the verdict AS OF THE LAST GATE
 * RUN continuously between runs, not to recompute a live verdict from progress.json's raw
 * drift_score - recomputing live would defeat the "the studio does work the author cannot see...
 * surfaces only when someone runs a command" motivation this task exists to fix, by silently
 * substituting a different, un-run judgment for the one the author actually asked for.
 *
 *   - gateToken: the top-level `verdict` field, upper-cased ("pass" -> "PASS", "block" -> "BLOCK").
 *   - driftBand: the `verdict` of the `checks[]` entry whose `check` is "stylometry", lower-cased.
 *     Using the existing pass/warn/block/skip vocabulary rather than inventing a new banding
 *     scheme: no other part of this codebase categorizes drift any other way (checked against
 *     hooks/lib/gate-engine.mjs, which only ever compares drift_score to drift_score_max and
 *     emits one of those four verdict tokens).
 *
 * Both are null when lastGate is null, has no string top-level verdict, or (for driftBand only)
 * carries no stylometry entry in checks[].
 *
 * @param {object|null} lastGate - parsed .studio/gate/last-gate.json, or null
 * @returns {{gateToken: string|null, driftBand: string|null}}
 */
export function deriveGateInfo(lastGate) {
  if (!lastGate || typeof lastGate.verdict !== 'string' || lastGate.verdict === '') {
    return { gateToken: null, driftBand: null };
  }
  const gateToken = lastGate.verdict.toUpperCase();
  let driftBand = null;
  if (Array.isArray(lastGate.checks)) {
    const styloCheck = lastGate.checks.find(c => c && c.check === 'stylometry');
    if (styloCheck && typeof styloCheck.verdict === 'string' && styloCheck.verdict !== '') {
      driftBand = styloCheck.verdict.toLowerCase();
    }
  }
  return { gateToken, driftBand };
}

/**
 * Truncates a string to at most maxChars, appending an ellipsis marker when truncated.
 * Defensive formatting only: never affects any comparison or verdict logic.
 *
 * @param {string} s
 * @param {number} maxChars
 * @returns {string}
 */
function truncate(s, maxChars) {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + '…'; // horizontal ellipsis, not three ASCII periods
}

/**
 * Formats the active-chapter segment: the slug (always, since it is schema-required), plus an
 * optional "(title)" clause when a distinct title is present, plus an optional ': "promise"'
 * clause when the chapter carries a `promise` string (see deriveActiveChapter's doc comment and
 * ADR-0008 for why `promise` is an optional, currently-unpopulated field rather than a
 * guaranteed one).
 *
 * Returns null when `slug` is not a non-empty string. Schema-required does not mean
 * schema-guaranteed here: progress.schema.json's own array-item validation could be bypassed by
 * a hand-edited or partially-corrupt-but-still-valid-JSON file, and this function must not turn
 * a missing slug into the literal text "undefined" in the user's status bar.
 *
 * @param {object} chapter - a chapters[] entry, as returned by deriveActiveChapter
 * @returns {string|null}
 */
function formatChapterSegment(chapter) {
  if (typeof chapter.slug !== 'string' || chapter.slug === '') return null;

  let seg = chapter.slug;
  if (typeof chapter.title === 'string' && chapter.title && chapter.title !== chapter.slug) {
    seg += ' (' + chapter.title + ')';
  }
  if (typeof chapter.promise === 'string' && chapter.promise.trim() !== '') {
    seg += ': "' + truncate(chapter.promise.trim(), PROMISE_MAX_CHARS) + '"';
  }
  return seg;
}

/**
 * Composes the full main-status-line string from already-loaded, already-parsed pieces. Every
 * segment is independently optional: a missing or malformed source degrades that ONE segment to
 * "omitted", never the whole line, and this function never throws (each field access is guarded).
 *
 * Segment order: book title | active chapter (+ title, + promise) | words (vs target) |
 * open claims | drift band | gate token. Segments are joined with " | "; an all-empty result is
 * the empty string, which the CLI treats as "print nothing".
 *
 * @param {{meta: object|null, progress: object|null, config: object|null, lastGate: object|null}} ctx
 * @returns {string}
 */
export function renderStatusLine(ctx) {
  const { meta = null, progress = null, config = null, lastGate = null } = ctx || {};
  const parts = [];

  try {
    if (meta && typeof meta.book_title === 'string' && meta.book_title) {
      parts.push(meta.book_title);
    }
  } catch { /* degrade this segment only */ }

  try {
    const chapter = deriveActiveChapter(progress);
    const chapterSeg = chapter ? formatChapterSegment(chapter) : null;
    if (chapterSeg) parts.push(chapterSeg);
  } catch { /* degrade this segment only */ }

  try {
    const totals = (progress && progress.totals && typeof progress.totals === 'object') ? progress.totals : null;
    if (totals && typeof totals.word_count === 'number' && Number.isFinite(totals.word_count)) {
      parts.push(formatWords(totals.word_count, deriveWordTarget(config)));
    }
    if (totals && typeof totals.open_claim_count === 'number' && Number.isFinite(totals.open_claim_count)) {
      parts.push('claims:' + totals.open_claim_count);
    }
  } catch { /* degrade this segment only */ }

  try {
    const { gateToken, driftBand } = deriveGateInfo(lastGate);
    if (driftBand) parts.push('drift:' + driftBand);
    if (gateToken) parts.push('gate:' + gateToken);
  } catch { /* degrade this segment only */ }

  return parts.join(' | ');
}

/**
 * Top-level orchestration for the main status line: resolve the directory from the stdin event,
 * find the book root, read the three small JSON files defensively, and render. Returns the empty
 * string on any failure path (no usable directory, no book root, or an unexpected error while
 * rendering) - the CLI treats an empty string as "print nothing" per (local working notes, not published) section 3a.
 *
 * @param {object} event - parsed status-line stdin JSON
 * @returns {string}
 */
export function buildMainStatusLine(event) {
  const startDir = resolveProjectDir(event);
  if (!startDir) return '';

  const found = findRootSafe(startDir);
  if (!found) return '';

  try {
    const { root, meta, config } = found;
    const progress = readJsonSafe(join(root, '.studio', 'progress.json'));
    const lastGate = readJsonSafe(join(root, '.studio', 'gate', 'last-gate.json'));
    return renderStatusLine({ meta, progress, config, lastGate });
  } catch {
    return '';
  }
}

/**
 * Builds the --subagent mode output: one JSON-serialized {id, content} row per task this
 * plugin's own agents own, per (local working notes, not published) section 3a ("annotate this plugin's own agents
 * with something book-relevant, and leave other agents' rows alone by not emitting for them").
 *
 * Ownership match: a task is "ours" when its `type` field (falling back to `name` when `type`
 * is absent) is a string starting with the `nonfiction-studio:` namespace prefix - the same
 * convention ADR-0007 (agent identity resolution) established for hook envelopes' `agent_type`
 * field. UNVERIFIED (see docs/adr/ADR-0008-status-hud.md and the task-3 report): this repo has
 * no live probe of the subagentStatusLine `tasks[]` shape the way ADR-0007 had for hook
 * envelopes; the field names are taken from (local working notes, not published)'s documented list.
 *
 * Row content, kept modest per the brief: the agent's own slug (the part after the namespace
 * prefix), plus the active chapter slug and the gate token when that task's own `cwd` resolves
 * to a book root with data to show. A task with no book root under its cwd, or no `id` string,
 * is skipped entirely (no row emitted) rather than emitting an empty-content row, so the
 * platform's default row still applies for that task.
 *
 * @param {object} event - parsed subagentStatusLine stdin JSON ({columns, tasks: [...]})
 * @returns {string[]} zero or more JSON-stringified {id, content} lines, one per owned task
 */
export function buildSubagentLines(event) {
  const tasks = Array.isArray(event && event.tasks) ? event.tasks : [];
  const lines = [];

  for (const task of tasks) {
    if (!task || typeof task.id !== 'string' || task.id === '') continue;

    const identity =
      (typeof task.type === 'string' && task.type) ? task.type :
      (typeof task.name === 'string' && task.name) ? task.name : '';
    if (!identity.startsWith(PLUGIN_NAMESPACE + ':')) continue;

    const startDir = (typeof task.cwd === 'string' && task.cwd) ? task.cwd : null;
    if (!startDir) continue;

    const found = findRootSafe(startDir);
    if (!found) continue;

    try {
      const progress = readJsonSafe(join(found.root, '.studio', 'progress.json'));
      const lastGate = readJsonSafe(join(found.root, '.studio', 'gate', 'last-gate.json'));
      const chapter = deriveActiveChapter(progress);
      const { gateToken } = deriveGateInfo(lastGate);

      const segs = [identity.slice(PLUGIN_NAMESPACE.length + 1)];
      if (chapter && typeof chapter.slug === 'string' && chapter.slug !== '') {
        segs.push('ch ' + chapter.slug);
      }
      if (gateToken) segs.push('gate:' + gateToken);

      lines.push(JSON.stringify({ id: task.id, content: segs.join(' - ') }));
    } catch {
      // Degrade this one row only: skip it, leaving the platform's default row in place.
    }
  }

  return lines;
}
