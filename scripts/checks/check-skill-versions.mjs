#!/usr/bin/env node
// scripts/checks/check-skill-versions.mjs
// what-it-is:   Tier A checker for per-skill versioning (ADR-0017, per-skill versioning): every
//               skill carries its own semver in frontmatter and a HISTORY.md beside it, and a skill
//               that changed since the last release says so
// what-it-does: asserts, for every skills/<name>/SKILL.md:
//                 R1. the frontmatter carries a `metadata:` map whose `version` is a quoted
//                     MAJOR.MINOR.PATCH string and whose `updated` is a YYYY-MM-DD date;
//                 R2. skills/<name>/HISTORY.md exists, opens its table with the header
//                     HISTORY_HEADER below, and its first data row carries exactly that version
//                     and that date;
//                 R3. every row is well formed: a semver, a date, a Release cell that is
//                     `unreleased` or a `vMAJOR.MINOR.PATCH` tag, a Type from HISTORY_TYPES, and a
//                     non-empty summary. Versions strictly descend down the table, dates never
//                     increase, and only the first row may say `unreleased`;
//                 R4. (git mode only) a skill whose directory differs from the latest reachable
//                     `v*.*.*` tag, or that did not exist at that tag, has a first row whose
//                     Release is `unreleased` or a tag newer than the latest one (a release being
//                     prepared). A changed skill that still claims an already-released version is
//                     the defect this rule exists to catch.
//               With `--release vX.Y.Z` (release.yml, on a tag push), R4 is replaced by R5: no
//               row anywhere may still say `unreleased`, and no row may name a release newer than
//               the tag being published.
// why:          ADR-0017 (per-skill versioning) - Standard 0.12 section 7.3, which this plugin
//               pins, says every component MUST carry `metadata.version`, and no shipped check
//               enforced it. A version that is never compared against history drifts silently,
//               so R4 ties the version to what git says changed.
// modes:        git mode when REPO_ROOT holds a .git directory and a `v*.*.*` tag is reachable.
//               Otherwise R4 is skipped with a named line, EXCEPT under CI (CI=true), where a
//               missing history means the checkout is too shallow and the check would be blind:
//               that is an operational error (exit 2), not a pass. tier-a.yml checks out with
//               fetch-depth 0 for this reason. Release mode never needs history.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseMiniYaml } from '../../hooks/lib/mini-yaml.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

const PREFIX = '[check-skill-versions]';
const HISTORY_HEADER = '| Version | Date | Release | Type | Summary |';
const HISTORY_TYPES =['added', 'changed', 'fixed', 'removed', 'deprecated', 'security'];

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FENCE_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function fatal(message) {
  process.stderr.write(PREFIX + ' FATAL: ' + message + '\n');
  process.exit(2);
}

function out(line) {
  process.stdout.write(PREFIX + ' ' + line + '\n');
}

/** Numeric triple from "1.2.3" or "v1.2.3"; null when the text is neither. */
function triple(text) {
  const m = SEMVER_RE.exec(text) || TAG_RE.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function parseArgs(argv) {
  const args = { release: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--release') {
      const tag = argv[i + 1];
      if (!tag || !TAG_RE.test(tag)) fatal('--release needs a tag of the form vMAJOR.MINOR.PATCH; got: ' + String(tag));
      args.release = tag;
      i++;
    } else {
      fatal('unknown argument: ' + argv[i] + ' (usage: check-skill-versions.mjs [--release vX.Y.Z])');
    }
  }
  return args;
}

/** Skill directory names, sorted by plain code-unit comparison (never localeCompare). */
function skillNames() {
  if (!existsSync(SKILLS_DIR)) fatal('no skills/ directory under ' + REPO_ROOT);
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** R1: the metadata block. Returns {version, updated} or null after recording findings. */
function readMetadata(name, findings) {
  const rel = 'skills/' + name + '/SKILL.md';
  const m = FENCE_RE.exec(readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8'));
  if (!m) {
    findings.push(rel + ': no YAML frontmatter block (R1)');
    return null;
  }
  let fm;
  try {
    fm = parseMiniYaml(m[1]);
  } catch (err) {
    findings.push(rel + ': frontmatter does not parse: ' + err.message + ' (R1)');
    return null;
  }
  const meta = fm && fm.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    findings.push(rel + ': frontmatter has no `metadata:` map carrying version and updated (R1)');
    return null;
  }
  let ok = true;
  if (typeof meta.version !== 'string' || !SEMVER_RE.test(meta.version)) {
    findings.push(rel + ': metadata.version must be a quoted MAJOR.MINOR.PATCH string; got: ' + JSON.stringify(meta.version) + ' (R1)');
    ok = false;
  }
  if (typeof meta.updated !== 'string' || !DATE_RE.test(meta.updated)) {
    findings.push(rel + ': metadata.updated must be a YYYY-MM-DD date; got: ' + JSON.stringify(meta.updated) + ' (R1)');
    ok = false;
  }
  return ok ? { version: meta.version, updated: meta.updated } : null;
}

/** R2 and R3: the history table. Returns its rows (possibly empty) after recording findings. */
function readHistory(name, meta, findings) {
  const rel = 'skills/' + name + '/HISTORY.md';
  const path = join(SKILLS_DIR, name, 'HISTORY.md');
  if (!existsSync(path)) {
    findings.push(rel + ': missing; every skill keeps its version history beside its SKILL.md (R2)');
    return [];
  }
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === HISTORY_HEADER);
  if (start < 0) {
    findings.push(rel + ': no table header line equal to "' + HISTORY_HEADER + '" (R2)');
    return [];
  }
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    rows.push({ line: i + 1, cells });
  }
  if (rows.length === 0) {
    findings.push(rel + ': the table has no rows (R2)');
    return [];
  }

  const parsed = [];
  for (const { line, cells } of rows) {
    const where = rel + ':' + line;
    if (cells.length !== 5) {
      findings.push(where + ': a row needs 5 cells (Version, Date, Release, Type, Summary); found ' + cells.length + ' (R3)');
      continue;
    }
    const [version, date, release, type, summary] = cells;
    let ok = true;
    if (!SEMVER_RE.test(version)) { findings.push(where + ': version "' + version + '" is not MAJOR.MINOR.PATCH (R3)'); ok = false; }
    if (!DATE_RE.test(date)) { findings.push(where + ': date "' + date + '" is not YYYY-MM-DD (R3)'); ok = false; }
    if (release !== 'unreleased' && !TAG_RE.test(release)) { findings.push(where + ': release "' + release + '" is neither `unreleased` nor a vMAJOR.MINOR.PATCH tag (R3)'); ok = false; }
    if (!HISTORY_TYPES.includes(type)) { findings.push(where + ': type "' + type + '" is not one of ' + HISTORY_TYPES.join(', ') + ' (R3)'); ok = false; }
    if (summary === '') { findings.push(where + ': the summary is empty (R3)'); ok = false; }
    if (ok) parsed.push({ line, version, date, release, type });
  }

  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    if (compare(triple(cur.version), triple(prev.version)) >= 0) {
      findings.push(rel + ':' + cur.line + ': version ' + cur.version + ' is not lower than the row above it (' + prev.version + '); rows run newest first (R3)');
    }
    if (cur.date > prev.date) {
      findings.push(rel + ':' + cur.line + ': date ' + cur.date + ' is later than the row above it (' + prev.date + '); rows run newest first (R3)');
    }
    if (cur.release === 'unreleased') {
      findings.push(rel + ':' + cur.line + ': only the first row may say `unreleased` (R3)');
    }
  }

  if (meta && parsed.length > 0 && parsed[0].line === rows[0].line) {
    if (parsed[0].version !== meta.version) {
      findings.push(rel + ':' + parsed[0].line + ': first row version ' + parsed[0].version + ' differs from SKILL.md metadata.version ' + meta.version + ' (R2)');
    }
    if (parsed[0].date !== meta.updated) {
      findings.push(rel + ':' + parsed[0].line + ': first row date ' + parsed[0].date + ' differs from SKILL.md metadata.updated ' + meta.updated + ' (R2)');
    }
  }
  return parsed;
}

function git(args) {
  return spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

/** The latest reachable v*.*.* tag, or null. */
function latestTag() {
  if (!existsSync(join(REPO_ROOT, '.git'))) return null;
  const r = git(['describe', '--tags', '--abbrev=0', '--match', 'v*.*.*']);
  if (r.status !== 0) return null;
  const tag = r.stdout.trim();
  return TAG_RE.test(tag) ? tag : null;
}

/** True when skills/<name>/ differs from `tag` in tracked or untracked files, or is new since it. */
function changedSince(tag, name) {
  const dir = 'skills/' + name + '/';
  if (git(['cat-file', '-e', tag + ':' + dir + 'SKILL.md']).status !== 0) return true;
  const diff = git(['diff', '--quiet', tag, '--', dir]);
  if (diff.status === 1) return true;
  if (diff.status !== 0) fatal('git diff failed for ' + dir + ': ' + diff.stderr.trim());
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', dir]);
  if (untracked.status !== 0) fatal('git ls-files failed for ' + dir + ': ' + untracked.stderr.trim());
  return untracked.stdout.trim() !== '';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = skillNames();
  if (names.length === 0) fatal('found no skills/<name>/SKILL.md under ' + REPO_ROOT);

  const findings = [];
  const tops = new Map();
  for (const name of names) {
    const meta = readMetadata(name, findings);
    const rows = readHistory(name, meta, findings);
    tops.set(name, rows);
  }

  if (args.release) {
    const tag = triple(args.release);
    for (const name of names) {
      for (const row of tops.get(name)) {
        const where = 'skills/' + name + '/HISTORY.md:' + row.line;
        if (row.release === 'unreleased') {
          findings.push(where + ': still says `unreleased`; stamp it with the release tag before publishing ' + args.release + ' (R5)');
        } else if (compare(triple(row.release), tag) > 0) {
          findings.push(where + ': names release ' + row.release + ', newer than the tag being published, ' + args.release + ' (R5)');
        }
      }
    }
    out('mode: release ' + args.release + ' (R5 replaces R4)');
  } else {
    const tag = latestTag();
    if (!tag) {
      if (process.env.CI === 'true') {
        fatal('R4 needs git history and a reachable v*.*.* tag, and none is visible; the CI checkout must use fetch-depth 0, or this check is blind');
      }
      out('mode: degraded (no .git directory or no reachable v*.*.* tag) - R4 skipped; R1 to R3 checked');
    } else {
      const tagTriple = triple(tag);
      let changed = 0;
      for (const name of names) {
        if (!changedSince(tag, name)) continue;
        changed++;
        const top = tops.get(name)[0];
        if (!top) continue; // R2 or R3 already named the missing table
        const pending = top.release === 'unreleased' || compare(triple(top.release), tagTriple) > 0;
        if (!pending) {
          findings.push('skills/' + name + '/HISTORY.md:' + top.line + ': ' + name + ' changed since ' + tag + ' but its newest row (' + top.version + ') is already released as ' + top.release + '; add a row for the new version with release `unreleased` and bump metadata.version (R4)');
        }
      }
      out('mode: git (latest tag ' + tag + '; ' + changed + ' skill(s) changed since it)');
    }
  }

  if (findings.length > 0) {
    for (const f of findings) out('FAIL ' + f);
    out(findings.length + ' finding(s) across ' + names.length + ' skill(s)');
    process.exit(1);
  }
  out('PASS: ' + names.length + ' skill(s) versioned: ' + names.map((n) => n + ' ' + tops.get(n)[0].version).join(', '));
}

main();
