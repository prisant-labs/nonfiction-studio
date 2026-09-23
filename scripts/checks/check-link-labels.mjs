// scripts/checks/check-link-labels.mjs
// what-it-is:   link-label agreement checker
// what-it-does: scans every git-tracked .md file under agents/, docs/, examples/, skills/,
//               templates/, plus root-level .md files, for an inline Markdown link
//               ("[label](href)", never an image "![alt](href)") whose href, resolved relative to
//               the linking file's own directory, is a COMPONENT PAGE - a file whose repo-relative
//               path matches one of a fixed set of shapes:
//                 docs/reference/skills/<name>.md or docs/reference/skills/<name>.example.md
//                 docs/reference/agents/<name>.md or docs/reference/agents/<name>.example.md
//                 docs/reference/cli/<name>.md    or docs/reference/cli/<name>.example.md
//                 skills/<name>/SKILL.md
//                 agents/<name>.md
//                 bin/<name>
//               EXCLUDED: files under docs/adr/ and docs/gates/ are skipped entirely - dated,
//               point-in-time historical records (an ADR's own Date: field fixes what it
//               describes to that date; a gate doc records what was true at a named past gate),
//               not living documents that track the current tree. Same rationale and the same
//               path-prefix-skip mechanism as scripts/checks/check-advertised-invocations.mjs and
//               check-component-counts.mjs's HISTORICAL_RECORD_PREFIXES. `output-styles/<name>.md`
//               and `docs/reference/output-styles.md` are deliberately NOT component pages: a
//               survey of the live tree found only four links to the single output-styles
//               reference page and none to either individual style file, too thin a shape to
//               justify a third named page-kind, so this checker leaves that page out of scope.
//               The rule (href-to-label): once an href resolves to a component page, the LABEL
//               text (the raw string between "[" and "]") must contain that component's <name> as
//               a whole token - not preceded or followed by a lowercase letter, digit, or hyphen
//               (a string edge counts as a valid boundary; a backtick, space, or punctuation mark
//               all satisfy it too, so "`nfs-doctor`" and "nfs-doctor's" both count). This also
//               distinguishes two real, separately shipped components whose names share a prefix -
//               "ns-status" is not a token match inside a label naming "ns-statusline" - which a
//               plain substring test would get wrong.
//               Fragment acceptance: when the href carries a "#fragment", a label that fails the
//               token test is still accepted when the label's GitHub-style slug (lowercase, only
//               letters/digits/spaces/hyphens kept, spaces turned into hyphens) equals the
//               fragment - this covers a legitimate section link such as
//               "[Compliance Append](./nfs-draft.md#compliance-append)", whose label names the
//               section, not the component, and is not a labeling defect. A blanket fragment
//               EXEMPTION (accepting every fragment link regardless of its label) was rejected
//               instead: replayed against history it would have hidden a real defect, a label
//               that still named an old, no-longer-shipped component while pointing at a
//               fragment on the renamed page.
//               Code is not prose: a link entirely inside a fenced code block, or entirely inside
//               an inline code span, is skipped - it is literal text shown as an example, not a
//               live cross-reference an author actually clicks. A link whose LABEL merely
//               contains a nested code span (for example "[`nfs-doctor`](...)") is unaffected:
//               only the outer link's own start position is tested against the fenced/code-span
//               ranges, and a code span nested inside a label closes before the label does.
//               An optional CommonMark link title after the destination - "(path "title")",
//               "(path 'title')", or "(path (title))", separated from the destination by
//               whitespace - is stripped before the destination is resolved, so a titled link
//               (ordinary, spec-legal Markdown used for hover text) resolves exactly like its
//               untitled equivalent instead of failing to match any component-page shape.
//               Two shapes are DELIBERATELY out of scope, both precedented by the existing
//               scripts/check-links.mjs, which uses the identical single-line
//               "\[([^\]]*)\]\(([^)]+)\)" link-extraction regex and has never handled them either:
//               reference-style links ("[label][ref]"), angle-bracket destinations
//               ("[label](<path>)"), a label containing balanced nested brackets, and a label
//               whose text spans a soft line break are all silently unrecognized as links at all,
//               rather than misclassified - a false negative, not a false positive, and no worse
//               than the coverage the tree already ships. A 4-space-indented (non-fenced) code
//               block is likewise not recognized as code (only a fenced block or an inline code
//               span is): CommonMark's indentation rule is ambiguous with an ordinary indented
//               list continuation without also parsing list context, which this line-based scanner
//               does not do, and the live tree has zero occurrences of an example link shown this
//               way (house style favors long unwrapped lines and fenced blocks).
//               A secondary rule was also measured and considered: flag a label that is SOLELY one
//               component name (after stripping backticks and bold asterisks) whose href does NOT
//               land on that same component's own page. It measured clean against the live tree
//               (40 bare-name labels, 0 failures), but every one of the 32 real rename-wave defects
//               already took the primary rule's shape (an href correctly repointed at a renamed
//               page, next to a label still naming the OLD component) - the secondary rule would
//               have added zero coverage against the actual defect class this checker exists to
//               close. Its only incremental coverage is a bare component-name label whose href
//               points somewhere else entirely, and that class includes ordinary, legitimate prose:
//               an author writing a bare component name to label a link to a design-discussion
//               section on a DIFFERENT page (for example a label "nfs-doctor" on a link into
//               ../architecture.md's own "nfs-doctor design notes" section) names the component
//               being discussed without claiming to link to its own reference page, and the
//               secondary rule would have flagged that correct, common pattern as a defect.
//               Dropped; this checker enforces the primary, href-to-label rule only.
//               Scope, discovery, and degraded (no-git) fallback: byte-identical in shape to
//               scripts/checks/check-advertised-invocations.mjs - git-tracked file discovery via
//               `git ls-files`, falling back to a plain filesystem walk (which skips
//               dot-prefixed directories, exactly like that checker's own fallback) when git is
//               unavailable or the directory is not a git repository, so a bare directory copy
//               with no .git present (the shape the companion test file's synthetic fixtures use)
//               still scans correctly in degraded mode.
// why:          A prior rename wave changed many shipped component names, and correctly updated
//               href targets across the tree to point at each renamed page - but 32 separate
//               link labels were left holding the OLD, no-longer-shipped name even though their
//               hrefs already resolved to the NEW page: for example a label that was just the old
//               bare name, or that old name followed by the words "skill reference", still
//               sitting next to a parenthetical target that had already been repointed correctly.
//               The existing relative-link checker (scripts/check-links.mjs) validates only that
//               an href resolves to a real, tracked file; it has no opinion on what the label
//               text says, so a stale label naming a component that no longer exists was, and
//               remains, entirely invisible to it - the href was never wrong, only the label.
//               An earlier proposed rule ran the opposite direction: it would flag a label that
//               named a component whose page the link did NOT target - reading label-to-href.
//               Replayed against the historical revisions that carried the 32 real defects, that
//               direction would have caught none of them, because every one of the 32 labels
//               names an OLD component name that is not any shipped page's current name at all;
//               a rule that starts from a name found in the label and looks up that name's page
//               has nothing to key off once the name itself no longer exists anywhere in the
//               tree. This checker therefore runs href-to-label instead: it starts from the
//               target a link's href actually resolves to (which the rename wave DID update
//               correctly, throughout) and asserts the label still names the component that
//               target documents, so a label frozen on a retired name is caught even though the
//               name it uses resolves to nothing.
// exit taxonomy: 0 = every component-page link's label names its target's component; 1 = named
//               finding(s) (a label fails both the token test and, where a fragment is present,
//               the slug test); 2 = operational error (zero files matched the scan scope, which
//               means a broken checkout or a resolution bug, not a clean pass).
// used-by:      .github/workflows/tier-a.yml, the "Link labels name their target" step.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREFIX = '[check-link-labels]';

// ---------------------------------------------------------------------------
// Scan scope: every .md file under agents/, docs/, examples/, skills/,
// templates/, plus root-level .md files, except docs/adr/ and docs/gates/
// (dated historical records - see header comment). Identical shape to
// scripts/checks/check-advertised-invocations.mjs's own Markdown scan scope.
// ---------------------------------------------------------------------------

const SCAN_DIR_PREFIXES = ['agents/', 'docs/', 'examples/', 'skills/', 'templates/'];
const HISTORICAL_RECORD_PREFIXES = ['docs/adr/', 'docs/gates/'];

function isRootLevelFile(rel) {
  return !rel.includes('/');
}

function inScope(rel) {
  if (!rel.endsWith('.md')) return false;
  if (HISTORICAL_RECORD_PREFIXES.some((p) => rel.startsWith(p))) return false;
  if (isRootLevelFile(rel)) return true;
  return SCAN_DIR_PREFIXES.some((p) => rel.startsWith(p));
}

// ---------------------------------------------------------------------------
// Tracked-file discovery (git ls-files), with a plain filesystem-walk
// fallback when git is unavailable or REPO_ROOT is not a git repository -
// mirrors scripts/checks/check-advertised-invocations.mjs, so a temp clone
// with no .git present (the standard fixture shape the companion test file
// uses) still scans correctly in degraded mode.
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

function walkDirRecursive(dir, baseDir, out = []) {
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
      walkDirRecursive(full, baseDir, out);
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

let trackedFiles = getGitTrackedFiles(REPO_ROOT);
let degradedReason = null;
if (!trackedFiles) {
  degradedReason = 'git unavailable or ' + REPO_ROOT + ' is not a git repository';
  trackedFiles = walkRootLevelFiles(REPO_ROOT);
  for (const prefix of SCAN_DIR_PREFIXES) {
    walkDirRecursive(join(REPO_ROOT, prefix.slice(0, -1)), REPO_ROOT, trackedFiles);
  }
}

const filesToScan = trackedFiles.filter(inScope).sort();

if (filesToScan.length === 0) {
  process.stderr.write(
    PREFIX + ' FATAL: zero files matched the scan scope (agents/, docs/, examples/, skills/, ' +
    'templates/, root-level .md files; excluding docs/adr/, docs/gates/) under ' + REPO_ROOT +
    '. This indicates a broken checkout or a resolution bug, not a clean pass.\n'
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Component page map: a repo-relative target path resolves to a component
// name when it matches exactly one of these shapes. See the header comment
// for the full list and the rationale for each.
// ---------------------------------------------------------------------------

const COMPONENT_PAGE_MAP = [
  /^docs\/reference\/skills\/([a-z0-9][a-z0-9-]*)(?:\.example)?\.md$/,
  /^docs\/reference\/agents\/([a-z0-9][a-z0-9-]*)(?:\.example)?\.md$/,
  /^docs\/reference\/cli\/([a-z0-9][a-z0-9-]*)(?:\.example)?\.md$/,
  /^skills\/([a-z0-9][a-z0-9-]*)\/SKILL\.md$/,
  /^agents\/([a-z0-9][a-z0-9-]*)\.md$/,
  /^bin\/([a-z0-9][a-z0-9-]*)$/,
];

function componentNameForTarget(relPath) {
  for (const re of COMPONENT_PAGE_MAP) {
    const m = re.exec(relPath);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fenced-code-block tracking, line by line. Follows CommonMark closer rules
// (same marker character, run length >= the opener's, only whitespace after)
// - the same idiom scripts/checks/mermaid-valid.mjs uses. Both the opening
// and closing fence lines themselves are marked "in fence" (fence syntax,
// not prose a link could legitimately live in).
// ---------------------------------------------------------------------------

const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^\s*(`{3,}|~{3,})\s*$/;

function computeFenceLineFlags(lines) {
  const inFence = new Array(lines.length).fill(false);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    if (fence) {
      inFence[i] = true;
      const close = lines[i].match(FENCE_CLOSE_RE);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.len) fence = null;
      continue;
    }
    const open = lines[i].match(FENCE_OPEN_RE);
    if (open) {
      inFence[i] = true;
      fence = { marker: open[1][0], len: open[1].length };
    }
  }
  return inFence;
}

// ---------------------------------------------------------------------------
// Inline-code-span detection, one line at a time: pairs the first backtick
// run with the next backtick run of the SAME length (CommonMark's own
// pairing rule), so a single stray backtick with no matching close is left
// as ordinary text rather than swallowing the rest of the line.
// ---------------------------------------------------------------------------

function findCodeSpanRanges(line) {
  const runs = [];
  const re = /`+/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    runs.push({ start: m.index, end: re.lastIndex, len: m[0].length });
  }
  const ranges = [];
  let i = 0;
  while (i < runs.length) {
    const opener = runs[i];
    let j = i + 1;
    while (j < runs.length && runs[j].len !== opener.len) j++;
    if (j < runs.length) {
      ranges.push([opener.start, runs[j].end]);
      i = j + 1;
    } else {
      i++;
    }
  }
  return ranges;
}

function isInsideAnyRange(idx, ranges) {
  return ranges.some(([start, end]) => idx >= start && idx < end);
}

// ---------------------------------------------------------------------------
// Token and slug helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True iff label contains name as a whole token: not preceded or followed by
 *  [a-z0-9-] (a string edge counts as a valid boundary on either side). */
function labelHasToken(label, name) {
  const re = new RegExp('(?:^|[^a-z0-9-])' + escapeRegExp(name) + '(?:[^a-z0-9-]|$)');
  return re.test(label);
}

/** GitHub-style heading slug: lowercase, strip everything but letters,
 *  digits, spaces, and hyphens, trim, then turn runs of whitespace into a
 *  single hyphen. */
function githubSlug(text) {
  return text
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// ---------------------------------------------------------------------------
// Link extraction: inline Markdown links only, "[label](href)" - never an
// image ("![alt](href)", excluded by checking the character before "["). A
// label may contain a nested code span or other inline markup; it must not
// itself contain "]" (the same simple, single-line shape
// scripts/check-links.mjs and check-advertised-invocations.mjs both use).
// ---------------------------------------------------------------------------

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

function isExternalLink(target) {
  return (
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('mailto:') ||
    target.startsWith('//')
  );
}

// A CommonMark inline link may carry an optional title after the destination, separated from it
// by whitespace: (dest "title"), (dest 'title'), or (dest (title)). Stripped here, before the
// destination is ever resolved, so a titled link ("[label](path "title")", ordinary hover-text
// markup) resolves exactly like its untitled equivalent instead of the quoted title text becoming
// part of the resolved path and matching no component-page shape.
const LINK_TITLE_RE = /\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))\s*$/;

function stripLinkTitle(href) {
  const m = LINK_TITLE_RE.exec(href);
  return m ? href.slice(0, m.index) : href;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const findings = [];
let componentLinkCount = 0;

for (const rel of filesToScan) {
  const absFile = join(REPO_ROOT, rel);
  let text;
  try {
    text = readFileSync(absFile, 'utf8');
  } catch (err) {
    findings.push(rel + ': cannot read file: ' + err.message);
    continue;
  }

  const lines = text.split(/\r?\n/);
  const fenceFlags = computeFenceLineFlags(lines);
  const fileDir = dirname(absFile);

  for (let li = 0; li < lines.length; li++) {
    if (fenceFlags[li]) continue;
    const line = lines[li];
    const codeSpans = findCodeSpanRanges(line);

    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(line)) !== null) {
      const startIdx = m.index;

      const isImage = startIdx > 0 && line[startIdx - 1] === '!';
      const isInCodeSpan = isInsideAnyRange(startIdx, codeSpans);
      if (isImage || isInCodeSpan) {
        if (m.index === LINK_RE.lastIndex) LINK_RE.lastIndex++;
        continue;
      }

      const label = m[1];
      const rawHref = stripLinkTitle(m[2].trim());

      if (!rawHref || isExternalLink(rawHref) || rawHref.startsWith('#')) {
        if (m.index === LINK_RE.lastIndex) LINK_RE.lastIndex++;
        continue;
      }

      const hashIdx = rawHref.indexOf('#');
      const filePart = hashIdx === -1 ? rawHref : rawHref.slice(0, hashIdx);
      const fragment = hashIdx === -1 ? null : rawHref.slice(hashIdx + 1);

      if (!filePart) {
        if (m.index === LINK_RE.lastIndex) LINK_RE.lastIndex++;
        continue;
      }

      const resolvedAbs = resolve(fileDir, filePart);
      const resolvedRel = relative(REPO_ROOT, resolvedAbs).replace(/\\/g, '/');

      if (resolvedRel === '' || resolvedRel.startsWith('..')) {
        if (m.index === LINK_RE.lastIndex) LINK_RE.lastIndex++;
        continue;
      }

      const name = componentNameForTarget(resolvedRel);
      if (name) {
        componentLinkCount++;
        const tokenOk = labelHasToken(label, name);
        const fragmentOk = fragment !== null && githubSlug(label) === fragment;
        if (!tokenOk && !fragmentOk) {
          findings.push(
            rel + ':' + (li + 1) + ': link label "' + label + '" does not name the component "' +
            name + '" that its target "' + resolvedRel + '" documents' +
            (fragment !== null ? ' (fragment "#' + fragment + '" does not match the label\'s slug either)' : '')
          );
        }
      }

      if (m.index === LINK_RE.lastIndex) LINK_RE.lastIndex++;
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (degradedReason) {
  process.stdout.write(PREFIX + ' NOTE: degraded mode, scanning the filesystem directly instead of the git-tracked set (' + degradedReason + ')\n');
} else {
  process.stdout.write(PREFIX + ' mode: git-tracked (' + filesToScan.length + ' file(s) in scope: agents/, docs/, examples/, skills/, templates/, root-level .md files; excluding docs/adr/, docs/gates/)\n');
}

if (findings.length === 0) {
  process.stdout.write(
    PREFIX + ' pass: ' + filesToScan.length + ' file(s) checked, ' + componentLinkCount +
    ' component-page link(s) found, every label names its target\'s component\n'
  );
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write(PREFIX + ' ERROR: ' + f + '\n');
  }
  process.stdout.write(PREFIX + ' ' + findings.length + ' finding(s) found\n');
  process.exit(1);
}
