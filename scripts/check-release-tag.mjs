// scripts/check-release-tag.mjs
// what-it-is:   release-tag version-agreement checker
// what-it-does: compares a git tag name against the version fields in the three
//               version-bearing manifests -- library.json (the version source of truth per
//               the U9 version-match check), package.json, and .claude-plugin/plugin.json --
//               and exits nonzero, naming every manifest that disagrees, unless the tag and
//               all three agree exactly.
// why:          the release tag workflow (.github/workflows/release.yml) needs this as its
//               only piece of real logic, kept out of YAML per the house convention that zero
//               validation logic lives there and every step is exactly one node or CLI call.
//               Nothing else in this repo checks a pushed tag against the shipped version
//               strings; U9 (version-match) and U8 (manifest-drift) only check the manifests
//               against each other, never against a tag.
// usage:        node scripts/check-release-tag.mjs [tag]
//               tag defaults to process.env.GITHUB_REF_NAME (the tag name GitHub Actions sets
//               on a tag-triggered run, e.g. "v0.2.0"); a leading "v" is stripped before
//               comparison, so tag v0.2.0 matches a manifest version of "0.2.0".
// exit taxonomy: 0 = tag and all three manifests agree; 1 = one or more manifests disagree
//                (named); 2 = operational error (no tag resolvable, a manifest missing or not
//                valid JSON)

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const PREFIX = '[check-release-tag]';

// The version-bearing manifests this repo actually ships (matches the U9 version-match and U8
// manifest-drift checks' scope; there is no .codex-plugin/plugin.json in this Claude-only
// plugin, so it is deliberately not in this list).
const VERSION_FILES = ['library.json', 'package.json', '.claude-plugin/plugin.json'];

function log(msg) { process.stdout.write(PREFIX + ' ' + msg + '\n'); }
function logErr(msg) { process.stderr.write(PREFIX + ' ' + msg + '\n'); }

function fail(code, msg) {
  logErr(msg);
  process.exit(code);
}

const rawTag = process.argv[2] || process.env.GITHUB_REF_NAME;
if (!rawTag) {
  fail(2, 'no tag given: pass one as an argument, or set GITHUB_REF_NAME (GitHub Actions sets this automatically on a tag-triggered run)');
}
const tagVersion = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;

const versions = {};
for (const rel of VERSION_FILES) {
  const abs = join(REPO_ROOT, ...rel.split('/'));
  if (!existsSync(abs)) {
    fail(2, 'missing version-bearing manifest: ' + rel);
  }
  let data;
  try {
    data = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    fail(2, rel + ' is not valid JSON: ' + err.message);
  }
  versions[rel] = data.version;
}

const mismatches = VERSION_FILES.filter((rel) => versions[rel] !== tagVersion);

if (mismatches.length > 0) {
  for (const rel of mismatches) {
    logErr(
      'MISMATCH: ' + rel + ' version "' + versions[rel] + '" does not equal tag "' + rawTag +
      '" (compared as "' + tagVersion + '")'
    );
  }
  fail(1, mismatches.length + ' of ' + VERSION_FILES.length + ' manifest(s) disagree with tag "' + rawTag + '"');
}

log('pass: tag "' + rawTag + '" agrees with ' + VERSION_FILES.join(', ') + ' (all "' + tagVersion + '")');
process.exit(0);
