// what-it-is:   the uniform CLI flag parser for all five engine CLIs
// what-it-does: parses process.argv against a declared flag spec and returns a normalized options object;
//               unknown flags produce a typed exit-2 error with a usage hint
// why:          all five engine CLIs share the same S-07 flag families; one parser keeps the contract uniform
//               and ensures every CLI exits 2 on bad arguments with the same message shape
// used-by:      imported by bin/ns-gate, bin/ns-claims, bin/ns-stylometry, bin/ns-scrub, bin/ns-doctor

/**
 * Typed error for the exit-2 class (bad arguments).
 * Callers catch ArgsError and exit with code 2.
 */
export class ArgsError extends Error {
  constructor(message, usage = '') {
    super(message + (usage ? '\nUsage: ' + usage : ''));
    this.name = 'ArgsError';
    this.code = 'BAD_ARGS';
    this.exitCode = 2;
  }
}

// Complete S-07 flag definitions: name -> { type: 'boolean' | 'string' | 'list' }
// boolean: standalone flag (--flag), value is true/false
// string:  value flag (--flag=<value>), value is a string
// list:    comma-separated list (--check=claims,scrub), value is string[]
const FLAG_DEFS = {
  'all':            { type: 'boolean' },
  'online':         { type: 'boolean' },
  'json':           { type: 'boolean' },
  'report':         { type: 'boolean' },
  'migrate':        { type: 'boolean' },
  'validate-packs': { type: 'boolean' },
  'chapter':        { type: 'string' },
  'project':        { type: 'string' },
  'baseline':       { type: 'string' },
  'check':          { type: 'list' },
  'measure':        { type: 'list' },
};

/**
 * Parses argv (typically process.argv.slice(2)) against the given spec.
 *
 * Each spec entry is either:
 *   - a string (flag name) - type is looked up in FLAG_DEFS
 *   - an object { name: string, type: 'boolean'|'string'|'list' } - inline type override
 *
 * Inline type overrides are necessary when a CLI uses an S-07 flag name with different semantics
 * (for example, ns-doctor uses --check as a boolean mode flag while ns-gate uses --check=<list>).
 *
 * @param {string[]} argv - raw argument array containing only flags (no executable or script names)
 * @param {Array<string|{name:string,type:string}>} spec - flags this CLI accepts; unknown flags are exit-2 errors
 * @returns {object} parsed options; booleans default to false, strings and lists default to null
 * @throws {ArgsError} with exitCode 2 on unknown flags, missing required values, or positional arguments
 */
export function parseArgs(argv, spec) {
  // Normalize spec entries to { name, type } objects.
  const normalizedSpec = spec.map(entry => {
    if (typeof entry === 'string') {
      if (!Object.prototype.hasOwnProperty.call(FLAG_DEFS, entry)) {
        throw new ArgsError('Unknown flag name in spec (not an S-07 flag): --' + entry);
      }
      return { name: entry, type: FLAG_DEFS[entry].type };
    }
    // Inline type override: validate name but use the provided type.
    if (typeof entry === 'object' && entry !== null && entry.name && entry.type) {
      return { name: entry.name, type: entry.type };
    }
    throw new ArgsError('Invalid spec entry: ' + JSON.stringify(entry));
  });

  // Build an O(1) lookup map: name -> type definition.
  const allowed = new Map(normalizedSpec.map(e => [e.name, e]));

  // Seed result with defaults derived from the spec.
  const result = {};
  for (const { name, type } of normalizedSpec) {
    result[name] = type === 'boolean' ? false : null;
  }

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      throw new ArgsError(
        'Unexpected positional argument: ' + arg,
        normalizedSpec.map(e => '--' + e.name).join(' ')
      );
    }

    const withoutDashes = arg.slice(2);
    const eqIndex = withoutDashes.indexOf('=');
    const name = eqIndex === -1 ? withoutDashes : withoutDashes.slice(0, eqIndex);
    const rawValue = eqIndex === -1 ? null : withoutDashes.slice(eqIndex + 1);

    if (!allowed.has(name)) {
      const validFlags = normalizedSpec.map(e => '--' + e.name).join(', ');
      throw new ArgsError(
        'Unknown flag: --' + name,
        'Valid flags for this command: ' + validFlags
      );
    }

    const def = allowed.get(name);

    if (def.type === 'boolean') {
      if (rawValue !== null) {
        throw new ArgsError('Flag --' + name + ' does not accept a value');
      }
      result[name] = true;
    } else if (def.type === 'string') {
      if (rawValue === null) {
        throw new ArgsError(
          'Flag --' + name + ' requires a value',
          '--' + name + '=<value>'
        );
      }
      result[name] = rawValue;
    } else if (def.type === 'list') {
      if (rawValue === null) {
        throw new ArgsError(
          'Flag --' + name + ' requires a value',
          '--' + name + '=<item>[,<item>...]'
        );
      }
      result[name] = rawValue.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
  }

  return result;
}
