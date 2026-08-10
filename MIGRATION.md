# Migration Guide

This file documents Nonfiction Studio's bible-schema compatibility story: what changes between plugin versions, what an author must do when their book's schema falls behind the installed plugin, and exactly how much of that is automated today versus intended for later. F-DX-13 (no shipped versioning policy) asks for this file to exist before the first schema bump, precisely so this honesty happens in advance rather than after an author's book is already affected.

For the mechanical sequence of steps a maintainer follows to cut a plugin release (as opposed to a book's own schema compatibility, which is this file's subject), see `RELEASE-NOTES.md`'s maintainer runbook.

## Where the schema version lives

Every book project carries a `.studio/meta.json` file with a `schema_version` field (currently `"2"` for every book scaffolded by this plugin version). `hooks/lib/doctor-engine.mjs` pins the version this installed plugin supports as `SUPPORTED_MAJOR = '2'`. `bin/ns-doctor` reads both and compares them on every `--check`, `--report`, and `--migrate` invocation.

## What `ns-doctor --migrate` does today

**Diagnosis only.** If a book's `schema_version` equals the installed plugin's `SUPPORTED_MAJOR`, `--migrate` reports "nothing to migrate" and exits 0: a current schema is a success state, not an error indistinguishable from a broken bible. If a book's `schema_version` is anything else, `--migrate` refuses and exits 2, naming both the book's version and the version the plugin supports.

**No automated transformation exists yet.** `--migrate` does not currently rewrite `.studio/meta.json`, does not touch chapter content, evidence-ledger entries, or voice-profile data, and does not write a migration-event log. There is nothing to transform yet, because the plugin has shipped exactly one schema major (`2`) since its first release, so this path has never had a real old-format bible to run against. The command exists today as a readiness check: it tells an author clearly whether their book needs attention, without silently doing (or silently failing to do) anything to their files.

Practically, this means: if you are reading this because `ns-doctor` told you a migration is required, the automated migration you might expect from the message does not exist yet for your specific version jump. Treat that outcome as a signal to check this file's migration log below and, if your target version genuinely lacks an entry, to treat the mismatch as a real blocker worth reporting rather than something to force past.

## Compatibility intent (design commitment, not yet exercised)

The intended policy, once a second schema major ships, is:

- A book's schema stays **read-compatible** with the plugin for at least one full MAJOR plugin version after the version that introduced the next schema major, so an author is never forced to migrate the moment they update the plugin.
- Read-compatible means `ns-doctor` and the other `bin/` engines (`ns-claims`, `ns-stylometry`, `ns-scrub`) can parse and process the older format without data loss, even if they do not rewrite it.
- Write-compatibility (writing the OLD format back out) is not guaranteed once a book has been migrated forward.
- No chapter content, evidence-ledger entry, or voice-profile data may be destroyed by a migration; anything that genuinely cannot be carried forward automatically is called out explicitly in that migration's own log entry below, never dropped silently.

This is a commitment about how the *next* migration will be built, not a description of code that exists. Until a migration log entry below says otherwise, no automated migration has ever run against a real book.

## Migration log

No migrations have shipped yet. When `schema_version` first changes, this section gains a dated entry in this shape:

```markdown
### schema_version "2" -> "3" (shipped in vX.Y.Z)

- What changed: <field rename / type change / removal, named exactly>
- What ns-doctor --migrate does automatically: <the real transformation, or "nothing yet, manual steps only">
- What the author must do manually: <steps, or "nothing">
- Data that cannot be migrated automatically: <named explicitly, or "none">
```

## What counts as a breaking change

For a prompt-and-Markdown plugin like this one, there is no REST endpoint to version: the compatibility surface is the bible schema, the component slugs, and the quality-gate semantics. A change needs a MAJOR version bump if it does any of the following:

- Renames, retypes, or removes a field in `.studio/meta.json`, `.studio/config.json`, `progress.json`, or the evidence-ledger format.
- Renames or removes any shipped agent, skill, or hook slug.
- Moves a deterministic quality-gate check from warn to block, or changes a block check's exit condition so that previously valid output starts failing.
- Changes a `bin/` CLI's exit code, removes a flag, or changes what an existing flag means.
- Removes or renames a previously documented `.studio/config.json` key.

A new skill, agent, hook, or template, a new optional config key, a new warn-only gate check, or a new `bin/` flag that does not remove an existing one, is feature-additive (MINOR). A correctness fix that does not change a contract (a check that was wrongly accepting bad output starting to reject it correctly, a prose update with no slug or schema affected) is a PATCH.

## Mid-book update promise

An author partway through a book must be able to take a MINOR or PATCH update with no migration step required at all. A MAJOR update may require running `ns-doctor --migrate`, but the migration must be runnable from the `doctor` skill without leaving the author's working session, any manual steps are surfaced before automated ones run, and no book content may be destroyed. `doctor` warns at session start whenever the installed plugin is ahead of a book's schema version, pointing at this file.
