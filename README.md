# Nonfiction Studio

Nonfiction Studio is an open-source Claude Code plugin that turns Claude into a governed non-fiction book studio. It runs a structured authoring workflow through a team of specialist agents: an intake interview that captures your book's thesis, audience, and voice; chapter drafting; claim-to-source tracking and fact-checking; voice consistency scoring; and a quality gate that runs before anything counts as done. You stay in charge throughout; the studio proposes, checks, and drafts, and you accept, revise, or reject every chapter.

## Status

**Pre-release, under construction.** Phase 1, the core authoring workflow, is complete. Later phases (deeper research tooling, a revision pass, manuscript export, and publishing-compliance features) are still being built, and rough edges are expected.

## Install

There is no public marketplace listing yet. For now, clone or download this repository, then install it from your local copy:

```
claude plugin marketplace add /path/to/nonfiction-studio
claude plugin install nonfiction-studio@nonfiction-studio
```

Replace `/path/to/nonfiction-studio` with wherever you cloned or unzipped it on your machine. A public marketplace listing is planned for a later release.

## Quickstart

The fastest way to see what this plugin does: paste some of your own writing and get a real, measured result back, no project setup required.

1. Open Claude Code in any folder.
2. Run `/nonfiction-studio:quick-scan` and paste 500 to 1000 words of your own prose. You get back a voice profile measured by the same deterministic engine this plugin uses everywhere else, a claim scan flagging sentences that need a source, and a one-paragraph read on what it's about - the measured and the model-judged parts are kept clearly distinct in the output.
3. Run `/nonfiction-studio:tour` to watch the quality gate work: it passes on the bundled sample book, blocks on a planted, realistic defect with a named reason, then passes again once the defect is fixed. The tour works from a disposable copy; nothing here touches the plugin's own shipped example.
4. Ready to write your own book? Run `/studio` (or `/nonfiction-studio:studio` if you have other plugins installed that also define a `/studio` command) and choose "Start a new book." That leads to the intake interview: a real 45-90 minute session that captures your book's thesis, audience, and voice. Budget for it honestly; success in that session means a confirmed project brief, not a drafted chapter. Quick-scan and the tour above are previews, not a substitute for it.

See [docs/quickstart.md](docs/quickstart.md) for the fuller walkthrough, or explore [examples/sample-book/](examples/sample-book/) directly: a complete two-chapter project called "The Quiet Network," with a full bible, research ledger, and gate history already in place.

## Surfaces

Nonfiction Studio is built for three places Claude runs, and they are not equally proven yet:

| Surface | What to expect |
|---|---|
| Claude Code CLI | Full support. This is where the plugin has actually been built and exercised. |
| Cowork | Expected to work the same way, but unverified. A hook-execution spike is still pending; see [ADR-0002](docs/adr/ADR-0002-cowork-hook-execution.md). |
| claude.ai chat | Skills only. Hooks do not fire on chat, so the quality gate does not run automatically there; run `/nonfiction-studio:run-quality-gate` yourself when you want a verdict. |

If you try Nonfiction Studio in Cowork, treat it as "should work" rather than "proven to work" until ADR-0002 is resolved.

## Self-sufficiency

**Self-sufficiency.** Nonfiction Studio runs entirely on a working Claude Code or Cowork login: every skill, agent, hook, and CLI in this plugin rides the model access your session already has, none of them call a model API directly, and none require a separate API key, account, or paid service. Tier B (model-integration CI) stays inside that same boundary: it authenticates with `CLAUDE_CODE_OAUTH_TOKEN`, an OAuth token a maintainer mints from their own subscription with `claude setup-token`, not an API key. It runs on manual dispatch only, is advisory only, and is never required to open or merge a pull request; when the token secret is not set, the workflow skips green with a named reason instead of failing. Running it yourself needs only your existing `claude` CLI login. See [ADR-0010](docs/adr/ADR-0010-tier-b-trigger-and-credential.md) for the full trigger and credential contract. Optional online research (DOI and URL lookups) uses Claude's own WebSearch and WebFetch tools, stays off by default, and falls back to author-pasted source text whenever it is unavailable or disabled, rather than blocking.

## Privacy and memory

The fact-checker agent keeps a small cache of verified claims at `.claude/agent-memory/nonfiction-studio-fact-checker/` inside your project folder, so it does not re-verify the same claim against the same source twice. It stores claim and source verification outcomes only, never your unpublished manuscript text wholesale. Delete that directory any time to clear it; it simply rebuilds as you keep working. Everything lives in your project folder and on your own machine; nothing is sent anywhere beyond your own Claude session. See [docs/privacy.md](docs/privacy.md) for the fuller note, including the AI-use log and chapter snapshots.

## Documentation

The [docs/](docs/README.md) folder has a reference page for every agent, skill, and command-line tool the plugin ships, plus the file-format specs for the project bible and the architecture decision records behind the major engineering calls. If something in your project looks wrong, the [doctor skill](docs/reference/skills/doctor.md) is the first place to run diagnostics: `/nonfiction-studio:doctor`.

## Contributing

Pull requests run a fully keyless, deterministic CI check (Tier A); you never need an API key to develop or test this plugin. A second, model-integration CI check (Tier B) exists for maintainers, runs on manual dispatch only, and is advisory, never a merge requirement or a trigger on pull requests at all. A fuller contributing guide will follow; for now, open an issue or a pull request.

## License

Nonfiction Studio is licensed under the [MIT License](LICENSE). Copyright 2026 JP Prisant.

The validation tooling vendored under `scripts/` is licensed separately under Apache License 2.0; see [scripts/LICENSE-APACHE](scripts/LICENSE-APACHE) and [scripts/ATTRIBUTION.md](scripts/ATTRIBUTION.md).
