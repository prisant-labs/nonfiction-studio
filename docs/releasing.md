# Cutting a release

This page is the maintainer's runbook for cutting a Nonfiction Studio release: the shape a release entry takes in `RELEASE-NOTES.md`, and the exact sequence that gets a version bumped, tagged, and published. It is maintainer-facing, not author-facing - an author looking for what shipped wants `RELEASE-NOTES.md` (curated highlights) or `CHANGELOG.md` (the full technical history) instead.

## Format of a release entry

Each release gets its own dated section in `RELEASE-NOTES.md`, newest first, in this shape:

````markdown
## 0.2.0 - 2026-MM-DD

A one- or two-sentence summary of what this release is about, in plain language.

### What this means for you

- The concrete, author-facing effect of the change (not the implementation).
- A second bullet if there is a second effect worth knowing about.

### Install

```
/plugin marketplace add prisant-labs/agent-plugins
/plugin install nonfiction-studio@prisant-labs
```

The marketplace entry pins to the release's own tag.

### Surface support

| Surface | Tested depth |
|---|---|
| Claude Code CLI | Full: name what CI actually exercised for this release (for 0.1.0: keyless Tier A CI on Ubuntu and Windows) |
| Cowork runtime | Expected to work the same way, but unverified; treat as "should work," not "proven to work" (see ADR-0002, Cowork hook execution) |
| claude.ai chat | Skills only: hooks do not fire on chat, so the quality gate does not run automatically; run `/nonfiction-studio:nfs-check-chapter` yourself for a verdict |

### Known limitations

- Anything genuinely unverified or partially built, named plainly, with the ADR or issue that tracks it.
- Pre-1.0: breaking changes are possible; point to `MIGRATION.md` for what counts as one.

### Known regressions

None, or a named list with a workaround if any exist.
````

The surface-support table format mirrors the plugin's actual three-surface support policy; the Cowork row must always carry its current, real caveat and must never be upgraded to a claim of verified support ahead of the evidence.

## Cutting a release (maintainer runbook)

This plugin has no release automation beyond the tag-triggered workflow, so cutting a version is a manual, documented sequence rather than a single command. Version 0.1.0 is the first release cut through this sequence. Versions 0.1.0 and 0.2.0 each carry one disclosed exception at step 1: Tier B finished red on the eval dispatch-accuracy step. That step's failure is a known eval-harness limitation, tracked in [issue #5 (the Tier B eval harness measures guessing, not dispatch)](https://github.com/prisant-labs/nonfiction-studio/issues/5), rather than a product regression. The maintainer released each version with the result disclosed under its Known limitations in `RELEASE-NOTES.md`.

1. Confirm Tier A is green on `main`, and confirm that Tier B ran live on the release candidate rather than skipping. Either of two runs counts as live evidence:
   - A dispatched run of `.github/workflows/tier-b.yml` counts when `CLAUDE_CODE_OAUTH_TOKEN` was set for it. The Actions tab shows whether the run went live or took the named skip.
   - A local run of `node scripts/run-integration.mjs` and `node scripts/run-evals.mjs`, from the maintainer's own authenticated `claude` CLI, counts when each script's first line reports `credential decision: live`. Version 0.2.0 used this path, because the repository's token was not yet set.

   A skip, or a local run that fell back to `dry-run`, is a valid green state day to day, but it proves nothing about the release candidate. Do not cut a release on that evidence alone. Wherever the release notes mention Tier B, say which of the two runs supplied the evidence.
2. Decide the new version number using the breaking / feature-additive / patch categories in `MIGRATION.md`'s compatibility section, applied to what actually changed since the last release.
3. Bump the version together, in one commit, in all three version-bearing manifests: `library.json` (the source of truth), `package.json`, and `.claude-plugin/plugin.json`. `node scripts/checks/manifest-drift.mjs`-backed conformance (run via `node scripts/check.mjs .`) fails loudly if any of the three disagree. Bump the two `version` fields at the top of `package-lock.json` in the same commit, and update the README's version badge, its "Project status" line, its "Current version" row and its changelog paragraph.
4. If this release changes `_nonfiction-studio/meta.json`'s `schema_version`, add a dated entry to `MIGRATION.md`'s migration log before tagging: F-DX-13 (no shipped versioning policy) exists precisely so this step is never skipped.
5. Move the `CHANGELOG.md` `Unreleased` section's content into a new dated `## [x.y.z] - YYYY-MM-DD` section (moved, not duplicated), leaving `Unreleased` empty for whatever comes next.
6. Stamp every skill's history. In each `skills/<name>/HISTORY.md` whose first row's Release column says `unreleased`, replace `unreleased` with the new tag, `v<x.y.z>`. Change nothing else in the row or in the skill's `SKILL.md`. [ADR-0017 (per-skill versioning)](adr/ADR-0017-per-skill-versioning.md) defines the scheme. Run `node scripts/checks/check-skill-versions.mjs --release v<x.y.z>` to confirm that no row still says `unreleased`; the release workflow runs the same command and refuses the tag otherwise.
7. Write this release's real entry in `RELEASE-NOTES.md`, in the shape shown above: a new dated `## x.y.z - YYYY-MM-DD` section, added above the previous release's own dated section, with the intro paragraph revised if it needs updating.
8. Commit the version bump, the stamped histories and the doc updates on a release-preparation branch, and merge it to `main` through a pull request once both Tier A legs are green. Tier A accepts the stamped rows before the tag exists, because a first row may name a tag newer than the latest one.
9. Tag the merge commit on `main`: `git tag v<x.y.z>`, then `git push origin v<x.y.z>`.
10. The tag push triggers `.github/workflows/release.yml`. It verifies that the tag agrees with all three manifests (`scripts/check-release-tag.mjs`), verifies that every skill history is stamped (`scripts/checks/check-skill-versions.mjs --release`), and then publishes a GitHub release using `RELEASE-NOTES.md`'s entire current contents as the release body, so every earlier release's entry below the new one appears in the new release's body too. A version mismatch or an unstamped history row fails that workflow before anything is published.
