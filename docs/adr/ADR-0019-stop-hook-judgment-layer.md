# ADR-0019: The Stop Hook Carries No Judgment Handler

**TL;DR:** The thesis-alignment prompt handler is removed from the Stop event in `hooks/hooks.json`, and Tier A now refuses a `prompt` or `agent` handler on Stop. On Stop, Claude Code feeds a judgment handler's reason back to Claude and continues the turn whenever the handler judges its condition unmet. Such a handler can therefore never be the warn-only check that D-03 (layered Stop gate) asks for. Live probes showed the shipped prompt keeping the turn from ending nine times in a row in a book folder, until Claude Code's own cap overrode it. The deterministic command handler stays. The `thesis_alignment` config key stays, reserved, with its coercion to warn unchanged.

- Status: Accepted. On 2026-10-16 the maintainer asked for this defect to be filed and resolved. The probes below left removal as the only fix that keeps D-03's own invariant, and the maintainer approves the record by merging it.
- Date: 2026-10-16
- Related: amends D-03 (layered Stop gate), a locked decision in the planning canon. It withdraws D-03's layer (b), a prompt handler for judgment checks, and its layer (c), the agent handler named as the upgrade path. [ADR-0018 (Tier B eval harness contract)](ADR-0018-tier-b-eval-harness-contract.md) records the first sighting of the defect. [Issue #21 (the Stop hook's thesis-alignment prompt keeps the turn from ending)](https://github.com/prisant-labs/nonfiction-studio/issues/21) tracks the work.
- Decision: REMOVE THE STOP PROMPT HANDLER; REFUSE PROMPT AND AGENT HANDLERS ON STOP IN TIER A; KEEP `thesis_alignment` AS A RESERVED KEY.

---

## Context

D-03 describes the Definition-of-Done gate as a layered Stop hook. Layer (a) is a command handler that runs the deterministic checks through `bin/ns-gate`. Layer (b) is a prompt handler for judgment checks, which is thesis alignment, and it is warn-only until its false-block rate is calibrated. Layer (c) is an experimental agent handler, documented as the upgrade path. D-03 also sets two invariants: judgment checks never block in v1, and the gate does nothing outside a book or when the session wrote no chapter content.

Layer (b) shipped in Phase 1 as a prompt that asked for a bare `pass` or `warn: <reason>` reply. Version 0.2.0 added a `skip` reply for a book with no thesis on record.

### What the platform does with a Stop prompt handler

Claude Code's hooks reference (`https://code.claude.com/docs/en/hooks`) says a prompt hook's model answers with JSON: `ok`, a `reason` that is required when `ok` is false, and an optional `impossible`. On `Stop` and `SubagentStop`, "the reason is fed back to Claude as its next instruction and the turn continues, unless the response also sets `impossible: true`". The model that judges the hook also sets `impossible` itself, "when it judges the condition can never be satisfied". The reference describes no other output for a Stop prompt hook.

### What the probes showed

ADR-0018's probes on 2026-10-14 first saw the handler replace a `claude -p` answer in an empty folder. Probes on 2026-10-16 measured how far the problem reached. Each probe ran `claude -p "Reply with the single word READY and nothing else."` on Claude Code 2.1.301 with haiku, from a fresh temporary folder, with `--plugin-dir`, `--setting-sources project`, `--no-session-persistence` and every `CLAUDE.md` turned off. The plugin's hooks were on.

| Plugin loaded | Folder | Turns | Cost | Outcome |
|---|---|---|---|---|
| This repository | Copy of `examples/sample-book`, run 1 | 10 | $0.014 | Blocked 9 times; Claude Code's cap ended the turn; the `-p` result was empty |
| This repository | Copy of `examples/sample-book`, run 2 | 10 | $0.014 | Blocked 9 times; the cap ended the turn |
| This repository | Empty folder | 4 | $0.011 | The answer was replaced with the skip message |
| A scratch plugin whose only Stop hook told the judge to reply `{"ok": false, "impossible": true, ...}` | Empty folder | 5 | $0.009 | Blocked 4 times; the judge wrote its own reason each time and never set `impossible` |

The cap message said that "A hook blocked the turn from ending 9 consecutive times" and that Claude Code was "overriding and ending turn."

Three facts follow from these runs:

1. **The judge reads a prompt as a condition to evaluate, not as an instruction to follow.** In the scratch plugin, it called the prompt "an instruction to emit a fixed JSON object, not a verifiable session state" and blocked. A prompt's author therefore cannot choose the reply.
2. **The handler had nothing to judge.** A prompt hook receives the hook input JSON (`cwd`, `last_assistant_message` and similar fields). The thesis lives in `structure/thesis.md`, which the input never contains.
3. **There is no advisory channel.** On Stop, the only effect a judgment handler can have is to continue the turn. That makes it a "keep working until" lever, which is a soft block, and D-03 forbids judgment checks to block.

### Why no check caught it

Tier A proves hook behavior deterministically, and no deterministic test can run the judge. `scripts/check-hooks-schema.mjs` required a prompt handler on Stop. The Tier B eval runner turns every hook off (ADR-0018), and the Tier B integration runner never loaded the plugin at all ([issue #24](https://github.com/prisant-labs/nonfiction-studio/issues/24)).

## Decision

### 1. The Stop event carries the command handler alone

`hooks/hooks.json` drops the prompt entry. `hooks/stop-gate.mjs` still runs the deterministic gate and still no-ops outside a book and on a re-entrant stop.

### 2. Tier A refuses a judgment handler on Stop

`scripts/check-hooks-schema.mjs` no longer requires a prompt handler on Stop. Its Step 6 now reports a finding for each `prompt` or `agent` entry on Stop, citing this record. `tests/hooks/hooks-json.test.mjs` plants each type in a temporary copy of `hooks.json` and asserts the finding. Mutating the refusal so that it accepts both types, or accepts `agent` only, turns those tests red.

### 3. D-03's layers (b) and (c) are withdrawn

An agent handler has the same continue-the-turn semantics on Stop as a prompt handler, and it costs more on every turn, so it is not an upgrade path. D-03's first invariant still governs any future judgment check: it never blocks. Such a check has to run where it can report without holding the turn open, for example inside a skill that the author invokes.

### 4. The `thesis_alignment` key stays, reserved

The key stays in `DEFAULT_GATE`, in both shipped config templates, and in every fixture. `loadGateConfig` still coerces a configured `block` to `warn`, and doctor check 9 still reports that coercion. `bin/ns-gate` never computed a thesis-alignment verdict, so no gate report changes. Keeping the key means no existing book's config becomes invalid, and a future judgment check can use it.

### 5. What changes for authors and contributors

- `nfs-check-chapter` no longer tells the author that the Stop hook runs a thesis-alignment judgment. It moves to 0.2.1 under ADR-0017 (per-skill versioning).
- `templates/hook-starter/` no longer teaches a Stop prompt handler, and its README explains why.
- The `ns-gate` reference page, the architecture overview, both project-init templates and the unsourced-claim fixture's notes describe the key as reserved, or name the fact-checker agent alone as the semantic check.

## Alternatives considered

- **Rewrite the prompt to the documented JSON shape and pass it `$ARGUMENTS`.** Rejected. The judge, not the prompt, decides the reply, and an `ok: false` on Stop still continues the turn. The input would still hold no thesis.
- **Use `ok: false` with `impossible: true` as a warning.** Rejected. The judge ignored that instruction in 4 of 4 tries, and the reference names no place where the reason would appear to the author.
- **A condition that is always satisfied.** Rejected. It would cost a background model call on every turn and do nothing, and it would still depend on the judge agreeing with it.
- **An agent handler that reads `structure/thesis.md`.** Rejected. It could see the thesis, but it has the same continue-the-turn semantics and a higher cost on every turn.

## Consequences

- A session that loads the plugin ends its turn normally, and no background model call runs at every Stop.
- No thesis-alignment judgment runs anywhere in v1. Deterministic checks, the fact-checker agent and the line editor are unaffected.
- Books on 0.2.0 or earlier keep the handler until the plugin is updated, so this fix is a candidate for a patch release.
- Unverified: the probes ran in print mode only. Interactive sessions use the same Stop mechanism, but none was probed. The probes ran on one CLI version, so it is unknown whether earlier versions also looped.
