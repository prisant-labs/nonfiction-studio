---
title: "nfs-fact-check worked example"
description: "Condensed transcript of a fact-check-pass session over the committed Chapter 2 of The Quiet Network - shows the file probe, ns-claims pre-count, cache-based clean verification, agent report write, and three-count summary"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "fact-check", "verification", "claims", "fact-checker", "evidence", "example"]
---

# nfs-fact-check - worked example

This is a condensed transcript of a `fact-check-pass` session over Chapter 2 (Finding Your Network, slug `02-finding-your-network`) of the sample book "The Quiet Network" (see `examples/sample-book/`). The example follows the flow specified in S-06 3.7 (skills and invocation surface) and the adjudications recorded in TSK-050 (fact-check-pass skill).

**Session provenance note.** This example runs over the committed `examples/sample-book/` baseline: `chapters/02-finding-your-network.md` is a committed fixture carrying 5 `[claim: EV-nnnn]` markers (EV-0006 through EV-0010), and all 5 corresponding EV entries in `research/evidence-log.md` are at `status: verified`. The web gate is closed. Because all EV entries are already `verified`, the fact-checker confirms them via cache hits and makes no chapter or ledger writes; the session is a clean-verification run demonstrating the cache protocol and idempotency guarantee. Any scenario showing `[UNVERIFIED]` insertions or status advances from `pending` is explicitly synthetic and does not reflect the committed fixture.

---

## Setup: what was already in place

`chapters/02-finding-your-network.md` is the committed Chapter 2 fixture. It carries 5 claim markers:

- `[claim: EV-0006]` - Dunbar limit on stable relationships (SRC-0005, pp. 469-493)
- `[claim: EV-0007]` - Curation satisfaction advantage (SRC-0004, pp. 12-14)
- `[claim: EV-0008]` - Weak-tie novelty in social networks (SRC-0002, pp. 1370-1373)
- `[claim: EV-0009]` - Source diversity and knowledge retention (SRC-0004, p. 8)
- `[claim: EV-0010]` - Pacing recommendation for new connections (SRC-0001, p. 78)

All 5 EV entries in `research/evidence-log.md` are at `status: verified`. A prior fact-check session (not shown here) advanced all 5 entries and populated the verified-claims cache at `.claude/agent-memory/nonfiction-studio-fact-checker/`. The web gate is closed (`research.web_enabled` is absent from `.studio/config.json`).

---

## Session: Chapter 2 clean verification, web gate closed, all entries previously verified

**Author:** `/nonfiction-studio:fact-check-pass 02-finding-your-network`

**Studio (Step 1 - Chapter argument resolution and file probe):**

The skill uses the Bash tool:
```
test -f structure/chapter-list.md && echo HAS_REGISTRY || echo NO_REGISTRY
```
Output: `HAS_REGISTRY`

The skill uses the Read tool on `structure/chapter-list.md`. The registry has six rows. The argument `02-finding-your-network` matches the slug in row 2:

```
| 2 | 02-finding-your-network | Finding Your Network | drafted | 527 |
```

Chapter resolved: number 2, working title "Finding Your Network", slug `02-finding-your-network`.

The skill uses the Bash tool:
```
test -f chapters/02-finding-your-network.md && echo HAS_CHAPTER || echo NO_CHAPTER
```
Output: `HAS_CHAPTER`

Chapter file confirmed present. Continue to Step 2.

**Studio (Step 2 - Resolve the plugin root):**

The skill uses the Bash tool to look up the `nonfiction-studio` marketplace source path in `~/.claude/settings.json`. The primary lookup resolves the plugin's installed path on the first try; the plugins-cache and dev-mode fallbacks are not needed for this run. Continue to Step 3.

**Studio (Step 3 - Engine-backed marker inventory):**

The skill uses the Bash tool:
```
node "<plugin-root>/bin/ns-claims" --chapter=02-finding-your-network --json
```

Output (abbreviated):
```json
{
  "check": "claim_coverage",
  "verdict": "pass",
  "totalMarkers": 5,
  "resolvedCount": 5,
  "coveragePct": 100,
  "chapters": [
    {
      "file": "chapters/02-finding-your-network.md",
      "totalMarkers": 5,
      "resolvedCount": 5,
      "openClaims": 0,
      "coveragePct": 100
    }
  ]
}
```

**Studio:**

> Chapter `02-finding-your-network` pre-count: 5 claim markers, 5 resolved, coverage 100%.
>
> All 5 markers reference EV entries the ledger already shows as `verified`. The fact-checker agent will run its authoritative pass, confirm each entry against its source, and write the per-chapter report.

**Studio (Step 4 - Web gate check and delegate to fact-checker):**

The skill uses the Read tool on `.studio/config.json`. The field `research.web_enabled` is absent.

**Studio:**

> Online pass is not enabled for this project (`research.web_enabled` is not `true` in `.studio/config.json`). The offline verification pass will use the evidence ledger and source registry. To enable DOI and URL resolution, add `"research": { "web_enabled": true }` to `.studio/config.json`.
>
> Spawning fact-checker for Chapter 2.

The skill spawns `fact-checker` via the `fact-check-pass -> fact-checker` chain edge, passing:
- Chapter slug: `02-finding-your-network`, file: `chapters/02-finding-your-network.md`
- ns-claims pre-count: 5 markers, 5 resolved, 100% coverage
- Web gate status: closed

**fact-checker (session-start cache protocol):**

> Reading `research/sources.md` to scan for `changed: true` flags.
>
> SRC-0001 (Noe 2009): no `changed: true` flag.
> SRC-0002 (Granovetter 1973): no `changed: true` flag.
> SRC-0003 (Brown, Collins, Duguid 1989): no `changed: true` flag.
> SRC-0004 (Siemens 2005): no `changed: true` flag.
> SRC-0005 (Dunbar 1992): no `changed: true` flag.
>
> No `changed: true` flags found. No cache invalidations needed.
>
> Loading verified-claims cache from `.claude/agent-memory/nonfiction-studio-fact-checker/`.
>
> Cache entries found for EV-0006, EV-0007, EV-0008, EV-0009, EV-0010 - all confirmed in session 2026-07-18, SRC dependencies unchanged. All 5 entries are valid cache hits; they will be skipped for re-verification per D-09 (learning checker agents).

**fact-checker (claim marker resolution):**

> Reading `chapters/02-finding-your-network.md` to locate all `[claim: EV-nnnn]` markers.
>
> Found 5 markers: `[claim: EV-0006]`, `[claim: EV-0007]`, `[claim: EV-0008]`, `[claim: EV-0009]`, `[claim: EV-0010]`.
>
> All 5 are cache hits with no invalidated SRC dependencies. Skipping re-verification for each.
>
> Status summary (from cache):
> - EV-0006 (dunbar limit): verified
> - EV-0007 (curation satisfaction): verified
> - EV-0008 (weak-ties novelty): verified
> - EV-0009 (source diversity retention): verified
> - EV-0010 (pacing recommendation): verified
>
> No `[UNVERIFIED]` insertions needed. No stale tags to remove. No chapter writes required.

**fact-checker (online pass):**

> Web gate is closed (`research.web_enabled` is not `true` in `.studio/config.json`). Skipping DOI/URL resolution. To enable the online pass, set `"research": { "web_enabled": true }` in `.studio/config.json`.

**fact-checker (per-chapter report write):**

> Writing `.studio/fact-check-reports/02-report.md`.

---

## .studio/fact-check-reports/02-report.md (written by fact-checker)

```markdown
# Fact-check report: 02-finding-your-network

Date: 2026-07-19
Chapter: chapters/02-finding-your-network.md

## Summary

- Total claim markers: 5
- Verified: 5 (all via cache hits; SRC dependencies unchanged)
- Unverified: 0
- Interpretation: 0
- Source-unverifiable: 0

## Status by entry

| Entry | Handle | Status | Source |
|---|---|---|---|
| EV-0006 | dunbar limit | verified (cache) | SRC-0005 (Dunbar 1992) |
| EV-0007 | curation satisfaction | verified (cache) | SRC-0004 (Siemens 2005) |
| EV-0008 | weak-ties novelty | verified (cache) | SRC-0002 (Granovetter 1973) |
| EV-0009 | source diversity retention | verified (cache) | SRC-0004 (Siemens 2005) |
| EV-0010 | pacing recommendation | verified (cache) | SRC-0001 (Noe 2009) |

## Online pass

Skipped - `research.web_enabled` is not `true` in `.studio/config.json`.

## Recommended actions

Coverage is 100%. All 5 claim markers are resolved. This chapter is ready for the quality gate:
`/nonfiction-studio:run-quality-gate 02-finding-your-network`
```

---

**Studio (Step 5 - Confirm agent writes via Read checks):**

The skill uses the Read tool on `chapters/02-finding-your-network.md`. The file is present and unchanged - no chapter writes were needed because all entries were verified cache hits.

The skill uses the Read tool on `research/evidence-log.md`. The file is readable. All 5 entries remain at `status: verified` (the agent made no status writes because cache hits require no re-check and no status change).

The skill uses the Read tool on `.studio/fact-check-reports/02-report.md`. The file is present. Continue to Step 6.

**Studio (Step 6 - Report three counts from the agent's per-chapter report):**

**Studio:**

> Fact-check pass complete for `chapters/02-finding-your-network.md`.
>
> Counts from `.studio/fact-check-reports/02-report.md`:
> - Verified: 5 (EV-0006 through EV-0010, all via cache hits)
> - Unresolved: 0
> - Source-unverifiable: 0
>
> Fact-check report: `.studio/fact-check-reports/02-report.md`
>
> Coverage is 100% and no open claims remain. Run the quality gate:
> `/nonfiction-studio:run-quality-gate 02-finding-your-network`

---

## Key assertions from this transcript

- **File probe is a tool call.** The Bash call on `chapters/02-finding-your-network.md` determines the `HAS_CHAPTER`/`NO_CHAPTER` token before any other work begins. No prose inference substitutes for the tool result.

- **Chapter argument resolved via Read.** The skill reads `structure/chapter-list.md` and matches the supplied slug `02-finding-your-network` to row 2. An unmatched argument would halt with the registry file name and the list of valid slugs.

- **ns-claims provides the engine-backed pre-count.** After resolving the plugin root in Step 2, the Bash call `node "<plugin-root>/bin/ns-claims" --chapter=02-finding-your-network --json` returns 5 total markers, 5 resolved, 100% coverage. The skill presents this count before delegation. The skill never eyeballs markers itself; ns-claims is the deterministic inventory source per the TSK-050 (fact-check-pass skill) adjudication.

- **Agent performs the authoritative pass.** The fact-checker agent runs its full five-step protocol - cache protocol, marker resolution, status assessment, marker writes (none needed here), and the online pass decision - regardless of what ns-claims already showed. The agent's assessment is the operative one; the ns-claims count is a pre-delegation snapshot.

- **Cache protocol skips known-good entries.** All 5 EV entries had valid cache hits with no invalidated SRC dependencies. The agent confirmed their `verified` status via cache and skipped re-verification per D-09 (learning checker agents). This is the cost-reduction mechanism for long books where most evidence is stable.

- **No chapter or ledger writes for a clean pass.** Because all entries were verified cache hits, the agent needed no marker insertions, no stale-tag removals, and no status-field updates. The chapter file and `research/evidence-log.md` are unchanged. Only `.studio/fact-check-reports/02-report.md` was written.

- **Three counts from the agent's report, not from ns-claims.** The skill formats the three counts (5 verified, 0 unresolved, 0 source-unverifiable) from the agent's per-chapter report at `.studio/fact-check-reports/02-report.md`. The skill reads the report to confirm it exists, then presents the counts the agent recorded; it does not independently recount markers.

- **No progress.json write.** The skill wrote no `.studio/progress.json`. On CLI or Cowork, the PostToolBatch hook updates the `open_claim_count` for `02-finding-your-network` when the agent writes the chapter file; because the agent made no chapter writes in this clean pass, the hook had no trigger and the existing `open_claim_count: 0` in `progress.json` is already correct.

- **Web gate stated honestly.** The skill read `.studio/config.json` before delegation and stated the gate status explicitly: the online pass is not enabled for this project. The agent confirmed the gate and skipped all WebSearch and WebFetch calls.

- **Idempotency demonstrated.** Re-running this skill on Chapter 2 would produce the same outcome: the cache still holds all 5 entries (no SRC changes), the agent skips re-verification, and the report is overwritten with the same result. No state accumulates across re-runs.

---

## Synthetic illustration: what a partial-verification pass looks like

The following is explicitly a synthetic illustration and does NOT reflect the committed sample-book fixture. It shows what Step 6 would report if a hypothetical chapter carried one unresolved claim after an offline pass:

> Counts from `.studio/fact-check-reports/03-report.md`:
> - Verified: 3
> - Unresolved: 1 (EV-0013 at `status: unverified` - source text does not support the claim as written; see report for detail)
> - Source-unverifiable: 0
>
> Fact-check report: `.studio/fact-check-reports/03-report.md`
>
> 1 open claim remains. To resolve it:
> - Paste the relevant source text and re-run: `/nonfiction-studio:fact-check-pass 03-your-curation-practice`
> - Or gather additional evidence first: `/nonfiction-studio:research-pass 03-your-curation-practice`

This synthetic illustration shows the three-count format and the suggested next steps when the pass is not clean. The committed Chapter 2 example above is the primary provenance-honest transcript.
