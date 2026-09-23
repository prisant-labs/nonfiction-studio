// tests/lib/mini-yaml.test.mjs
// what-it-is:   unit tests for hooks/lib/mini-yaml.mjs (C1 fix, Wave 1 exit final review)
// what-it-does: exercises the vendored YAML-subset parser directly against the shapes its two
//               callers actually feed it (flat settings frontmatter, an agent's full frontmatter
//               including a folded description scalar and nested metadata, and
//               agents/_chain-permitted.yaml's flat map-of-sequences), plus its error paths (flow
//               collections, mis-indented siblings, a repeated key within one mapping, and a
//               nested child line whose indentation mixes spaces and tabs) and the
//               empty/comments-only success case.
// runner:       node --test tests/lib/mini-yaml.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMiniYaml, MiniYamlError } from '../../hooks/lib/mini-yaml.mjs';

test('empty document parses to null', () => {
  assert.strictEqual(parseMiniYaml(''), null);
});

test('comments-only document parses to null', () => {
  assert.strictEqual(parseMiniYaml('# gate_mode: warn\n# thresholds:\n#   overlap_min_words: 20\n'), null);
});

test('flat scalars: string, number, boolean, and an unknown key pass through', () => {
  const doc = parseMiniYaml('gate_mode: block\ncount: 5\nflag: true\nsome_future_key: hello\n');
  assert.deepStrictEqual(doc, { gate_mode: 'block', count: 5, flag: true, some_future_key: 'hello' });
});

test('one level of nested map (thresholds shape)', () => {
  const doc = parseMiniYaml('thresholds:\n  overlap_min_words: 20\n  another: 3.5\n');
  assert.deepStrictEqual(doc, { thresholds: { overlap_min_words: 20, another: 3.5 } });
});

test('one level of nested sequence', () => {
  const doc = parseMiniYaml('thresholds:\n  - 1\n  - 2\n');
  assert.deepStrictEqual(doc, { thresholds: [1, 2] });
});

test('top-level sequence (not a map) parses to an array', () => {
  assert.deepStrictEqual(parseMiniYaml('- one\n- two\n'), ['one', 'two']);
});

test('quoted string scalar', () => {
  assert.deepStrictEqual(parseMiniYaml('thresholds: "not an object"\n'), { thresholds: 'not an object' });
});

test('a flow-style value ("[" or "{" leading) throws MiniYamlError', () => {
  assert.throws(() => parseMiniYaml('gate_mode: [off, warn\n'), MiniYamlError);
  assert.throws(() => parseMiniYaml('model: {unclosed\n'), MiniYamlError);
});

test('a chain-permitted.yaml-shaped document: flat map of string sequences, with comments', () => {
  const doc = parseMiniYaml(
    '# fixture chain contract\n' +
    'interviewer:\n' +
    '  - nfs-new-book\n' +
    '\n' +
    '# another edge\n' +
    'drafting-partner:\n' +
    '  - research-librarian\n'
  );
  assert.deepStrictEqual(doc, {
    interviewer: ['nfs-new-book'],
    'drafting-partner': ['research-librarian'],
  });
});

test('an agent-frontmatter-shaped document: folded scalar, nested map with a nested list, all skipped correctly to reach a later top-level key', () => {
  const doc = parseMiniYaml(
    'name: line-editor\n' +
    'description: >-\n' +
    '  Applies sentence clarity edits as proposals only; flags meaning\n' +
    '  changes; never removes or alters claim markers.\n' +
    'model: sonnet\n' +
    'color: orange\n' +
    'tools:\n' +
    '  - Read\n' +
    '  - Write\n' +
    'metadata:\n' +
    '  version: 0.1.0\n' +
    '  agent-targets:\n' +
    '    - claude\n'
  );
  assert.strictEqual(doc.model, 'sonnet');
  assert.strictEqual(doc.color, 'orange');
  assert.deepStrictEqual(doc.tools, ['Read', 'Write']);
  assert.deepStrictEqual(doc.metadata, { version: '0.1.0', 'agent-targets': ['claude'] });
  assert.strictEqual(typeof doc.description, 'string');
});

// ---------------------------------------------------------------------------
// Regression: a mis-indented sibling must throw, not silently discard content (advisor-caught gap
// - the first version of parseMiniYaml only ever parsed the FIRST top-level node and silently
// dropped every line after it that did not belong to that node, which would have let a
// stray-indented "routing_enforce: block" go completely unwarned, the exact failure class this
// whole fix (C1) exists to close).
// ---------------------------------------------------------------------------

test('a mis-indented second key (one stray leading space) throws MiniYamlError rather than being silently dropped', () => {
  assert.throws(
    () => parseMiniYaml('gate_mode: warn\n routing_enforce: block\n'),
    MiniYamlError,
    'inconsistent indentation must be a parse error, not a silently truncated document'
  );
});

test('a mapping value nested one level too deep (over-indented) throws rather than being silently absorbed', () => {
  assert.throws(
    () => parseMiniYaml('gate_mode: warn\n    routing_enforce: block\n'),
    MiniYamlError
  );
});

// ---------------------------------------------------------------------------
// Regression: a repeated key within one mapping throws naming the line, rather than silently
// resolving last-wins (the real "yaml" package this module replaces throws on this shape; a stray
// repeated routing_enforce: line silently changing enforcement mode would violate the settings
// page's never-silently-disable promise).
// ---------------------------------------------------------------------------

test('a repeated key within one mapping throws MiniYamlError naming the 1-based line number', () => {
  assert.throws(
    () => parseMiniYaml('gate_mode: warn\nrouting_enforce: block\nrouting_enforce: off\n'),
    (err) => err instanceof MiniYamlError && /\bline 3\b/.test(err.message),
    'must throw naming line 3 (the second occurrence), not silently take the last value'
  );
});

test('a repeated key in a nested mapping throws MiniYamlError naming the 1-based line number', () => {
  assert.throws(
    () => parseMiniYaml('thresholds:\n  overlap_min_words: 20\n  overlap_min_words: 5\n'),
    (err) => err instanceof MiniYamlError && /\bline 3\b/.test(err.message),
    'a duplicate inside a nested mapping must throw too, naming the line it repeats on'
  );
});

test('the same key name at two different mapping depths is not a duplicate (each mapping tracks its own keys)', () => {
  const doc = parseMiniYaml('name: outer\nthresholds:\n  name: inner\n');
  assert.deepStrictEqual(doc, { name: 'outer', thresholds: { name: 'inner' } });
});

// ---------------------------------------------------------------------------
// Regression: a nested child line whose leading indentation mixes spaces and tabs throws naming
// the line, rather than degrading to a garbled scalar (indentOf only counts spaces, so a
// spaces-then-tab prefix under-measures the child's own indent width and the child line's content
// -- still carrying the tab -- fails both the mapping-key and sequence-item shape checks and falls
// through to being misparsed as a bare scalar).
// ---------------------------------------------------------------------------

test('a nested mapping child indented with a mix of spaces and a tab throws MiniYamlError naming the line, instead of misparsing as a scalar', () => {
  // Two spaces then a tab, then "child: value" -- indentOf sees only the two spaces.
  const doc = 'parent:\n  \tchild: value\n';
  assert.throws(
    () => parseMiniYaml(doc),
    (err) => err instanceof MiniYamlError && /\bline 2\b/.test(err.message) && /tab/i.test(err.message),
    'must throw naming line 2 and mentioning the tab, not silently produce a garbled scalar'
  );
});

test('a sequence item\'s own nested child indented with a mix of spaces and a tab throws MiniYamlError naming the line', () => {
  // "items:" descends into a sequence at indent 2; that lone item's own value is empty, so it
  // descends again into a nested mapping at indent 4 -- exercising parseSequence's own child
  // descent point, distinct from the mapping-child case above.
  const doc = 'items:\n  -\n    \tkey: value\n';
  assert.throws(
    () => parseMiniYaml(doc),
    (err) => err instanceof MiniYamlError && /\bline 3\b/.test(err.message) && /tab/i.test(err.message)
  );
});

test('indentation of spaces only is unaffected by the mixed-indentation check', () => {
  assert.deepStrictEqual(
    parseMiniYaml('thresholds:\n  overlap_min_words: 20\n'),
    { thresholds: { overlap_min_words: 20 } }
  );
});
