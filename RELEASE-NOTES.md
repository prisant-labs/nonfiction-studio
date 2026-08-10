# Release Notes

This file is curated and user-facing: what a given release means for someone writing a book with Nonfiction Studio, not a full technical history. For the complete, chronological record of every change, see `CHANGELOG.md`. The two are deliberately different documents; a release note here should read like something worth telling an author, not a diff summary.

No version has been tagged yet. The plugin is currently at `0.1.0` (see `library.json`, the version source of truth) and has not been released. This file is a stub until the first tag is cut; the section below shows the shape a real entry will take.

## Format of a release entry

Each release gets its own dated section, newest first, in this shape:

```markdown
## 0.2.0 - 2026-MM-DD

A one- or two-sentence summary of what this release is about, in plain language.

### What this means for you

- The concrete, author-facing effect of the change (not the implementation).
- A second bullet if there is a second effect worth knowing about.

### Surface support

| Surface | Tested depth |
|---|---|
| Claude Code CLI | Full: all skills, all agents, all hooks, Tier A and Tier B CI |
| Cowork runtime | Expected to work the same way, but unverified; treat as "should work," not "proven to work" (see ADR-0002, Cowork hook execution) |
| claude.ai chat | Skills only: hooks and `bin/` CLIs are not available on this surface by design |

### Known regressions

None, or a named list with a workaround if any exist.
```

The surface-support table format mirrors the plugin's actual three-surface support policy; the Cowork row must always carry its current, real caveat and must never be upgraded to a claim of verified support ahead of the evidence.

## Cutting a release (maintainer runbook)

This plugin has no release automation beyond the tag-triggered workflow, so cutting a version is a manual, documented sequence rather than a single command. It has never been executed for a real release; the steps below are the intended sequence, not a proven-live procedure.

1. Confirm Tier A is green on `main` and confirm Tier B's most recent scheduled or dispatched run was a genuine live pass, not a named skip -- `git log` or the Actions tab shows whether `CLAUDE_CODE_OAUTH_TOKEN` was set for that run. A skip is a valid green state day to day, but it proves nothing about the release candidate; do not cut a release on skip evidence alone.
2. Decide the new version number using the breaking / feature-additive / patch categories in `MIGRATION.md`'s compatibility section, applied to what actually changed since the last release.
3. Bump the version together, in one commit, in all three version-bearing manifests: `library.json` (the source of truth), `package.json`, and `.claude-plugin/plugin.json`. `node scripts/checks/manifest-drift.mjs`-backed conformance (run via `node scripts/check.mjs .`) fails loudly if any of the three disagree.
4. If this release changes `.studio/meta.json`'s `schema_version`, add a dated entry to `MIGRATION.md`'s migration log before tagging -- F-DX-13 (no shipped versioning policy) exists precisely so this step is never skipped.
5. Move the `CHANGELOG.md` `Unreleased` section's content into a new dated `## [x.y.z] - YYYY-MM-DD` section (moved, not duplicated), leaving `Unreleased` empty for whatever comes next.
6. Write this release's real entry in `RELEASE-NOTES.md`, in the shape shown above, replacing this stub content the first time this step runs.
7. Commit the version bump and both doc updates on `main`.
8. Tag the commit: `git tag v<x.y.z>`, then `git push origin v<x.y.z>`.
9. The tag push triggers `.github/workflows/release.yml`, which verifies the tag agrees with all three manifests (`scripts/check-release-tag.mjs`) and publishes a GitHub release using this file's current contents as the release body. A version mismatch fails that workflow before anything is published.
