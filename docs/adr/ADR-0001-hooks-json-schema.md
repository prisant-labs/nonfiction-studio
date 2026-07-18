# ADR-0001: hooks.json Schema Confirmed - Wrapper Object Format

**TL;DR:** Both candidate forms pass `claude plugin validate --strict .`, but the validator does not read hooks.json. The official docs at https://code.claude.com/docs/en/hooks exclusively show the wrapper-object format. Form A (wrapper) is adopted for all Nonfiction Studio hooks.

- Status: Accepted
- Date: 2026-07-17
- Spike: SPK-01 (hooks.json schema)
- Task: TSK-007 (SPK-01 hooks.json schema)
- Unblocks: TSK-006 (prompt-type hook starter template), TSK-030 (hooks.json Phase 1 wiring)
- PA resolved: PA-1 (hooks.json format ambiguity)

---

## Context

PA-1 (hooks.json format ambiguity) was identified in S-07 (hooks and scripts) because the plugin hook-development reference (`SKILL.md`) is internally contradictory: two different sections show two different top-level schemas for `hooks/hooks.json`.

### Contradicting sections (verbatim)

**Section "Plugin hooks.json Format" (the plugin-specific label, Form A - wrapper object):**

```
**For plugin hooks** in `hooks/hooks.json`, use wrapper format:

{
  "description": "Brief explanation of hooks (optional)",
  "hooks": {
    "PreToolUse": [...],
    "Stop": [...],
    "SessionStart": [...]
  }
}

Key points:
- `description` field is optional
- `hooks` field is required wrapper containing actual hook events
- This is the **plugin-specific format**
```

The same document then states at line 119:

> "For plugin hooks.json, wrap these in `{'hooks': {...}}`."

**Section "Plugin Hook Configuration" (Form B - flat event map):**

```
In plugins, define hooks in `hooks/hooks.json`:

{
  "PreToolUse": [
    {
      "matcher": "Write|Edit",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Validate file write safety"
        }
      ]
    }
  ],
  "Stop": [...],
  "SessionStart": [...]
}

Plugin hooks merge with user's hooks and run in parallel.
```

These two sections both claim authority over `hooks/hooks.json` and show incompatible top-level structures: one wraps event keys under a `"hooks"` property, the other puts event keys at the document root.

---

## Method

Both candidate files were saved under `examples/spikes/spk-01/` and each was placed at `hooks/hooks.json` in turn for validation. After both tests `hooks/` was restored to `.gitkeep` only.

### Form A - wrapper object (`hooks.form-a-wrapper.json`)

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/examples/spikes/spk-01/probe.mjs" } ] }
    ]
  }
}
```

### Form B - flat event map (`hooks.form-b-flat.json`)

```json
{
  "SessionStart": [
    { "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/examples/spikes/spk-01/probe.mjs" } ] }
  ]
}
```

---

## Validator Evidence

Both forms were tested with `claude plugin validate --strict .` from the repo root.

**Form A validator output (exit 0):**

```
Validating marketplace manifest: <repo-root>\.claude-plugin\marketplace.json

V Validation passed
```

**Form B validator output (exit 0):**

```
Validating marketplace manifest: <repo-root>\.claude-plugin\marketplace.json

V Validation passed
```

**Critical observation:** The validator output names only `marketplace.json`. It does not mention `hooks/hooks.json`. Both forms produce byte-for-byte identical output, which confirms that `claude plugin validate --strict .` does not currently read or schema-check `hooks/hooks.json`. Passing validation is not proof of correct hooks.json schema - it is proof the validator does not yet cover that file.

This is the "both forms validate" escalation path described in the task brief.

---

## Decision

**Adopted form: Form A (wrapper object).**

The brief's decision rule states: "a form that validates AND matches the live official docs example wins." Formal checking against the live documentation at https://code.claude.com/docs/en/hooks (the URL the SKILL.md itself cites as authoritative) shows that every hooks example in the official docs uses the wrapper-object structure exclusively:

**Official docs example - general hooks:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh"
          }
        ]
      }
    ]
  }
}
```

**Official docs example - plugin hooks.json specifically:**

```json
{
  "description": "Automatic code formatting",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh",
            "args": [],
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

The official docs show zero examples using the flat event-map structure. Form A (wrapper) validates and matches the live official docs. Form B (flat) validates but does not match the live official docs. Therefore Form A wins under the primary decision rule without reaching the tie-break.

---

## Open questions and runtime escalation

Because the validator does not currently check hooks.json, validation result alone cannot confirm runtime hook firing. Two questions remain open after this ADR:

1. **Runtime firing confirmation:** Does Form A (wrapper) actually cause Claude Code to fire hooks at runtime on this platform (Windows, SPK-05 (bin PATH on Windows) context)? To be confirmed in TSK-030 (hooks.json Phase 1 wiring) or the first live hook test.

2. **Validator gap:** Should hooks.json schema validation be added to the plugin validate pipeline? Tracked as a potential enhancement; not blocking for phase 0.

---

## Consequences

- TSK-006 (prompt-type hook starter template): use Form A wrapper structure. The starter template `hooks.json` should use `{ "hooks": { "EventName": [...] } }` at the top level, with an optional `description` field.
- TSK-030 (hooks.json Phase 1 wiring): wire the first production hooks.json using Form A; include a runtime confirmation step (log-on-fire proof) before marking the task done.
- `examples/spikes/spk-01/` retains both candidate files as permanent evidence. Neither is wired into production hooks.
- If TSK-030 discovers at runtime that Form A does not fire and Form B does, this ADR must be revised and the commit history of all hook files updated.

---

## References

- Reference that created PA-1 (hooks.json format ambiguity): `~/.claude/plugins/cache/claude-plugins-official/plugin-dev/unknown/skills/hook-development/SKILL.md`
- Official docs consulted: https://code.claude.com/docs/en/hooks - fetched 2026-07-17 (decision evidence); re-verified 2026-07-18, both quoted examples still present and wrapper-object format is the only shape shown on the page (Example 1 now also includes `"if"` and `"args"` inner fields not present at decision time; wrapper structure unchanged).
  - Example 1 (general hooks, block-rm.sh): appears under the "How a hook resolves" heading.
  - Example 2 (plugin hooks.json, Automatic code formatting): appears under the "Reference scripts by path" heading (Plugin scripts tab).
- Spike files: `examples/spikes/spk-01/hooks.form-a-wrapper.json`, `examples/spikes/spk-01/hooks.form-b-flat.json`, `examples/spikes/spk-01/probe.mjs`
