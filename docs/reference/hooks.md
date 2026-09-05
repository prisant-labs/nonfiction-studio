---
title: "Hooks reference"
description: "Reference for the plugin's hook events, focused on SessionStart's output field contract"
audience: "non-engineer"
level: "beginner"
tags: ["hooks", "session-start", "reference"]
---

# Hooks

Nonfiction Studio wires six hook events, declared in `hooks/hooks.json`: `SessionStart`,
`PreToolUse`, `PostToolBatch`, `PostToolUse` (matched to `WebFetch|WebSearch`), `Stop`, and
`PreCompact`. The full schema those declarations follow is documented in
[ADR-0001 (hooks.json schema)](../adr/ADR-0001-hooks-json-schema.md). This page documents one
hook's output field contract in detail - `SessionStart` - because it is the hook an author's
first turn in a session actually depends on. The other five hooks are internal enforcement and
state-maintenance machinery an author never configures directly; they are out of scope here.

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

## See also

- [ADR-0001 (hooks.json schema)](../adr/ADR-0001-hooks-json-schema.md) - the full schema every hook declaration in `hooks/hooks.json` follows
- [nfs-new-book skill reference](skills/nfs-new-book.md) - the skill that generates the `book-context` skill this page's `reloadSkills` section describes
- [nfs-start skill reference](skills/nfs-start.md) - the studio dispatcher `initialUserMessage` opens
- [Privacy and data](../privacy.md) - what the generated `book-context` skill contains and how to remove it
