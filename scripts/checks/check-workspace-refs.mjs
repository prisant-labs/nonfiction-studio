// scripts/checks/check-workspace-refs.mjs
// what-it-is:   workspace-reference checker (durable form of "a shipped file must not point at a
//               path that does not survive a clean checkout")
// what-it-does: derives the forbidden-directory set by parsing this repo's own .gitignore for
//               explicit directory patterns (a pattern line ending in "/"; negation lines and
//               glob-wildcard directory patterns are not supported and are skipped, since none
//               occur in this repo's .gitignore today), then scans every git-tracked file under
//               the shipped scan scope (bin/, hooks/, scripts/, skills/, agents/, docs/,
//               examples/, templates/, evals/, tests/, and root-level files) for three forms of
//               plain-text reference to content that will not survive a clean checkout:
//                 form 1 (path reference): a forbidden directory name immediately followed by "/"
//                 and at least one more non-whitespace path segment, anywhere in the file's text
//                 (not only inside Markdown link syntax - scripts/check-links.mjs already covers
//                 that narrower case; this extends the same principle to code comments, prose, and
//                 test names, which is where every violation this checker exists to close actually
//                 landed);
//                 form 2 (bare filename reference): the basename of a file that would not survive a
//                 clean checkout, mentioned on its own with no preceding "/" (a "/"-preceded
//                 occurrence is form 1's territory, so the two forms never double-report the same
//                 text). The forbidden-basename set has two sources, unioned: a committed, hashed
//                 manifest (scripts/checks/workspace-refs-manifest.json) that a clean CI checkout
//                 can read with no scratch tree present on disk at all, and a live walk of this
//                 machine's actual scratch directories (local runs only, when they exist on disk),
//                 which supplements the manifest with a basename not yet written to it. Either
//                 source is reduced by every git-tracked basename, computed fresh at check time, so
//                 a name that becomes tracked stops being forbidden with no manifest edit. A
//                 basename made only of [A-Za-z0-9_.-] ("token-shaped") is matched by extracting
//                 every such maximal character run from the scanned text and hashing it (and its
//                 dot-bounded prefixes) for comparison against the forbidden hash set - see the
//                 findTokenMatches comment below for exactly how this reproduces the same matches a
//                 literal alternation regex would find. A basename containing any other character
//                 (one exists today, containing spaces) cannot be reduced to a token match at all;
//                 it stays on the literal-regex path this checker used before, live-derived only,
//                 so it is enforced locally but not on CI - the one residual local-only class, and
//                 --write-manifest reports how many it skipped rather than silently dropping them.
//                 A hashed manifest, not a clear-text list, because a committed clear-text list of
//                 gitignored-only basenames is exactly what form 2 forbids, and it would publish
//                 this tree's private file names the moment this repository is ever made public;
//                 hashing (one-way, not reversible in the sense this rule cares about) stands in
//                 for that clear-text list without being one;
//                 form 3 (task-workspace prose citation): one of four unambiguous literal shapes
//                 naming this wave's own internal scratch-task numbering ("task-N brief", "task-N
//                 report", "the task brief", "the task report", case-insensitive), independent of
//                 the .gitignore-derived forbidden-directory set entirely - these four are
//                 recognized by their own wording, not by naming a forbidden directory or an
//                 existing basename. See the scope note below for why general prose citation
//                 ("per the brief") stays out of scope while these four specific shapes do not.
//               A small, explicitly-named subtraction is applied to the .gitignore-derived set
//               before either form runs: directories gitignored because they hold reproducible,
//               machine-generated content (an installed dependency tree, build output, test-
//               coverage output, or a per-project runtime cache the platform itself creates when a
//               subagent runs with a project-scoped memory field) are not the kind of directory
//               this rule is about, and treating them the same as an authored-content scratch
//               directory produces real false positives, not hypothetical ones - see
//               NON_SCRATCH_GITIGNORED_DIRS below for the exact set and the concrete evidence that
//               justified each entry. This is a bounded, stated exclusion sitting alongside the
//               fully dynamic .gitignore-derived set, not a replacement for it: a NEW authored-
//               content scratch directory added to .gitignore tomorrow is covered automatically,
//               with no code change here; only a new directory in the same reproducible-artifact
//               category would ever need adding to the exclusion.
// scope note:   this checker does not attempt to catch every shape a workspace reference can take.
//               An internal task-number label used OUTSIDE form 3's four shapes (for example, a
//               bare "Task 4" with no "brief" or "report" following it) carries no path or
//               filename at all, so there is nothing to derive it from without hardcoding
//               wave-specific vocabulary beyond the four literal shapes form 3 already hardcodes;
//               and a prose citation that names no file and uses none of form 3's four shapes
//               ("per the brief", "the kickoff plan for this wave") is not distinguishable from
//               ordinary English by any pattern this checker could apply without an unacceptable
//               false-positive rate on normal prose. Both remain out of scope by design, not by
//               oversight, for everything outside form 3's four shapes above.
// manifest:     scripts/checks/workspace-refs-manifest.json is { "version": 1, "algorithm":
//               "sha256", "hashes": [...] }, lowercase hex sha256 of each UTF-8 basename, sorted by
//               plain string comparison (every entry is the same length and pure ASCII hex, so this
//               IS codepoint order, never localeCompare). A missing or malformed manifest is a
//               fatal, exit-2 operational error on a normal run, not a soft warning, because CI
//               reads the manifest alone and a warn-and-continue would silently reinstate the exact
//               blind spot this file exists to close (the same reasoning already applied to a
//               missing .gitignore, above). `--write-manifest` is the one mode that tolerates a
//               missing file: it starts from an empty set and says so, since the very first run on
//               a machine that has never generated one has nothing to read yet; a malformed file is
//               still fatal in that mode too, on the theory that overwriting corruption silently is
//               worse than stopping. A local run with scratch directories on disk that finds
//               live-derived, token-shaped basenames missing from the committed manifest prints a
//               NOTICE (not a finding, and not a failure) naming the count and `--write-manifest`,
//               and still exits 0 - a new scratch file must not turn an ordinary local run red,
//               since routine session logging creates one every session.
// why:          C2 (enforcement theater) - a policy asserted in prose and enforced by nothing is
//               not a control. Applied here to this wave's own process: the rule that a shipped
//               file must not reference this wave's scratch workspace was restated in the shared
//               constraints after each of three violations and still recurred a fourth time; this
//               turns the rule into machinery instead of prose. The hashed-manifest extension to
//               form 2 applies the same principle one level down: a rule only a machine with the
//               right scratch tree happens to be present can enforce is enforcement theater on
//               every other machine, CI included, which is exactly the shape form 2 had until this
//               manifest gave it something to read on a clean checkout.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-workspace-refs]';

function fatal(message) {
  process.stderr.write(PREFIX + ' FATAL: ' + message + '\n');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Forbidden-directory derivation from .gitignore
// ---------------------------------------------------------------------------

const GITIGNORE_PATH = join(REPO_ROOT, '.gitignore');

/**
 * Parses a .gitignore file for explicit directory patterns (a line ending in
 * "/"), returning repo-root-relative, forward-slash directory paths with no
 * leading or trailing slash. A leading "/" (root anchor) is stripped. Lines
 * that are blank, a comment, a negation ("!..."), or contain a glob wildcard
 * in the directory name are skipped: negation and wildcard directory
 * patterns do not occur in this repo's .gitignore today, and resolving them
 * correctly would need real gitignore-matching semantics this checker does
 * not implement.
 */
function parseGitignoreDirectories(absPath) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (err) {
    fatal('cannot read .gitignore at ' + absPath + ': ' + err.message);
  }
  const dirs = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('!')) continue;
    if (!line.endsWith('/')) continue;
    let dir = line.slice(0, -1);
    if (dir.startsWith('/')) dir = dir.slice(1);
    if (/[*?[\]]/.test(dir)) continue;
    if (!dir) continue;
    dirs.push(dir);
  }
  return [...new Set(dirs)].sort();
}

if (!existsSync(GITIGNORE_PATH)) {
  fatal('no .gitignore found at ' + GITIGNORE_PATH + '; the forbidden-directory set cannot be derived');
}

const allGitignoredDirs = parseGitignoreDirectories(GITIGNORE_PATH);

// Directories gitignored for reproducibility, not because they hold uniquely
// authored planning or scratch content. Each entry was checked against this
// repo's actual shipped content before being added here, not assumed:
//   - node_modules: an installed dependency tree, reproducible from the lock
//     file. Walking it for form 2's basename derivation would also make that
//     form unusable (a dependency tree's basenames - an index file, a readme,
//     a manifest - are exactly the "common word that happens to be a
//     gitignored basename" false-positive risk the design brief warns about).
//   - dist, coverage, .nyc_output: build and test-coverage output, absent
//     from this checkout until the corresponding command runs; regenerated,
//     not authored.
//   - .claude/agent-memory, .claude/agent-memory-local: a per-project runtime
//     cache the platform creates in an END USER's OWN project when a shipped
//     subagent runs with a project-scoped memory field - not pre-existing
//     content in THIS repository that a reader is being sent to read. This
//     entry is not hypothetical: applying the plain rule to it would flag
//     more than a dozen sites of correct, already-reviewed documentation
//     that describes this real product behavior (README.md's privacy
//     section, multiple agents/** and skills/** reference bodies,
//     docs/reference/**, and the ADR that records how the directory is
//     named), none of which are a reference to content that vanishes at the
//     end of this wave.
const NON_SCRATCH_GITIGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.nyc_output',
  '.claude/agent-memory',
  '.claude/agent-memory-local',
]);

const scratchDirs = allGitignoredDirs.filter((d) => !NON_SCRATCH_GITIGNORED_DIRS.has(d));

// ---------------------------------------------------------------------------
// Tracked-file discovery (git ls-files -z), with a plain filesystem-walk
// fallback when git is unavailable or REPO_ROOT is not a git repository -
// mirrors scripts/check-links.mjs and scripts/checks/check-plugin-root.mjs.
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
  const gitRoot = resolve(gitRootRaw);

  let listing;
  try {
    listing = execFileSync('git', ['ls-files', '-z'], {
      cwd: gitRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }

  return { gitRoot, relPaths: listing.toString('utf8').split('\0').filter(Boolean) };
}

// ignoredDirSet holds repo-root-relative directory paths (as produced by
// parseGitignoreDirectories) that a real "git ls-files" would never surface.
// A plain recursive walk has no such knowledge on its own, so degraded mode
// must be told explicitly - otherwise a file living inside a gitignored
// scratch directory looks exactly as "tracked" as a real shipped file, which
// would silently defeat form 2's "exists only under a gitignored directory"
// test the moment git is unavailable (this is not hypothetical: it is
// exactly how clone-helper.mjs's temp clones run, by design - see that
// file's header comment - which is how this was caught before it ever
// reached a real degraded-mode environment).
function walkAllFiles(dir, baseDir, ignoredDirSet, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === '.git') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const rel = full.slice(baseDir.length + 1).replace(/\\/g, '/');
      if (ignoredDirSet.has(rel)) continue;
      walkAllFiles(full, baseDir, ignoredDirSet, out);
    } else if (e.isFile()) {
      out.push(full.slice(baseDir.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

const gitInfo = getGitTrackedFiles(REPO_ROOT);
let scanRoot;
let scanModeLabel;
let allTrackedRelPaths;
if (gitInfo) {
  scanRoot = gitInfo.gitRoot;
  scanModeLabel = 'git-tracked';
  allTrackedRelPaths = gitInfo.relPaths;
} else {
  scanRoot = REPO_ROOT;
  scanModeLabel = 'filesystem-walk (git unavailable or ' + REPO_ROOT + ' is not a git repository)';
  allTrackedRelPaths = walkAllFiles(REPO_ROOT, REPO_ROOT, new Set(allGitignoredDirs));
}

// ---------------------------------------------------------------------------
// Scan scope: bin/, hooks/, scripts/, skills/, agents/, docs/, examples/,
// templates/, evals/, tests/, and root-level files. Deliberately excludes
// .github/, .claude-plugin/, and .codex-plugin/, which are out of this
// checker's stated scope.
// ---------------------------------------------------------------------------

const SCAN_PREFIXES = [
  'bin/', 'hooks/', 'scripts/', 'skills/', 'agents/', 'docs/',
  'examples/', 'templates/', 'evals/', 'tests/',
];

function isRootLevelFile(rel) {
  return !rel.includes('/');
}

function inScanScope(rel) {
  if (isRootLevelFile(rel)) return true;
  return SCAN_PREFIXES.some((p) => rel.startsWith(p));
}

const filesToScan = allTrackedRelPaths.filter(inScanScope).sort();

if (filesToScan.length === 0) {
  fatal(
    'zero files matched the scan scope (bin/, hooks/, scripts/, skills/, agents/, docs/, ' +
    'examples/, templates/, evals/, tests/, root-level files) under ' + scanRoot +
    '. This indicates a broken checkout or a resolution bug, not a clean pass.'
  );
}

// ---------------------------------------------------------------------------
// Form 2 forbidden-basename derivation: a file basename that exists on disk
// under a scratch directory and does not exist anywhere in the tracked tree.
// ---------------------------------------------------------------------------

const trackedBasenames = new Set(allTrackedRelPaths.map((p) => basename(p)));

function walkFileBasenames(absDir, out = []) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(absDir, e.name);
    if (e.isDirectory()) {
      walkFileBasenames(full, out);
    } else if (e.isFile()) {
      out.push(e.name);
    }
  }
  return out;
}

// basename -> the scratch directory it was first discovered under (for the
// finding message; a basename colliding across two scratch directories is
// rare enough in practice that reporting the first origin is sufficient).
const basenameOrigin = new Map();
for (const dir of scratchDirs) {
  const abs = join(scanRoot, ...dir.split('/'));
  if (!existsSync(abs)) continue;
  for (const name of walkFileBasenames(abs)) {
    if (trackedBasenames.has(name)) continue;
    if (!basenameOrigin.has(name)) basenameOrigin.set(name, dir);
  }
}

// Split the live-derived set: a "token-shaped" basename (only [A-Za-z0-9_.-])
// can be hashed and matched against the committed manifest; anything else
// (one basename exists today, containing spaces) cannot, and stays on the
// live-derived literal-regex path below - the one residual local-only class.
const TOKEN_SHAPE_RE = /^[A-Za-z0-9_.-]+$/;
const tokenShapedLiveOrigin = new Map();
const nonTokenShapedOrigin = new Map();
for (const [name, dir] of basenameOrigin) {
  (TOKEN_SHAPE_RE.test(name) ? tokenShapedLiveOrigin : nonTokenShapedOrigin).set(name, dir);
}

// ---------------------------------------------------------------------------
// Regex construction (form 1, and form 2's non-token-shaped fallback)
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Form 1: a scratch directory name, not itself preceded by an identifier or
// path character (so it is not matched as a suffix of a larger token or a
// deeper nested path), followed by "/" and one or more characters that are
// not whitespace or a closing/quoting character that would end an inline
// code span, a quoted string, or a Markdown link target.
function buildDirRefRegex(dirs) {
  if (dirs.length === 0) return null;
  const alternation = dirs.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|');
  return new RegExp('(?<![A-Za-z0-9_./-])(' + alternation + ')/([^\\s"\'`)\\]]+)', 'g');
}

// Form 2, non-token-shaped fallback only (see TOKEN_SHAPE_RE above): a
// forbidden basename, not preceded by an identifier or path character (so a
// "/"-preceded occurrence, already form 1's territory, is never double-
// reported here) and not followed by another identifier character (so a
// basename is never matched as a prefix of a longer token). Live-derived
// names only - a non-token-shaped name is never written to the manifest, so
// this path has nothing to read on a clean CI checkout and is local-only.
function buildBasenameRegex(basenames) {
  if (basenames.length === 0) return null;
  const alternation = basenames.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|');
  return new RegExp('(?<![A-Za-z0-9_./-])(' + alternation + ')(?![A-Za-z0-9_-])', 'g');
}

const dirRefRegex = buildDirRefRegex(scratchDirs);
const nonTokenShapedBasenameRegex = buildBasenameRegex([...nonTokenShapedOrigin.keys()]);

// ---------------------------------------------------------------------------
// Form 2, token-shaped / hashed matching
// ---------------------------------------------------------------------------

function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const MANIFEST_PATH = join(__dirname, 'workspace-refs-manifest.json');
const MANIFEST_REL_LABEL = 'scripts/checks/workspace-refs-manifest.json';
const HEX64_RE = /^[0-9a-f]{64}$/;
const WRITE_MANIFEST_FLAG = process.argv.includes('--write-manifest');

/**
 * Reads and validates the committed manifest. A missing file is fatal
 * (exit 2) UNLESS allowMissing is set (only --write-manifest sets it), in
 * which case it is treated as an empty, not-yet-created manifest. A
 * malformed file (bad JSON, wrong shape, a non-hex entry) is always fatal,
 * in both modes: overwriting corruption silently on --write-manifest would
 * be worse than stopping. See this file's header "manifest:" section for
 * the exit-2-not-a-warning rationale.
 */
function loadManifest(path, allowMissing) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && allowMissing) {
      process.stdout.write(PREFIX + ' --write-manifest: no existing manifest at ' + path + '; starting from an empty set\n');
      return new Set();
    }
    fatal(
      'cannot read the committed workspace-refs manifest at ' + path + ': ' + err.message +
      ' - a clean CI checkout enforces form 2 (bare filename reference) from this file alone, so a ' +
      'missing manifest is an operational error, not a soft warning (see this file\'s header).'
    );
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fatal('the committed workspace-refs manifest at ' + path + ' is not valid JSON: ' + err.message);
  }
  if (!data || typeof data !== 'object' || data.version !== 1 || data.algorithm !== 'sha256' || !Array.isArray(data.hashes)) {
    fatal(
      'the committed workspace-refs manifest at ' + path + ' does not match the expected shape ' +
      '{ "version": 1, "algorithm": "sha256", "hashes": [...] }'
    );
  }
  for (const h of data.hashes) {
    if (typeof h !== 'string' || !HEX64_RE.test(h)) {
      fatal('the committed workspace-refs manifest at ' + path + ' contains a malformed entry: ' + JSON.stringify(h));
    }
  }
  return new Set(data.hashes);
}

const manifestHashSet = loadManifest(MANIFEST_PATH, WRITE_MANIFEST_FLAG);

// hash -> { name, dir }, for the live-derived token-shaped names this machine
// can still name in clear text (used only to write a friendlier finding
// message; the manifest side of the union never carries a clear-text name).
const hashToLocalOrigin = new Map();
for (const [name, dir] of tokenShapedLiveOrigin) {
  hashToLocalOrigin.set(sha256Hex(name), { name, dir });
}
const liveTokenShapedHashSet = new Set(hashToLocalOrigin.keys());

// Tracked-basename subtraction, computed fresh at check time (P3): a hash
// equal to a git-tracked basename is never forbidden, from either source.
const trackedBasenameHashSet = new Set([...trackedBasenames].map(sha256Hex));

const forbiddenHashSet = new Set();
for (const h of manifestHashSet) forbiddenHashSet.add(h);
for (const h of liveTokenShapedHashSet) forbiddenHashSet.add(h);
for (const h of trackedBasenameHashSet) forbiddenHashSet.delete(h);

if (WRITE_MANIFEST_FLAG) {
  const beforeCount = manifestHashSet.size;
  const unionHashes = new Set(manifestHashSet);
  for (const h of liveTokenShapedHashSet) unionHashes.add(h);
  let prunedCount = 0;
  for (const h of trackedBasenameHashSet) {
    if (unionHashes.delete(h)) prunedCount++;
  }
  // Plain string comparison: every hash is the same length and pure ASCII
  // hex, so this IS codepoint order (Constraint: never localeCompare).
  const sortedHashes = [...unionHashes].sort();
  const newCount = sortedHashes.length - beforeCount + prunedCount;
  const output = JSON.stringify({ version: 1, algorithm: 'sha256', hashes: sortedHashes }, null, 2) + '\n';
  writeFileSync(MANIFEST_PATH, output, 'utf8');
  process.stdout.write(
    PREFIX + ' --write-manifest: wrote ' + sortedHashes.length + ' hash(es) to ' + MANIFEST_REL_LABEL +
    ' (' + newCount + ' new, ' + prunedCount + ' pruned via tracked-basename subtraction, ' +
    nonTokenShapedOrigin.size + ' skipped: non-token-shaped)\n'
  );
  process.exit(0);
}

// Freshness: live-derived, token-shaped hashes this machine can see that are
// not yet in the committed manifest (and would not be pruned by tracked-
// basename subtraction on write) - exactly what --write-manifest would add.
const staleHashSet = new Set();
for (const h of liveTokenShapedHashSet) {
  if (!manifestHashSet.has(h) && !trackedBasenameHashSet.has(h)) staleHashSet.add(h);
}

/**
 * Token matcher for form 2's hashed basenames. A token-shaped forbidden
 * basename is matched by extracting, from a line, every maximal run of
 * [A-Za-z0-9_.-] that is not immediately preceded by another character in
 * that class or by "/" (a "/"-preceded run is form 1's territory - compare
 * buildDirRefRegex's lookbehind above), then testing that run, and each of
 * its "boundary prefixes" - the run itself, plus the text up to (not
 * including) each internal "." - longest first, hashing each candidate and
 * stopping at the first one whose hash is forbidden.
 *
 * This reproduces exactly what the old literal alternation regex found,
 * including a case its own design depends on: the alternation tries its
 * longest alternative TEXTUALLY first and can still fail the lookahead (an
 * alternative "zzz-example-9x.md.b" would match the text of token
 * "zzz-example-9x.md.bak" up to that point, but the next character "a" is a
 * letter, so the lookahead rejects it), in which case the engine backtracks
 * to the next-longest alternative at the SAME position. This matcher never
 * needs to backtrack across a failed literal match, because it only ever
 * proposes a boundary at the token's own end or at an internal "." -
 * exactly the positions the lookahead would ever accept - so a candidate
 * like "zzz-example-9x.md.b" (ending mid-word, before an ordinary letter)
 * is never proposed at all; only lookahead-legal positions are tried, in
 * the same longest-first order, so the first (longest) one whose hash is
 * forbidden is always the same match the regex would have found.
 *
 * (The worked-example names above are deliberately invented - see the test
 * file's own "self-matching discipline" note - since forms 1 and 2, unlike
 * form 3, carry no self-source exemption: a plausible real basename quoted
 * here could someday enter the manifest and start flagging this comment.)
 */
const TOKEN_RE = /[A-Za-z0-9_.-]+/g;

// A full scan hashes every candidate boundary of every token in every scanned
// file - ordinary prose repeats the same short words constantly ("the", file
// extensions, etc.), so memoizing sha256Hex for this hot path cuts wall time
// substantially (measured: this alone brought a full live-tree scan back
// down from several seconds to near the pre-hashing baseline).
const hashCache = new Map();
function cachedSha256Hex(s) {
  let h = hashCache.get(s);
  if (h === undefined) {
    h = sha256Hex(s);
    hashCache.set(s, h);
  }
  return h;
}

function findTokenMatches(line, hashSet) {
  const results = [];
  if (hashSet.size === 0) return results;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    const token = m[0];
    const start = m.index;
    if (start > 0 && line[start - 1] === '/') continue; // form 1's territory, never double-reported
    const ends = [token.length];
    for (let i = 0; i < token.length; i++) {
      if (token[i] === '.') ends.push(i);
    }
    ends.sort((a, b) => b - a); // longest boundary first
    for (const end of ends) {
      if (end <= 0) continue;
      const candidate = token.slice(0, end);
      const hash = cachedSha256Hex(candidate);
      if (hashSet.has(hash)) {
        results.push({ text: candidate, hash });
        break; // longest forbidden boundary wins; no further, shorter candidate is reported
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Form 3: task-workspace prose citation (four unambiguous literal shapes)
// ---------------------------------------------------------------------------
//
// Independent of the .gitignore-derived forbidden-directory set: these four shapes are
// recognized by their own wording, not by naming a scratch directory or an existing basename.
// "task-N brief" and "task-N report" match this wave's per-task scratch filename convention
// (task-N-brief.md, task-N-report.md) used as a noun phrase in prose; "the task brief" and
// "the task report" match the same citation with the number dropped. All four are
// case-insensitive. See the scope note above for why a general
// prose citation ("per the brief") stays out of scope while these four specific shapes do not:
// no shipped file has a legitimate reason to say "task-4 brief" or "the task report", since
// "task" here can only mean this wave's own internal scratch numbering.
const FORM3_PATTERNS = [
  { label: 'task-N brief', re: /\btask-\d+\s+brief\b/gi },
  { label: 'task-N report', re: /\btask-\d+\s+report\b/gi },
  { label: 'the task brief', re: /\bthe task brief\b/gi },
  { label: 'the task report', re: /\bthe task report\b/gi },
];

// Form 3 self-source exemption: this file's own "what-it-does" header and scope note above
// necessarily write out the four literal shapes form 3 matches, in order to describe them to a
// reader. Scanning this file for form 3 would therefore always find its own documentation. This
// file (scripts/checks/check-workspace-refs.mjs) is the one explicitly named exemption from form
// 3 scanning; nothing else is exempted, and forms 1 and 2 still scan this file exactly as before.
// Form 2 now hashes every token in this file's own source against the forbidden hash set on every
// run (unlike form 3, there is no separate exemption for it) - it still does not self-match, not
// because it is skipped, but because none of this file's own tokens happen to hash to a forbidden
// entry, the same reason it never matched form 1's directory-reference pattern either.
const FORM3_SELF_SOURCE_REL_PATH = 'scripts/checks/check-workspace-refs.mjs';

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const findings = [];

for (const rel of filesToScan) {
  const abs = join(scanRoot, ...rel.split('/'));
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue; // unreadable entry - skip, not fatal
  }
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (dirRefRegex) {
      dirRefRegex.lastIndex = 0;
      let m;
      while ((m = dirRefRegex.exec(line)) !== null) {
        const dirName = m[1];
        const trailing = m[2];
        findings.push(
          rel + ':' + lineNo + ': workspace path reference "' + dirName + '/' + trailing + '" - "' +
          dirName + '/" is gitignored and will not exist after a clean checkout'
        );
        if (m.index === dirRefRegex.lastIndex) dirRefRegex.lastIndex++;
      }
    }

    for (const match of findTokenMatches(line, forbiddenHashSet)) {
      const local = hashToLocalOrigin.get(match.hash);
      if (local) {
        findings.push(
          rel + ':' + lineNo + ': bare workspace filename reference "' + local.name +
          '" - it exists only under gitignored directory "' + local.dir +
          '/" and will not exist after a clean checkout'
        );
      } else {
        findings.push(
          rel + ':' + lineNo + ': bare workspace filename reference "' + match.text +
          '" - matches the committed workspace-refs manifest (' + MANIFEST_REL_LABEL +
          ') and will not exist after a clean checkout'
        );
      }
    }

    if (nonTokenShapedBasenameRegex) {
      nonTokenShapedBasenameRegex.lastIndex = 0;
      let m2;
      while ((m2 = nonTokenShapedBasenameRegex.exec(line)) !== null) {
        const name = m2[1];
        const originDir = nonTokenShapedOrigin.get(name);
        findings.push(
          rel + ':' + lineNo + ': bare workspace filename reference "' + name +
          '" - it exists only under gitignored directory "' + originDir +
          '/" and will not exist after a clean checkout'
        );
        if (m2.index === nonTokenShapedBasenameRegex.lastIndex) nonTokenShapedBasenameRegex.lastIndex++;
      }
    }

    if (rel !== FORM3_SELF_SOURCE_REL_PATH) {
      for (const { label, re } of FORM3_PATTERNS) {
        re.lastIndex = 0;
        let m3;
        while ((m3 = re.exec(line)) !== null) {
          findings.push(
            rel + ':' + lineNo + ': task-workspace prose citation "' + m3[0] + '" - names this ' +
            'wave\'s internal scratch-task numbering (' + label + ' shape), which does not survive ' +
            'a clean checkout'
          );
          if (m3.index === re.lastIndex) re.lastIndex++;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

process.stdout.write(
  PREFIX + ' mode: ' + scanModeLabel + ' (' + filesToScan.length + ' file(s) scanned, ' +
  scratchDirs.length + ' scratch gitignored dir(s): ' + (scratchDirs.join(', ') || '(none)') +
  ', ' + forbiddenHashSet.size + ' forbidden basename hash(es): ' + manifestHashSet.size +
  ' from the manifest, ' + liveTokenShapedHashSet.size + ' live-derived, ' +
  nonTokenShapedOrigin.size + ' local-only non-token-shaped)\n'
);

if (staleHashSet.size > 0) {
  process.stdout.write(
    PREFIX + ' NOTICE: ' + staleHashSet.size + ' scratch basename(s) not in the committed ' +
    'manifest; run with --write-manifest\n'
  );
}

if (findings.length === 0) {
  process.stdout.write(PREFIX + ' pass: no workspace-scratch references found\n');
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
