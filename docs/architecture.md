# Architecture

This page is a contributor-facing map of how Nonfiction Studio is built, grounded in the shipped code and the ADRs that decided it. It does not repeat the user-facing pitch in `README.md`; it explains the mechanism underneath.

The shape in one sentence: skills narrate and orchestrate, agents do scoped writing work, deterministic engines under `hooks/lib/` do the actual computation, `bin/ns-*` CLIs and Claude Code hooks are two different thin callers of those same engines, and the author's plain-Markdown project bible, plus a small amount of machine state under `.studio/`, is where project truth lives.

## The component model

### Skills narrate and orchestrate

The 14 skills under `skills/` (each a `skills/<name>/SKILL.md`) are the front door for every author-facing flow: interview, outline, draft, fact-check, capture voice, build apparatus, check a chapter, and so on. A skill never computes a verdict itself. It resolves arguments, reads the bible files it needs, decides which agent (if any) to dispatch, and presents the result. `skills/nfs-draft/SKILL.md` is representative: it resolves the chapter argument against `structure/chapter-list.md`, loads the outline and evidence entries, dispatches `drafting-partner` and then `line-editor`, and confirms the write with a Read check - the skill is the orchestrator, the agents are the writers.

### Agents do scoped work, with declared model tiers and a permitted chain

The 8 agents under `agents/` (`drafting-partner`, `fact-checker`, `interviewer`, `line-editor`, `research-librarian`, `structure-architect`, `thesis-architect`, `voice-capture`) are each a single Markdown file with a `model:` frontmatter field declaring its tier, per D-18 (in-plugin model routing). Which agent may dispatch which other agent, and which skill may dispatch which agent, is a fixed edge list in `agents/_chain-permitted.yaml`, not left to a skill's own prose. That file is enforced twice, for two different failure classes:

- **Lint time**, by `scripts/check-frontmatter.mjs`, which checks every skill-to-agent edge the file declares against the real skill directories on disk - a phantom caller (an edge naming a skill that does not exist) fails the build.
- **Dispatch time**, by `hooks/pre-tool-use.mjs` via `hooks/lib/routing.mjs`, which fires on every dispatch to one of this plugin's own agents. It warns when a dispatch carries an explicit model override that disagrees with the target agent's declared `model:` tier. When the dispatcher is itself a plugin agent, it also warns when the edge is not listed in `agents/_chain-permitted.yaml`; the only agent-to-agent edge declared today is `drafting-partner -> research-librarian`. Warn is the default. The per-project settings file's `routing_enforce` key can turn this `off` or raise it to `block`, which denies instead of warning.

### `bin/ns-*` CLIs are thin wrappers over deterministic engines

The 9 CLIs under `bin/` (`ns-claims`, `ns-doctor`, `ns-gate`, `ns-notes`, `ns-overlap`, `ns-scrub`, `ns-status`, `ns-statusline`, `ns-stylometry`) each follow the same shape: parse arguments, locate the book root, call into one or more engine modules under `hooks/lib/`, and format the result. `bin/ns-gate`'s own header states the rule directly: "the CLI is the public surface; all logic lives in `gate-engine.mjs` so `hooks/stop-gate.mjs` and CI can share the same computation path." Every engine module - `claims-engine.mjs`, `stylometry-engine.mjs`, `scrub-engine.mjs`, `doctor-engine.mjs`, `overlap-engine.mjs`, `apparatus-engine.mjs`, `gate-engine.mjs` - is a unit-testable module with no CLI concerns of its own, so a CLI and a hook can call the same code. For the gate specifically, `hooks/stop-gate.mjs` runs `bin/ns-gate` itself as a subprocess, which is what keeps a manual `ns-gate` run and a Stop-hook gate run from disagreeing.

### Hooks wire engines into Claude Code events

`hooks/hooks.json` is the authoritative event list; it wires six events to thin hook scripts under `hooks/`:

- **SessionStart** (`hooks/session-start.mjs`) - locates the book root and emits an orientation block; on an empty directory it opens the guided front door unprompted.
- **PreToolUse** (`hooks/pre-tool-use.mjs`) - the write-containment guard, the per-agent write-scope and web-research gates, and dispatch-routing enforcement (see "The enforcement layer" below).
- **PostToolBatch** (`hooks/post-tool-batch.mjs`) - refreshes `.studio/progress.json` and writes AI-disclosure records to `.studio/ai-use-log.jsonl`.
- **PostToolUse**, matched only on `WebFetch|WebSearch` (`hooks/post-tool-use.mjs`) - the untrusted-fetch envelope.
- **Stop** (`hooks/stop-gate.mjs` plus a prompt-based thesis-alignment check) - the deterministic quality gate, run at the end of a turn.
- **PreCompact** (`hooks/pre-compact.mjs`).

### Output styles

The 2 output styles under `output-styles/` (`manuscript.md`, `review.md`) change only how Claude's replies are worded and shaped in a project; neither touches what any skill, agent, or engine reads, writes, or checks. Neither is on by default - `nfs-new-book` offers both once at project init and records the outcome in the per-project settings file, but activation itself happens through the platform's own `/config` picker or a settings-file merge-write, never automatically. See `docs/reference/output-styles.md` for the full mechanism.

## The project bible

The project bible is the author's own plain-Markdown files - never a database, never a binary format - under `context/`, `structure/`, `chapters/`, `research/`, and `production/` inside a book project. Every file format the studio reads or writes there has a normative grammar page under `docs/formats/` (claim markers, the evidence log, sources, decisions, snapshots, the settings file, and more), written so that, in each page's own words, "a parser author must be able to implement a conformant [reader/scanner] without consulting any other document." `hooks/lib/bible.mjs` is the single shared module that walks up from a start directory to locate the book root and reads `meta.json` and `config.json`, and reads and atomically writes `progress.json` with unknown-field preservation - every CLI and every hook goes through this one module rather than re-implementing root-finding.

## The deterministic quality gate

`hooks/lib/gate-engine.mjs` is the policy layer. It composes seven checks - claim coverage, quote fidelity, stylometry (voice drift), prompt-injection scrub, continuity, state coherence, and research-corpus overlap - plus a session-write flag check, into one structured verdict. Two design points carry the whole system:

**Config merge order.** `loadGateConfig` is the single choke point (its own doc comment states this): `DEFAULT_GATE` (the shipped defaults, exported from `gate-engine.mjs` itself) is overlaid by `.studio/config.json`'s `gate` and `thresholds` blocks, which is overlaid by the per-project settings file's `gate_mode` and `thresholds` keys, and only after all of that are two structural coercions applied. The coercions force `thesis_alignment.mode` and `quote_fidelity.mode` from `block` back to `warn` no matter what any config layer requested. `thesis_alignment` is a judgment check that must never block, which is D-03 (layered Stop gate) Invariant 1. `quote_fidelity` is held at warn until a quote normalization and adjudication policy ships. Because the settings overlay runs before the coercions and never writes to `gate.checks`, a settings file can raise the top-level `gate.mode` but can never promote either check out of warn. This is expressed as code, not convention.

**Warn versus block.** Every individual engine (`ns-claims`, `ns-stylometry`, `ns-scrub`, `ns-doctor`) is mode-independent - it exits nonzero on any finding regardless of gate config. The gate itself is the one mode-dependent layer: it exits 1 (block) only when the top-level `gate.mode` is not `warn` AND at least one check configured to `block` actually fails; it exits 2 on any operational error (which always beats a block verdict, which always beats a pass or warn verdict); otherwise it exits 0. `hooks/stop-gate.mjs` runs `bin/ns-gate` as a subprocess at the end of a turn and maps that exit code to a block decision, a warn `additionalContext`, or silence.

## Voice measurement (ADR-0012)

The stylometry check does not sum per-marker deviations against a fixed budget; it takes the single largest standardized deviation against a null distribution calibrated on the author's own corpus, per [ADR-0012 (voice verdict scope)](adr/ADR-0012-voice-verdict-scope.md). Summing every marker dilutes a real signal that usually concentrates in one or two dimensions; the maximum does not. A second consequence of that same ADR is scope, not just arithmetic: an author whose own corpus cannot support a chapter-scale verdict (too few first-person or contraction tokens to separate signal from sampling noise) is measured at book scale instead, with the baseline itself recording which regime applies - the per-chapter number becomes advisory rather than blocking for that author. Voice "registers" (multiple calibrated styles per project) are advisory-only in the current baseline, per the same decision.

## The claims and evidence ledger

`research/evidence-log.md` and `research/sources.md` are parsed and serialized byte-faithfully by `hooks/lib/ledger.mjs`, the one shared parser every claims-aware code path uses (`ns-claims`, `ns-doctor`, `ns-notes`, `gate-engine.mjs`, `overlap-engine.mjs`, and the session orientation block). Chapter prose carries three inline marker forms that `hooks/lib/claims-engine.mjs` scans for and resolves against the ledger: `[claim: EV-NNNN]` (resolved when its EV entry's status is `verified` or `interpretation`; anything else, including a missing entry, is an open claim), `[UNVERIFIED]` (always open), and `[SOURCE-UNVERIFIABLE]` (open unless paired with a `[claim:]` marker on the same line, whose own status already carries the finding). `hooks/lib/apparatus-engine.mjs` closes the loop on the writing side: it is a pure, no-filesystem-access module that turns every `[claim:]` anchor already in a chapter into a Chicago-style note or a named attention row, plus a deduplicated bibliography and index-candidate terms - `bin/ns-notes` is its only caller.

## The enforcement layer

Three independent mechanisms, each with its own failure posture:

- **Write-scope guard**, per [ADR-0007 (agent identity resolution)](adr/ADR-0007-agent-identity-resolution.md). `hooks/lib/agent-identity.mjs` exports `AGENT_WRITE_SCOPES`, a table of book-root-relative prefixes each of five agents (`research-librarian`, `drafting-partner`, `line-editor`, `structure-architect`, `thesis-architect`) is allowed to write under, verified against that agent's own shipped prose. `hooks/pre-tool-use.mjs` enforces it fail-closed: a write outside the allowed prefix is denied. An agent deliberately absent from the table (`fact-checker`, `interviewer`, `voice-capture`) is unconstrained by design, not by oversight - constraining a claim the agent's own prose never made would be a behavior change, and the ADR records that reasoning by name. Agent identity itself comes from the hook envelope's `agent_type` field, namespace-matched against `nonfiction-studio:` so a same-named agent from an unrelated plugin is never accidentally bound by this guard.
- **Untrusted-fetch envelope**, wired to `PostToolUse` matched on `WebFetch|WebSearch` (`hooks/post-tool-use.mjs`). Each fetch result is wrapped before Claude sees it: a preamble stating the content is retrieved data and not instructions, the source, a retrieval timestamp, a content-scan flag line, and the original body inside a nonce-fenced boundary. Inside a book project, one append-only JSONL record per fetch is logged to `.studio/logs/fetches.jsonl`. The hook is fail-open: if wrapping itself throws, it emits nothing and the platform passes the original output through unwrapped. The hook's own header is explicit about a design choice worth citing here: a dedicated "ignore your instructions"-style injection detector was built, adversarially tested across four rounds, and removed rather than shipped, because every narrowing still false-positived on ordinary prose (a "your prompt" reference to a shell prompt, in developer documentation, was the case that closed the question). The wrap-and-fence mechanism is unconditional and unaffected by that removal; it is the mitigation the hook actually relies on.
- **Routing and chain enforcement**, per [ADR-0013 (wave 1 exit surfaces)](adr/ADR-0013-wave-1-exit-surfaces.md) and D-18 (in-plugin model routing). Covered above under "Agents do scoped work" - the same `hooks/pre-tool-use.mjs` guard, reading `hooks/lib/routing.mjs`, warns or (opted in) blocks a dispatch that violates a declared model tier or an undeclared chain edge.

All enforcement in `hooks/pre-tool-use.mjs` and its collaborators shares one posture split: guard violations (containment, write-scope, web gate) are fail-closed by design (D-13, security posture); operational failures reading a settings file, an agent's frontmatter, or the chain-permitted table are fail-open (silence, never a false deny) - a corrupt or missing config file must never crash a hook or force an incorrect verdict.

## The per-project settings file

`.claude/nonfiction-studio.local.md` (schema v1, read by `hooks/lib/settings.mjs`) is optional and per-project, and is kept apart from the shared, version-controlled bible files. Its YAML frontmatter carries four keys - `gate_mode`, `thresholds`, `routing_enforce`, and `output_style` (a record of the style offer's outcome, not an activation switch) - each independently validated; a bad value for one key is dropped alone, every other valid key (known or unknown) survives, and the file's Markdown body beneath the frontmatter is never parsed, only surfaced as a one-line "read your house notes" pointer at session start. Every failure mode is fail-open, matching the enforcement layer's own posture: absent, corrupt, or malformed, the file changes nothing rather than breaking a session. The full grammar is `docs/formats/settings.md`.

## The CI tiers

Two workflows, two different jobs:

- **Tier A** (`.github/workflows/tier-a.yml`) is fully deterministic and keyless - no model credential required - and gates every pull request targeting `main`, on both Ubuntu and Windows. There is no `npm test`; the canonical battery is the run-steps in that workflow file itself: spine conformance, platform validation, hooks-schema, frontmatter completeness, docs completeness, link checking, plugin-root convention, self-sufficiency, component inventory, workspace-reference guard, skill CLI routing targets, advertised invocations, link labels, component-count claims, compliance-stanza parity, engine unit tests, fixture tests, and sample-book integrity. Every one of those except platform validation (`claude plugin validate --strict .`) is a script under `scripts/` or `scripts/checks/`, each independently runnable.
- **Tier B** (`.github/workflows/tier-b.yml`) is model-integration testing, triggered only by manual `workflow_dispatch`, never on a schedule or on every push, per [ADR-0010 (tier B trigger and credential)](adr/ADR-0010-tier-b-trigger-and-credential.md). It authenticates with `CLAUDE_CODE_OAUTH_TOKEN`, a subscription-based OAuth token the maintainer mints locally, not an API key - keeping Tier B inside the same self-sufficiency boundary the rest of the plugin holds to. On an unattended runner with no credential set, it exits 0 with a named skip that says which secret is missing, rather than either failing or silently passing. Tier B is advisory to merges (it has no `pull_request` trigger at all) and treated as blocking to a release: a maintainer should not cut a tag off a run that failed or only skipped.

## Data-flow sketch: one chapter, draft to gate verdict

```
author invokes /nonfiction-studio:nfs-draft <chapter>
        |
        v
  skills/nfs-draft/SKILL.md  (resolves slug against structure/chapter-list.md,
        |                     loads structure/outline.md + research/evidence-log.md
        |                     + context/style-profile.md + context/brief.md)
        v
  agent: drafting-partner    (writes chapters/<slug>.md directly, or emits
        |                     diff-proposal blocks for an existing chapter;
        |                     write-scope guard confines it to chapters/)
        v
  agent: line-editor         (proposal-only polish; author accepts each change)
        |
        v
  hooks/pre-tool-use.mjs     (fires before each agent write above: containment
        |                     and write-scope guards; snapshot to .studio/snapshots/
        |                     on an existing-chapter overwrite; session-write flag set)
        v
  hooks/post-tool-batch.mjs  (.studio/progress.json refreshed;
        |                     .studio/ai-use-log.jsonl compliance record appended)
        v
  [end of turn] hooks/stop-gate.mjs
        |
        v
  bin/ns-gate  -> hooks/lib/gate-engine.mjs
        |             DEFAULT_GATE <- .studio/config.json <- settings file
        |             <- structural coercions (thesis_alignment, quote_fidelity -> warn)
        |             runs: claim_coverage, quote_fidelity, stylometry, prompt_scrub,
        |             continuity, state_coherence, overlap, session_write_flag
        v
  .studio/gate/<slug>.<ts>.json  (report written by ns-gate; stop-gate copies its stdout to last-gate.json)
        |
        v
  verdict surfaced: pass (silent) | warn (additionalContext) | block (Stop decision)
```

A human can also run this gate directly (`/nonfiction-studio:nfs-check-chapter`, or `bin/ns-gate` from a shell). A chapter reaches `final` only through a dated author attestation naming it in `context/decisions.md`, per [ADR-0011 (tranche 2 decisions)](adr/ADR-0011-tranche-2-decisions.md), and any later edit demotes it automatically. The gate informs that decision but does not grant it. The studio proposes and checks; the author accepts, revises, or rejects.
