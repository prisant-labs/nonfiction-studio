# Documentation index

This folder holds the reference material for Nonfiction Studio. It is organized by kind, not by audience, so a couple of these folders are more useful to contributors than to authors.

- **[adr/](adr/)** - Architecture decision records: the evidence and reasoning behind specific engineering choices in this plugin.
- **[formats/](formats/)** - The file-format contracts for the project bible: what every tracked file (evidence log, sources, decisions, snapshots, and so on) is required to contain.
- **[gates/](gates/)** - Internal engineering verification records for each build phase. Not user documentation; kept for the project's own accountability trail.
- **[reference/](reference/)** - A reference page, and a worked example, for every agent, skill, and command-line tool the plugin ships: [reference/agents/](reference/agents/), [reference/skills/](reference/skills/), [reference/cli/](reference/cli/).
- **[privacy.md](privacy.md)** - The plugin's privacy and persistent-state behavior, author-facing.

**New here?** Start with [reference/skills/studio.md](reference/skills/studio.md); it describes the guided front door that the rest of the plugin routes through.
