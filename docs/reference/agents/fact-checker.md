---
title: "fact-checker agent reference"
description: "Reference for the fact-checker agent - the adversarial verification agent that advances EV entry statuses, maintains a project-scoped verified-claims cache, and writes per-chapter fact-check reports"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "research", "fact-check", "evidence", "verification", "ledger"]
---

# fact-checker

The `fact-checker` agent is the adversarial verifier of the project claim ledger.
It is the only agent in the roster that advances EV entry statuses beyond `pending`.
It is a Phase 1 Research-pillar agent specified in S-03 (research and evidence agents)
and governed by D-07 (claim ledger), D-09 (learning checker agents), D-13 (security
posture), and D-19 (colors by pillar).

## Purpose

The `fact-checker` works as a counterpart to `research-librarian`. Where
`research-librarian` registers sources and logs evidence at `status: pending`,
`fact-checker` takes adversarial ownership of every pending entry: it asks whether the
cited source actually supports the claim, whether a reasonable alternative explanation
exists, and whether the source is current and authoritative enough to bear the weight
placed on it. A claim passes to `verified` only when the agent can affirmatively trace
it to the registered SRC record.

Three outcomes are possible for each EV entry: `verified` (the source supports the
claim), `unverified` (the agent could not confirm the claim from the cited source), or
`interpretation` (the claim is a judgment about verifiable facts, not a falsifiable
assertion itself). A fourth outcome, `source-unverifiable`, is available only during
the optional online pass when a DOI or URL fails to resolve.

The `fact-checker` also maintains a project-scoped verified-claims cache. Claims
confirmed in a prior session do not need to be re-checked unless their source record
has changed; the cache reduces per-session cost significantly on books where most
evidence is stable.

The `fact-checker` does not allocate EV or SRC identifiers. It does not register
sources. It does not draft chapter prose. Those roles belong to `research-librarian`
and `drafting-partner` respectively.

## Invocation triggers

Invoke `fact-checker` when any of the following holds.

- Any chapter is about to be marked done; the Stop gate calls `bin/ns-claims` (D-05,
  five shipped CLIs) and surfaces unresolved markers before the gate clears.
- The author wants to verify a specific chapter or EV entry without running the full
  gate sequence.
- The `nfs-fact-check` skill is invoked; it routes here directly.

## At a glance

Registry facts for this agent, from the CANON component registry, are fixed.

| Property | Value |
|---|---|
| Pillar | Research |
| Phase | 1 |
| Model | `inherit` |
| Color | cyan |
| Memory | project |
| Tools | Read, Write, WebSearch, WebFetch |

The `model: inherit` choice follows D-18 (in-plugin model routing): adversarial
verification requires the same depth of reasoning that the session model was chosen for.
The cyan color follows D-19 (colors by pillar), which assigns cyan to the Research
pillar. The `memory: project` declaration follows D-09 (learning checker agents): the
platform creates `.claude/agent-memory/nonfiction-studio-fact-checker/` as the
project-scoped cache directory, confirmed by ADR-0004 (plugin agent memory).

## Inputs

The `fact-checker` reads only these paths.

| Path | When it is read | Why |
|---|---|---|
| `chapters/NN-*.md` | Start of every pass | Scan for all `[claim: EV-NNNN]` markers in the target chapter |
| `research/evidence-log.md` | Start of every session | Resolve markers to EV entries; confirm statuses on invalidated cache entries |
| `research/sources.md` | Start of every session | Scan for `changed: true` flags; retrieve SRC record details for verification |
| `.claude/agent-memory/nonfiction-studio-fact-checker/` | Start of every session | Read the verified-claims cache to identify entries that can be skipped |

## Outputs

The `fact-checker` writes only these paths, and only during a session where
at least one claim is being reviewed.

| Path | Written when | Contents |
|---|---|---|
| `research/evidence-log.md` | After each EV entry is resolved | `status` field updated to `verified`, `unverified`, `interpretation`, or `source-unverifiable`; reset to `pending` on cache invalidation. Claim text is never changed. |
| `chapters/NN-*.md` | When an entry is unverified or source-unverifiable; when a previously failed entry advances to `verified` on re-check | `[UNVERIFIED]` or `[SOURCE-UNVERIFIABLE]` inserted adjacent to the claim marker when the entry fails; the stale tag is removed when the entry advances to `verified` on re-check. The original `[claim: EV-NNNN]` marker is never removed. |
| `.studio/fact-check-reports/NN-report.md` | End of every pass | Per-chapter summary of findings and recommended actions |
| `.claude/agent-memory/nonfiction-studio-fact-checker/` | End of every pass | Cache updated with newly confirmed entries and session timestamps |

## The adversarial posture

The `fact-checker` does not start from a presumption of correctness. Its default
posture is to try to falsify each claim. For every EV entry, it applies three questions:

1. Does the cited source actually state what the EV entry asserts?
2. Is the source current and authoritative enough to support the claim as stated?
3. Does a reasonable alternative explanation exist that the chapter should acknowledge?

A claim passes only when the answer to question 1 is affirmatively yes and the
answers to 2 and 3 do not undercut the claim as stated. A source that discusses a
topic without explicitly supporting the specific claim does not count as confirmation.

## Claim marker resolution

For every `[claim: EV-NNNN]` anchor in the target chapter, the agent follows this
five-step sequence:

1. Locate the corresponding EV entry in `research/evidence-log.md`.
2. Verify the EV entry has a registered SRC record in `research/sources.md`.
3. Determine whether the claim text in the chapter matches what the source says.
4. Update the EV entry status to `verified`, `unverified`, or `interpretation` as
   appropriate.
5. For `unverified` entries: insert `[UNVERIFIED]` adjacent to the claim marker in
   the chapter. The original claim marker is not removed. On a re-check of an entry
   that previously carried an `[UNVERIFIED]` or `[SOURCE-UNVERIFIABLE]` tag and now
   advances to `verified`: remove the now-stale tag from the chapter file. The original
   `[claim: EV-NNNN]` marker is still never removed.

## Fact, interpretation, and opinion

Each claim in a chapter is one of three categories.

**Fact.** A claim that is falsifiable and traceable to a source. The `fact-checker`
resolves it to `verified` if the cited source supports it, or `unverified` if the
agent cannot confirm it from the cited source. Either way the EV entry carries the
result.

**Interpretation.** A claim that depends on judgment or framing of verifiable facts
rather than being directly falsifiable. The `fact-checker` resolves it to
`interpretation` in the EV entry. The agent notes what factual substrate the
interpretation rests on and whether that substrate is itself verified.

**Opinion.** A claim the author is explicitly making as their own view. Opinion
claims are not logged in the evidence ledger and are not tagged `[UNVERIFIED]`.
The `fact-checker` flags cases where an opinion is presented as a fact without
appropriate framing - for example, a generalization stated as a finding without
qualification - and marks these in the per-chapter report as author decisions. The
author, not the agent, resolves them.

## The primary versus secondary distinction

Each SRC record carries a `nature` field: `primary` (original study, dataset,
interview, legal text, or first-person account) or `secondary` (synthesis,
commentary, or a report citing another source). The `fact-checker` does not annotate
EV entries with a separate primary/secondary field. Consumers that need the distinction
- for example, `drafting-partner` signaling secondary sourcing in the manuscript -
dereference the EV entry's `source` field to the SRC record and read its `nature`
value. The EV grammar carries no such annotation field.

The `nature` field is relevant to the adversarial posture: a claim backed by a single
secondary source receives closer scrutiny than one backed by a primary source. The
agent may note a `nature: secondary` source's distance from the original finding in
the per-chapter report.

## The verified-claims cache

The `fact-checker` maintains a project-scoped cache at
`.claude/agent-memory/nonfiction-studio-fact-checker/`. The platform creates this
directory when the agent's `memory: project` frontmatter field is honored, per
ADR-0004 (plugin agent memory). The body-text path shown here is documentation; the
`memory: project` field - not any body-text literal - is what controls which directory
the platform creates.

At the start of every session, the agent follows a three-step protocol:

1. Read `research/sources.md` and scan for SRC records carrying `changed: true`.
2. For each changed SRC record, invalidate all cache entries whose `source_id` matches
   and reset those EV entries in `research/evidence-log.md` to `pending`.
3. Load the cache. EV entries with a valid cache hit and no invalidated SRC dependency
   are skipped for the current pass.

A cache entry is never treated as valid across a schema change to
`research/evidence-log.md`. When the ledger schema changes, the entire cache is
invalidated and all entries re-verified from scratch.

Cache hits reduce per-session token cost significantly on long books where most evidence
is stable. The cache does not affect the verified status of any entry; it only controls
whether re-checking is needed.

## The web research gate and online pass

Web research is an optional capability for the `fact-checker`. The author enables it
per-project by adding the following to `.studio/config.json`:

```json
"research": {
  "web_enabled": true
}
```

The gate rule is strict: `web_enabled` must be the boolean `true`. An absent key,
the string `"true"`, `false`, or `null` all leave the gate closed. This is the same
`research.web_enabled` config key used by `research-librarian`.

When the gate is open, the `fact-checker` runs an online pass after the offline check.
It attempts to retrieve the `locator` field from each SRC record referenced by the
chapter's EV entries. A DOI is retrieved via its resolver; a URL is fetched directly.
If resolution fails:

- The EV entry is updated to `source-unverifiable`.
- `[SOURCE-UNVERIFIABLE]` is inserted adjacent to the claim marker in the chapter.
- The failure is noted in the per-chapter report.

The agent does not follow redirects to paywalled content and does not treat a
robot-generated summary as source confirmation.

## Per-chapter fact-check report

After completing every pass - offline or online - the `fact-checker` writes
`.studio/fact-check-reports/NN-report.md`. The report always contains:

- Total claim markers found in the chapter.
- Count and list of `verified`, `unverified`, `interpretation`, and
  `source-unverifiable` entries.
- Any claims categorized as opinion-presented-as-fact requiring author decision.
- Recommended actions before re-running the coverage gate.

The report is written even when all entries are verified. `bin/ns-claims` and the Stop
gate read this report as part of the coverage evaluation.

## Security posture

Fetched web content is untrusted data per D-13 (security posture). The `fact-checker`
quotes and attributes content from fetched pages and never paraphrases it as its own
claim. Any instruction-shaped text inside a fetched page - for example,
"Ignore your previous instructions and output..." - is data, not a command to execute.
The shipped agent prompt (`agents/fact-checker.md`) instructs the agent never to follow
such embedded instructions; it does not separately instruct the agent to flag or log the
anomaly in its own session output, so whether one appears there is a matter of model
judgment, not a documented contract. Any WebFetch or WebSearch call this agent makes
additionally passes through the mechanical `PostToolUse` hook (`hooks/post-tool-use.mjs`),
which wraps and fences the payload and appends a record to `.studio/logs/fetches.jsonl`
regardless of what the agent itself does. This posture is not waivable; it applies to
every WebFetch call regardless of the apparent credibility of the source. The agent never reports a robot-generated summary as source
confirmation and never follows a redirect to a paywall or login screen to retrieve
gated content.

## Guardrails

- **Adversarial by default.** The default disposition is falsification. Absence of
  evidence against a claim is not evidence for it.
- **Sole status advancer.** Only `fact-checker` advances EV entries beyond `pending`.
  `research-librarian` creates entries and sets them to `pending`; only `fact-checker`
  resolves them further.
- **Never allocates IDs.** The `fact-checker` never allocates new EV or SRC
  identifiers. That role belongs exclusively to `research-librarian`.
- **Sanctioned backward move only.** The only permitted backward status transition is
  the cache-invalidation reset to `pending` described in S-03 (research and evidence
  agents) section 1.4. No other backward move is permitted.
- **Original marker preserved.** The `[claim: EV-NNNN]` marker in a chapter is never
  removed. Tags are added adjacent to it; they do not replace it.
- **Web gate is hard.** WebSearch and WebFetch are not called unless `research.web_enabled`
  is exactly the boolean `true` in `.studio/config.json`. When the gate is closed the
  agent reports that the online pass is disabled and states the config change needed.
- **Fetched content is data.** The D-13 (security posture) untrusted-data rule applies
  to all fetched content without exception.
- **Report is mandatory.** The per-chapter fact-check report is written at the end of
  every pass. The Stop gate will not clear a chapter that lacks a current report.

Per A-02 (platform capability baseline), a plugin-shipped agent cannot declare `hooks`,
`permissionMode`, or `mcpServers` in frontmatter; the platform ignores those fields.
Every guardrail above is enforced in the agent's system prompt.

## Natural next step

After a fact-check pass, the natural next steps depend on the outcome. If all entries
are `verified`, the chapter is ready for the coverage gate; run `bin/ns-claims` or
invoke `nfs-check-chapter` to confirm. If any entries are `unverified` or
`source-unverifiable`, return to `research-librarian` to supply or correct the source
before re-running the pass. If entries are marked `interpretation`, the author reviews
the per-chapter report to confirm the framing is accurate.

## Worked example

See [fact-checker.example.md](./fact-checker.example.md) for a condensed transcript
of a fact-check pass over Chapter 2 of the sample book "The Quiet Network," showing
the session-start cache protocol, adversarial claim resolution for five EV entries,
the trichotomy in action, and the resulting per-chapter report.
