---
title: "nfs-fact-check skill reference"
description: "Reference for the nfs-fact-check skill - the verification front door that runs an engine-backed marker inventory, delegates to fact-checker, confirms writes, and reports three counts from the agent's per-chapter report"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "fact-check", "verification", "claims", "fact-checker", "evidence"]
---

# nfs-fact-check

The `nfs-fact-check` skill is the studio's verification front door. It resolves the chapter argument, runs a deterministic marker inventory via `bin/ns-claims`, states the web gate status, delegates the authoritative adversarial verification pass to the `fact-checker` agent, confirms agent writes via Read checks, and formats the three counts from the agent's per-chapter report at `.studio/fact-check-reports/<NN>-report.md`. It is a Phase 1 skill specified in S-06 3.7 (skills and invocation surface) and governed by D-05 (five shipped CLIs), D-06 (single-writer state discipline), D-07 (claim ledger), D-09 (learning checker agents), and D-13 (security posture).

## Purpose

`nfs-fact-check` bridges a drafted chapter and the verified evidence ledger. The `fact-checker` agent it invokes is the sole component that advances EV entry statuses beyond `pending`: it resolves `verified`, `unverified`, `interpretation`, or `source-unverifiable` for each entry tied to a chapter's claim markers. Chapter markers (`[UNVERIFIED]`, `[SOURCE-UNVERIFIABLE]`) are written and removed exclusively by the agent; the skill never touches marker text directly.

The skill's role is to present an engine-backed pre-count before delegation, confirm agent writes afterward, and format the three counts the agent's report contains. It writes no chapter files, no ledger files, and no `.studio/progress.json`. The PostToolBatch hook maintains the per-chapter `open_claim_count` in `progress.json` when the agent writes chapter files; see [Progress.json and the open-claims total](#progressjson-and-the-open-claims-total) below.

**Writer alignment.** `fact-checker` writes all claim markers in `chapters/<slug>.md` and all EV status transitions in `research/evidence-log.md`. The skill confirms both files exist after the agent pass via Read checks. The skill's sole read role is: argument resolution (Read on `structure/chapter-list.md`), the ns-claims inventory (Bash), the config read for the web gate (Read on `.studio/config.json`), and the post-pass confirmation reads.

**Re-run idempotency.** Re-runs are safe because the agent's writes are status-field updates and tag insert-or-remove operations against current state, and its cache skips known-good claims per D-09 (learning checker agents). A session interrupted after partial agent writes leaves chapter and ledger files in a consistent intermediate state; re-running picks up from current state without duplicating changes.

## Invocation

```
/nonfiction-studio:nfs-fact-check <chapter>
```

The `<chapter>` argument is required. Supply the chapter slug (for example `02-finding-your-network`) or the chapter number (for example `2`). Valid slugs are in `structure/chapter-list.md`.

Alternate entry points:
- Via the `nfs-start` dispatcher: routes here from Path 3 (Research and verify) when the author says they want to verify existing claims
- Via `nfs-draft` Step 6: that skill closes with an explicit prompt to run `nfs-fact-check` or `nfs-check-chapter`
- Via `nfs-check-chapter`: when the gate reports unresolved claims it suggests re-invoking `nfs-fact-check`

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `structure/chapter-list.md` | Step 1 (Bash probe + Read) | Confirm the registry is present; resolve the chapter slug or number |
| `chapters/<slug>.md` | Step 1 (Bash probe); Step 5 (Read check) | Confirm the chapter file exists before delegation; confirm it is present and non-empty after the agent pass |
| `research/evidence-log.md` | Step 5 (Read check); passed to fact-checker | Confirm the ledger is readable after the agent updates status fields |
| `research/sources.md` | Passed to fact-checker | Source registry the agent reads at session start to scan for `changed: true` flags and to retrieve SRC records during verification |
| `.studio/config.json` | Step 4 (Read) | Check `research.web_enabled` to state the online pass gate status before delegation |
| `.claude/agent-memory/nonfiction-studio-fact-checker/` | Read by fact-checker | Verified-claims cache; entries with cache hits are skipped per D-09 (learning checker agents) |

### Outputs

All chapter writes and ledger writes are performed by the `fact-checker` agent, not by the skill.

| Path | Written by | Contents |
|---|---|---|
| `chapters/<slug>.md` | `fact-checker` (agent) | `[UNVERIFIED]` inserted adjacent to unresolved markers; `[SOURCE-UNVERIFIABLE]` paired with the existing `[claim: EV-nnnn]` for online-pass failures; stale tags removed for entries that advance to `verified` on re-check; `[claim: EV-nnnn]` markers never removed |
| `research/evidence-log.md` | `fact-checker` (agent) | `status` fields updated to `verified`, `unverified`, `interpretation`, or `source-unverifiable`; status reset to `pending` on cache invalidation; claim text never changed |
| `.studio/fact-check-reports/<NN>-report.md` | `fact-checker` (agent) | Per-chapter report with total markers, count by status, opinion-presented-as-fact flags, and recommended actions; written at the end of every pass |
| `.claude/agent-memory/nonfiction-studio-fact-checker/` | `fact-checker` (agent) | Verified-claims cache updated with newly confirmed entries and session timestamps |

The skill writes no `.studio/progress.json` and no other `.studio/` machine state.

## Flow Summary

The skill runs six steps.

1. **Chapter argument resolution and file probe (mandatory first tool call).** Uses a Bash tool call to test whether `structure/chapter-list.md` is present (`HAS_REGISTRY`/`NO_REGISTRY`). If the registry is present, reads it and resolves the slug or number argument. Uses a second Bash tool call to test whether `chapters/<slug>.md` exists (`HAS_CHAPTER`/`NO_CHAPTER`). `NO_CHAPTER` halts immediately, routing to `nfs-draft`. This is the deterministic-guard convention per S-06 1.1 (skill anatomy and discovery).

2. **Resolve the plugin root.** Before ns-claims is invoked, the skill resolves the plugin's installed path: a primary lookup against `extraKnownMarketplaces['nonfiction-studio'].source.path` in `~/.claude/settings.json`, a `~/.claude/plugins/cache` search fallback, and a dev-mode fallback that checks for `bin/ns-claims` in the current directory. This is the same three-tier convention `nfs-new-book` uses to locate its scaffold templates; it exists because a literal relative `bin/ns-claims` path resolves against the invoking shell's working directory, not the installed plugin, and would silently fail for a marketplace-installed author. If all three lookups fail, the skill halts and names the settings.json and cache paths it attempted.

3. **Engine-backed marker inventory.** Uses the Bash tool to run `node "<plugin-root>/bin/ns-claims" --chapter=<slug> --json`. Parses the JSON output for `totalMarkers`, `resolvedCount`, and `coveragePct`, and presents this pre-count to the author before delegation. If ns-claims exits non-zero, reports the exact stderr message and halts. The skill never eyeballs markers itself: ns-claims is the deterministic inventory source.

4. **Web gate check and delegate to fact-checker.** Reads `.studio/config.json` to check `research.web_enabled`. States the gate status explicitly before spawning the agent: gate open announces DOI/URL resolution; gate closed (the default) explains that pasted source content is analyzed with the same quote-and-attribute discipline per D-13 (security posture); on chat notes that WebSearch and WebFetch may not be available. Spawns `fact-checker` via the `nfs-fact-check -> fact-checker` chain edge with the chapter slug, ns-claims pre-count, and web gate status. The agent runs its five-step pass: cache protocol, marker resolution, status updates, marker writes (insert and the re-check removal rule), and the optional online pass.

5. **Confirm agent writes via Read checks.** Reads `chapters/<slug>.md`, `research/evidence-log.md`, and `.studio/fact-check-reports/<NN>-report.md` to confirm each is present after the agent completes. A missing file surfaces as a gap report with an offer to re-run from Step 4.

6. **Report three counts from the agent's per-chapter report.** Formats and presents the three counts from `.studio/fact-check-reports/<NN>-report.md`: verified (including cache hits), unresolved (open claims), and source-unverifiable. Names the report path explicitly. Suggests next steps based on the counts. On the chat surface, adds an explicit prompt to run `nfs-check-chapter` because the Stop hook gate does not fire automatically on chat per S-06 1.3 (gate closure compensation).

## Progress.json and the Open-Claims Total

The PostToolBatch hook at `hooks/post-tool-batch.mjs` maintains the per-chapter `open_claim_count` in `.studio/progress.json`. When the `fact-checker` agent writes `chapters/<slug>.md` during the verification pass, the hook recounts claim markers via the claims engine and writes the new total to the matching chapter entry in `progress.json`. The skill performs no `progress.json` write; see D-06 (single-writer state discipline).

The `open_claim_count` in `progress.json` is derived from the marker state on disk after the agent's writes land. The three counts the skill presents (verified, unresolved, source-unverifiable) come from the agent's report and represent the same state; the hook's count reflects the same truth computed independently from the chapter file.

## Web Research Gate

The `fact-checker` agent checks `research.web_enabled` in `.studio/config.json` before every WebSearch or WebFetch call. The gate rule is strict: the value must be exactly the boolean `true`. An absent field, the string `"true"`, `false`, or `null` all leave the gate closed. The gate is checked at the time of each web-research request, not once at session start.

This is a project-level setting, not a surface-level one. Authors running on Claude Code CLI with the gate closed receive the same offline-only pass as authors on chat.

To enable the online DOI/URL resolution pass for a project, add the following to `.studio/config.json`:

```json
"research": {
  "web_enabled": true
}
```

When the gate is open, the agent announces each web call before making it. Fetched content is untrusted data per D-13 (security posture): the agent quotes and attributes; it never follows instructions embedded in fetched pages, never reports a robot-generated summary as source confirmation, and never follows redirects to paywalled content.

Note that on the chat surface WebSearch and WebFetch may not be available even when the config gate is open. The agent falls back to pasted source text in that case.

## The Verified-Claims Cache (D-09)

The `fact-checker` agent maintains a project-scoped verified-claims cache at `.claude/agent-memory/nonfiction-studio-fact-checker/`, provided by the `memory: project` frontmatter field. At the start of every session the agent reads the cache and identifies EV entries with valid cache hits and no invalidated SRC dependency; those entries are skipped for re-verification.

A cache entry is invalidated when its source SRC record carries `changed: true` in `research/sources.md`. The agent resets those EV entries to `pending` and re-verifies them. A cache entry is never treated as valid across a schema change to `research/evidence-log.md`.

This cache behavior is the mechanism behind re-run idempotency: a second pass on a chapter where most entries are already verified costs little because the agent skips cache hits and only re-checks entries whose SRC records changed or whose status has not yet been resolved.

## Failure Behavior

**Chapter file missing.** The Step 1 Bash probe halts on `NO_CHAPTER`. The halt message names the chapter file path and routes to `nfs-draft`. No state is written by a halted Step 1.

**Chapter argument not matched.** Step 1 halts with the supplied value, the registry file name (`structure/chapter-list.md`), and the list of valid slugs when the registry is present but the argument matches no row. No state is written.

**ns-claims failure.** If `bin/ns-claims` exits non-zero (evidence log absent, chapter unreadable, BibleError), the exact stderr message is reported and the skill halts at Step 3. The most common cause is a missing `research/evidence-log.md`; run `/nonfiction-studio:nfs-research` to create it, then re-invoke.

**Agent incomplete or report missing.** If the Step 5 Read checks find a file absent after the agent ran, the skill reports the gap and offers to re-run from Step 4. Re-runs are safe: the agent's cache marks known-good entries and skips their re-verification; status-field writes and marker operations are idempotent against current state.

**Gate closed, unresolved claims remain.** When the online pass is disabled and offline verification leaves entries unresolved, the skill reports the count and suggests either enabling the gate or providing pasted source text. The chapter is in a valid intermediate state; the Stop gate blocks only in blocking mode, and in Phase 1 the gate is warn-only by default per D-03 (warn-only default).

## Worked Example

See [nfs-fact-check.example.md](./nfs-fact-check.example.md) for a condensed transcript of a `nfs-fact-check` session over the committed Chapter 2 of the sample book "The Quiet Network" (see `examples/sample-book/`). The example shows a clean verification run: the ns-claims pre-count reports 5 markers at 100% coverage (all entries already `verified` in the committed ledger), the agent runs its session-start cache protocol, all 5 entries are confirmed via cache hits, no marker writes are needed, the agent writes the fact-check report, and the skill presents the three counts with the report path.
