# Changelog

All notable changes to Nonfiction Studio are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses [Semantic Versioning](https://semver.org/) once a version is tagged. See `MIGRATION.md` for what counts as a breaking change to a book already in progress, and `RELEASE-NOTES.md` for curated, user-facing summaries of each release.

This file is written from the commit history of the branch it ships from, not from a plan or a roadmap: an entry here means the change actually landed, not that it was intended.

## Unreleased

### Added

- Agent identity resolution from the hook envelope, activating two previously dormant guards: the research-agent write-scope containment, F-AG-01 (dormant write-path containment), and the web research gate that blocks unapproved online lookups, F-AG-02 (web gate unenforced). `ai-use-log` entries now attribute chapter writes to the real acting agent instead of a placeholder, D-10 (compliance layer is a feature). Recorded in ADR-0007 (agent identity resolution).
- A verbatim quote ledger field and a quote-fidelity engine, D-07 (claim ledger), plus a `quote_fidelity` quality-gate check registered warn-only by construction, D-03 (layered Stop gate).
- The untrusted-fetch envelope hook, OPP-P04 (untrusted-source envelope), and a second detector closing a gap in prompt-injection flagging.
- `ns-statusline`, the sixth shipped CLI, and its engine: a zero-token deterministic status view of active chapter, word progress against target, open claims, drift band, and gate state, per OPP-P03 (studio HUD). Ships via a `subagentStatusLine` declaration plus an explicitly consented, one-time install step in the `doctor` skill; `ns-doctor` itself stays read-only without exception. Recorded in ADR-0008 (status HUD and CANON 3.5).
- Weekly-scheduled Tier B model-integration CI (in addition to manual dispatch), on `CLAUDE_CODE_OAUTH_TOKEN` subscription authentication rather than an API key; a shared, honest three-state credential decision (`scripts/lib/credential-mode.mjs`) used by both `scripts/run-integration.mjs` and `scripts/run-evals.mjs`, replacing a probe that could only prove the `claude` binary existed, never that anyone was authenticated - F-CI-02 (Tier B trigger contradicts D-20). A dispatch-accuracy failure threshold (`scripts/lib/dispatch-threshold.mjs`) so a genuinely broken dispatch table now turns a live Tier B run red. Recorded in ADR-0010 (Tier B trigger and credential).
- A tag-triggered release workflow (`.github/workflows/release.yml`) that verifies a pushed version tag agrees with `library.json`, `package.json`, and `.claude-plugin/plugin.json` before publishing a GitHub release from `RELEASE-NOTES.md`.
- `CHANGELOG.md`, `RELEASE-NOTES.md`, and `MIGRATION.md`, closing F-ST-11 (no release automation), F-DX-13 (no shipped versioning policy), and F-DX-14 (no changelog).

### Changed

- Six skill verb triggers rephrased from "legacy" framing (implying a deprecated slash command) to "alias" framing (this plugin has no `commands/` directory at all, so no verb was ever a registered command to deprecate) - F4 (verb vocabulary).
- The Stop hook's check list now derives from the quality gate engine's own registry instead of a separately hand-maintained copy, and a third duplicated `foldForCompare` implementation was collapsed into the shared module.
- Self-sufficiency scanning closed blind spots in its scanned-file set (`examples/` was previously unscanned for provider-key patterns) and gained negative tests proving each checker can genuinely fail on a planted violation, not only pass - F6 (checker negative tests), F7 (scan-set blind spots).
- Prompt-injection flagging now requires a category-candidate match plus an explicit assistant-directed referent within the same sentence, instead of triggering on a single category match; closes false positives found across technical docs, corrections, status pages, quoted dialogue, and consumer-tech prose describing legitimate "developer mode" or "no longer bound by" language. The forged-role category (a bare `"Label:"` line prefix) and the role-redefinition category are both dropped entirely rather than repaired, since neither survived generalized testing beyond their original illustrative examples.

### Fixed

- The dormant write-scope guard and web research gate were activated for real; the agent prose that had claimed this enforcement existed is now literally true rather than aspirational - F-AG-01 (dormant write-path containment), F-AG-02 (web gate unenforced).
- A corrupt `.studio/config.json` no longer silently suppresses the shell destructive-command caution for non-write tools - F8 (corrupt config suppresses the shell caution).
- Sample-book gate fixtures and chapter voice now reflect genuine `ns-gate`/`ns-doctor` output instead of hand-authored approximations, including synced word-count and fixture-name assertions - F5 (gate fixture shape).
- Claims-ledger entries now use durable IDs, a dead field was dropped, and mutually exclusive CLI flags are now enforced rather than silently accepted together.
- A self-sufficiency test that was tripping on scanning its own source file is fixed.
- Removed stale scratch-workspace path references left behind in an earlier task's tests.
