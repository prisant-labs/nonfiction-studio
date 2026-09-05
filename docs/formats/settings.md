# Settings File Format

**Purpose.** This is the normative grammar for `.claude/nonfiction-studio.local.md`, the per-project studio settings file (schema v1), read by `hooks/lib/settings.mjs`'s `loadSettings`. The file lets an author tune gate strictness, threshold values, dispatch-routing enforcement, and an output-style record for one project, without touching the shared, version-controlled `.studio/config.json`. It is optional everywhere it is read: absent, it changes nothing, and every default already in effect stays in effect. A parser author must be able to implement a conformant reader without consulting any other document.

## Location and discovery

The file lives at `.claude/nonfiction-studio.local.md`, relative to a book project's root or one of its ancestors. `loadSettings(startDir)` walks **up** from `startDir` - the same walk shape `findBookRoot` uses to locate the book root itself - checking, at each directory including `startDir` itself, whether `.claude/nonfiction-studio.local.md` exists there. The first ancestor that has one wins; the walk stops at the filesystem root. A settings file in a sibling tree, or below `startDir`, is never found.

Absent anywhere in the ancestor chain is silent success: empty settings, no warning, no dropped keys, and a `null` path.

## File structure

The file is a Markdown document whose top begins with a YAML frontmatter fence: a `---` line, the YAML block, a closing `---` line, and then everything after the closing fence is free-form Markdown the studio calls the **body**. A file with no fence at all is treated as a whole-file failure (below); its entire text is preserved as the body, since there is no fenced block to separate from it.

The body is never parsed or validated. `hooks/session-start.mjs` reads only whether it is non-empty, and if so emits a one-line pointer at session start telling Claude to read and honor it - this is the "house notes" mechanism: author-specific standing instructions (numeral conventions, citation style, a personal preference for straight hyphens over em-dashes) that do not belong in the shared, version-controlled bible files.

## Schema v1

Every key is optional. An unrecognized key is preserved on the returned `settings` object without validation, so a future schema addition round-trips safely through an older reader.

| Key | Type | Values | Effect | Default when absent |
|---|---|---|---|---|
| `gate_mode` | string (enum) | `off`, `warn`, `block` | Overrides `.studio/config.json`'s top-level `gate.mode` for this project. | Whatever `config.json` says (its own shipped default is `warn`). |
| `thresholds` | object | any plain object | Shallow-merged **over** `config.json`'s `thresholds` object: a key present here wins on a collision; a key absent here passes `config.json`'s value through unchanged. | `config.json`'s `thresholds` object, unmodified. |
| `routing_enforce` | string (enum) | `off`, `warn`, `block` | Controls how strictly `hooks/pre-tool-use.mjs`'s dispatch-routing branch (model-tier and chain-edge checks, D-18 in-plugin model routing) enforces at agent-dispatch time. | `warn`. |
| `output_style` | string | any string (not enum-checked by this reader) | A **record** of the `nfs-new-book` output-style offer's outcome (`"manuscript"`, `"review"`, or `"declined"`), not an activation switch. The style itself is activated by a different mechanism entirely - see [Output styles](../reference/output-styles.md). | No record exists; the offer has not yet been answered for this project. |

## Corruption handling

Every failure mode is fail-open: `loadSettings` never throws, and a corrupt or malformed file never breaks a session, never silently disables a guard, and never changes gate or hook behavior beyond substituting empty settings for whatever the file would have supplied. Every failure carries exactly one warning sentence naming the settings file's path, collapsed to a single printable line even when the underlying parse error is multi-line.

Two different granularities of failure exist, and callers with more than one settings key in play distinguish them via a `droppedKeys` array (see Return contract, below):

**Whole-file failures** - the file could not be read; it has no YAML frontmatter fence; the YAML parser dependency is unavailable; the YAML itself fails to parse; or the parsed frontmatter is not a key/value map (a bare string, number, or list). Every one of these returns empty settings, a one-sentence warning, and an **empty** `droppedKeys` - no single key can be blamed when the whole file is the casualty.

One YAML result is deliberately **not** treated as a failure: an empty or comments-only frontmatter block parses to `null`, and `null` is routed to silent success (empty settings, no warning) rather than the "not a key/value map" warning. This is what lets the shipped example template, copied verbatim with every key left commented out, produce zero warnings.

**Per-key failures** - the file parses to a valid key/value map, but one or more *known* keys (the four in the Schema v1 table) fail their own type or enum check. Each failing key is dropped individually; every valid key, known or unknown, survives; and the returned `droppedKeys` array names exactly which known keys were dropped, one warning sentence per key, joined with a space.

| Failure | `settings` | `warning` | `droppedKeys` |
|---|---|---|---|
| File unreadable | `{}` | one sentence, path + read error | `[]` |
| No frontmatter fence | `{}` | one sentence, path | `[]` |
| YAML parser unavailable | `{}` | one sentence, path + underlying error | `[]` |
| Invalid YAML | `{}` | one sentence, path + underlying error | `[]` |
| Frontmatter is empty/comments-only (parses to `null`) | `{}` | `null` (success, not a failure) | `[]` |
| Frontmatter parses but is not a key/value map | `{}` | one sentence, path | `[]` |
| One or more known keys fail their own schema | surviving keys only | one sentence per dropped key | names of the dropped keys |
| File absent anywhere in the ancestor chain | `{}` | `null` | `[]` |

## Return contract

`loadSettings(startDir)` returns:

```
{
  settings: object,          // validated key/value map; unknown keys pass through unvalidated
  body: string,               // everything after the closing frontmatter fence, or the full raw
                               // text when no fence was found at all; empty ('') when the file
                               // was unreadable or absent everywhere in the ancestor chain
  warning: string | null,     // one collapsed-to-one-line sentence (or several, space-joined),
                               // or null when nothing was dropped
  path: string | null,        // the absolute path of the settings file found, or null if none
  droppedKeys: string[]       // names of known keys individually dropped; empty on every
                               // whole-file failure and on success
}
```

## Precedence, and the never-un-coerce invariant

`hooks/lib/gate-engine.mjs`'s `loadGateConfig` is the single choke point where settings are read into the gate config; nothing else in the gate path reads this file. The layering order is:

```
DEFAULT_GATE  <-  .studio/config.json (gate + thresholds)  <-  settings mappings
              (gate_mode -> gate.mode; thresholds -> shallow merge)  <-  structural coercions
```

The settings overlay runs **before** the structural coercions (D-03, layered Stop gate: `thesis_alignment` and `quote_fidelity` can never block in v1), and this ordering is deliberate and load-bearing: `gate_mode` can raise the top-level `gate.mode` all the way to `block`, and `thresholds` can override any threshold value, but neither can promote `thesis_alignment` or `quote_fidelity` out of their coerced `warn` mode. The reason is structural rather than a convention someone could accidentally violate: the settings schema has no per-check mode key at all - `gate_mode` maps only to the single top-level `gate.mode` field - and the coercion blocks re-derive their verdict by reading `gate.checks` directly, a part of the config the settings overlay never writes to. A settings file cannot reach the one field that would let it bypass the coercion, because that field does not exist in its schema.

## Consumed by

- `hooks/lib/gate-engine.mjs` (`loadGateConfig`): reads `gate_mode` and `thresholds` per the precedence above; returns the settings warning as `settingsWarning` for its callers to print rather than printing it itself.
- `bin/ns-gate` and `hooks/stop-gate.mjs`: print a non-null `settingsWarning` to stderr, prefixed `ns-gate: settings warning: `.
- `hooks/pre-tool-use.mjs` (dispatch-routing branch): reads `routing_enforce` to select warn, block, or off behavior for the model-tier and chain-edge checks at agent-dispatch time. See [Hooks reference](../reference/hooks.md#pretooluse-dispatch-routing-model-tier-and-chain-edge) for the three-case fail-open rule this branch applies to a settings-file problem specifically (it uses `droppedKeys`, not the blanket `warning` string, to avoid letting an unrelated invalid key silence a validly configured `routing_enforce`).
- `hooks/session-start.mjs`: reads whether the body is non-empty to decide whether to emit the house-notes pointer line; does not read or validate any frontmatter key.
- `skills/nfs-new-book/SKILL.md` (output-style offer step): writes the `output_style` record on explicit consent or decline, stamping the file from `templates/nonfiction-studio.local.example.md` with only that key set if the file does not exist yet. This is the only shipped writer of this file; every other consumer above only reads it.

## Example

```markdown
---
gate_mode: block
thresholds:
  overlap_min_words: 20
routing_enforce: warn
output_style: manuscript
---

## House notes

Always spell out numbers under one hundred; never use "over 100" style prose numerals.
Prefer " - " (space hyphen space) to an em-dash in body prose.
```

The shipped, fully-commented starting point for this file is `templates/nonfiction-studio.local.example.md`.
