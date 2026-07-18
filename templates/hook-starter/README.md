# Hook Starter Template

This directory is a copy-from template for wiring plugin hooks in Nonfiction Studio. Copy
`hooks.json` to `hooks/hooks.json` (owned by TSK-030 (hooks.json Phase 1 wiring)) and replace
every `REPLACE-*` placeholder before committing live wiring.

---

## Shape: Form A wrapper object (ADR-0001)

This template uses the Form A wrapper object shape confirmed in
`docs/adr/ADR-0001-hooks-json-schema.md` (SPK-01 (hooks.json schema) outcome).

Top-level structure:

```
{
  "description": "...",    // optional; omit if not needed
  "hooks": {
    "EventName": [
      {
        "hooks": [
          { "type": "command", "command": "...", "timeout": <number> },
          { "type": "prompt",  "prompt": "...",  "timeout": <number> }
        ]
      }
    ]
  }
}
```

Key points:

- The outer `"hooks"` key is required. Event names sit inside it.
- Each event value is an array of match-group objects.
- Each match-group has its own nested `"hooks"` array containing the actual handler entries.
- `"matcher"` is an optional field on each match-group (not shown in this minimal template).
  Add it when you need to scope a handler to a subset of tools (for example `"Write|Edit"`).

Form A was adopted because the official Claude Code docs at
`https://code.claude.com/docs/en/hooks` show the wrapper-object structure exclusively, and
the ADR is the binding shape authority for all Nonfiction Studio hook files.

---

## All hooks belong in this file - not in agent frontmatter

Plugin agents ignore `hooks`, `mcpServers`, and `permissionMode` keys in their frontmatter at
the platform level (PA-2 (plugin agent hooks ignored), verified in A-02 (platform capability
baseline)). Any `hooks` key inside a file under `agents/` is silently dropped by the platform.

All plugin-wide hooks must be declared in `hooks/hooks.json`. This file is the single source
of truth for hook wiring.

---

## One orchestrating script per event

D-06 (single-writer state discipline) requires exactly one orchestrating script per hook event.
When an event needs multiple behaviors, the single script coordinates them internally. Wiring
multiple command handlers to the same event (which the platform would run in parallel) violates
single-writer discipline and risks corrupting shared state files such as `.studio/progress.json`.

The prompt handler in the `Stop` entry of this template is a known exception: it does not write
state. D-06 permits the combination of one command handler plus one stateless prompt handler on
the same event, as used in the `Stop` gate design.

---

## Validation: `claude plugin validate` does NOT check this file

Running `claude plugin validate --strict .` produces a pass result regardless of the shape of
`hooks/hooks.json`. The validator reads only `marketplace.json`. Passing validation is not
proof that the hooks file is correctly structured.

The real schema gate arrives with TSK-055 (Tier A check scripts):

```
node scripts/check-hooks-schema.mjs
```

Until TSK-055 lands, verify the file manually:

1. JSON parse check:
   ```
   node -e "const h = JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); if (!h.hooks) throw new Error('top-level hooks key missing');"
   ```
2. Review the shape against ADR-0001 (hooks.json schema) before merging any live wiring.

---

## REPLACE fields in hooks.json

| Placeholder | What to put there |
|---|---|
| `REPLACE-brief-description-of-what-these-hooks-do` | One sentence describing the plugin's hook set. Omit the `description` key entirely if not needed. |
| `REPLACE-script-name` | Filename of the orchestrating Node script (without the `.mjs` extension, since the extension is already in the template). Example: `session-start` produces `node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.mjs`. |
| `REPLACE-judgment-question` | The natural-language question for the prompt-type Stop handler. Keep it specific and actionable. Example from S-07: `Review the thesis-alignment of the last written section. Reply 'pass' if the content advances the thesis, or 'warn: <one-sentence reason>' if it drifts.` |

---

## Handler field reference

### command handler

```json
{
  "type": "command",
  "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/REPLACE-script-name.mjs",
  "timeout": 600000
}
```

- `timeout` is optional; the platform default for command handlers is 600000 ms.
- Always use `${CLAUDE_PLUGIN_ROOT}` for script paths. The variable resolves to the plugin's
  versioned install directory and changes on every plugin update. Never store state there.
- `args` (array) is also accepted but not shown in this minimal template.

### prompt handler

```json
{
  "type": "prompt",
  "prompt": "REPLACE-judgment-question",
  "timeout": 30
}
```

- `timeout` for prompt handlers defaults to 30 seconds. The value in this template is explicit
  at the platform default. Increase it only if the judgment question requires extended reasoning.
- Prompt handlers are always advisory in Phase 1 (warn mode). They must not write shared state.

---

## Shape disagreement: S-07 vs ADR-0001

S-07 (hooks and scripts) section 1 was authored before SPK-01 resolved PA-1 (hooks.json
format ambiguity). It shows event array items as flat handler objects placed directly in the
event array, for example:

```json
"SessionStart": [
  { "type": "command", "command": ["node", "$CLAUDE_PLUGIN_ROOT/hooks/session-start.mjs"], "timeout": 60000 }
]
```

ADR-0001 (hooks.json schema, the binding shape authority) and the official platform docs show
event array items as match-group objects containing a nested `"hooks"` array:

```json
"SessionStart": [
  { "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/..." } ] }
]
```

This template follows ADR-0001. S-07 section 1 should be updated in a future doc pass to
reflect the ADR-0001 shape.

S-07 also specifies timeouts in milliseconds (30000) while the platform reference and the
brief specify prompt handler timeout in seconds (30). This template uses seconds (30) per the
brief and platform reference.
