// scripts/checks/check-skill-cli-targets.mjs
// what-it-is:   skill-to-CLI routing-target resolution checker
// what-it-does: scans tracked skills/**/SKILL.md files for the literal invocation form a
//               CLI-wrapper skill uses to name its routing target - "bin/ns-<name>", the same
//               shape node "<plugin-root>/bin/ns-<name>" resolves to once the plugin root is
//               substituted in (see skills/init-project/SKILL.md Step 4 for that resolution) -
//               and asserts each named CLI is genuinely shipped: the extensionless file exists
//               directly under bin/. A bare "ns-<name>" mention with no "bin/" prefix (for
//               example a sentence naming a sibling CLI in passing) is deliberately out of
//               scope: this checker verifies that a skill's own ROUTING target resolves to a
//               real file, not that every CLI name mentioned anywhere in a skill's prose is
//               spelled correctly. Checking for the ".cmd" Windows shim is scripts/checks/
//               check-inventory.mjs's job (component inventory equality); this checker only
//               ever asserts the extensionless bin/ns-<name> target a skill actually invokes.
// why:          F-CI-07 (dispatcher and CLI-wrapper skills uncovered) - nothing previously
//               asserted that a CLI-wrapper skill's named routing target is a real, shipped
//               file, so a typo'd or renamed CLI reference would ship silently and surface only
//               as a runtime failure for an author. This is the generic, reusable form of that
//               finding's fix; it was written to close the gap for status-dashboard's
//               bin/ns-status reference, and it applies to every other skill in the same scan
//               scope for free, at no extra cost, because the mechanism does not special-case
//               any one skill.
// exit taxonomy: 0 = every referenced CLI target resolves; 1 = named finding(s) (a skill names a
//               bin/ns-<name> target that does not exist under bin/); 2 = operational error (zero
//               files matched the scan scope, which means a broken checkout or a resolution bug,
//               not a clean pass).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-skill-cli-targets]';
const BIN_DIR = join(REPO_ROOT, 'bin');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

// ---------------------------------------------------------------------------
// Tracked-file discovery (git ls-files), with a plain filesystem-walk
// fallback when git is unavailable or REPO_ROOT is not a git repository -
// mirrors scripts/checks/check-plugin-root.mjs and check-workspace-refs.mjs,
// so a temp clone with no .git present (the standard fixture shape the
// companion test file uses) still scans correctly in degraded mode.
// ---------------------------------------------------------------------------

function getGitTrackedFiles(repoRoot) {
  let gitRootRaw;
  try {
    gitRootRaw = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null;
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

function walkDir(dir, baseDir, out = []) {
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
      walkDir(full, baseDir, out);
    } else if (e.isFile()) {
      out.push(full.slice(baseDir.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

let trackedFiles = getGitTrackedFiles(REPO_ROOT);
let degradedReason = null;
if (!trackedFiles) {
  degradedReason = 'git unavailable or ' + REPO_ROOT + ' is not a git repository';
  trackedFiles = walkDir(SKILLS_DIR, REPO_ROOT);
}

// ---------------------------------------------------------------------------
// Scan scope: skills/**/SKILL.md only.
// ---------------------------------------------------------------------------

function inScope(rel) {
  return rel.startsWith('skills/') && rel.endsWith('/SKILL.md');
}

const filesToScan = trackedFiles.filter(inScope).sort();

if (filesToScan.length === 0) {
  process.stderr.write(
    PREFIX + ' FATAL: zero files matched skills/**/SKILL.md under ' + REPO_ROOT +
    '. This indicates a broken checkout or a resolution bug, not a clean pass.\n'
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Bin-target reference detection: "bin/ns-<name>", the same prefix
// check-plugin-root.mjs's RELATIVE_BIN_RE anchors on. The character class
// stops at the first character that cannot appear in a CLI basename (a
// closing quote, backtick, or ".cmd" suffix all fall outside it), so a
// trailing ".cmd" is never folded into the captured name.
// ---------------------------------------------------------------------------

const BIN_TARGET_RE = /bin\/(ns-[a-z0-9][a-z0-9-]*)/g;

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
    BIN_TARGET_RE.lastIndex = 0;
    let m;
    while ((m = BIN_TARGET_RE.exec(line)) !== null) {
      const cliName = m[1];
      const targetPath = join(BIN_DIR, cliName);
      if (!existsSync(targetPath)) {
        findings.push(
          rel + ':' + (li + 1) + ': routing target "bin/' + cliName + '" does not exist - ' +
          'this skill names a CLI that is not shipped under bin/'
        );
      }
      if (m.index === BIN_TARGET_RE.lastIndex) BIN_TARGET_RE.lastIndex++;
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (degradedReason) {
  process.stdout.write(PREFIX + ' NOTE: degraded mode, scanning the filesystem directly instead of the git-tracked set (' + degradedReason + ')\n');
} else {
  process.stdout.write(PREFIX + ' mode: git-tracked (' + filesToScan.length + ' file(s) in scope under skills/**/SKILL.md)\n');
}

if (findings.length === 0) {
  process.stdout.write(PREFIX + ' pass: ' + filesToScan.length + ' file(s) checked, every bin/ns-<name> routing target resolves to a shipped CLI\n');
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
