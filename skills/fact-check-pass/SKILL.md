---
name: fact-check-pass
user-invocable: true
argument-hint: "<chapter: slug or number>"
description: "Runs the adversarial verification pass on a drafted chapter: an engine-backed marker inventory via bin/ns-claims, then the fact-checker agent's authoritative five-step pass that advances EV entry statuses, updates chapter markers, and writes the per-chapter fact-check report. Reports three counts (verified, unresolved, source-unverifiable) from the agent's report and names the report path. Writes no progress.json - the PostToolBatch hook owns the open-claims total."
when_to_use: "Use when the author types the legacy /factcheck <ch> verb, finishes drafting and wants claims verified, run-quality-gate reports unresolved claims, or studio routes here from Path 3 (Research and verify). Do not invoke when no chapter argument is supplied (the skill halts if the chapter file is absent), or for unrelated queries."
chain:
  - fact-checker
---

This skill is the verification front door. It resolves the chapter argument, runs an engine-backed marker inventory via `bin/ns-claims`, states the web gate status, delegates the authoritative verification pass to the `fact-checker` agent, confirms agent writes via Read checks, and formats the three counts from the agent's per-chapter report. The `fact-checker` agent is the sole writer of chapter markers and EV status transitions; the skill orchestrates, confirms, and reports. The skill writes no `.studio/progress.json` - the open-claims total is maintained by the PostToolBatch hook per D-06 (single-writer state discipline).

**Writer alignment.** `fact-checker` writes all claim markers in `chapters/<slug>.md` (inserting `[UNVERIFIED]` or `[SOURCE-UNVERIFIABLE]` adjacent to unresolved markers and removing stale tags on re-checks that advance to `verified`; the `[claim: EV-nnnn]` marker is never removed) and all EV status transitions in `research/evidence-log.md`. The skill confirms both files via Read checks after the agent pass. It never eyeballs markers itself: the ns-claims engine is the deterministic inventory source.

**Re-run idempotency.** Re-runs are safe because the agent's writes are status-field updates and tag insert-or-remove operations against current state, and its cache skips known-good claims per D-09 (learning checker agents). A session interrupted after partial agent writes leaves the chapter and ledger in a consistent intermediate state; re-running picks up from current state without duplicating changes.

Skill inputs read:
- `structure/chapter-list.md` (slug registry; probed at Step 1 to resolve the chapter argument)
- `chapters/<slug>.md` (target chapter; file-existence probed at Step 1, confirmed via Read after agent pass)
- `research/evidence-log.md` (evidence ledger; passed to fact-checker, confirmed via Read after agent pass)
- `research/sources.md` (source registry; passed to fact-checker for the session-start changed-flag scan and online pass)
- `.studio/config.json` (web gate check at Step 3)
- `.claude/agent-memory/nonfiction-studio-fact-checker/` (verified-claims cache; read by fact-checker at session start per D-09)

Skill chain edge: `fact-check-pass -> fact-checker` per `agents/_chain-permitted.yaml`.

---

## Step 1 - Chapter argument resolution and file probe (mandatory first tool call)

Use the Bash tool to check whether the chapter-list registry is present:
```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```

If `HAS_REGISTRY`: use the Read tool on `structure/chapter-list.md` to resolve the supplied argument to the canonical slug.
- **Slug match** (for example `02-finding-your-network`): locate the row whose slug column matches exactly. Carry the slug forward.
- **Number match** (for example `2` or `02`): locate the row whose chapter number matches. Carry the slug forward.
- **No match:** halt with a clear error. State: "Chapter `[supplied value]` was not found in the chapter registry. Check `structure/chapter-list.md` for the valid slugs." List the available slugs.

If `NO_REGISTRY`: use the supplied argument directly as the slug candidate.

After resolving the slug, use the Bash tool:
```
test -f chapters/<slug>.md && echo HAS_CHAPTER || echo NO_CHAPTER
```

The output is a binary token:
- `NO_CHAPTER`: halt immediately. State: "Chapter file `chapters/<slug>.md` was not found. Produce the chapter with `/nonfiction-studio:draft-chapter <slug>` before running the verification pass."
- `HAS_CHAPTER`: continue to Step 2.

A chapter argument is required. Do not proceed without a resolved slug pointing to an existing chapter file.

---

## Step 2 - Engine-backed marker inventory

Use the Bash tool to run the deterministic marker inventory:
```
node bin/ns-claims --chapter=<slug> --json
```

Parse the JSON output for the pre-count fields:
- `totalMarkers`: total claim markers (`[claim: EV-nnnn]` and `[UNVERIFIED]`) in the chapter
- `resolvedCount`: markers whose referenced EV entry is at `verified` or `interpretation`
- `coveragePct`: current coverage percentage

Present this pre-count to the author before delegation:

> Chapter `<slug>` pre-count: `<totalMarkers>` claim markers, `<resolvedCount>` resolved, coverage `<coveragePct>%`.

If `bin/ns-claims` exits with a non-zero code (evidence log missing, chapter unreadable, or BibleError), report the exact error message from stderr and halt. Do not proceed to delegation with a failed or incomplete inventory.

The ns-claims count is the deterministic pre-count the skill presents. The `fact-checker` agent performs the authoritative five-step verification pass per its contract; the agent's assessment is the operative one.

---

## Step 3 - Web gate check and delegate to fact-checker

Use the Read tool on `.studio/config.json` to check whether `research.web_enabled` is exactly the boolean `true`. State the gate status before spawning the agent:

- **Gate open** (`research.web_enabled: true`, running on CLI or Cowork): "Online pass enabled. The agent will attempt DOI and URL resolution for SRC records referenced by the chapter's EV entries."
- **Gate closed** (field absent, `false`, or any other value): "Online pass is not enabled for this project (`research.web_enabled` is not `true` in `.studio/config.json`). To enable it, add `\"research\": { \"web_enabled\": true }` to `.studio/config.json`. For claims that remain unresolved, source text can be pasted; the agent analyzes pasted content with the same quote-and-attribute discipline per D-13 (security posture)."
- **On chat** (even when gate is open): "Note: WebSearch and WebFetch may not be available on the chat surface. Paste source content for any claims the agent cannot resolve from the evidence ledger alone."

Spawn `fact-checker` via the `fact-check-pass -> fact-checker` chain edge, passing:
- The chapter slug and file path (`chapters/<slug>.md`)
- The ns-claims pre-count from Step 2 (total markers, resolved, coverage)
- The web gate status from the config read
- Any pasted source content provided by the author

The `fact-checker` agent runs its authoritative five-step pass per its contract:
1. Session-start cache protocol: reads `research/sources.md` for `changed: true` flags, invalidates affected cache entries, loads the verified-claims cache from `.claude/agent-memory/nonfiction-studio-fact-checker/` per D-09 (learning checker agents)
2. Resolves all `[claim: EV-nnnn]` markers against `research/evidence-log.md`
3. Updates EV entry statuses (`verified`, `unverified`, `interpretation`, or `source-unverifiable`)
4. Inserts `[UNVERIFIED]` adjacent to unverified markers in `chapters/<slug>.md`; removes stale `[UNVERIFIED]` or `[SOURCE-UNVERIFIABLE]` tags when an entry advances to `verified` on a re-check; never removes the original `[claim: EV-nnnn]` marker
5. Runs the optional online DOI/URL pass when `research.web_enabled` is exactly the boolean `true`; inserts `[SOURCE-UNVERIFIABLE]` paired with the existing `[claim: EV-nnnn]` for online-pass failures; reports the gate as closed and the path to enable it when the gate is off

The agent writes `.studio/fact-check-reports/<NN>-report.md` at the end of every pass, including passes where all entries are verified.

The skill writes no chapter files, no ledger files, and no `.studio/` machine state.

---

## Step 4 - Confirm agent writes via Read checks

After the agent completes its pass, use the Read tool to confirm:
- `chapters/<slug>.md` is present and non-empty
- `research/evidence-log.md` is readable
- `.studio/fact-check-reports/<NN>-report.md` exists (the report the agent writes at the end of every pass)

If any file is missing, report the gap, name the last successful step, and offer to re-run from Step 3. Idempotency is guaranteed by the agent's cache-skip semantics and status-field update model: re-running starts from current state and repeats only the work not yet reflected on disk.

---

## Step 5 - Report three counts from the agent's per-chapter report

Format and present the three counts from the agent's per-chapter report at `.studio/fact-check-reports/<NN>-report.md`:

- **Verified:** EV entries advanced to `verified` or `interpretation` in this pass (including cache hits, which required no network call)
- **Unresolved:** entries remaining at `unverified` or `pending` after the pass (open claims)
- **Source-unverifiable:** entries tagged `source-unverifiable` by the online pass

Name the report path explicitly:

> Fact-check report: `.studio/fact-check-reports/<NN>-report.md`

Note: the per-chapter `open_claim_count` in `.studio/progress.json` is maintained by the PostToolBatch hook, not by this skill. The hook updates the open-claims total when the agent writes chapter files. The three counts above are conversation-level reporting only.

Suggest next steps based on the counts:
- Unresolved or source-unverifiable entries remain: run `/nonfiction-studio:research-pass <slug>` to add source material, or paste source content and re-run `/nonfiction-studio:fact-check-pass <slug>`.
- Coverage is 100% and no open claims remain: run the quality gate: `/nonfiction-studio:run-quality-gate <slug>`.

On the chat surface, state that the Stop hook gate does not fire automatically: "On chat the Stop hook gate does not fire automatically. Run `/nonfiction-studio:run-quality-gate <slug>` explicitly when all claims are resolved."

---

## Failure behavior

**Chapter file missing.** The Step 1 Bash probe halts on `NO_CHAPTER`. The halt message names the chapter file path and routes to `draft-chapter`. No state is written by a halted Step 1.

**Chapter argument not matched.** Step 1 halts with the supplied value, the registry file name (`structure/chapter-list.md`), and the list of valid slugs when the registry is present but the argument matches no row. No state is written.

**ns-claims failure.** If `bin/ns-claims` exits non-zero (evidence log absent, chapter unreadable, BibleError), the exact stderr message is reported and the skill halts at Step 2. Do not proceed to agent delegation with a failed inventory. The most common cause is a missing `research/evidence-log.md`; run `/nonfiction-studio:research-pass` to create it.

**Agent incomplete or report missing.** If the Step 4 Read checks find the chapter file or report absent after the agent ran, report the gap and offer to re-run from Step 3. The re-run is safe: the agent's cache marks known-good entries and skips their re-verification; the agent's status-field writes and marker operations are idempotent against current state.

**Gate closed, unresolved claims remain.** When the online pass is disabled and offline verification leaves entries unresolved, the skill reports the count and suggests either enabling the gate or providing pasted source text. The chapter is in a valid intermediate state; the Stop gate blocks release only in blocking mode, and in Phase 1 the gate is warn-only by default.
