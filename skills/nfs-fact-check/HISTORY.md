# History - nfs-fact-check

Versions of this skill, newest first. [ADR-0017 (per-skill versioning)](../../docs/adr/ADR-0017-per-skill-versioning.md) defines the scheme, and `scripts/checks/check-skill-versions.mjs` checks this table against the version in `SKILL.md`. A row whose Release is `unreleased` is stamped with the release tag when the plugin is next released.

| Version | Date | Release | Type | Summary |
|---|---|---|---|---|
| 0.2.0 | 2026-10-04 | unreleased | changed | Finds the state folder through the shared "Locate the state folder" section, which reads the book's pointer file (ADR-0015, state folder name), and reads chapters from the folder the pointer names (ADR-0016, adopting an existing book). It stops before its first write when claims is not adopted, and names the way to adopt it. |
| 0.1.1 | 2026-09-24 | v0.1.1 | fixed | Finds the plugin root from the installed-plugins record instead of a scan of the plugin cache, so the right copy is used when several versions are cached (ADR-0014, plugin-root resolution). |
| 0.1.0 | 2026-09-23 | v0.1.0 | added | First released version: runs the adversarial verification pass on a drafted chapter, an engine-backed marker inventory followed by the fact-checker agent's pass. |
