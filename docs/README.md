# Documentation index

This folder holds the reference material for Nonfiction Studio. It is organized by kind, not by audience, so a couple of these folders are more useful to contributors than to authors.

- **[quickstart.md](quickstart.md)** - The fast path: install, paste writing for a real voice-and-claims read, take the guided gate tour, then the honest pointer to the full intake interview.
- **[architecture.md](architecture.md)** - A contributor-facing map of the component model, the project bible, the deterministic quality gate, voice measurement, the claims ledger, the enforcement layer, the per-project settings file, and the CI tiers, grounded in the shipped code and ADRs.
- **[adr/](adr/)** - Architecture decision records: the evidence and reasoning behind specific engineering choices in this plugin.
- **[formats/](formats/)** - The file-format contracts for the project bible (the book's canonical reference files under `context/`, `structure/`, `chapters/`, `research/`, and `production/`): what every tracked file (evidence log, sources, decisions, snapshots, and so on) is required to contain. The per-project settings file, `.claude/nonfiction-studio.local.md`, has its own page too: [formats/settings.md](formats/settings.md).
- **[gates/](gates/)** - Internal engineering verification records for each build phase. Not user documentation; kept for the project's own accountability trail.
- **[reference/](reference/)** - A reference page, and a worked example, for every agent, skill, and command-line tool the plugin ships: [reference/agents/](reference/agents/), [reference/skills/](reference/skills/), [reference/cli/](reference/cli/). The two optional output styles have their own page too: [reference/output-styles.md](reference/output-styles.md). The hook events the plugin wires, and the `SessionStart` output-field contract in particular, are documented in [reference/hooks.md](reference/hooks.md).
- **[privacy.md](privacy.md)** - The plugin's privacy and persistent-state behavior, author-facing.
- **[releasing.md](releasing.md)** - The maintainer's runbook for cutting a release: the shape of a `RELEASE-NOTES.md` entry and the version-bump-to-tag-push sequence. Maintainer-facing, not author-facing.

**New here?** Start with [quickstart.md](quickstart.md) for the fast path, or [reference/skills/nfs-start.md](reference/skills/nfs-start.md) for the guided front door that the rest of the plugin routes through.
