// tests/engines/settings.test.mjs
// what-it-is:   unit tests for hooks/lib/settings.mjs (Wave 1 exit Task 2, P1/P2)
// what-it-does: verifies loadSettings' walk-up resolution, warn-and-default corruption handling
//               (absent file silent; corrupt YAML / non-object frontmatter / unreadable file each
//               produce empty settings plus a one-sentence warning naming the file; a per-key
//               type violation drops only that key and keeps valid siblings), the P2 schema
//               validators for all four v1 keys, unknown-key preservation, and body-verbatim
//               pass-through.
// runner:       node --test tests/engines/settings.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { loadSettings } from '../../hooks/lib/settings.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fresh temp directory under the OS temp root, isolated per test. */
function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'ns-settings-test-'));
}

/** Writes .claude/nonfiction-studio.local.md under dir with the given raw text content. */
function writeSettingsFile(dir, text) {
  const settingsDir = join(dir, '.claude');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, 'nonfiction-studio.local.md'), text, 'utf8');
}

// ---------------------------------------------------------------------------
// Absent file: silent empty defaults (P1)
// ---------------------------------------------------------------------------

test('loadSettings: no settings file anywhere in the ancestor chain -> empty settings, no warning, null path', () => {
  const root = makeTempRoot();
  try {
    const result = loadSettings(root);
    assert.deepStrictEqual(result.settings, {});
    assert.strictEqual(result.body, '');
    assert.strictEqual(result.warning, null, 'absence must be silent -- no warning');
    assert.strictEqual(result.path, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Walk-up resolution
// ---------------------------------------------------------------------------

test('loadSettings: a settings file two directories above startDir is found', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\ngate_mode: warn\n---\nHouse notes here.\n');
    const startDir = join(root, 'a', 'b');
    mkdirSync(startDir, { recursive: true });

    const result = loadSettings(startDir);
    assert.strictEqual(result.settings.gate_mode, 'warn');
    assert.strictEqual(result.path, join(root, '.claude', 'nonfiction-studio.local.md'));
    assert.strictEqual(result.warning, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: a settings file in a sibling tree is not found', () => {
  const root = makeTempRoot();
  try {
    // Sibling A carries a settings file; sibling B (and a subdirectory of B) does not.
    // Walking up from B/sub must never cross into A.
    const siblingA = join(root, 'sibling-a');
    const siblingB = join(root, 'sibling-b');
    mkdirSync(siblingA, { recursive: true });
    const startDir = join(siblingB, 'sub');
    mkdirSync(startDir, { recursive: true });
    writeSettingsFile(siblingA, '---\ngate_mode: block\n---\n');

    const result = loadSettings(startDir);
    assert.deepStrictEqual(result.settings, {}, 'sibling tree settings file must not be found');
    assert.strictEqual(result.path, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: startDir itself carrying the settings file is found without walking up', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\ngate_mode: off\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.settings.gate_mode, 'off');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Corruption handling: warn loudly, default to empty -- never throw, never silently disable
// ---------------------------------------------------------------------------

test('loadSettings: invalid YAML frontmatter -> empty settings, one-sentence warning naming the file, body preserved', () => {
  const root = makeTempRoot();
  try {
    // Unterminated flow mapping: invalid YAML, parses to a syntax error.
    writeSettingsFile(root, '---\ngate_mode: [off, warn\n---\nBody text survives.\n');
    const result = loadSettings(root);
    assert.deepStrictEqual(result.settings, {}, 'corrupt YAML must default to empty settings');
    assert.ok(result.warning, 'corrupt YAML must produce a warning');
    assert.ok(
      result.warning.includes(join(root, '.claude', 'nonfiction-studio.local.md')),
      'warning must name the settings file path; got: ' + result.warning
    );
    assert.strictEqual(
      result.warning.split('\n').length, 1,
      'corrupt-YAML warning must be exactly one sentence (single line); got: ' + result.warning
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: frontmatter block that is empty (every key commented out) parses to null -> valid empty settings, no warning', () => {
  const root = makeTempRoot();
  try {
    // Mirrors templates/nonfiction-studio.local.example.md as shipped: every key commented out.
    writeSettingsFile(root, '---\n# gate_mode: warn\n# thresholds:\n#   overlap_min_words: 20\n---\nHouse notes only, no keys set.\n');
    const result = loadSettings(root);
    assert.deepStrictEqual(result.settings, {}, 'an all-comments frontmatter block is valid, not corrupt');
    assert.strictEqual(result.warning, null, 'an intentionally empty frontmatter block must never warn');
    assert.strictEqual(result.body, 'House notes only, no keys set.\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: frontmatter parses but is not a key/value map (a YAML list) -> empty settings, warning names the file', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\n- one\n- two\n---\n');
    const result = loadSettings(root);
    assert.deepStrictEqual(result.settings, {});
    assert.ok(result.warning);
    assert.ok(result.warning.includes(join(root, '.claude', 'nonfiction-studio.local.md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: file present but missing the YAML frontmatter fence entirely -> empty settings, warning, body is the full text', () => {
  const root = makeTempRoot();
  try {
    const text = 'Just prose. No frontmatter fence at all.\n';
    writeSettingsFile(root, text);
    const result = loadSettings(root);
    assert.deepStrictEqual(result.settings, {});
    assert.ok(result.warning, 'a fenceless file must still warn, never silently pass through as settings');
    assert.strictEqual(result.body, text, 'body must be the full text when no fence is found');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: settings path is a directory, not a file (unreadable) -> empty settings, warning, never throws', () => {
  const root = makeTempRoot();
  try {
    // Create .claude/nonfiction-studio.local.md AS A DIRECTORY so existsSync is true but
    // readFileSync throws EISDIR.
    mkdirSync(join(root, '.claude', 'nonfiction-studio.local.md'), { recursive: true });
    assert.doesNotThrow(() => loadSettings(root));
    const result = loadSettings(root);
    assert.deepStrictEqual(result.settings, {});
    assert.ok(result.warning, 'an unreadable settings path must warn, not throw');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Per-key validation: drop individually, keep valid siblings (P1)
// ---------------------------------------------------------------------------

test('loadSettings: gate_mode wrong type is dropped with a warning; a valid sibling key survives', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\ngate_mode: 5\nthresholds:\n  overlap_min_words: 20\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.settings.gate_mode, undefined, 'invalid gate_mode must be dropped');
    assert.deepStrictEqual(result.settings.thresholds, { overlap_min_words: 20 }, 'valid sibling must survive');
    assert.ok(result.warning && result.warning.includes('gate_mode'), 'warning must name gate_mode');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: gate_mode outside the off|warn|block enum is dropped with a warning', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\ngate_mode: maybe\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.settings.gate_mode, undefined);
    assert.ok(result.warning && result.warning.includes('gate_mode'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: thresholds wrong type (a string, not an object) is dropped; a valid sibling survives', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\nthresholds: "not an object"\ngate_mode: warn\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.settings.thresholds, undefined);
    assert.strictEqual(result.settings.gate_mode, 'warn');
    assert.ok(result.warning && result.warning.includes('thresholds'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: thresholds as a YAML list (array) is dropped -- an array is not a plain object', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\nthresholds:\n  - 1\n  - 2\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.settings.thresholds, undefined);
    assert.ok(result.warning && result.warning.includes('thresholds'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: routing_enforce wrong type/enum is dropped with a warning', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\nrouting_enforce: loud\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.settings.routing_enforce, undefined);
    assert.ok(result.warning && result.warning.includes('routing_enforce'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: output_style wrong type (not a string) is dropped with a warning', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\noutput_style:\n  nested: true\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.settings.output_style, undefined);
    assert.ok(result.warning && result.warning.includes('output_style'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: two invalid keys in the same file each add a warning sentence and both are dropped', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\ngate_mode: nope\nrouting_enforce: 42\noutput_style: manuscript\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.settings.gate_mode, undefined);
    assert.strictEqual(result.settings.routing_enforce, undefined);
    assert.strictEqual(result.settings.output_style, 'manuscript', 'the one valid key survives');
    assert.ok(result.warning.includes('gate_mode'), 'warning must name gate_mode');
    assert.ok(result.warning.includes('routing_enforce'), 'warning must name routing_enforce');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Unknown keys: preserved and ignored (no validation, no warning)
// ---------------------------------------------------------------------------

test('loadSettings: an unknown key is preserved on the settings object with no warning', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\ngate_mode: warn\nsome_future_key: true\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.settings.gate_mode, 'warn');
    assert.strictEqual(result.settings.some_future_key, true);
    assert.strictEqual(result.warning, null, 'an unknown key alone must not produce a warning');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Valid round trip: full P2 schema
// ---------------------------------------------------------------------------

test('loadSettings: a fully valid P2 schema file round-trips with no warning', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(
      root,
      '---\n' +
      'gate_mode: block\n' +
      'thresholds:\n' +
      '  overlap_min_words: 25\n' +
      'routing_enforce: warn\n' +
      'output_style: review\n' +
      '---\n' +
      'Standing author instructions live here.\n'
    );
    const result = loadSettings(root);
    assert.deepStrictEqual(result.settings, {
      gate_mode: 'block',
      thresholds: { overlap_min_words: 25 },
      routing_enforce: 'warn',
      output_style: 'review',
    });
    assert.strictEqual(result.warning, null);
    assert.strictEqual(result.body, 'Standing author instructions live here.\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Body pass-through: verbatim after the closing fence
// ---------------------------------------------------------------------------

test('loadSettings: body is returned verbatim after the closing fence, including blank lines and markdown', () => {
  const root = makeTempRoot();
  try {
    const body = '\n## House notes\n\n- Always cite page numbers.\n- Never use em-dashes.\n';
    writeSettingsFile(root, '---\ngate_mode: warn\n---\n' + body);
    const result = loadSettings(root);
    assert.strictEqual(result.body, body);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSettings: empty body (frontmatter only, nothing after the closing fence) returns an empty string', () => {
  const root = makeTempRoot();
  try {
    writeSettingsFile(root, '---\ngate_mode: warn\n---\n');
    const result = loadSettings(root);
    assert.strictEqual(result.body, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
