# ADR-0006: Manifest Authority Split - library.json, plugin.json, marketplace.json

**TL;DR:** Three manifest files coexist in this repo. `library.json` is the component source of truth and drives version computation at release. `.claude-plugin/plugin.json` is the authored platform-identity manifest. `.claude-plugin/marketplace.json` is the authored distribution manifest. When `version` or `name` disagree, `library.json` is authoritative and the release gate enforces equality before any release tag. `description` may differ legitimately between files. `plugin.json` stays authored (not generated) through Phase 1; generation revisits when more than 10 components are registered in `library.json`.

- Status: Accepted
- Date: 2026-07-18
- Task: TSK-013 (source-of-truth ADR)
- Implements: D-22 (packaging corrected), D-11 (toolkit adoption)
- Unblocks: Q-02 (CI pipeline) release workflow

---

## Context

The Nonfiction Studio plugin build straddles two ecosystems that each want one manifest to be canonical.

D-11 (toolkit adoption) vendors the agent-skills-toolkit validation spine into the repo. That spine treats `library.json` as the authoritative manifest for component inventory, version, and spine-graded conformance. Its generator (`scripts/generators/gen-manifest.mjs`) can derive `.claude-plugin/plugin.json` from `library.json`, making `library.json` the single source and `plugin.json` a generated artifact.

D-22 (packaging corrected) establishes that the plugin ships `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` as authored files satisfying the Claude Code marketplace. The platform validator (`claude plugin validate --strict .`) reads these authored manifests. The vendored spine reads `library.json`. Neither validator reads the other's file: the authority domains are structurally disjoint.

The authored files carry fields the spine generator does not know about: `author` and `license` in `plugin.json`, and `owner` plus `description` in `marketplace.json`. The `description` field in `marketplace.json` is required under strict validation per TSK-003 (packaging manifests), which found that `claude plugin validate --strict` treats a missing `description` in `marketplace.json` as a blocking error.

T-01 (toolkit assessment) identifies this as the "dual source-of-truth tension" (section 5): the toolkit wants `library.json` canonical with `plugin.json` generated; Claude Code's marketplace expects an authored `plugin.json` plus `marketplace.json`. Leaving the split undocumented risks double-maintenance and value-drift as the component roster grows.

This ADR records the authority split decided by D-22 (packaging corrected) and D-11 (toolkit adoption). It documents; it does not re-open either decision.

---

## Decision

### `library.json` is authoritative for

- The component inventory: which agents, skills, hooks, and CLIs are registered in the build.
- Per-component versions (each component's `version` entry in the manifest).
- The Standard pin (`library.json.standard`, set to `"0.12"` per D-11 (toolkit adoption)).
- Agent targets (`agent-targets: [claude]`, per D-11 (toolkit adoption)).
- Plugin version computation at release time: the release version equals the largest component bump across all registered components, following the askit-release pattern.

### `.claude-plugin/plugin.json` is authoritative for

- The installed plugin identity (`name` drives namespace resolution by Claude Code).
- Platform-facing metadata the validator and marketplace read: `description` (one-liner), `author`, `license`.

### `.claude-plugin/marketplace.json` is authoritative for

- Distribution metadata only: marketplace identity (`name`), `owner`, `plugins` listing, and `description`. The `description` field is required under `claude plugin validate --strict` per TSK-003 (packaging manifests).
- This file carries no `version` field. Version authority resides in `library.json` and `plugin.json`.

---

## Field-Level Authority Rules

When two or more files carry the same logical field and the values disagree, these rules apply. The release gate in Q-02 (CI pipeline) enforces all three rules and blocks a release tag if any is violated.

| Field | Files that carry it | Rule on disagreement |
|---|---|---|
| `version` | `library.json`, `plugin.json` | Must be equal. When they disagree, `library.json` is right and `plugin.json` is corrected before the release tag. The release gate blocks if they differ. |
| `name` | `library.json`, `plugin.json`, `marketplace.json` | Must be equal across all three. A mismatch is a release-gate failure. `library.json` is authoritative. |
| `description` | `library.json`, `plugin.json`, `marketplace.json` | May differ in length and phrasing. The one-liner in `plugin.json` and the marketplace description in `marketplace.json` are independently authored. No sync is enforced beyond both being present and non-empty. |

---

## Authored vs. Generated: Phase Policy and Revisit Trigger

The vendored generator `scripts/generators/gen-manifest.mjs` can emit `plugin.json` from `library.json`. This project keeps `plugin.json` authored through Phase 0 and Phase 1 for two reasons:

1. The generated output does not carry `author`, `license`, or any field beyond the spine's component registry view. Adding those fields to the generator would require customization that offers no consistency benefit at low component counts.
2. `marketplace.json` is not generated by the toolkit at all (T-01 (toolkit assessment), section 4.2: "Adopt" table). It stays authored indefinitely.

**Revisit trigger (recorded here as a consequence of the split):** when the component inventory in `library.json` grows beyond 10 registered components, open a task to evaluate `gen-manifest.mjs` customization and switch `plugin.json` to generated. At that scale, the consistency benefit of a generated manifest exceeds the cost of generator customization. Until that threshold, manual authoring with release-gate equality enforcement is the lower-overhead path.

---

## Consequences

### Validator scope is narrower than it appears

`claude plugin validate --strict .` reads the manifest files in `.claude-plugin/` only.

It does not read `hooks/hooks.json`. ADR-0001 (hooks.json schema) confirmed this: both hook-schema candidates produced byte-for-byte identical validator output, proving the validator does not currently read or schema-check `hooks/hooks.json`. Passing platform validation is not proof of a correct hooks schema.

It does not read or lint agent files or skill files. TSK-005 (agent template adaptation) confirmed this: the validator reported only "Validating marketplace manifest:" even when agent files were present in the working tree.

Deep component-file linting is absent from the platform gate entirely.

### The release gate in Q-02 (CI pipeline) is the only real enforcement layer

Because the platform validator covers only manifest shape, the following must be enforced by the Q-02 (CI pipeline) release workflow and the vendored check scripts:

- `claude plugin validate --strict .` - confirms authored manifests are well-formed (runs in the release gate).
- `node scripts/check.mjs` (vendored spine) - confirms `library.json` conformance and component-inventory integrity (runs in the release gate).
- `version` equality assertion between `library.json` and `plugin.json` - a custom release-gate step; either failure blocks the tag.
- `name` equality assertion across all three files - a custom release-gate step; a mismatch blocks the tag.

The platform validator is a structural pre-flight, not a substitute for these checks. Manifest equality and inventory truth are enforced exclusively by the Q-02 (CI pipeline) release workflow and check scripts.

### Generation-revisit trigger

Logged here (not as an open question) because the trigger is deterministic: when `library.json` crosses 10 registered components, open a task to evaluate generator adoption for `plugin.json`. No action is needed until that threshold.

---

## Verification (present-day equality)

As of the commit that introduces this ADR:

| File | `name` | `version` |
|---|---|---|
| `library.json` | `"nonfiction-studio"` | `"0.1.0"` |
| `.claude-plugin/plugin.json` | `"nonfiction-studio"` | `"0.1.0"` |
| `.claude-plugin/marketplace.json` | `"nonfiction-studio"` | (field absent - correct) |

All three files satisfy the `name` equality rule. `library.json` and `plugin.json` satisfy the `version` equality rule. `marketplace.json` carries no `version` field, which is correct: distribution metadata does not carry a plugin version under this split.

`claude plugin validate --strict .` passes (exit 0) on the tree that includes this ADR.

---

## References

Planning-doc paths below are code spans, not links: `_local/` is gitignored, so a
relative link to it resolves in a working tree but breaks in a clean checkout. This
matches the convention in ADR-0003 (skill invocation ergonomics) and ADR-0005 (bin
PATH on Windows).

- D-22 (packaging corrected): `(local working notes, not published)` - decision establishing authored manifests and requiring this ADR
- D-11 (toolkit adoption): `(local working notes, not published)` - decision establishing `library.json` as component source of truth
- T-01 (toolkit assessment): `(local working notes, not published)` - dual source-of-truth tension (section 5) and gen-manifest.mjs adapt note (section 4.2)
- [ADR-0001 (hooks.json schema)](./ADR-0001-hooks-json-schema.md) - evidence that the platform validator ignores hooks.json
- TSK-003 (packaging manifests) report - `description` required under `--strict` evidence
- TSK-005 (agent template adaptation) report - platform validator ignores agent files evidence
- Q-02 (CI pipeline): `(local working notes, not published)` - the release workflow that owns field-equality enforcement
