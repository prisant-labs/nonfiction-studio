// scripts/check-links.mjs
// what-it-is:   relative Markdown link checker
// what-it-does: scans all .md files under docs/ and the repo root, extracts relative
//               Markdown link targets ([text](path) and [text](path#anchor)), and
//               verifies each referenced file exists on disk; reports named errors with
//               file path and line number for every broken link.
// why:          Q-02 1.2 link-check step; cross-references between docs must resolve.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Glob all .md files under a directory tree (recursive)
// ---------------------------------------------------------------------------

function collectMdFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skip hidden dirs like .studio
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      collectMdFiles(full, out);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collect files to scan: docs/ subtree + root-level .md files
// ---------------------------------------------------------------------------

const filesToScan = [];

// Root-level .md files (README.md, CHANGELOG.md, etc.)
try {
  for (const e of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) {
      filesToScan.push(join(REPO_ROOT, e.name));
    }
  }
} catch (err) {
  process.stderr.write('[check-links] FATAL: cannot read repo root: ' + err.message + '\n');
  process.exit(2);
}

// docs/ subtree
const docsDir = join(REPO_ROOT, 'docs');
if (existsSync(docsDir)) {
  collectMdFiles(docsDir, filesToScan);
}

// ---------------------------------------------------------------------------
// Link extraction regex
// Matches [text](target) where target is not empty.
// Captures the target (group 1).
// ---------------------------------------------------------------------------

// Matches markdown links and images: [text](target) or ![text](target)
const LINK_RE = /!?\[(?:[^\]]*)\]\(([^)]+)\)/g;

// ---------------------------------------------------------------------------
// Check each file
// ---------------------------------------------------------------------------

const findings = [];

function isExternalLink(target) {
  return (
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('mailto:') ||
    target.startsWith('//')
  );
}

function isAnchorOnly(target) {
  return target.startsWith('#');
}

for (const absFile of filesToScan) {
  let text;
  try {
    text = readFileSync(absFile, 'utf8');
  } catch (err) {
    findings.push(absFile + ': cannot read file: ' + err.message);
    continue;
  }

  const lines = text.split('\n');
  const fileDir = dirname(absFile);

  // Relative path from repo root for reporting
  const relFile = absFile.replace(REPO_ROOT + '\\', '').replace(REPO_ROOT + '/', '').replace(/\\/g, '/');

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let match;
    LINK_RE.lastIndex = 0;
    while ((match = LINK_RE.exec(line)) !== null) {
      const raw = match[1].trim();

      // Skip external links, anchor-only links, and empty targets
      if (!raw || isExternalLink(raw) || isAnchorOnly(raw)) continue;

      // Separate path from optional fragment (#anchor)
      const hashIdx = raw.indexOf('#');
      const filePart = hashIdx === -1 ? raw : raw.slice(0, hashIdx);

      if (!filePart) continue; // anchor-only after split

      // Resolve relative to the file's directory
      const resolved = resolve(fileDir, filePart);

      if (!existsSync(resolved)) {
        findings.push(relFile + ':' + (li + 1) + ': broken link "' + raw + '" -> resolved "' + resolved.replace(REPO_ROOT, '').replace(/\\/g, '/') + '" does not exist');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (findings.length === 0) {
  process.stdout.write('[check-links] pass: ' + filesToScan.length + ' file(s) checked, no broken relative links\n');
  process.exit(0);
} else {
  for (const f of findings) {
    process.stderr.write('[check-links] ERROR: ' + f + '\n');
  }
  process.stdout.write('[check-links] ' + findings.length + ' broken link(s) found\n');
  process.exit(1);
}
