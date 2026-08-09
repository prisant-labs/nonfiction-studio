// scripts/checks/check-plugin-root.mjs
// what-it-is:   plugin-root invocation convention checker
// what-it-does: scans tracked files under skills/**/SKILL.md, agents/*.md (top-level
//               only), and docs/reference/** and fails on (a) a relative bin
//               invocation of the form node [./]bin/ns-<name> (resolves against the
//               caller's cwd, not the installed plugin, so it breaks for every
//               marketplace-installed user), and (b) the literal string
//               $CLAUDE_PLUGIN_ROOT or ${CLAUDE_PLUGIN_ROOT} anywhere in those files
//               (that variable is a hooks.json-only interpolation mechanism; it is
//               never set in a live Bash shell, per ADR-0005). Naming ADR-0005 in
//               prose is fine; the literal variable string is not. hooks/,
//               .github/, and templates/hook-starter legitimately use the braced
//               form for real hooks.json command strings; they are never in scope
//               here because the three include globs below never match them.
// why:          F-SK-01 (broken bin invocation) and F-ST-01 (unbraced env form) -
//               the house plugin-root convention (skills/init-project/SKILL.md
//               Step 4: settings.json lookup, plugins-cache search, dev-mode
//               fallback) is the only form that resolves for an installed user;
//               this check guards the fix against regression.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Determine the set of git-tracked files, so scanning matches what a clean CI
// checkout sees rather than whatever happens to exist on the local filesystem.
// Falls back to a plain directory walk (degraded mode) when git is unavailable
// or the directory is not a git repo -- mirrors scripts/check-links.mjs.
// ---------------------------------------------------------------------------

function getGitTrackedFiles(repoRoot) {
  let gitRootRaw;
  try {
    gitRootRaw = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null; // git unavailable, or not a git repo
  }
  if (!gitRootRaw) return null;

  let listing;
  try {
    listing = execFileSync('git', ['ls-files', '-z'], {
      cwd: resolve(gitRootRaw),
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }

  return listing.toString('utf8').split('\0').filter(Boolean);
}

// Degraded-mode fallback: walk the three scan roots directly on disk. Returns
// paths relative to REPO_ROOT, forward-slash separated.
function walkDir(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, out);
    } else if (e.isFile()) {
      out.push(full.slice(REPO_ROOT.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

let trackedFiles = getGitTrackedFiles(REPO_ROOT);
let degradedReason = null;
if (!trackedFiles) {
  degradedReason = 'git unavailable or ' + REPO_ROOT + ' is not a git repository';
  trackedFiles = [
    ...walkDir(join(REPO_ROOT, 'skills')),
    ...walkDir(join(REPO_ROOT, 'agents')),
    ...walkDir(join(REPO_ROOT, 'docs', 'reference')),
  ];
}

// ---------------------------------------------------------------------------
// Scan scope: skills/**/SKILL.md, agents/*.md (top-level only), docs/reference/**
// This include-only design is what keeps hooks/, .github/, and
// templates/hook-starter out of scope -- they simply never match these globs,
// so no explicit exclusion list is needed.
// ---------------------------------------------------------------------------

function inScope(rel) {
  if (rel.startsWith('skills/') && rel.endsWith('/SKILL.md')) return true;
  if (rel.startsWith('agents/') && rel.endsWith('.md') && !rel.slice('agents/'.length).includes('/')) return true;
  if (rel.startsWith('docs/reference/')) return true;
  return false;
}

const filesToScan = trackedFiles.filter(inScope).sort();

// A scan scope of zero is never a legitimate clean pass for this repo shape
// (skills/, agents/, and docs/reference/ always contain matching files) --
// it means REPO_ROOT resolved wrong, the checkout is broken, or the three
// directories are missing. Fail loudly rather than reporting a silent pass.
if (filesToScan.length === 0) {
  process.stderr.write(
    '[check-plugin-root] FATAL: zero files matched skills/**/SKILL.md, agents/*.md, ' +
    'or docs/reference/** under ' + REPO_ROOT + '. This indicates a broken checkout ' +
    'or a resolution bug, not a clean pass.\n'
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Bad-pattern detection
// ---------------------------------------------------------------------------

// (a) node [./]bin/ns-<name> -- relative bin invocation, resolves against the
// caller's cwd rather than the installed plugin root. An optional leading
// quote is tolerated so a quoted-but-still-relative form is also caught.
const RELATIVE_BIN_RE = /\bnode\s+["']?(?:\.\/)?bin\/ns-/;

// (b) the literal hooks.json-only interpolation string, braced or unbraced.
const ENV_VAR_RE = /\$\{?CLAUDE_PLUGIN_ROOT\}?/;

const findings = [];

for (const rel of filesToScan) {
  const absFile = join(REPO_ROOT, rel);
  let text;
  try {
    text = readFileSync(absFile, 'utf8');
  } catch (err) {
    findings.push(rel + ': cannot read file: ' + err.message);
    continue;
  }

  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    const relMatch = line.match(RELATIVE_BIN_RE);
    if (relMatch) {
      findings.push(
        rel + ':' + (li + 1) + ': relative bin invocation "' + relMatch[0] + '" ' +
        "resolves against the caller's cwd, not the installed plugin - invoke as " +
        'node "<plugin-root>/bin/ns-<name>" after resolving the plugin root ' +
        '(see skills/init-project/SKILL.md Step 4)'
      );
    }

    const envMatch = line.match(ENV_VAR_RE);
    if (envMatch) {
      findings.push(
        rel + ':' + (li + 1) + ': literal plugin-root environment-variable string "' +
        envMatch[0] + '" - that variable interpolates only inside hooks.json command ' +
        'strings and is never set in a live Bash shell (ADR-0005); use a resolved ' +
        '<plugin-root> path instead'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (degradedReason) {
  process.stdout.write('[check-plugin-root] NOTE: degraded mode, scanning the filesystem directly instead of the git-tracked set (' + degradedReason + ')\n');
} else {
  process.stdout.write('[check-plugin-root] mode: git-tracked (' + filesToScan.length + ' file(s) in scope under skills/**/SKILL.md, agents/*.md, docs/reference/**)\n');
}

if (findings.length === 0) {
  process.stdout.write('[check-plugin-root] pass: ' + filesToScan.length + ' file(s) checked, no relative bin invocations or literal plugin-root variables found\n');
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write('[check-plugin-root] ERROR: ' + f + '\n');
  }
  process.stdout.write('[check-plugin-root] ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
