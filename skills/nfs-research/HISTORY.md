# History - nfs-research

Versions of this skill, newest first. [ADR-0017 (per-skill versioning)](../../docs/adr/ADR-0017-per-skill-versioning.md) defines the scheme, and `scripts/checks/check-skill-versions.mjs` checks this table against the version in `SKILL.md`. A row whose Release is `unreleased` is stamped with the release tag when the plugin is next released.

| Version | Date | Release | Type | Summary |
|---|---|---|---|---|
| 0.2.0 | 2026-10-04 | unreleased | changed | Finds the state folder through the shared "Locate the state folder" section, which reads the book's pointer file (ADR-0015, state folder name), and reads chapters from the folder the pointer names (ADR-0016, adopting an existing book). It stops before its first write when claims is not adopted, and names the way to adopt it. |
| 0.1.0 | 2026-09-23 | v0.1.0 | added | First released version: runs a research session that adds evidence entries and source references to the ledger through research-librarian. |
