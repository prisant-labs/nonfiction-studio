// what-it-is:   vendored, zero-dependency YAML-subset parser (C1 fix, Wave 1 exit final review)
// what-it-does: parses the block-style YAML subset actually used by every file this plugin's hook
//               execution path reads: a settings frontmatter block (flat scalars plus one level of
//               nested map/list, e.g. `thresholds:`), an agent's frontmatter (nested maps, nested
//               lists, and folded/literal block scalars for `description:`), and
//               agents/_chain-permitted.yaml (a flat map of scalar keys to string sequences). Not a
//               general YAML implementation: no flow collections (`[...]` / `{...}`), no anchors,
//               aliases, tags, or multi-document streams. Anything outside this subset throws
//               MiniYamlError rather than silently misparsing.
// why:          C1 (Wave 1 exit final review) -- hooks/lib/settings.mjs and hooks/lib/routing.mjs
//               both lazily required the "yaml" npm package, a real runtime dependency. Nothing
//               installs dependencies for an installed plugin (hooks run as
//               `node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs`, no install step anywhere), so on the
//               documented install path both readers silently returned "parser unavailable" and
//               the settings overlay and dispatch-routing enforcement were inert. This module
//               ships in the plugin tree itself (no node_modules dependency, ever) so both callers
//               work identically whether run from a git checkout with dependencies installed or
//               from an installed plugin with none. Follows the same hand-rolled-parser convention
//               scripts/checks/check-compliance-stanza.mjs already uses for its own narrower need
//               (that checker's own comment: "a full YAML parse is more machinery than that
//               needs" -- this module is the generalization the hook path actually needs).
// used-by:      hooks/lib/settings.mjs (settings frontmatter), hooks/lib/routing.mjs (agent
//               frontmatter's `model:` field, and agents/_chain-permitted.yaml in full).

/** Thrown for any input outside the supported block-style subset (matches the "throw on invalid
 * input" contract callers already built around the "yaml" package's own YAMLParseError). */
export class MiniYamlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MiniYamlError';
  }
}

function indentOf(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}

function isBlankOrComment(line) {
  const t = line.trim();
  return t === '' || t.startsWith('#');
}

/** Advances past blank and full-line-comment lines; returns the index of the next real content
 * line (or lines.length at end of input). */
function skipIgnorable(lines, i) {
  while (i < lines.length && isBlankOrComment(lines[i])) i++;
  return i;
}

/** Strips a trailing inline comment (a '#' preceded by start-of-line or whitespace, outside any
 * quoted string) and trims trailing whitespace. Used only on structural lines (key/value,
 * sequence items) -- never on block-scalar continuation lines, whose content is opaque. */
function stripInlineComment(s) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"' && s[i - 1] !== '\\') inDouble = false;
      continue;
    }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

/** Parses one scalar token: quoted string, number, boolean, null, or a bare (plain) string.
 * Throws on anything that looks like an unsupported flow collection ('[' or '{' leading). */
function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s[0] === '[' || s[0] === '{') {
    throw new MiniYamlError('flow-style collections ("[...]" / "{...}") are not supported: ' + s);
  }
  return s;
}

const SEQUENCE_ITEM_RE = /^-(\s+(.*)|)$/;
const MAPPING_KEY_RE = /^([^:#\s][^:]*):\s*(.*)$/;

/** Consumes a folded (">") or literal ("|") block scalar's continuation lines (every line more
 * indented than `indent`, blank lines included) and returns its opaque joined string plus the
 * next unconsumed line index. The exact chomping/folding semantics are not reproduced -- no
 * caller in this plugin reads a block-scalar VALUE, only skips past it to reach the next real
 * key, so "some reasonable string" is all this needs to return. */
function consumeBlockScalar(lines, start, indent, style) {
  const collected = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { collected.push(''); i++; continue; }
    if (indentOf(line) > indent) { collected.push(line.slice(indent)); i++; continue; }
    break;
  }
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();
  const joined = style === '>' ? collected.filter((l) => l !== '').join(' ') : collected.join('\n');
  return { value: joined, next: i };
}

/** Parses a sequence ("- item" lines) at the given indent, starting at lines[start]. */
function parseSequence(lines, start, indent) {
  const items = [];
  let i = start;
  for (;;) {
    const line = lines[i];
    const content = stripInlineComment(line).slice(indent).replace(/\s+$/, '');
    const m = SEQUENCE_ITEM_RE.exec(content);
    if (!m) throw new MiniYamlError('expected a "- item" sequence entry, got: ' + content);
    const itemText = (m[2] || '').trim();
    if (itemText === '') {
      const j = skipIgnorable(lines, i + 1);
      if (j < lines.length && indentOf(lines[j]) > indent) {
        const child = parseNode(lines, j, indentOf(lines[j]));
        items.push(child.value);
        i = child.next;
      } else {
        items.push(null);
        i++;
      }
    } else if (itemText[0] === '>' || itemText[0] === '|') {
      const block = consumeBlockScalar(lines, i + 1, indent, itemText[0]);
      items.push(block.value);
      i = block.next;
    } else {
      items.push(parseScalar(itemText));
      i++;
    }

    const k = skipIgnorable(lines, i);
    if (k < lines.length && indentOf(lines[k]) === indent && /^-(\s|$)/.test(lines[k].slice(indent))) {
      i = k;
      continue;
    }
    return { value: items, next: i };
  }
}

/** Parses a mapping ("key: value" lines) at the given indent, starting at lines[start]. */
function parseMapping(lines, start, indent) {
  const result = {};
  let i = start;
  for (;;) {
    const line = lines[i];
    const content = stripInlineComment(line).slice(indent).replace(/\s+$/, '');
    const m = MAPPING_KEY_RE.exec(content);
    if (!m) throw new MiniYamlError('expected a "key: value" mapping entry, got: ' + content);
    const key = m[1].trim();
    const rest = m[2].trim();
    i++;

    if (rest === '') {
      const j = skipIgnorable(lines, i);
      if (j < lines.length && indentOf(lines[j]) > indent) {
        const child = parseNode(lines, j, indentOf(lines[j]));
        result[key] = child.value;
        i = child.next;
      } else {
        result[key] = null;
      }
    } else if (rest[0] === '>' || rest[0] === '|') {
      const block = consumeBlockScalar(lines, i, indent, rest[0]);
      result[key] = block.value;
      i = block.next;
    } else {
      result[key] = parseScalar(rest);
    }

    const k = skipIgnorable(lines, i);
    if (k < lines.length && indentOf(lines[k]) === indent) {
      i = k;
      continue;
    }
    return { value: result, next: i };
  }
}

/** Dispatches to sequence, mapping, or bare-scalar parsing based on lines[start]'s own shape.
 * Returns { value, next }. Caller guarantees lines[start] is a real (non-blank, non-comment)
 * content line at exactly `indent`. */
function parseNode(lines, start, indent) {
  const line = lines[start];
  const content = stripInlineComment(line).slice(indent).replace(/\s+$/, '');
  if (SEQUENCE_ITEM_RE.test(content)) return parseSequence(lines, start, indent);
  if (MAPPING_KEY_RE.test(content)) return parseMapping(lines, start, indent);
  return { value: parseScalar(content), next: start + 1 };
}

/**
 * Parses a block-style YAML document (or a YAML frontmatter block's inner text). Returns `null`
 * for an empty or comments/whitespace-only document (matching the "yaml" package's own behavior,
 * which this plugin's callers already treat as valid "no settings set" success rather than
 * corruption). Throws MiniYamlError on anything outside the supported subset, including a root
 * document that does not fully consume every line: a sibling line at neither the root's own
 * indent nor a deeper one (a mis-indented key, most commonly) is inconsistent indentation, not a
 * second root value to silently discard -- matching the "yaml" package's own throw-on-bad-
 * indentation behavior, and this module's own no-silent-corruption contract.
 *
 * @param {string} text
 * @returns {null|object|Array|string|number|boolean}
 */
export function parseMiniYaml(text) {
  const lines = String(text).split(/\r?\n/);
  const start = skipIgnorable(lines, 0);
  if (start >= lines.length) return null;
  const indent = indentOf(lines[start]);
  const { value, next } = parseNode(lines, start, indent);
  const trailing = skipIgnorable(lines, next);
  if (trailing < lines.length) {
    throw new MiniYamlError(
      'unexpected content at line ' + (trailing + 1) + ' (inconsistent indentation?): ' +
      lines[trailing].trim()
    );
  }
  return value;
}
