# ADR-0009: Apparatus CLI - An Engine CLI for OPP-D05, and D-05's (Five Shipped CLIs) Growth Policy

**TL;DR:** OPP-D05 (apparatus generator) is built the same way the other six CLIs are: a thin
`bin/ns-notes` shell over a pure, unit-tested engine module, `hooks/lib/apparatus-engine.mjs`,
not skill-only prose. The reason is that this feature's own acceptance bar - byte-identical
regeneration over an unchanged ledger, and a planted blank locator landing in an attention list
with no malformed note ever produced - is a deterministic, machine-checkable property. Only code
can be asserted against with a failing test; an LLM narrating "read the ledger and write
Chicago-style endnotes" from skill prose cannot promise the same bytes twice, and there would be
nothing to write a RED test against. The Chicago style itself is expressed as data
(`hooks/lib/citation-styles/chicago.json`), not formatting logic, so a second style or an
additional source `type` needs no engine change. D-05 (five shipped CLIs) grows to seven:
`bin/ns-statusline` shipped as the sixth earlier in this wave (ADR-0008, status HUD); `bin/ns-notes`
is the seventh. This ADR records that growth and the standing policy a future CLI candidate should
be tested against.

- Status: Accepted
- Date: 2026-08-09
- Task: Wave 1 item 5 (apparatus generator), roadmap row 1.6
- Decision: ENGINE CLI, DATA-DRIVEN STYLE - `bin/ns-notes` and `hooks/lib/apparatus-engine.mjs`
  follow the same CLI-over-engine-module pattern as the other six CLIs; the Chicago citation
  style lives in `hooks/lib/citation-styles/chicago.json` as data, not as formatting logic in the
  engine, so a second style or an additional source type needs no engine change
- PA resolved: OPP-D05 (apparatus generator) implemented as the seventh shipped CLI; D-05
  (five shipped CLIs) grows to seven and gains a standing growth-policy test for future engines

---

## Context

OPP-D05 (apparatus generator) inverts the claim ledger's cost structure: maintaining
`research/evidence-log.md` and `research/sources.md` currently pays off only at a gate check
(`bin/ns-claims`, `bin/ns-gate`). The generator makes the ledger pay the author back directly by
producing publisher-ready back matter - Chicago-style endnotes with real locators, a
deduplicated bibliography, index-term candidates, and an honest needs-attention list - from
data the author is already maintaining.

The shipping shape was open to question: a skill could plausibly read the ledger and chapter
files itself and write the four back-matter files by following prose instructions, the way
several other skills in this plugin already read project files and reason over them without an
engine CLI underneath. This ADR records why that shape was rejected for this specific feature,
and states the general test a future capability should pass before
choosing the engine-CLI shape, so the next task that ships an eighth CLI does not have to
re-derive the reasoning from scratch.

**Verified against the tree, not assumed**, because a decision record that gets its own subject's
count wrong is worse than one that omits it: `bin/` held six CLIs (`ns-claims`, `ns-doctor`,
`ns-gate`, `ns-scrub`, `ns-statusline`, `ns-stylometry`) before this change, and
`library.json`'s `components.clis` array agreed. `bin/ns-statusline` was the sixth, added earlier
in this wave and recorded in ADR-0008 (status HUD). `bin/ns-notes` is the seventh; this change
adds it to both `bin/` and `library.json` in the same commit, so the two never disagree at any
commit boundary.

## Decision

`bin/ns-notes` is a thin shell: shebang, argument parsing via `hooks/lib/args.mjs`, book-root
discovery via `hooks/lib/bible.mjs`, and output formatting, nothing else. All computation lives
in `hooks/lib/apparatus-engine.mjs`, which has no filesystem access at all - it takes already-
parsed ledger entries, source entries, chapter texts, and a parsed citation style, and returns
either structured data or a Markdown string. This is the same shape `hooks/lib/claims-engine.mjs`
already uses, adopted for the same reason its own header states: "the engine logic lives in a
lib module so both bin/ns-claims (CLI) and ... [a caller] share the same computation path per
S-07 section 4." `bin/ns-notes.cmd` ships alongside as the two-line Windows shim every CLI
carries, per ADR-0005 (bin PATH on Windows); it is not the primary dispatch form, exactly as
ADR-0005 concluded for the first five.

### Why an engine CLI and not skill-only logic

Two of this feature's own acceptance criteria settle the question directly, because neither is
achievable by a skill narrating steps in prose:

1. **Byte-identical regeneration.** Running the generator twice over an unchanged ledger must
   produce byte-identical files under `production/`. This is tested directly:
   `tests/engines/apparatus.test.mjs` calls `computeApparatus` and each markdown builder twice
   over the same fixture input and asserts the strings are `===`; `tests/engines/notes-cli.test.mjs`
   spawns the real binary twice against a temp clone of the committed sample book and asserts the
   four `production/` files are byte-identical `Buffer`s. Neither assertion is meaningful against
   a skill: an LLM re-reading the same ledger and re-composing the same four files from prose
   instructions has no mechanism that guarantees the same word order, the same whitespace, or even
   the same set of included citations twice, because generation is not the same operation as
   computation.
2. **The attention-list honesty guarantee.** A planted blank locator (or a missing source, an
   unknown source type, or an incomplete source record) must land in `apparatus-attention.md` and
   must never produce a malformed note in `endnotes.md`. This is a total-function guarantee -
   every input either renders correctly or is named as a gap, with no third outcome - which is
   exactly what `hooks/lib/apparatus-engine.mjs`'s `resolveSource` function is: a pure function
   with an exhaustive `ok: true | false` return, unit-tested against six independent failure
   fixtures in one pass (`tests/engines/apparatus.test.mjs`, the "six independent problems in one
   chapter" case). A skill instructed to "check for missing data and flag it" is a best-effort
   prompt, not a totality guarantee a failing test can be written against.

More generally, this plugin's own test-first discipline applies here too: a behavior with no
failing test that can be written against it before implementation is not a behavior this
development method can verify. Prose-only skill logic for a generation task with a determinism
requirement fails that test at the design stage, before a single line of the skill would even be
written.

### Chicago style as data, not code

`hooks/lib/citation-styles/chicago.json` names, per source `type`, which `research/sources.md`
fields are required before a citation can be built, and the field order and punctuation for the
full note, short note, and bibliography forms. `hooks/lib/apparatus-engine.mjs`'s template filler
is a single generic function: it substitutes named placeholders and asserts every placeholder a
template uses was already guaranteed present by the type's own `required` list, so it never
guesses a blank field's value. Today's file covers the four source types the plugin's own worked
example (`examples/sample-book/`) actually cites (`book`, `article`, `report`, `web`) out of the
seven legal `type` values `docs/formats/sources.md` defines (the other three - `interview`,
`dataset`, `other` - are real, legal values with no real cited example in the committed ledger to
validate a template against). A source of one of those three types is not a crash and not a
guessed format; per the same "unknown type" path already required for a genuinely unrecognized
value, it lands in `apparatus-attention.md` naming the type. Extending coverage to any of them,
or adding a second style entirely, is a pure data edit to a JSON file - no change to
`apparatus-engine.mjs` is required, which is the concrete proof that the interpreter is general
rather than Chicago-specific code wearing a data-file costume.

### The growth-policy test for D-05 (five shipped CLIs), a standing amendment

D-05 (five shipped CLIs) is no longer an accurate name for a six-item, now seven-item, list; it
remains the durable ID for the decision it names (an engine CLI per capability, one shared
computation path per capability, shipped under `bin/`), which continues to grow. A future task
proposing an eighth CLI should be able to answer yes to at least one of these before choosing the
CLI shape over skill-only logic:

1. **Is correctness a deterministic, machine-checkable property** - byte-for-byte, exit-code-for-
   exit-code, or an equivalent total-function guarantee - that a failing test can be written
   against before the feature exists? (This is the test OPP-D05 passes, above.)
2. **Must the capability run somewhere no conversational skill can reach** - a hook, CI, or
   another script - the way `bin/ns-statusline --subagent` must run from the platform's
   `subagentStatusLine` contract, outside any skill invocation? (This is the test OPP-P03,
   studio HUD, passed; ADR-0008.)
3. **Do two or more callers need the identical computation**, such that a shared engine module is
   how this plugin already avoids drift between them (S-07 section 4), the way `bin/ns-claims`'s
   claim-coverage computation is shared between the CLI and the Stop gate hook?

A candidate that answers no to all three should stay skill-only logic. Building a CLI for a
one-off, best-effort, single-caller task would relocate the same prose from a skill into a
script with no shared caller and no determinism requirement to justify the move: speculative
abstraction, the same failure mode this plugin's contributors are already asked to avoid in a
configuration knob nobody asked for, applied instead to an architecture choice.

## Consequences

- `bin/ns-notes`, `bin/ns-notes.cmd`, `hooks/lib/apparatus-engine.mjs`, and
  `hooks/lib/citation-styles/chicago.json` are new. `library.json`'s `components.clis` array and
  `scripts/check-docs-completeness.mjs`'s `SHIPPED_CLIS` array both register the seventh CLI, in
  the same commit that adds the binary, so `scripts/checks/check-inventory.mjs` (bidirectional
  tree-vs-manifest equality) and `scripts/check-docs-completeness.mjs` (reference-page coverage)
  never see the tree and the manifests disagree.
- `docs/reference/cli/ns-notes.md` and `docs/reference/skills/build-apparatus.md` are new,
  matching the structure of the existing CLI and skill reference pages.
- The roadmap's amendment queue gains "D-05 (five shipped CLIs): growth policy as engines are
  added (standing)," pointing at this ADR's growth-policy test above, landed by the planning-doc
  synchronization task this wave designates for governing-document edits.
- A future CLI candidate that fails all three growth-policy tests above is a signal to keep the
  capability as skill-only logic rather than default to the CLI shape out of habit.
