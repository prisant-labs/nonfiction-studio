// what-it-is:   shared five-element orientation block builder (TSK-035 extraction)
// what-it-does: assembles the gate-debt line, thesis one-liner, active-chapter slug and title,
//               top three style rules, and open-claims count into a single newline-joined block
//               string; returns the block and the book title for sessionTitle use; each element
//               is fail-open (any read or parse error logs one JSONL record to
//               .studio/logs/errors.jsonl and the element is omitted from the block).
// why:          one implementation, two callers (session-start.mjs and pre-compact.mjs);
//               the equality of their additionalContext outputs proves shared code.
// used-by:      hooks/session-start.mjs, hooks/pre-compact.mjs

import { readFileSync, appendFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readProgress } from './bible.mjs';
import { parseEvidenceLog, resolvedStatuses } from './ledger.mjs';

/**
 * Appends one JSONL error record to .studio/logs/errors.jsonl.
 * Fail-open: never throws. Only callable after a book root is confirmed.
 *
 * @param {string} root     - absolute path to the book root
 * @param {string} hookName - calling hook name; written as the "hook" field in the record
 * @param {string} msg      - short description of what failed
 * @param {unknown} err     - the caught error value
 */
function logError(root, hookName, msg, err) {
  try {
    const logsDir = join(root, '.studio', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      hook: hookName,
      msg,
      err: String(err)
    });
    appendFileSync(join(logsDir, 'errors.jsonl'), record + '\n', 'utf8');
  } catch {
    // Cannot write the error log; nothing further to do.
  }
}

/**
 * Assembles the five-element orientation block.
 *
 * Elements (in specification order):
 *   1. Gate debt: present when .studio/gate/last-gate.json is absent or its newest ts
 *      predates the most recent chapters/*.md mtime.
 *   2. Thesis one-liner: from context/brief.md, first non-empty non-heading line under
 *      the "## 2. Thesis" heading.
 *   3. Active chapter and title: from .studio/progress.json; last chapter with a working
 *      status (outlined, drafting, drafted, revised), falling back to the last chapter.
 *   4. Top three style rules: first three bullet lines from context/style-profile.md
 *      "## Do" and "## Do not" sections, in document order.
 *   5. Open-claims count: from research/evidence-log.md; count of entries whose status is
 *      not in resolvedStatuses (verified, interpretation).
 *
 * Each element is fail-open: a read or parse error logs one JSONL line to
 * .studio/logs/errors.jsonl and the element is omitted from the returned block.
 *
 * @param {string}      root     - absolute path to the confirmed book root
 * @param {object|null} meta     - meta object from findBookRoot (provides book_title for callers)
 * @param {string}      hookName - calling hook name (used in errors.jsonl records)
 * @returns {{ block: string, bookTitle: string|null, hasActiveChapter: boolean }}
 *   hasActiveChapter is true when element 3 resolved a chapter entry; pre-compact uses this
 *   for its stricter no-op (empty stdout when false) without duplicating the check logic.
 */
export function buildOrientation(root, meta, hookName) {
  const lines = [];
  let hasActiveChapter = false;

  // --- Element 1: Gate debt ---------------------------------------------------
  // Debt is present when last-gate.json is absent (gateTsMs 0) or its newest ts
  // is older than the most recent chapters/*.md mtime.
  try {
    const lastGatePath = join(root, '.studio', 'gate', 'last-gate.json');
    const chaptersDir = join(root, 'chapters');

    let gateTsMs = 0; // 0 means absent or unreadable
    try {
      const lastGate = JSON.parse(readFileSync(lastGatePath, 'utf8'));
      for (const entry of Object.values(lastGate)) {
        if (entry && typeof entry.ts === 'string') {
          const ms = Date.parse(entry.ts);
          if (Number.isFinite(ms) && ms > gateTsMs) gateTsMs = ms;
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
      // No chapters directory or unreadable: skip debt check.
    }

    if (maxChapterMtimeMs > 0 && gateTsMs < maxChapterMtimeMs) {
      lines.push(
        'Gate debt: last-gate.json is missing or predates a chapter write; ' +
        'run run-quality-gate to clear the debt.'
      );
    }
  } catch (err) {
    logError(root, hookName, 'gate-debt check failed', err);
  }

  // --- Element 2: Thesis one-liner from context/brief.md ----------------------
  // Extraction rule: first non-empty, non-heading line after the "## 2. Thesis" heading.
  try {
    const briefPath = join(root, 'context', 'brief.md');
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
    if (thesis) lines.push('Thesis: ' + thesis);
  } catch (err) {
    logError(root, hookName, 'thesis read failed', err);
  }

  // --- Element 3: Active chapter and title from .studio/progress.json ---------
  // Active = last chapter with a working status; falls back to last chapter in array.
  try {
    const progress = readProgress(root);
    const chapters = Array.isArray(progress.chapters) ? progress.chapters : [];
    const workingStatuses = new Set(['outlined', 'drafting', 'drafted', 'revised']);
    let active = [...chapters].reverse().find(ch => workingStatuses.has(ch.status));
    if (!active) active = chapters[chapters.length - 1];
    if (active) {
      hasActiveChapter = true;
      const slug = active.slug || '(unknown)';
      const title = active.title || slug;
      lines.push('Active chapter: ' + slug + ' - ' + title);
    }
  } catch (err) {
    logError(root, hookName, 'progress read failed', err);
  }

  // --- Element 4: Top three style rules from context/style-profile.md ---------
  // Extraction rule (S-08 section 9 format): collect bullet lines (starting with "- ")
  // under "## Do" and "## Do not" headings in document order; take first three.
  try {
    const stylePath = join(root, 'context', 'style-profile.md');
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
    logError(root, hookName, 'style-profile read failed', err);
  }

  // --- Element 5: Open-claims count from research/evidence-log.md -------------
  // Count entries whose status is not in resolvedStatuses (the sole authority from ledger.mjs).
  try {
    const logPath = join(root, 'research', 'evidence-log.md');
    const logText = readFileSync(logPath, 'utf8');
    const entries = parseEvidenceLog(logText);
    const openCount = entries.filter(e => !resolvedStatuses.has(e.status)).length;
    lines.push('Open claims: ' + openCount);
  } catch (err) {
    logError(root, hookName, 'evidence-log read failed', err);
  }

  const bookTitle = (meta && typeof meta.book_title === 'string') ? meta.book_title : null;
  return { block: lines.join('\n'), bookTitle, hasActiveChapter };
}
