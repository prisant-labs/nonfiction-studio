// scripts/checks/check-skill-cli-targets.mjs
// what-it-is:   CLI routing-target resolution checker (Markdown and non-Markdown)
// what-it-does: scans two scopes for the literal invocation form a CLI-wrapper skill (or any
//               other shipped file) uses to name a routing target - "bin/ns-<name>", the same
//               shape node "<plugin-root>/bin/ns-<name>" resolves to once the plugin root is
//               substituted in (see skills/nfs-new-book/SKILL.md Step 4 for that resolution) -
//               and asserts each named CLI is genuinely shipped: the extensionless file exists
//               directly under bin/. A bare "ns-<name>" mention with no "bin/" prefix (for
//               example a sentence naming a sibling CLI in passing) is deliberately out of
//               scope: this checker verifies that a document's own ROUTING target resolves to a
//               real file, not that every CLI name mentioned anywhere in shipped prose is
//               spelled correctly. Checking for the ".cmd" Windows shim is scripts/checks/
//               check-inventory.mjs's job (component inventory equality); this checker only
//               ever asserts the extensionless bin/ns-<name> target a document actually invokes.
//               Scope 1, Markdown: every git-tracked .md file under agents/, bin/, docs/,
//               evals/, examples/, hooks/, output-styles/, scripts/, skills/, templates/, plus
//               root-level .md files. Grown twice since the scope was first widened from
//               skills/**/SKILL.md only: once to cover every shipped Markdown location, and
//               again in two further pieces, both closing the same class of gap rather than
//               opening a new one - output-styles/ is a shipped plugin folder made only of
//               Markdown (its review.md carries live bin/ns-<name> routing targets in ordinary
//               prose, exactly like a SKILL.md would), and .md files under scripts/, hooks/,
//               bin/, and evals/ previously matched NEITHER this scope nor scope 2 below (scope
//               2 rejects any .md file outright, and this scope's prefix list did not yet name
//               those four directories), so a stale routing target named inside one of them had
//               nothing to catch it at all - not a defect ever found live, but a real gap in
//               coverage, not only in intent.
//               Scope 2, non-Markdown: every git-tracked NON-.md file under hooks/, bin/,
//               scripts/, agents/, templates/, evals/, examples/, plus root-level non-.md files
//               (settings.json carries one live reference today). A hook module's own comment, a
//               scripts/ helper, or a root-level config file can name a stale bin/ns-<name>
//               routing target exactly as easily as a SKILL.md can, and nothing previously read
//               any of them. docs/, output-styles/, and skills/ are deliberately NOT part of this
//               second scope: their Markdown files are already covered by scope 1, and widening
//               to their non-Markdown files too was not part of this pass. A file matching EITHER
//               scope is scanned exactly once - the two scopes are structurally disjoint by file
//               extension (scope 1 requires .md, scope 2 rejects it), regardless of how much their
//               prefix lists overlap, so naming the same directory in both lists (as agents/,
//               bin/, evals/, examples/, hooks/, scripts/, and templates/ all now do) can never
//               double-count a file.
//               EXCLUDED from both scopes: files under docs/adr/ and docs/gates/ - dated,
//               point-in-time historical records (an ADR's own Date: field fixes what it
//               describes to that date; a gate doc records what was true at a named past gate),
//               not living documents that track the current tree, so a routing target named in
//               one that has since been renamed or removed is not a live defect. Same rationale
//               and the same path-prefix-skip mechanism as scripts/checks/
//               check-component-counts.mjs's HISTORICAL_RECORD_PREFIXES.
//               EXCLUDED from the non-Markdown scope specifically: everything under tests/, home
//               to this checker's own planted-violation fixtures (ns-a through ns-h,
//               ns-nonexistent, ns-widget, ns-zzz-simulated-growth - named here without a
//               leading "bin/" deliberately: this file's own source now sits inside the
//               non-Markdown scope it defines, via the scripts/ prefix, so gluing "bin/" onto
//               any nonexistent name in this header would make this very file the finding).
//               tests/ needs no separate exclusion rule in the scan-scope logic below: it was
//               never one of the seven non-Markdown prefixes to begin with, so a fixture planted
//               there is simply never enumerated. node_modules is never git-tracked, so it never
//               reaches either scope regardless of mode.
//               Binary files are skipped entirely in both scopes: a file is treated as binary,
//               and never read as text, when a NUL byte (0x00) appears anywhere in its first
//               8 KB - the same shape of heuristic git itself uses to classify a blob as binary.
//               Dot-directories (e.g. templates/book-scaffold/.studio/): the degraded (no-git)
//               fallback walk descends into them for the non-Markdown scope, matching
//               git-tracked mode, which never skipped them (git ls-files does not care about a
//               dot-prefixed directory name, only .gitignore). The Markdown scope's fallback
//               walk deliberately still skips them, unchanged from before this fix - see the
//               comment above the discovery functions below for why descending there too would
//               have changed which files degraded mode counts as Markdown.
// why:          F-CI-07 (dispatcher and CLI-wrapper skills uncovered) - nothing previously
//               asserted that a CLI-wrapper skill's named routing target is a real, shipped
//               file, so a typo'd or renamed CLI reference would ship silently and surface only
//               as a runtime failure for an author. This is the generic, reusable form of that
//               finding's fix; it was written to close the gap for nfs-status-dashboard's own
//               routing target, the ns-status CLI, and it applies to every other skill in the
//               same scan scope for free, at no extra cost, because the mechanism does not
//               special-case any one skill. The scan scope was widened from skills/**/SKILL.md
//               only to every shipped Markdown location - PF-22 (checker coverage shapes)
//               widening 1 - because the original scope missed a broken bin/ns-<name> reference
//               anywhere else in the tree: an agent's own prose, a reference doc, a fixture
//               note, a scaffold template, or a root-level doc could name a stale routing target
//               with nothing to catch it, the exact same defect class this checker already
//               caught inside a SKILL.md file. Widening 1 still left a second, symmetric blind
//               spot: the exact same defect class inside a NON-Markdown shipped file - a hook
//               module's comment, a scripts/ helper's usage note, a root-level config value -
//               had nothing to catch it either, even though the checker's own regex has never
//               cared what kind of file it is reading. PF-22 (checker coverage shapes) widening
//               2 closes that: the non-Markdown scope described above. A probe run before this
//               widening found 56 non-Markdown bin/ns-<name> references already in the newly
//               scanned scope on the real tree, all resolving, so this widening lands green with
//               no live defect to fix. Two further Markdown-scope additions closed remaining
//               gaps in the same spirit, both landing green with no live defect: output-styles/,
//               a shipped plugin folder that carries the same bin/ns-<name> prose shape (its
//               review.md names three routing targets) and was scanned by neither scope at all;
//               and .md files under scripts/, hooks/, bin/, and evals/, which - because those
//               four directories were only ever named in the non-Markdown prefix list, and the
//               non-Markdown scope rejects any .md file outright - fell between both scopes and
//               were scanned by neither, the same coverage gap in miniature.
// exit taxonomy: 0 = every referenced CLI target resolves; 1 = named finding(s) (a document
//               names a bin/ns-<name> target that does not exist under bin/); 2 = operational
//               error (zero files matched either scan scope, which means a broken checkout or a
//               resolution bug, not a clean pass).
// used-by:      .github/workflows/tier-a.yml, the "Skill CLI routing targets" step.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-skill-cli-targets]';
const BIN_DIR = join(REPO_ROOT, 'bin');

// ---------------------------------------------------------------------------
// Scan scope. Two scopes, split by file extension (so they can never
// double-count a file regardless of prefix overlap), both excluding
// docs/adr/ and docs/gates/ (dated historical records - see header comment):
//   - Markdown: every .md file under agents/, bin/, docs/, evals/, examples/,
//     hooks/, output-styles/, scripts/, skills/, templates/, plus root-level
//     .md files.
//   - non-Markdown: every NON-.md file under hooks/, bin/, scripts/,
//     agents/, templates/, evals/, examples/, plus root-level non-.md
//     files. tests/ is never one of these prefixes, so a fixture planted
//     there is simply never enumerated - no separate exclusion needed.
// The two lists overlap on purpose (agents/, bin/, evals/, examples/,
// hooks/, scripts/, templates/ all appear in both): a directory in both
// lists gets its .md files scanned by the Markdown scope and its non-.md
// files scanned by the non-Markdown scope, never both for the same file.
// docs/, output-styles/, and skills/ appear only in the Markdown list,
// since none of the three ship a non-Markdown file this checker has reason
// to scan.
// ---------------------------------------------------------------------------

const MD_SCAN_DIR_PREFIXES = ['agents/', 'bin/', 'docs/', 'evals/', 'examples/', 'hooks/', 'output-styles/', 'scripts/', 'skills/', 'templates/'];
const NON_MD_SCAN_DIR_PREFIXES = ['hooks/', 'bin/', 'scripts/', 'agents/', 'templates/', 'evals/', 'examples/'];
const HISTORICAL_RECORD_PREFIXES = ['docs/adr/', 'docs/gates/'];

function isRootLevelFile(rel) {
  return !rel.includes('/');
}

function inMdScope(rel) {
  if (!rel.endsWith('.md')) return false;
  if (HISTORICAL_RECORD_PREFIXES.some((p) => rel.startsWith(p))) return false;
  if (isRootLevelFile(rel)) return true;
  return MD_SCAN_DIR_PREFIXES.some((p) => rel.startsWith(p));
}

function inNonMdScope(rel) {
  if (rel.endsWith('.md')) return false;
  if (HISTORICAL_RECORD_PREFIXES.some((p) => rel.startsWith(p))) return false;
  if (isRootLevelFile(rel)) return true;
  return NON_MD_SCAN_DIR_PREFIXES.some((p) => rel.startsWith(p));
}

// ---------------------------------------------------------------------------
// Tracked-file discovery (git ls-files), with a plain filesystem-walk
// fallback when git is unavailable or REPO_ROOT is not a git repository -
// mirrors scripts/checks/check-plugin-root.mjs and check-workspace-refs.mjs,
// so a temp clone with no .git present (the standard fixture shape the
// companion test file uses) still scans correctly in degraded mode. The
// fallback walk mirrors check-component-counts.mjs's own two-part shape: a
// recursive walk of each scan-prefix directory, plus a separate, non-
// recursive pass over root-level files only.
//
// Dot-directory handling in the fallback walk deliberately differs between
// the two scopes, to keep git-tracked mode and degraded mode in agreement
// for each scope separately:
//   - non-Markdown: descends into dot-directories (e.g.
//     templates/book-scaffold/.studio/), skipping only .git and
//     node_modules by name - matching git-tracked mode, where
//     `git ls-files` already includes tracked files under a dot-directory
//     regardless of the directory name.
//   - Markdown: keeps the OLD behavior (skips any dot-prefixed entry
//     entirely) unchanged - the non-Markdown widening that introduced this
//     split promised to keep the Markdown scope's degraded-mode file set
//     byte-identical, and later additions to the Markdown prefix list
//     (output-styles/, and scripts/, hooks/, bin/, evals/ for their .md
//     files) kept that same skip behavior rather than changing it. Checked
//     against the real tree: agents/, docs/, examples/, skills/, and
//     templates/ collectively carry real .md files under dot-directories
//     today (five gate-snapshot files under examples/*/.studio/snapshots/),
//     so descending into dot-directories for the Markdown scope too would
//     change which files degraded mode counts as Markdown; the newer
//     Markdown prefixes carry no dot-directory .md files today, so this is
//     currently a distinction without a difference for them, but the rule
//     stays the same for all ten prefixes rather than special-casing some.
//     Because agents/, bin/, evals/, examples/, hooks/, scripts/, and
//     templates/ are scanned by BOTH scopes, this requires two separate
//     walks over those directories in degraded mode (one per scope, each
//     with its own dot-directory policy), not one shared walk feeding both
//     scopes' filters.
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

function walkDirRecursive(dir, baseDir, opts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    if (!opts.descendDotDirs && e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkDirRecursive(full, baseDir, opts, out);
    } else if (e.isFile()) {
      out.push(full.slice(baseDir.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

function walkRootLevelFiles(baseDir, out = []) {
  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isFile()) out.push(e.name);
  }
  return out;
}

let filesToScan;
let mdCount;
let nonMdCount;
let degradedReason = null;

const trackedFiles = getGitTrackedFiles(REPO_ROOT);
if (trackedFiles) {
  filesToScan = trackedFiles.filter((rel) => inMdScope(rel) || inNonMdScope(rel)).sort();
  mdCount = filesToScan.filter(inMdScope).length;
  nonMdCount = filesToScan.length - mdCount;
} else {
  degradedReason = 'git unavailable or ' + REPO_ROOT + ' is not a git repository';

  const rootFiles = walkRootLevelFiles(REPO_ROOT);

  const mdCandidates = [...rootFiles];
  for (const prefix of MD_SCAN_DIR_PREFIXES) {
    walkDirRecursive(join(REPO_ROOT, prefix.slice(0, -1)), REPO_ROOT, { descendDotDirs: false }, mdCandidates);
  }

  const nonMdCandidates = [...rootFiles];
  for (const prefix of NON_MD_SCAN_DIR_PREFIXES) {
    walkDirRecursive(join(REPO_ROOT, prefix.slice(0, -1)), REPO_ROOT, { descendDotDirs: true }, nonMdCandidates);
  }

  const mdFiles = mdCandidates.filter(inMdScope);
  const nonMdFiles = nonMdCandidates.filter(inNonMdScope);
  filesToScan = [...mdFiles, ...nonMdFiles].sort();
  mdCount = mdFiles.length;
  nonMdCount = nonMdFiles.length;
}

if (filesToScan.length === 0) {
  process.stderr.write(
    PREFIX + ' FATAL: zero files matched either scan scope (Markdown: agents/, bin/, docs/, ' +
    'evals/, examples/, hooks/, output-styles/, scripts/, skills/, templates/, root-level .md ' +
    'files; non-Markdown: hooks/, bin/, scripts/, agents/, templates/, evals/, examples/, ' +
    'root-level non-.md files; excluding tests/, docs/adr/, docs/gates/) under ' + REPO_ROOT +
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

// A file is treated as binary, and never read as text, when a NUL byte
// (0x00) appears anywhere in its first 8 KB - the same shape of heuristic
// git itself uses to classify a blob as binary. Applies to both scopes; in
// practice only the non-Markdown scope can contain a binary file.
const BINARY_SNIFF_BYTES = 8192;

const findings = [];
let skippedBinaryCount = 0;

for (const rel of filesToScan) {
  const absFile = join(REPO_ROOT, rel);
  let buf;
  try {
    buf = readFileSync(absFile);
  } catch (err) {
    findings.push(rel + ': cannot read file: ' + err.message);
    continue;
  }

  if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    skippedBinaryCount++;
    continue;
  }

  const text = buf.toString('utf8');
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
          'this document names a CLI that is not shipped under bin/'
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
  process.stdout.write(
    PREFIX + ' mode: git-tracked (' + filesToScan.length + ' file(s) in scope: ' + mdCount +
    ' Markdown under agents/, bin/, docs/, evals/, examples/, hooks/, output-styles/, scripts/, ' +
    'skills/, templates/, root-level .md files; ' + nonMdCount + ' non-Markdown under hooks/, ' +
    'bin/, scripts/, agents/, templates/, evals/, examples/, root-level non-.md files; ' +
    'excluding tests/, docs/adr/, docs/gates/)\n'
  );
}

if (skippedBinaryCount > 0) {
  process.stdout.write(PREFIX + ' NOTE: skipped ' + skippedBinaryCount + ' binary file(s) (NUL byte in the first 8 KB)\n');
}

if (findings.length === 0) {
  process.stdout.write(
    PREFIX + ' pass: ' + filesToScan.length + ' file(s) checked (' + mdCount + ' Markdown, ' +
    nonMdCount + ' non-Markdown), every bin/ns-<name> routing target resolves to a shipped CLI\n'
  );
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
