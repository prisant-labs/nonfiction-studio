---
title: "ns-statusline CLI reference"
description: "Reference for the ns-statusline CLI - the studio HUD engine that renders the main Claude Code status line and this plugin's subagentStatusLine rows"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "statusline", "hud", "gate", "drift"]
---

# ns-statusline

Reads a status-line JSON event from stdin and prints either the main status line (default mode)
or, with `--subagent`, one row per subagent task this plugin owns. This is OPP-P03 (studio HUD):
a zero-token, deterministic view of active chapter and promise, words versus target, open claims,
drift band, and gate state, visible continuously instead of only after a command runs. See
[ADR-0008](../../adr/ADR-0008-status-hud.md) for the platform constraints that shaped this design.

## Purpose

`ns-statusline` is the sixth CLI shipped under `bin/` (D-05, five shipped CLIs, grown by one per
OPP-P03). Unlike the other seven CLIs, it never reads its input from `--project` or the working
directory: the platform's statusLine and subagentStatusLine features pipe a JSON event to stdin on
every invocation, and this CLI reads the project directory out of that event
(`workspace.current_dir` or `cwd`), never from `process.cwd()`. It reads at most four small files
(`.studio/meta.json`, `.studio/config.json`, `.studio/progress.json`,
`.studio/gate/last-gate.json`) and spawns no subprocess. Not being inside a book project is a
normal state, not an error: outside a book project, or on any malformed `.studio/` file, the
command prints nothing and exits 0. It never prints a stack trace or an error string.

**This CLI is not, by itself, the HUD the author sees.** A plugin cannot ship a main status line
(see ADR-0008); `ns-statusline` becomes the visible HUD only after it is installed as the user's
own `statusLine` command, which happens through a one-time, explicitly consented write performed
by the `nfs-doctor` skill (see [doctor skill reference](../skills/nfs-doctor.md)), or by the author running
the built-in `/statusline` command themselves. The `--subagent` mode is different: it is wired up
automatically for every author, via this plugin's own `settings.json` at the plugin root.

## Invocation

```
ns-statusline            < statusline-event.json
ns-statusline --subagent < subagent-statusline-event.json
```

Both modes read one JSON object from stdin and print to stdout. Neither mode takes any other
argument; there is no `--project`, `--chapter`, or `--json` flag, because the platform always
supplies the project location and there is only ever one output shape per mode.

## Windows invocation

Bare `ns-statusline` invocation fails in the Bash tool on Windows; the plugin
system does not add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill, and settings
contexts must resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-statusline" [--subagent]
```

where `<plugin-root>` is the resolved plugin installation path. This plugin's own
`settings.json` uses the `CLAUDE_PLUGIN_ROOT` plugin-system interpolation form for its
`subagentStatusLine` command, the same mechanism `hooks/hooks.json` already relies on; see
ADR-0008 for what is and is not verified about that interpolation for this specific file.

## Modes

### Default mode: the main status line

**stdin** is the platform's statusLine event JSON (one object; see the platform's statusline
documentation for the full field list). Fields this CLI reads: `cwd`, `workspace.current_dir`.
Every other field is ignored.

**stdout**: a single line, printed with no trailing newline, composed of up to six
` | `-separated segments, each independently optional:

| Segment | Source | Omitted when |
|---|---|---|
| Book title | `.studio/meta.json` `book_title` | title absent |
| Active chapter | `.studio/progress.json` `chapters[]` (first `drafting`, else first non-`final`) | no non-final chapter exists |
| Words vs. target | `.studio/progress.json` `totals.word_count`; target from `.studio/config.json` `targets.word_count` | word_count unreadable |
| Open claims | `.studio/progress.json` `totals.open_claim_count` | value unreadable |
| Drift band | `.studio/gate/last-gate.json` `checks[]` entry where `check` is `stylometry`, its `verdict` | no last-gate.json, or no stylometry entry in it |
| Gate token | `.studio/gate/last-gate.json` top-level `verdict`, upper-cased | no last-gate.json |

Outside a book project, or when any of these files is missing or fails to parse, the affected
segment (or, outside a book project, the whole line) is silently omitted. Exit code is always 0.

Example, a book mid-chapter with a recent warn-mode gate run:

```
The Quiet Network | 01-listening-before-speaking (Listening Before Speaking) | 1055/30000w | claims:0 | drift:pass | gate:WARN
```

Example, a project that has just been scaffolded and never gated:

```
The Quiet Network | claims:0
```

### `--subagent` mode

**stdin** is the platform's subagentStatusLine event JSON: `{ columns, tasks: [...] }`, where each
task carries at least `id`, and (per the platform's documented field list) `type` or `name`, and
`cwd`.

**stdout**: zero or more lines, each one JSON object, `{"id": "<task id>", "content": "<row
body>"}`. A task is "owned" by this plugin when its `type` (falling back to `name`) is a string
starting with `nonfiction-studio:` - the same namespace-prefix convention
[ADR-0007](../../adr/ADR-0007-agent-identity-resolution.md) established for hook envelopes. Every
other task gets no line, which keeps the platform's own default `name - description - token
count` row for it. An owned task whose own `cwd` resolves to no book root also gets no line, for
the same reason: emitting an empty-content row would blank a row that otherwise has useful
platform-default content.

Row content for an owned task is deliberately modest: the agent's own slug, plus the active
chapter slug and the gate token when its `cwd` resolves to a book root with data:

```
{"id": "task-1", "content": "drafting-partner - ch 01-listening-before-speaking - gate:WARN"}
```

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Always. Both a populated render and full silence (no book project, or an unexpected error) exit 0. `ns-statusline` never uses a non-zero exit to signal anything: there is no operator watching this CLI's exit code, only a status bar that must never show a stack trace. |

## Performance

Designed to read three to four small JSON files and print, with no subprocess spawned and no
directory walk beyond the bounded upward walk that locates the book root. Measured wall-clock
time against the committed sample book: a full invocation (Node.js process start, stdin pipe, and
render, timed end to end with `process.hrtime.bigint()` around 15 samples) medians 44.6ms (range
42.7-47.7ms); the engine's own computation alone, called in-process with no process spawn (200
samples), medians 0.23ms. Both are under OPP-P03 (studio HUD)'s acceptance bar, "renders under
50ms on the sample book" - the full-invocation figure is what a real status-line refresh actually
costs, dominated by Node.js process startup rather than by this engine's own work. See
[ADR-0008](../../adr/ADR-0008-status-hud.md) for the full method and the reasoning behind
measuring both figures.

## Two fields not yet populated by any shipped writer

`.studio/progress.json` chapter entries may carry an optional `promise` string, and
`.studio/config.json` may carry an optional `targets.word_count` number; `ns-statusline` renders
both when present. As of this CLI's introduction, no shipped writer in this plugin populates
either field: `progress.json`'s schema (`templates/book-scaffold/.studio/progress.schema.json`)
has no `promise` property, and `config.json`'s shape (`templates/config-defaults.json`) has no
`targets` object. The word-count target an author sets during intake is recorded today as prose
in `context/brief.md` ("Target word count: NNN words"), not as structured data. Until a future
task wires a writer for one or both fields, real projects render the words segment without a
target suffix and the chapter segment without a promise clause; both are proven, with a synthetic
fixture, in `tests/engines/statusline-cli.test.mjs`. See ADR-0008 for the full reasoning.

## Relationship to other CLIs

`ns-statusline` is the sixth CLI shipped under `bin/`, alongside `ns-claims`, `ns-doctor`,
`ns-gate`, `ns-scrub`, and `ns-stylometry` (D-05, five shipped CLIs). It is never invoked by a
hook or another CLI: `hooks/stop-gate.mjs` writes
`.studio/gate/last-gate.json`, and `ns-statusline` only ever reads that file, never runs
`ns-gate` itself. This is a deliberate performance boundary: spawning `ns-gate` as a subprocess
on every assistant message would make the status line as slow as a full gate run, defeating the
reason it exists.

## See also

- [doctor skill reference](../skills/nfs-doctor.md) - the consented install path that puts
  `ns-statusline` in front of the author as their actual `statusLine`
- [ADR-0008: status HUD](../../adr/ADR-0008-status-hud.md) - the platform constraints and design
  decisions behind this CLI
- [ns-gate CLI reference](./ns-gate.md) - the orchestrator whose `last-gate.json` output this CLI
  reads verbatim
