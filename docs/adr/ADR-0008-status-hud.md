# ADR-0008: Status HUD - Main Statusline Ships By Consent, Not By Plugin Manifest

**TL;DR:** The planning language behind OPP-P03 (studio HUD) described a single plugin-shipped
status line; the current platform does not support that. A plugin's root `settings.json` honors
exactly two keys, `agent` and `subagentStatusLine`, and silently ignores anything else, including
a `statusLine` key. `subagentStatusLine` is a different feature with a different output contract
(one JSON row per subagent task, not a plain-text bar), and there is no plugin-to-user consent
API of any kind. The HUD therefore ships as two separate things: `bin/ns-statusline`, a new sixth
CLI (D-05, five shipped CLIs, grown by one) that renders either shape depending on how it is
invoked, plus a plugin-root `settings.json` that ships only the `subagentStatusLine` default; and
a one-time, explicitly consented write of the MAIN status line into the author's own
`~/.claude/settings.json`, performed by the `doctor` skill on an explicit yes and never by the
read-only `bin/ns-doctor` engine. Measured render time against the committed sample book: a full
invocation (Node.js process start, stdin pipe, and render, `process.hrtime.bigint()` around 15
samples) medians 44.6ms (range 42.7-47.7ms); the engine's own computation alone, called
in-process with no process spawn (200 samples), medians 0.23ms. Both are under OPP-P03's "renders
under 50ms" bar.

- Status: Accepted
- Date: 2026-08-10
- Docs: `https://code.claude.com/docs/en/plugins.md`, `https://code.claude.com/docs/en/plugins-reference.md`,
  and `https://code.claude.com/docs/en/statusline.md` (plugin `settings.json` keys, the
  `subagentStatusLine` contract, and the main `statusLine` contract respectively), read against
  the docs as they stood for local CLI 2.1.225
- Task: Wave 1 item 3 (Studio HUD), roadmap row 1.3
- Decision: TWO-PIECE HUD - a plugin-shipped `subagentStatusLine` default (in-plugin, no consent
  needed) plus a consented one-time write of the main `statusLine` into the user's own settings
  (skill-performed, never engine-performed)
- PA resolved: OPP-P03 (studio HUD) implemented against the platform's real statusline and
  plugin-settings contracts rather than the planning language's assumed single plugin-shipped bar

---

## Context

The audit's C3 cluster identified a trust problem: the studio does work the author cannot see.
State lives in `.studio/` and surfaces only when someone runs a command. OPP-P03 (studio HUD)
calls for "a zero-token deterministic status line showing active chapter and promise, words
versus target, open claims, drift band, and gate state" to close that gap. The planning documents
that describe this feature were written in terms the current platform does not support; building
to their literal wording would have produced a `statusLine` key in the plugin's own
`settings.json` that is accepted with no error and then never appears anywhere, which is a worse
outcome than not building the feature at all, because nothing would say why it silently does
nothing.

## Correction 1: a plugin cannot ship a main statusLine

Two independently fetched pages of the official documentation agree verbatim: a plugin's
`settings.json` supports "only the `agent` and `subagentStatusLine` keys," and "unknown keys are
silently ignored." A `"statusLine": {...}` entry placed in a plugin's own `settings.json` is not
an error and not a warning; it is dropped at load time. This is the same enforcement-theater
failure mode this wave exists to close elsewhere, just discovered here instead of built here: a
convincing-looking manifest entry that does nothing, with nothing in the product surfacing that
fact.

**Consequence.** `settings.json` (new, at the plugin root, a sibling of `library.json` and
`hooks/`, not inside `.claude-plugin/`) ships only a `subagentStatusLine` entry. No `statusLine`
key exists anywhere in this plugin's shipped files.

## Correction 2: subagentStatusLine is a different feature, not a smaller scope of the same one

`statusLine` is the single bar at the bottom of the interface, session-wide, plain text to
stdout. `subagentStatusLine` renders a custom row body for each subagent shown in the agent panel
below the prompt, replacing the default `name - description - token count` row. Its stdin carries
`columns` and a `tasks[]` array (each task carrying at least `id`, `type` or `name`, and `cwd`
among other fields); its stdout contract is one JSON object per line, `{"id": "<task id>",
"content": "<row body>"}`, keyed by task id. Nothing about this shape resembles the main
statusLine's plain-text contract. Treating them as one feature with two configuration knobs, as
the planning language implicitly did, would have produced a `--subagent` mode that either crashed
on the wrong stdin shape or emitted plain text into a field expecting JSON rows.

**Consequence.** `bin/ns-statusline` has two genuinely different code paths
(`buildMainStatusLine` and `buildSubagentLines` in `hooks/lib/statusline-engine.mjs`), selected by
a `--subagent` flag, each reading its own documented stdin shape and emitting its own documented
stdout shape. They share only the underlying book-state-reading helpers (`findRootSafe`,
`readJsonSafe`, `deriveActiveChapter`, `deriveGateInfo`), not any output formatting.

## Correction 3: there is no plugin-to-user consent API

Nothing in the platform lets a plugin request that the user's own settings be changed. The
plugin `userConfig` mechanism writes only into `pluginConfigs[<plugin-id>].options`, under that
plugin's own namespace, for substitution back into that plugin's own config values; it cannot set
an arbitrary top-level key like `statusLine` in the user's `~/.claude/settings.json`. The built-in
`/statusline` command is a Claude Code feature a human invokes, not something a plugin can invoke
on a user's behalf. There are exactly two honest paths to a main status line that shows this
plugin's content: tell the author to run `/statusline` themselves, or have a skill write
`~/.claude/settings.json` directly with the Write or Edit tool, which surfaces Claude Code's
ordinary permission prompt for that file, precisely like any other settings edit a skill might
propose.

**Consequence.** The `doctor` skill (`skills/doctor/SKILL.md`) gains a narrowly scoped install
mode. It states exactly what will be written and where, asks a yes/no question, and writes
`~/.claude/settings.json`'s `statusLine` key only on an explicit yes, using the Write or Edit
tool (which the skill does not and cannot suppress the platform's own permission prompt for). On
anything other than yes it writes nothing and names `/statusline` as the alternative. The skill
reads the existing file first, merges rather than overwrites, preserves every unknown key, and if
a `statusLine` already exists it says so and requires a separate explicit confirmation before
touching it. This is "exactly one consent prompt" from OPP-P03's acceptance language: exactly one
code path in the whole plugin can ever write the user's settings, and it cannot run without an
explicit yes.

## The doctor read-only covenant: carve-out, not erosion

`bin/ns-doctor` and the `doctor` skill shipped a documented read-only guarantee in at least four
places (`skills/doctor/SKILL.md:9,13` and `docs/reference/skills/doctor.md:11,17,60,64` as they
stood before this task), including the specific claim "The skill writes no files. All reads are
performed by `bin/ns-doctor` under its READ-ONLY COVENANT." This task adds a consented write to
the `doctor` skill, which would make that blanket claim false if left standing unchanged - exactly
the enforcement-theater pattern (a claim in the repository that the product does not actually
keep) this wave exists to close.

The resolution keeps the covenant true by narrowing it precisely, not by weakening it:

- **`bin/ns-doctor` and `hooks/lib/doctor-engine.mjs` are untouched by this task** and remain
  absolutely read-only, with no exception. The proof-by-grep at
  `hooks/lib/doctor-engine.mjs:13-14` still holds: `grep -n "writeFileSync\|renameSync\|mkdirSync\|appendFileSync\|writeFile" hooks/lib/doctor-engine.mjs` still produces zero matches. The
  engine is not involved in the statusline install at all; it never reads `~/.claude/settings.json`
  and has no code path that could write it.
- **The skill gains exactly one narrowly scoped mode** (`doctor install-statusline`) that performs
  the write itself, via the Write or Edit tool, never by shelling out to the engine and never by
  any other mode. Every other mode (`report`, `migrate`, `packs`) is unchanged and still writes
  nothing.
- **Every site naming the covenant was updated to state the narrowed, still-true claim** (the
  engine is read-only without exception; the skill writes nothing except this one explicitly
  consented settings install, only in `install-statusline` mode, only after an explicit yes) - in
  two passes, not one. The four sites named above were updated when `install-statusline` was
  built. A fifth site was missed in that pass and found only on review:
  `docs/reference/skills/doctor.example.md`'s "Key assertions from this transcript" section
  carried its own standalone, bolded, unqualified "The skill writes nothing" line - a worked
  example that this task's original file-ownership list did not include, and so was not part of
  the four-site sweep above. It is fixed as part of this same task once found, not deferred. A
  repo-wide grep for `READ-ONLY COVENANT`, `writes no files`, and `writes nothing`, re-run after
  that fifth site was fixed, confirms no other site remains.

This is the same shape of decision D-06 (single-writer state discipline) already makes elsewhere
in this plugin: a write is fine when it is scoped, attributed, and honestly documented; what is
not fine is a write that contradicts a standing claim the shipped prose still makes.

## Content sourcing: three files, and two fields with an honest gap

OPP-P03 (studio HUD) assigns each HUD segment to a source file: active chapter, word counts, and
open claims from `.studio/progress.json`; targets and thresholds from `.studio/config.json`; gate
state and drift from `.studio/gate/last-gate.json` (the Stop hook's verbatim copy of `ns-gate`'s
last output). Implementing this against the ACTUAL shipped schemas surfaced two gaps the planning
language did not anticipate:

- **No word-count target exists in `config.json` today.** `templates/config-defaults.json` has no
  `targets` object, and the number an author actually sets during intake ("Target word count:
  30,000 words") is recorded as free prose in `context/brief.md`, not as structured data anywhere.
- **No `promise` field exists in `progress.json` today.** The schema
  (`templates/book-scaffold/.studio/progress.schema.json`) declares no such property, and the
  committed sample book's `structure/chapter-list.md` - the file the `outline-book` skill's own
  reference documentation describes as carrying "one-line promise" per chapter - does not
  actually have a promise column in its shipped form.

Both gaps are resolved the same way every other missing-data case in this design already is
(missing `last-gate.json`, malformed `progress.json`): graceful, silent omission of that one
segment, never an error and never invented data. `hooks/lib/statusline-engine.mjs` reads an
optional `chapters[].promise` string and an optional `config.targets.word_count` number; both
schemas already permit additional properties, so a future writer can populate either field with
no engine change, and `tests/engines/statusline-cli.test.mjs` proves both paths render correctly
against a synthetic fixture that sets them. Today, against every real shipped fixture including
the committed sample book, neither field is present, so the HUD renders the chapter slug and
title without a promise clause, and the word count without a target suffix. No prose parsing of
`context/brief.md` was attempted: the target figure there is unstructured natural-language text,
and parsing it reliably would be exactly the kind of fragile, undocumented inference this
plugin's schema-driven design otherwise avoids everywhere else.

**Planning-doc amendment earned, not landed here** (CANON is an internal, gitignored planning
document maintained separately from this ADR): OPP-P03's "words versus target" and "active
chapter and its promise" language should be amended to name `config.json`'s `targets.word_count` and
`progress.json`'s `chapters[].promise` as the specific fields the HUD reads, note that neither is
populated by any shipped writer as of this task, and record that populating either is a distinct,
not-yet-scheduled follow-on (a candidate for whichever future task next touches `outline-book`,
`draft-chapter`, or the PostToolBatch hook).

## Drift band: read from the last gate run, not recomputed live

`deriveGateInfo` in `hooks/lib/statusline-engine.mjs` takes both the gate token and the drift band
from `.studio/gate/last-gate.json`: the gate token is the file's top-level `verdict`, upper-cased;
the drift band is the `verdict` of its `checks[]` entry whose `check` is `stylometry`, lower-cased
- the same `pass`/`warn`/`block`/`skip` vocabulary `hooks/lib/gate-engine.mjs` already uses
everywhere else, not a new banding scheme invented for this task. This was a deliberate choice
against the alternative of recomputing a live band from `progress.json`'s raw `drift_score`
against `config.json`'s `drift_score_max` threshold on every render: doing that would silently
substitute a fresh, never-actually-run judgment for the one the author asked for the last time
they ran the gate, which is precisely the "work the author cannot see" problem OPP-P03 exists to
fix, just moved one level down. The HUD shows the verdict AS OF THE LAST GATE RUN, continuously,
between runs - not a recomputation that happens to look like one.

## Active chapter: a documented derivation rule, because none exists in the data

`progress.json` carries no explicit "this is the active chapter" marker. `deriveActiveChapter`
picks, in order: the first chapter (array order, which mirrors `structure/chapter-list.md`'s
registry order) whose `status` is `drafting` - the status `hooks/post-tool-batch.mjs` itself
assigns on a chapter's first write, so it is a first-class signal of current work, not a guess;
failing that, the first chapter whose `status` is not `final`, as a "what's next" fallback; `null`
when the chapters array is empty or every chapter is already final. This rule is recorded here and
in `docs/reference/cli/ns-statusline.md` so a future implementer does not have to reverse-engineer
it from behavior.

## Verification gap: `${CLAUDE_PLUGIN_ROOT}` inside a plugin's own settings.json is unverified

This was checked directly against the platform documentation before implementation:
`${CLAUDE_PLUGIN_ROOT}` demonstrably expands inside `hooks/hooks.json` command strings (ADR-0005,
bin PATH on Windows, proved this live, for hooks specifically), but the
official statusline documentation's own worked example for a plugin's `subagentStatusLine` uses a
bare absolute path (`~/.claude/subagent-statusline.sh`), not a plugin-relative one, and no worked
example anywhere shows the interpolation inside a plugin `settings.json` file specifically.

This task's `settings.json` ships `"command": "node ${CLAUDE_PLUGIN_ROOT}/bin/ns-statusline
--subagent"` on the strength of the following reasoning, not a live probe: `hooks.json` and a
plugin's `settings.json` are both plugin-root manifest files processed by the same plugin-loading
system at the same lifecycle stage (plugin enable), and the two documentation pages describe the
same `${CLAUDE_PLUGIN_ROOT}` token as the mechanism for locating plugin-relative resources in
manifest files generally, not as a `hooks.json`-specific feature. No implementer on this task had
access to a live Claude Code session with workspace trust accepted, so this remains **unverified,
not confirmed** - a materially different evidentiary status than ADR-0005's hooks.json finding,
which rests on an actual measured probe. `claude plugin validate --strict .` was run as part of
this task's verification suite and passed, validating the marketplace manifest structurally;
that kind of structural validation does not exercise runtime variable interpolation, so it cannot
resolve this question either way.

**If a future live session shows the variable does not expand here:** there is no code-level
fallback that fixes it, because a plugin cannot compute its own future install path at
`settings.json`-authoring time. The honest remediation is to file the gap against the platform (if
the docs claim it should work) or, if it is confirmed to be hooks.json-only behavior, to drop the
`subagentStatusLine` default from this plugin's `settings.json` entirely and document that the
row-annotation feature requires a manual per-user configuration step, rather than ship a manifest
entry that looks functional and silently is not - the same failure mode Correction 1 above exists
to avoid.

## Consequences

- `bin/ns-statusline`, `bin/ns-statusline.cmd`, `hooks/lib/statusline-engine.mjs`,
  `settings.json` (plugin root, new), `docs/reference/cli/ns-statusline.md`, and this ADR are new.
- `library.json` and `scripts/check-docs-completeness.mjs` (`SHIPPED_CLIS`) register the sixth
  CLI. A second task this wave also adds a CLI and owns the D-05 (five shipped CLIs) growth
  decision record; this ADR states the fact of growth to six but defers the D-05 amendment
  itself to that task's coordination.
- `skills/doctor/SKILL.md`, `docs/reference/skills/doctor.md`, and
  `docs/reference/skills/doctor.example.md` gain the narrowly scoped `install-statusline` mode
  and updated, still-true read-only covenant language; see "The doctor read-only covenant" above
  for the exact site list and how it was verified complete.
- This ADR is the basis for a new CANON section 3.5 (statusline and output styles as component
  classes), landed separately by item 8 (planning-doc sync); it is written precisely enough to
  amend a governing document from.
- Output styles as a component class are explicitly out of scope for this task; CANON 3.5 will
  cover them when that work is scheduled.
- The end-to-end rendering of either statusline inside a real, trust-accepted Claude Code session
  was not observed by this task. The automated test suite proves the engine's behavior against
  the documented stdin/stdout contracts: project-directory resolution from stdin JSON rather than
  `process.cwd()`, per-segment graceful degradation on missing or malformed source data, the
  BLOCK token rendering within one refresh, `--subagent` namespace matching, and measured
  performance (see the TL;DR above). Two things first prove only in a live session: whether the
  main status line and the `subagentStatusLine` row actually render as designed inside the
  interface, and whether `${CLAUDE_PLUGIN_ROOT}` truly expands inside this plugin's own
  `settings.json` (see "Verification gap" above).
