# History - nfs-start

Versions of this skill, newest first. [ADR-0017 (per-skill versioning)](../../docs/adr/ADR-0017-per-skill-versioning.md) defines the scheme, and `scripts/checks/check-skill-versions.mjs` checks this table against the version in `SKILL.md`. A row whose Release is `unreleased` is stamped with the release tag when the plugin is next released.

| Version | Date | Release | Type | Summary |
|---|---|---|---|---|
| 0.2.0 | 2026-10-07 | unreleased | changed | Finds the state folder through the shared "Locate the state folder" section, which reads the book's pointer file (ADR-0015, state folder name), and reads chapters from the folder the pointer names (ADR-0016, adopting an existing book). It needs no element, so it never stops on adoption, and it reads the adoption record only when one exists. In a folder of existing writing it offers adoption first, and in an adopted book it marks each path whose element is not adopted. Its description now names the adoption path too. |
| 0.1.0 | 2026-09-23 | v0.1.0 | added | First released version: the guided front door, presenting six numbered paths and routing to the matching skill. |
