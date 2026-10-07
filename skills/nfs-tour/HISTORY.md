# History - nfs-tour

Versions of this skill, newest first. [ADR-0017 (per-skill versioning)](../../docs/adr/ADR-0017-per-skill-versioning.md) defines the scheme, and `scripts/checks/check-skill-versions.mjs` checks this table against the version in `SKILL.md`. A row whose Release is `unreleased` is stamped with the release tag when the plugin is next released.

| Version | Date | Release | Type | Summary |
|---|---|---|---|---|
| 0.1.2 | 2026-10-04 | unreleased | changed | Follows the sample book's renamed state folder when it switches the tour copy to block mode (ADR-0015, state folder name), and updates the shared plugin-root note. |
| 0.1.1 | 2026-09-24 | v0.1.1 | fixed | Finds the plugin root from the installed-plugins record instead of a scan of the plugin cache, so the right copy is used when several versions are cached (ADR-0014, plugin-root resolution). |
| 0.1.0 | 2026-09-23 | v0.1.0 | added | First released version: a guided walkthrough of the bundled sample book in a disposable copy. |
