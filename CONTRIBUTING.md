# Contributing to Nonfiction Studio

Thanks for wanting to work on this plugin. It is a solo-maintained, publicly readable project - see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the standards expected in this space and [SECURITY.md](SECURITY.md) for how to report a vulnerability privately instead of through a public issue. This guide covers everything else: how to set up, what CI actually runs, how tests and checks are expected to be written, and how a release gets cut.

## Prerequisites

- **Node.js 22.12 or later.** This is the engines floor declared in `package.json` and the version Tier A pins in CI.
- **The Claude Code CLI**, installed and on your `PATH`. One Tier A step (`claude plugin validate --strict .`) shells out to it to validate the plugin manifests against the platform's own schema; nothing else in local development requires it, and no API key or account login is needed for that validation call.
- A working `claude` login only if you plan to run Tier B locally (see below) - the same login your interactive Claude Code sessions already use.

## Setup

```
npm ci
```

This is a clean install from the committed lockfile (`package-lock.json`), matching what CI does. `package.json` declares one npm dependency, the `yaml` parser, which the repo's own check scripts use. The installed plugin itself runs with no `node_modules`: the hooks carry a vendored, zero-dependency YAML-subset parser (`hooks/lib/mini-yaml.mjs`).

## The local battery

Every command below is one line of `.github/workflows/tier-a.yml`, in the order it runs there, so running them locally in this order reproduces Tier A exactly. Tier A runs on every pull request targeting `main`, on both Ubuntu and Windows; both legs have to come back green, since a failure on only one is a real cross-platform bug, not noise. There is no `npm test` script - each step is invoked directly, deliberately, so the workflow file carries zero validation logic of its own (see the header comment in `tier-a.yml`).

1. `node scripts/check.mjs --profile plain-plugin` - the Bronze spine-conformance check (the vendored agent-skills-toolkit spine, Standard 0.12; see `scripts/ATTRIBUTION.md`).
2. `claude plugin validate --strict .` - platform schema validation of the authored manifests under `.claude-plugin/`; needs the `claude` CLI installed, no account or API key.
3. `node scripts/check-hooks-schema.mjs` - `hooks/hooks.json` schema and script-existence check.
4. `node scripts/check-frontmatter.mjs` - agent and skill frontmatter validation, including the `nfs-` skill naming convention (see below).
5. `node scripts/check-docs-completeness.mjs` - every shipped component has a reference page under `docs/reference/`.
6. `node scripts/check-links.mjs` - every relative Markdown link across `docs/` and the repo-root `.md` files resolves.
7. `node scripts/checks/check-plugin-root.mjs` - the plugin-root invocation convention.
8. `node scripts/check-self-sufficiency.mjs` - no additional API keys, accounts, or paid services are implied anywhere in the shipped tree.
9. `node scripts/checks/check-inventory.mjs` - component inventory equality between `library.json` and the tree, and manifest name agreement.
10. `node scripts/checks/check-workspace-refs.mjs` - no shipped file points at a path that would not survive a clean checkout, including a gitignored scratch working directory. See "Before you push," below, if you keep one.
11. `node scripts/checks/check-skill-cli-targets.mjs` - every `bin/ns-<name>` a shipped file names as a routing target is actually shipped under `bin/`.
12. `node scripts/checks/check-advertised-invocations.mjs` - every `/nonfiction-studio:<name>` a shipped document advertises resolves to a real skill directory.
13. `node scripts/checks/check-link-labels.mjs` - once a Markdown link's target resolves to a component's own reference page, `SKILL.md`, agent page, or `bin/` CLI, the link's label has to name that component.
14. `node scripts/checks/check-component-counts.mjs` - a stated component count (skills, CLIs) has to match the tree's true count. See "Writing prose that survives this checker," below.
15. `node scripts/checks/check-compliance-stanza.mjs` - every agent-dispatching skill (a skill whose frontmatter `chain:` list is non-empty) carries the byte-identical shared compliance stanza.
16. `node scripts/test-engines.mjs` - the engine, lib, hook, and schema unit test suites, **and** the checker unit tests under `tests/checks/`, all in one `node --test` invocation.
17. `node scripts/test-fixtures.mjs` - the bidirectional fixture matrix, run against temp clones so committed fixtures are never touched.
18. `node scripts/verify-sample-book.mjs` - sample-book integrity: marker-to-ledger-to-source resolution.

`tier-a.yml` has twenty `run:` lines. Its comments number nineteen of them "Live step 1" through "Live step 19", and Live step 1 is `npm ci` (see Setup). The twentieth, `npm install -g @anthropic-ai/claude-code`, is marked inert scaffolding. Each item above is therefore numbered one lower than its "Live step" label in the workflow; installing the `claude` binary is a prerequisite already covered by "Prerequisites." Open a pull request only once every numbered step above passes locally.

### The two suites, named directly

Steps 16 and 17 are also referred to on their own, since they are what you reach for while iterating on a single change without re-running the whole battery:

- `node scripts/test-engines.mjs` - unit tests for the engines, libs, hooks, schemas, and the checkers themselves.
- `node scripts/test-fixtures.mjs` - the golden-fixture-plus-planted-bad-fixture matrix across the bidirectional engine CLIs.

## Writing prose that survives this checker

`scripts/checks/check-component-counts.mjs` fails the build on any stale claim about the plugin's component totals: a cardinal number (digit or spelled-out word) sitting directly next to the plural noun "skills" or "CLIs" (or "CLI(s)"/"skill(s)"), optionally bridged by the word "shipped," is compared against the tree's true count at run time. The canonical totals live in the README's "At a glance" table; do not restate them elsewhere without need, since every restatement is another site to update at the next growth event (agent and output-style counts in prose are not machine-checked by anything; `check-inventory.mjs` checks that `library.json`'s component lists match the tree, not what prose says, and it does not cover output styles). A cardinal directly beside the noun (or bridged only by "shipped") fails even when it describes a true subset, because the checker cannot tell a subset from a total. A cardinal separated from the noun by any other word (for example "six agent-dispatching" before "skills") is not matched at all, so a stale count phrased that way is not caught either. Prefer describing a subset by its actual property ("every agent-dispatching skill, meaning a non-empty `chain:` list") over a count, or use a different noun ("seven checks," "six hook events," "nineteen steps," and "two suites" are outside this checker's plural-noun pattern and are safe). If a count genuinely changes, fix the prose, not the checker.

`scripts/check-self-sufficiency.mjs` fails on phrasing in `docs/`, `README.md`, `agents/`, or `skills/` that implies an API key, access token, credential, or paid subscription is required - including in a documentation paragraph explaining Tier B's OAuth credential. Describe Tier B's `CLAUDE_CODE_OAUTH_TOKEN` as "an OAuth token minted from a maintainer's own Claude subscription, not an API key," and state plainly that a local run needs no token to be set, rather than writing a sentence of the shape "Tier B needs a credential" that a pattern match could read as a requirement this plugin imposes on you.

`scripts/checks/check-workspace-refs.mjs` fails on a shipped file naming a path under a gitignored scratch directory, or naming a private scratch file by its bare filename. Refer to a scratch working area generically ("a gitignored scratch directory") in anything you commit; never write out its actual path or a private filename.

None of this is pedantry for its own sake: each of these checkers was added or widened after a real stale or leaked reference got past review; `CHANGELOG.md`'s `Unreleased` section records most of those cases.

## TDD and mutation-proof expectations for a new check or engine

A checker that cannot fail is not a checker. Every checker and engine in this repo is expected to ship with a test that proves it actually catches the defect it claims to catch, not only that it passes on already-clean input. The house pattern, followed throughout `tests/checks/` and `tests/engines/`:

1. **Write the test red first.** Before the checker exists (or before the fix lands), write the test that should fail against the current, broken tree, and confirm it does fail for the right reason.
2. **Plant a realistic violation.** A fixture, a temp-cloned copy of a real file, or an in-memory construction that reproduces the actual defect shape - not a synthetic case the checker could only ever see in a test file.
3. **Prove the mutation is real, not inert.** After the fix or the new checker lands, revert it (or flip the specific condition it checks) and confirm the test now fails. A mutation proof that still passes with the fix reverted is not proving anything; several fixes in this repo's history originally shipped an inert mutation proof and were caught and corrected during review. If a plan-specified mutation proof turns out to be structurally inert (for example, a test whose assertion derives from the same registry the fix touches, so it silently adapts instead of catching the regression), say so and substitute one that actually pins the invariant, rather than shipping the inert one as written.
4. **Keep committed fixtures immutable.** Anything exercising a bidirectional engine against a "known bad" case works on a temp clone, the way `scripts/test-fixtures.mjs` does, so a test run never leaves the committed tree dirty.

`tests/checks/check-frontmatter.test.mjs` and its planted-violation fixtures are a good worked example to read before writing a new checker test.

## Commit message style

Commits in this repo follow a conventional-commits shape: `type(scope): subject`, lowercase, present-tense, sentence-shaped subject. The scope is optional - a repo-wide documentation change is often just `docs: ...` with no parenthetical. Recent examples from the actual history:

```
feat(ci): workspace-reference guard enforces the bare-filename form on clean checkouts via a hashed manifest
fix(overlap): findings sort by code unit so ordering is identical across Node ICU builds
test(hooks): the shipped chain file must parse cleanly; the overlap order test no longer asserts ICU behavior
docs: record the checker mini-wave in the CHANGELOG and reconcile scope descriptions
chore(ci): refresh the workspace-reference manifest to the current scratch tree
```

The types in active use are `feat`, `fix`, `docs`, `test`, and `chore`; pick the one that names what actually changed, and a scope (`ci`, `hooks`, `overlap`, `docs`, ...) when one real component owns the change.

## The `nfs-` skill naming convention

Every skill directory under `skills/` is named `nfs-<name>`, with no exceptions, ever. This is machine-enforced in `scripts/check-frontmatter.mjs`: the directory name must match `^nfs-[a-z0-9]+(-[a-z0-9]+)*$`, the `SKILL.md`'s own `name:` frontmatter field must equal the directory name, and the `library.json` `components.skills[]` entry must match the same pattern. See [ADR-0003 (skill invocation ergonomics)](docs/adr/ADR-0003-skill-invocation-ergonomics.md)'s amendment for why: a short invocation form shares a namespace with every other installed plugin, and the prefix is what keeps this plugin's verbs from colliding with someone else's.

## Hooks fail open; settings can never promote a coerced check

Every hook script in `hooks/` is written to fail open: a malformed stdin event, a corrupt config file, or an unreadable settings file never breaks a session and never silently escalates a check's severity. The failure path always substitutes a safe default (empty settings, a skipped check, an unattributed write) and, where a human would otherwise be misled, emits exactly one warning sentence naming what went wrong. See `docs/formats/settings.md`'s "Corruption handling" section for the exact per-key and whole-file failure taxonomy this posture follows.

The per-project settings file (`.claude/nonfiction-studio.local.md`) can move the gate either way: `gate_mode` sets the gate's top-level mode to `off`, `warn`, or `block`, and `thresholds` is shallow-merged over any threshold value. What it can never do is promote `thesis_alignment` or `quote_fidelity` out of the `warn` mode that D-03 (layered Stop gate) coerces them to, so neither can block. This is structural, not a convention: the settings overlay runs before the coercions, and the settings schema has no per-check mode key, so a settings file cannot reach the field that would bypass the coercion (see `docs/formats/settings.md`, "Precedence, and the never-un-coerce invariant"). If you add a new settings key, keep that property true by construction rather than by discipline.

## Where decisions live, and how to propose one

Architecture decisions live in [`docs/adr/`](docs/adr/), one file per decision, numbered `ADR-NNNN-<slug>.md` (four digits). An ADR records a decision, its context, and its consequences; it is not a task tracker or a design doc draft. To propose one: open a pull request adding the ADR file itself (Status: Proposed), referencing the issue or discussion that motivated it, and expect discussion on the PR before it is marked Accepted. A decision that changes shipped behavior should land in the same pull request as the ADR that records it, or reference an already-accepted one.

## Tier B is maintainer-only and advisory to pull requests

Tier B (`.github/workflows/tier-b.yml`, model-integration CI) triggers only on manual `workflow_dispatch` from the Actions tab; it has no `pull_request` trigger at all, so it can never block a merge and you do not need to run it to get a pull request accepted. It authenticates with `CLAUDE_CODE_OAUTH_TOKEN`, an OAuth token a maintainer mints from their own Claude subscription with `claude setup-token`, never an API key. On a real GitHub runner with that secret unset, both live steps exit 0 with a named skip rather than failing, since an unset maintainer-only secret is expected configuration on a repository a contributor does not control.

You can run the same two scripts locally without setting any token. With no credential in the environment, they use your existing `claude` CLI login if one works, and otherwise fall back to a dry run. A live local run makes real model calls against your own Claude subscription (ADR-0010 (Tier B trigger and credential) estimates roughly $1 to $2.50 per run):

```
node scripts/run-integration.mjs
node scripts/run-evals.mjs
```

Both also support `--dry-run` for a keyless smoke pass with no model calls at all. See [ADR-0010 (Tier B trigger and credential)](docs/adr/ADR-0010-tier-b-trigger-and-credential.md) for the full trigger, credential, and skip-versus-fail contract. Tier B is advisory to every pull request; it is a manual precondition to a release (below), not something a contributor's PR is judged against.

## Release process

The maintainer, not a contributor, cuts a release, but the mechanics are worth knowing when a change you are proposing is version-bearing.

1. `library.json` is the version source of truth. `package.json`'s `version` and `.claude-plugin/plugin.json`'s `version` must be bumped to the identical value in the same change.
2. Push a tag of the form `vX.Y.Z` matching that value exactly.
3. `.github/workflows/release.yml` triggers on the tag push. Its first step, `node scripts/check-release-tag.mjs`, refuses the release (exit 1) and names every manifest that disagrees with the tag unless the tag and all three manifests (`library.json`, `package.json`, `.claude-plugin/plugin.json`) agree exactly.
4. Once verified, the workflow publishes a GitHub release for that tag using `RELEASE-NOTES.md`'s current contents as the release body.
5. A maintainer treats a green, manually dispatched Tier B run as a precondition to cutting the tag; nothing in the workflow enforces this mechanically, so it is a runbook step, not a gate (see ADR-0010's Decision 4).

## Before you push: refresh the workspace-reference manifest (maintainers with a local scratch directory)

If you keep a gitignored scratch working directory locally (notes, task briefs, or similar material that never ships), refresh the committed, hashed basename manifest that `check-workspace-refs.mjs` reads on a clean checkout as the last commit before you push a branch:

```
node scripts/checks/check-workspace-refs.mjs --write-manifest
```

This regenerates `scripts/checks/workspace-refs-manifest.json` (sha256 hashes only, never clear-text scratch filenames) from your current scratch tree, so the guard's bare-filename form still enforces correctly on a CI runner that has no scratch tree on disk at all. Most contributors, with no such directory, will see this command make no changes.

## Further reading

- [`docs/architecture.md`](docs/architecture.md) - how the plugin's pieces fit together.
- [`docs/README.md`](docs/README.md) - the documentation index: a reference page for every skill, subagent, and CLI.
- [`CLAUDE.md`](CLAUDE.md) - project-specific guidance for an AI assistant working in this repo.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) - the standards this project expects.
- [`SECURITY.md`](SECURITY.md) - how to report a vulnerability privately.
- [`docs/adr/`](docs/adr/) - the full architecture decision record set.
- [`MIGRATION.md`](MIGRATION.md) - the book-schema compatibility story between plugin versions, and what an author does when a book's schema falls behind.
