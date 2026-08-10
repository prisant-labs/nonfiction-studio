// scripts/check-docs-completeness.mjs
// what-it-is:   docs reference completeness gate (D-24 docs release gate)
// what-it-does: verifies every shipped agent, skill, and CLI
//               binary has a corresponding reference page under docs/reference/; exits
//               non-zero with named missing pages when any component lacks coverage.
// why:          D-24 (docs release gate) makes this a hard gate, not advisory; Q-02 1.2.
// exit taxonomy: 0 = pass; 1 = named finding(s); 2 = operational error

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const AGENTS_DIR = join(REPO_ROOT, 'agents');
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const BIN_DIR = join(REPO_ROOT, 'bin');
const DOCS_AGENTS = join(REPO_ROOT, 'docs', 'reference', 'agents');
const DOCS_SKILLS = join(REPO_ROOT, 'docs', 'reference', 'skills');
const DOCS_CLI = join(REPO_ROOT, 'docs', 'reference', 'cli');

// The shipped CLI binaries per D-05 (five shipped CLIs via bin/; ns-statusline is the sixth,
// added by OPP-P03, studio HUD; see docs/adr/ADR-0008-status-hud.md for the growth decision).
// Excludes spike/probe scripts and .cmd Windows shims.
const SHIPPED_CLIS = ['ns-claims', 'ns-doctor', 'ns-gate', 'ns-scrub', 'ns-statusline', 'ns-stylometry'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const findings = [];

function addFinding(msg) {
  findings.push(msg);
  process.stderr.write('[check-docs-completeness] MISSING: ' + msg + '\n');
}

// ---------------------------------------------------------------------------
// Check agents
// ---------------------------------------------------------------------------

let agentFiles;
try {
  agentFiles = readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'));
} catch (err) {
  process.stderr.write('[check-docs-completeness] FATAL: cannot read agents/ directory: ' + err.message + '\n');
  process.exit(2);
}

for (const filename of agentFiles) {
  const name = basename(filename, '.md');

  const refPage = join(DOCS_AGENTS, name + '.md');
  if (!existsSync(refPage)) {
    addFinding('docs/reference/agents/' + name + '.md (for agent "' + name + '")');
  }
}

// ---------------------------------------------------------------------------
// Check skills
// ---------------------------------------------------------------------------

let skillEntries;
try {
  skillEntries = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'));
} catch (err) {
  process.stderr.write('[check-docs-completeness] FATAL: cannot read skills/ directory: ' + err.message + '\n');
  process.exit(2);
}

for (const entry of skillEntries) {
  const skillName = entry.name;

  const refPage = join(DOCS_SKILLS, skillName + '.md');
  if (!existsSync(refPage)) {
    addFinding('docs/reference/skills/' + skillName + '.md (for skill "' + skillName + '")');
  }
}

// ---------------------------------------------------------------------------
// Check CLI binaries
// ---------------------------------------------------------------------------

for (const cliName of SHIPPED_CLIS) {
  const binPath = join(BIN_DIR, cliName);
  if (!existsSync(binPath)) {
    process.stderr.write(
      '[check-docs-completeness] WARN: bin/' + cliName + ' not found; skipping docs check for this CLI\n'
    );
    continue;
  }

  const refPage = join(DOCS_CLI, cliName + '.md');
  if (!existsSync(refPage)) {
    addFinding('docs/reference/cli/' + cliName + '.md (for CLI "' + cliName + '")');
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (findings.length === 0) {
  const agentCount = agentFiles.length;
  const skillCount = skillEntries.length;
  process.stdout.write(
    '[check-docs-completeness] pass: all ' + agentCount + ' agent(s), ' +
    skillCount + ' skill(s), and ' + SHIPPED_CLIS.length + ' CLI(s) have reference pages\n'
  );
  process.exit(0);
} else {
  process.stdout.write('[check-docs-completeness] ' + findings.length + ' missing reference page(s)\n');
  process.exit(1);
}
