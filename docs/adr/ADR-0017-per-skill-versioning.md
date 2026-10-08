# ADR-0017: Every Skill Carries Its Own Version and History

**TL;DR:** Each skill now carries its own semantic version in its frontmatter, as `metadata.version`, with the date of its latest change as `metadata.updated`. A `HISTORY.md` file beside each `SKILL.md` records every version, newest first. A new Tier A check ties the two together and ties them to git: a skill that changed since the last release tag must carry a version that has not been released yet. On a tag push, the release workflow refuses to publish while any history row still says `unreleased`. The plugin's own version in `library.json` is unchanged and still versions the plugin as a whole.

- Status: Accepted. On 2026-10-06 the maintainer decided that this plugin should use per-skill versioning. This record fixes the scheme, the starting history and the enforcement, which the decision left open.
- Date: 2026-10-06
- Related: [ADR-0006 (manifest authority split)](ADR-0006-manifest-authority-split.md) keeps `library.json` as the component inventory, and this record does not change its shape. [ADR-0015 (state folder name)](ADR-0015-state-folder-name.md) and [ADR-0016 (adopting an existing book)](ADR-0016-adopting-an-existing-book.md) are the unreleased changes that the starting history records. D-11 (toolkit adoption) pins the Standard version this plugin is graded against.
- Decision: EVERY SKILL CARRIES `metadata.version` AND `metadata.updated`; EVERY SKILL KEEPS A `HISTORY.md` TABLE; A CHANGED SKILL CARRIES AN UNRELEASED VERSION UNTIL THE NEXT TAG; A TAG CANNOT SHIP AN `unreleased` ROW; THE PLUGIN VERSION STAYS SEPARATE; AGENTS AND OUTPUT STYLES ARE OUT OF SCOPE FOR NOW

---

## Context

The plugin had one version, in `library.json`, `package.json` and `.claude-plugin/plugin.json`, and no skill carried a version of its own. That left three problems.

1. **The Standard this plugin pins already requires it.** `library.json` declares Standard 0.12. Section 7.3 of that Standard says: "Each component MUST carry its current `version` (semver) in frontmatter (`metadata.version`) at every tier". It also recommends a co-located `HISTORY.md` below the Silver tier. No check in the vendored spine, or in the toolkit's current release, enforces either half, so the gap was invisible to every gate this repository runs.
2. **A plugin version cannot say which skill changed.** Between v0.1.1 and this record, every skill changed, but not in the same way. Some gained a new stop condition, one gained a new mode, and a few changed wording only. A release note can describe that once. A per-skill version lets a reader, or an agent, see it per skill, and see that a skill did not change at all in a later release.
3. **A version that nothing compares against history drifts.** A version field that a person updates by memory goes stale on the first busy week. The useful version is one a machine refuses to let fall behind the code.

## Decision

### 1. The fields

Every `skills/<name>/SKILL.md` carries, at the end of its frontmatter:

```yaml
metadata:
  version: "0.2.0"
  updated: 2026-10-04
```

`version` is a quoted `MAJOR.MINOR.PATCH` string. `updated` is the date of the skill's most recent change, which is also the date on its newest history row. The `metadata:` block holds only these two fields today. In particular, the top-level `chain:` list that agent-dispatching skills carry stays where it is: the readers in `scripts/check-frontmatter.mjs`, `scripts/checks/chain-contract.mjs` and `scripts/checks/check-compliance-stanza.mjs` read it at the top level, and moving it is a separate decision.

### 2. The history file

Every skill directory holds a `HISTORY.md` with one table, whose header is exactly:

```text
| Version | Date | Release | Type | Summary |
```

Rows run newest first. `Release` is the plugin tag that first shipped the version, or `unreleased` for a version not yet tagged. Only the first row may say `unreleased`. `Type` is one of `added`, `changed`, `fixed`, `removed`, `deprecated` or `security`, the change types this repository's changelog already uses. The summary names what changed in that skill, in a sentence or two. It does not restate the plugin's changelog.

### 3. Which number moves

A skill's version moves independently of the plugin's version and of every other skill's.

- **MAJOR** moves when an author must change how they use the skill: a removed argument, a renamed mode, or a changed output an author relies on. Before 1.0.0, a change of that kind moves MINOR instead, as semantic versioning allows.
- **MINOR** moves when the skill does something an author can see that it did not do before: a new mode, a new stop condition, or a new place it reads from or writes to.
- **PATCH** moves for a fix or for wording, where the behavior an author sees does not change.

A skill moves one version per release, not one per pull request. Once a skill carries an `unreleased` row, later changes in the same release cycle edit that row, and may raise its number if the change is larger. They do not add another row.

### 4. The starting history

The starting history was derived from git, not written from memory.

- Every skill that shipped in v0.1.0 starts at `0.1.0`, dated 2026-09-23, the date `CHANGELOG.md` gives that release. The v0.1.0 tag itself was re-pointed on 2026-09-24 for the maintainer's full name, and that date describes the tag, not the release.
- Every skill whose directory differs between v0.1.0 and v0.1.1 gains a `0.1.1` row, dated 2026-09-24 and typed `fixed`. Each of those changes was the plugin-root resolver fix of ADR-0014 (plugin-root resolution).
- Every skill whose directory differs between v0.1.1 and this record gains an `unreleased` row, dated with that skill's latest commit. The shared state-folder section of ADR-0015 and the adoption stops of ADR-0016 are author-visible, so those skills move MINOR to `0.2.0`. Three skills changed only in wording or in a cross-reference note, so they move PATCH to `0.1.2`.
- `nfs-adopt`, new in ADR-0016, starts at `0.1.0`, `unreleased`.

### 5. Enforcement

`scripts/checks/check-skill-versions.mjs` runs as a Tier A step. On every pull request it checks four rules:

- **R1:** each `SKILL.md` carries a well-formed `metadata.version` and `metadata.updated`.
- **R2:** each skill has a `HISTORY.md` whose first row matches both fields.
- **R3:** every history row is well formed and in order.
- **R4:** a skill whose directory differs from the latest `v*.*.*` tag, or that did not exist at that tag, has a first row that is `unreleased` or names a tag newer than the latest one.

The second R4 case allows a release-preparation pull request that has already stamped the rows. R4 needs git history and tags, so the Tier A checkout fetches the full history (`fetch-depth: 0`). Under CI, a checker that cannot see a tag exits 2 rather than passing, because a check that has gone blind must not report clean. Run locally without a `.git` directory, it says that it skipped R4.

### 6. Release stamping

Before a release tag is pushed, the release-preparation pull request replaces each `unreleased` in a first row with the new tag. `release.yml` runs the same checker with `--release <tag>` on the tag push. That mode refuses the release when any row still says `unreleased`, or when any row names a release newer than the tag being published. It needs no git history, so the release checkout stays shallow.

### 7. Out of scope

- **The plugin version.** `library.json`, `package.json` and `.claude-plugin/plugin.json` still version the plugin as a whole, and `scripts/check-release-tag.mjs` still requires the tag to match them. A skill's version is never derived from the plugin's, and never the other way around.
- **Agents and output styles.** The Standard's rule names every component, and agents are components. The maintainer's decision named skills, and an agent's frontmatter is read at dispatch time by `hooks/lib/routing.mjs`, so adding a field there deserves its own test of the runtime reader. A later record can extend this scheme to agents and output styles.

## Alternatives considered

**Keep the plugin version only.** This is the status quo. It leaves this plugin out of conformance with the Standard it pins, and it cannot say which skill changed in a release. Rejected by the maintainer's decision.

**Version each skill without a history file.** Cheaper by one file per skill, but the version alone cannot say what changed, and R2 would have nothing to compare against. The Standard recommends the history file at this tier, and its sibling repository already keeps one per skill. Rejected.

**Bump the version on every pull request that touches a skill.** This is simpler to check, because it needs only the diff against the base branch, not the latest tag. It would also produce several versions per release, most of which no author ever installs. Rejected in favor of one version per skill per release, which matches what an installed plugin can actually be.

**Derive the version from git at build time.** No build step exists, and an installed plugin ships its source tree as committed. A version a reader can see in the file is the one that matters. Rejected.

## Consequences

- Every skill directory gains a `HISTORY.md`, and every `SKILL.md` gains a two-field `metadata:` block. The platform validator (`claude plugin validate --strict .`) accepts the block. A run on the first skill to carry it reported only the warnings it reported before the change.
- `scripts/checks/check-skill-versions.mjs` and `tests/checks/check-skill-versions.test.mjs` are new. The tests prove each rule with a planted defect: R1 to R3 on a clone of the real tree, and R4 and the release mode on throwaway git repositories with a tag.
- `.github/workflows/tier-a.yml` gains a step and fetches the full history. `.github/workflows/release.yml` gains a step before it publishes.
- `AGENTS.md`, `CLAUDE.md` and `CONTRIBUTING.md` state the rule a contributor follows: a change to a skill moves its version and its history row in the same pull request.
- The next release-preparation pull request has one more task: stamping each `unreleased` row with the new tag.
