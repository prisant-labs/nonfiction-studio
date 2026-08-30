// tests/checks/version-literals.test.mjs
// what-it-is:   guard against a shipped instruction restating an engine constant's value
// what-it-does: scans every shipped instruction file (skills/**/SKILL.md and agents/*.md) for
//               a comparison written against a bare numeric literal where a code constant is
//               the source of truth, and fails naming the file and line.
// why:          skills/nfs-check-chapter/SKILL.md told the model to treat a baseline as stale
//               unless marker_set_version equalled a literal 2. CURRENT_MARKER_SET_VERSION had
//               moved to 3, so every current baseline read as stale: the voice-drift check was
//               skipped on every run through that skill, and the author was advised to
//               re-capture a baseline that was already correct. A shipped feature was silently
//               off and nothing caught it. The file even carried its own inline note to
//               re-check the number by hand, which is the tell: a value maintained by human
//               vigilance across two files is a value that will drift. Found by the 2026-08-21
//               pre-flight audit, recorded as PF-23 (stale version literal).
//
//               The remedy enforced here is structural rather than corrective. An instruction
//               must NAME the constant and send the reader to it, never restate the value. A
//               named constant cannot go stale; a copied number always can, and this
//               repository has now lost that bet twice: once here, and once with the component
//               counts that recurred across four separate sweeps before
//               scripts/checks/check-component-counts.mjs ended it.
// runner:       node --test "tests/checks/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const TICK = String.fromCharCode(96);

// Detection is PARAGRAPH-scoped rather than one regex spanning the whole phrase. The first
// version of this guard used a single pattern with a [^.] span and a mutation proved it
// decorative: the real prose puts a sentence boundary between the field name and the
// comparison, and the dotted path stylometry.baseline.marker_set_version carries periods of
// its own, so nothing excluding a period can span it. Two independent signals in the same
// paragraph is both robust and hard to trip by accident.
const GUARDED = [
  {
    constant: 'CURRENT_MARKER_SET_VERSION',
    module: 'hooks/lib/stylometry-engine.mjs',
    subject: /marker_set_version/i,
    comparison: new RegExp('\\b(?:equal to|equals|is|matches|match|be)\\b\\s*' + TICK + '\\d+' + TICK, 'i'),
    why: 'the engine bumps this; an instruction restating the number disables the check it guards',
  },
];

// A paragraph is a run of lines between blank lines. Fenced code blocks are excluded: a
// worked example showing real CLI output legitimately contains the current number, and
// flagging that would push authors toward vaguer examples rather than truer instructions.
function paragraphs(text) {
  const out = [];
  let inFence = false;
  let buf = [];
  let startLine = 1;
  const lines = text.split('\n');
  const FENCE = new RegExp('^\\s*' + TICK + TICK + TICK);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (line.trim() === '') {
      if (buf.length) { out.push({ text: buf.join(' '), line: startLine }); buf = []; }
    } else {
      if (!buf.length) startLine = i + 1;
      buf.push(line);
    }
  }
  if (buf.length) out.push({ text: buf.join(' '), line: startLine });
  return out;
}

function scanText(text, label) {
  const findings = [];
  for (const para of paragraphs(text)) {
    for (const g of GUARDED) {
      if (!g.subject.test(para.text)) continue;
      if (!g.comparison.test(para.text)) continue;
      findings.push(
        label + ':' + para.line +
        ' restates ' + g.constant + ' as a literal. ' + g.why +
        '. Name the constant and its module (' + g.module + ') instead of writing the number.'
      );
    }
  }
  return findings;
}

function shippedInstructionFiles() {
  const files = [];
  const skillsDir = join(REPO_ROOT, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(p)) files.push(p);
    }
  }
  const agentsDir = join(REPO_ROOT, 'agents');
  if (existsSync(agentsDir)) {
    for (const name of readdirSync(agentsDir)) {
      if (name.endsWith('.md')) files.push(join(agentsDir, name));
    }
  }
  return files;
}

function scan(files) {
  const findings = [];
  for (const file of files) {
    const label = file.replace(REPO_ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
    findings.push(...scanText(readFileSync(file, 'utf8'), label));
  }
  return findings;
}

test('shipped instructions name engine constants rather than restating their values', () => {
  const files = shippedInstructionFiles();
  assert.ok(files.length > 0, 'expected at least one shipped instruction file to scan');
  const findings = scan(files);
  assert.deepEqual(findings, [],
    'a shipped instruction restates an engine constant as a literal:\n  ' + findings.join('\n  '));
});

test('the guard has teeth: the exact prose that shipped undetected is caught', () => {
  // Reconstructed rather than quoted from the live file, so this test keeps working after
  // that file is corrected. This is the shape that shipped and went unnoticed: the field
  // name and the comparison sit in one paragraph but are separated by a sentence boundary,
  // which is precisely what defeated the first version of this guard.
  const planted =
    'If ' + TICK + 'stylometry.baseline.markers' + TICK + ' is present and non-null, also check ' +
    TICK + 'stylometry.baseline.marker_set_version' + TICK + ' in that same read. If it is ' +
    'absent, null, or not equal to ' + TICK + '2' + TICK + ', the stored baseline predates the ' +
    'corrected engine and will be rejected.';

  const findings = scanText(planted, 'planted.md');
  assert.equal(findings.length, 1,
    'expected exactly one finding, got: ' + JSON.stringify(findings));
  assert.match(findings[0], /CURRENT_MARKER_SET_VERSION/,
    'the finding must name the constant whose value was restated');
});

test('the guard does not fire on the corrected phrasing', () => {
  const correct =
    'If ' + TICK + 'stylometry.baseline.markers' + TICK + ' is present and non-null, also check ' +
    TICK + 'stylometry.baseline.marker_set_version' + TICK + ' in that same read. If it is ' +
    'absent, null, or different from the value of ' + TICK + 'CURRENT_MARKER_SET_VERSION' + TICK +
    ' exported by ' + TICK + 'hooks/lib/stylometry-engine.mjs' + TICK + ', the stored baseline ' +
    'predates the current engine.';

  assert.deepEqual(scanText(correct, 'correct.md'), [],
    'the guard must not fire on an instruction that names the constant instead of its value, ' +
    'or authors will be pushed back toward writing the number');
});

test('the guard ignores fenced code blocks, where a real number belongs', () => {
  const withExample =
    'The engine prints the vector alongside a version number:\n\n' +
    TICK + TICK + TICK + 'json\n' +
    '{ "marker_set_version": 3 }\n' +
    TICK + TICK + TICK + '\n\n' +
    'Read the constant, not this example, when comparing.';

  assert.deepEqual(scanText(withExample, 'example.md'), [],
    'a worked example showing real output must not be flagged, or authors will make their ' +
    'examples vaguer instead of their instructions truer');
});
