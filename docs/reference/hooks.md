---
title: "Hooks reference"
description: "Reference for the plugin's hook events: SessionStart's output field contract and PreToolUse's dispatch-routing enforcement"
audience: "non-engineer"
level: "beginner"
tags: ["hooks", "session-start", "pre-tool-use", "routing", "reference"]
---

# Hooks

Nonfiction Studio wires six hook events, declared in `hooks/hooks.json`: `SessionStart`,
`PreToolUse`, `PostToolBatch`, `PostToolUse` (matched to `WebFetch|WebSearch`), `Stop`, and
`PreCompact`. The full schema those declarations follow is documented in
[ADR-0001 (hooks.json schema)](../adr/ADR-0001-hooks-json-schema.md). This page documents two
hooks' output field contracts in detail: `SessionStart`, because it is the hook an author's first
turn in a session actually depends on, and `PreToolUse`'s dispatch-routing behavior, an enforcement
surface an author can configure directly (via `routing_enforce` in the per-project settings file,
alongside that same file's `gate_mode` for the Stop gate). The remaining internal enforcement and
state-maintenance machinery is out of scope here.

## SessionStart output fields

`hooks/session-start.mjs` reads the platform's `SessionStart` event from stdin and writes a
single JSON line to stdout. Every field the platform actually reads lives nested under
`hookSpecificOutput` - a **top-level** field of the same name is silently ignored, with no error
on either side. All four fields below follow this same nested placement.

| Field | Type | When emitted |
|---|---|---|
| `hookEventName` | string | Always: `"SessionStart"` |
| `additionalContext` | string | Always: the orientation block (a found book project) or a two-sentence empty-state or corrupt-project message |
| `sessionTitle` | string | Only when a book project is found and its `book_title` is readable |
| `initialUserMessage` | string | Only on the empty-state path, and only when the directory is truly empty (see below) |
| `reloadSkills` | boolean (`true`) | Only when a book project is found and a generated `book-context` skill exists for it (see below) |

### `additionalContext` and `sessionTitle`

On a found book project, `additionalContext` carries the five-element orientation block (gate
debt, thesis, active chapter, top style rules, open-claims count), assembled by
`hooks/lib/orientation.mjs`, and `sessionTitle` carries the book's title from `.studio/meta.json`.
On the empty-state path (no book project found anywhere in the ancestor chain) or the
corrupt-project path (a book root was found but its bible files could not be read),
`additionalContext` carries a short plain-text message instead, and `sessionTitle` is omitted.

### `initialUserMessage`: opening the studio dispatcher unprompted

When no book project is found and the directory is **truly empty** - no entries beyond an
allowlist of `.claude`, `.git`, `.gitignore`, `.DS_Store`, and `Thumbs.db` - the hook additionally
emits `initialUserMessage: "/nonfiction-studio:nfs-start"`. This becomes a genuine first user turn
in the session, with its own model response, before whatever the author actually types; confirmed
in headless (`-p`) mode.

The truly-empty gate exists because "no book project found" alone is not a safe trigger: it fires
in every non-book directory, including an unrelated repository that happens to have this plugin
installed at user scope. Opening the dispatcher unprompted there would hijack the first turn of an
unrelated project. A directory holding only the allowlisted entries above is treated the same as
empty, since none of them indicate an existing, unrelated project.

### `reloadSkills`: picking up a generated `book-context` skill

When a book project is found and `.claude/skills/book-context/SKILL.md` exists (written by the
`nfs-new-book` skill's book-context generation step; see
[nfs-new-book](skills/nfs-new-book.md#book-context-skill-generation)), the hook emits
`reloadSkills: true`.

This field affects only the platform's skill scan performed at the moment this `SessionStart`
hook runs - it does **not** grant same-session liveness to a skill file written mid-session. A
skill file created after a session has already started is not invocable in that same session,
`reloadSkills: true` or not; the platform's own skill-scan step has already run by the time a
mid-session write happens. The confirmed recovery path is a session restart, or a session
**resume**, which re-fires `SessionStart` end to end (including this same `reloadSkills`
emission) and does pick up a skill file written earlier in that resumed session's history. This
is why the book-context generation step tells the author their new skill becomes usable starting
their next session, not the current one.

## Fail-open

`hooks/session-start.mjs` exits 0 unconditionally. Any read or parse error after the book root is
resolved is caught, logged as one JSONL record to `.studio/logs/errors.jsonl`, and the script
continues with whatever partial orientation block it has already assembled - a single failed
element (for example, an unreadable style profile) never suppresses the rest of the block. The
`initialUserMessage` and `reloadSkills` checks added for the zero-friction first session follow
the same discipline: an error determining whether a directory is truly empty, or whether the
generated skill file exists, defaults to the safer outcome (no `initialUserMessage`, no
`reloadSkills`) and never prevents the rest of the output from being emitted.

## PreToolUse: dispatch routing (model tier and chain edge)

`hooks/pre-tool-use.mjs` also enforces two things at agent dispatch time - when the
platform's `PreToolUse` event carries a `tool_name` of `Agent` or `Task`. The
2026-09-04 platform probe confirmed the live tool name is `"Agent"`; `"Task"` is
matched too, since the installed binary's own attribution helper still checks for it
as a prior or parallel surface. Both checks apply only to this plugin's own agents:
`tool_input.subagent_type` must carry the `nonfiction-studio:` namespace prefix
(stripped before comparison) or the branch exits with zero output - the same
no-false-denies posture the write-scope and web-gate guards use (see
[ADR-0007](../adr/ADR-0007-agent-identity-resolution.md), agent identity resolution).

### Model-tier rule (D-18, in-plugin model routing)

Every plugin agent declares a `model:` field in its own frontmatter
(`agents/<slug>.md`) - either a named tier (`sonnet`, `opus`, and so on) or `inherit`.
When a dispatch carries an explicit `tool_input.model` that disagrees with a
named-tier declaration, the hook warns:

> Routing: line-editor declares model sonnet (D-18 in-plugin model routing); this dispatch requests opus.

Three cases stay silent: `tool_input.model` is absent (the platform resolves to the
declaration anyway); the declared model matches the requested one; and the agent
declares `inherit`, which never warns regardless of what is requested.

### Chain-edge rule (`agents/_chain-permitted.yaml`)

`agents/_chain-permitted.yaml`, previously a lint-time-only contract (S4,
`scripts/checks/chain-contract.mjs`), is now also read at dispatch time. When the
dispatching context is itself a plugin agent (the shared `resolveActiveAgent` helper
resolves a non-null slug from the event), the hook checks whether that agent is
permitted to dispatch the requested one; an edge the file does not list warns, naming
both slugs. A main-session dispatch (no active plugin agent) never triggers this
check.

### `routing_enforce` mode

Both checks share one mode, read from the per-project settings file's
`routing_enforce` key (`.claude/nonfiction-studio.local.md`; see
`hooks/lib/settings.mjs`):

| Value | Behavior |
|---|---|
| `warn` (default, including an absent settings file) | Either warning above becomes an `additionalContext` caution; the dispatch proceeds. |
| `block` | Either warning becomes a `permissionDecision: "deny"` with the identical sentence. |
| `off` | The whole branch exits silently; no file reads, no warnings. |

### Fail-open

Every read this branch performs can fail without ever producing a false warning or a
false deny: a missing `agents/<slug>.md` file, frontmatter that is not valid YAML, and
an unreadable or unparseable `agents/_chain-permitted.yaml` each produce total
silence. Frontmatter and chain-contract reads are cached for the lifetime of one hook
process.

A settings-file problem is narrower, and deliberately so: `hooks/lib/settings.mjs`
names, in a `droppedKeys` array, exactly which known key (if any) was individually
dropped for failing its own validation, separately from its one-sentence `warning`.
This branch silences itself only when the whole settings file failed to parse at all
(a warning with an empty `droppedKeys` - `routing_enforce`'s real value is genuinely
unknown), or when `routing_enforce` itself is the dropped key (author intent for that
one key is unknown). A warning naming a *different* key - `gate_mode: bogus` sitting
beside a perfectly valid `routing_enforce: block`, say - does not silence this branch;
the valid `routing_enforce` value governs exactly as if the sibling key were absent. A
broader "any settings warning silences the branch" rule was tried first and rejected:
it let an explicitly configured `routing_enforce: block` go silently dark whenever any
unrelated key in the same file was also invalid, which is worse than the narrower
fail-open behavior above.

## See also

- [ADR-0001 (hooks.json schema)](../adr/ADR-0001-hooks-json-schema.md) - the full schema every hook declaration in `hooks/hooks.json` follows
- [nfs-new-book skill reference](skills/nfs-new-book.md) - the skill that generates the `book-context` skill this page's `reloadSkills` section describes
- [nfs-start skill reference](skills/nfs-start.md) - the studio dispatcher `initialUserMessage` opens
- [Privacy and data](../privacy.md) - what the generated `book-context` skill contains and how to remove it
