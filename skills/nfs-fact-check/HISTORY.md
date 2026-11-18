# History - nfs-fact-check

Versions of this skill, newest first. [ADR-0017 (per-skill versioning)](../../docs/adr/ADR-0017-per-skill-versioning.md) defines the scheme, and `scripts/checks/check-skill-versions.mjs` checks this table against the version in `SKILL.md`. A row whose Release is `unreleased` is stamped with the release tag when the plugin is next released.

| Version | Date | Release | Type | Summary |
|---|---|---|---|---|
| 0.3.0 | 2026-11-15 | v0.2.2 | changed | Says when a chapter is unmarked, with no claim markers in 200 or more words of prose, instead of quoting its 100 percent coverage, and tells the fact-checker so (ADR-0020, zero-marker guard). Halts only on an `ns-claims` error (exit 2), not on open claims (exit 1), which are the input this skill exists to check. |
| 0.2.0 | 2026-10-04 | v0.2.0 | changed | Finds the state folder through the shared "Locate the state folder" section, which reads the book's pointer file (ADR-0015, state folder name), and reads chapters from the folder the pointer names (ADR-0016, adopting an existing book). It stops before its first write when claims is not adopted, and names the way to adopt it. |
| 0.1.1 | 2026-09-24 | v0.1.1 | fixed | Finds the plugin root from the installed-plugins record instead of a scan of the plugin cache, so the right copy is used when several versions are cached (ADR-0014, plugin-root resolution). |
| 0.1.0 | 2026-09-23 | v0.1.0 | added | First released version: runs the adversarial verification pass on a drafted chapter, an engine-backed marker inventory followed by the fact-checker agent's pass. |
