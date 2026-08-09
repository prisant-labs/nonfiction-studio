// tests/lib/args.test.mjs
// what-it-is:   unit tests for hooks/lib/args.mjs
// what-it-does: verifies parseArgs behavior for all S-07 flag families and the exit-2 error contract
// runner:       node --test tests/lib/args.test.mjs (or node --test tests/lib/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ArgsError, parseArgs } from '../../hooks/lib/args.mjs';

// ---- ArgsError class -----------------------------------------------------------

test('ArgsError has name, code BAD_ARGS, and exitCode 2', () => {
  const err = new ArgsError('bad flag');
  assert.equal(err.name, 'ArgsError');
  assert.equal(err.code, 'BAD_ARGS');
  assert.equal(err.exitCode, 2);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ArgsError);
});

// ---- unknown flag produces exit-2 error ----------------------------------------

test('unknown flag throws ArgsError with exitCode 2', () => {
  assert.throws(
    () => parseArgs(['--unknown-flag'], ['json']),
    (err) => {
      assert.ok(err instanceof ArgsError, 'error is ArgsError');
      assert.equal(err.exitCode, 2, 'exitCode is 2');
      assert.ok(err.message.includes('--unknown-flag'), 'message names the offending flag');
      return true;
    }
  );
});

test('flag present in S-07 but not in spec throws ArgsError', () => {
  // --online is a valid S-07 flag, but this CLI only accepts --json.
  assert.throws(
    () => parseArgs(['--online'], ['json']),
    (err) => {
      assert.ok(err instanceof ArgsError, 'error is ArgsError');
      assert.equal(err.exitCode, 2, 'exitCode is 2');
      return true;
    }
  );
});

// ---- boolean flags -------------------------------------------------------------

test('boolean flag defaults to false when absent', () => {
  const result = parseArgs([], ['json', 'all', 'online']);
  assert.equal(result.json, false);
  assert.equal(result.all, false);
  assert.equal(result.online, false);
});

test('boolean flag is true when present', () => {
  const result = parseArgs(['--json'], ['json', 'all']);
  assert.equal(result.json, true);
  assert.equal(result.all, false);
});

test('multiple boolean flags parsed independently', () => {
  const result = parseArgs(['--json', '--all', '--online'], ['json', 'all', 'online']);
  assert.equal(result.json, true);
  assert.equal(result.all, true);
  assert.equal(result.online, true);
});

test('boolean flag with a value throws ArgsError', () => {
  assert.throws(
    () => parseArgs(['--json=true'], ['json']),
    (err) => {
      assert.ok(err instanceof ArgsError);
      assert.equal(err.exitCode, 2);
      return true;
    }
  );
});

// ---- string flags --------------------------------------------------------------

test('string flag defaults to null when absent', () => {
  const result = parseArgs([], ['chapter', 'project']);
  assert.equal(result.chapter, null);
  assert.equal(result.project, null);
});

test('string flag parses the value after the equals sign', () => {
  const result = parseArgs(['--chapter=01-intro', '--project=/path/to/book'], ['chapter', 'project']);
  assert.equal(result.chapter, '01-intro');
  assert.equal(result.project, '/path/to/book');
});

test('string flag without a value throws ArgsError', () => {
  assert.throws(
    () => parseArgs(['--chapter'], ['chapter']),
    (err) => {
      assert.ok(err instanceof ArgsError);
      assert.equal(err.exitCode, 2);
      return true;
    }
  );
});

// ---- list flags ----------------------------------------------------------------

test('list flag defaults to null when absent', () => {
  const result = parseArgs([], ['check']);
  assert.equal(result.check, null);
});

test('list flag with a single item returns single-element array', () => {
  const result = parseArgs(['--check=claims'], ['check']);
  assert.deepEqual(result.check, ['claims']);
});

test('list flag with comma-separated items returns an array', () => {
  const result = parseArgs(['--check=claims,scrub,stylometry'], ['check']);
  assert.deepEqual(result.check, ['claims', 'scrub', 'stylometry']);
});

test('list flag trims whitespace around items', () => {
  const result = parseArgs(['--check=claims, scrub , stylometry'], ['check']);
  assert.deepEqual(result.check, ['claims', 'scrub', 'stylometry']);
});

// ---- ns-gate spec (full CLI simulation) ----------------------------------------

test('ns-gate spec parses correctly with all flags', () => {
  const spec = ['check', 'chapter', 'project', 'json'];
  const result = parseArgs(
    ['--check=claims,scrub', '--chapter=01-intro', '--project=/book', '--json'],
    spec
  );
  assert.deepEqual(result.check, ['claims', 'scrub']);
  assert.equal(result.chapter, '01-intro');
  assert.equal(result.project, '/book');
  assert.equal(result.json, true);
});

// ---- ns-doctor spec (mode flags) -----------------------------------------------

test('ns-doctor spec parses report/migrate/check modes', () => {
  // ns-doctor uses --check as a boolean mode flag; ns-gate uses --check=<list>.
  // Spec entries can be objects { name, type } to override the FLAG_DEFS default.
  const spec = [{ name: 'check', type: 'boolean' }, 'migrate', 'report', 'project', 'json'];

  const resultCheck = parseArgs(['--check'], spec);
  assert.equal(resultCheck.check, true);

  const resultMigrate = parseArgs(['--migrate'], spec);
  assert.equal(resultMigrate.migrate, true);

  const resultReport = parseArgs(['--report'], spec);
  assert.equal(resultReport.report, true);
});

// ---- ns-stylometry spec (baseline flag) ----------------------------------------

test('ns-stylometry spec parses --baseline=<path>', () => {
  const spec = ['chapter', 'all', 'baseline', 'project', 'json'];
  const result = parseArgs(['--baseline=/some/path/baseline.json', '--all'], spec);
  assert.equal(result.baseline, '/some/path/baseline.json');
  assert.equal(result.all, true);
});

// ---- positional argument error -------------------------------------------------

test('positional argument (not starting with --) throws ArgsError', () => {
  assert.throws(
    () => parseArgs(['somearg'], ['json']),
    (err) => {
      assert.ok(err instanceof ArgsError);
      assert.equal(err.exitCode, 2);
      return true;
    }
  );
});

// ---- validate-packs flag -------------------------------------------------------

test('validate-packs flag parses as boolean', () => {
  const result = parseArgs(['--validate-packs'], ['validate-packs']);
  assert.equal(result['validate-packs'], true);
});
