# AGENTS.md

This file mirrors CLAUDE.md for other agent tools (Codex and others); the two must
change together. Content below is identical to CLAUDE.md except for this header.

Operating guide for AI coding agents (and humans) working IN this repository - the
plugin's own source tree, not a book project built with it. If you are looking for
author-facing usage, start at [README.md](README.md) instead.

## What this repo is

This is the source for **Nonfiction Studio**, an open-source Claude Code plugin that turns
Claude into a governed non-fiction book studio: specialist subagents draft, a plain-Markdown
project bible holds the truth, and a deterministic quality gate decides what counts as done.
See [README.md](README.md) for the author-facing pitch and [docs/README.md](docs/README.md)
for the full documentation index.

## Layout

- `skills/` - the `nfs-*` skills an author invokes directly; each is a directory with a
  `SKILL.md`.
- `agents/` - the `nfs-*` skills dispatch to these subagents; `_chain-permitted.yaml` is the
  chain-of-custody contract between them.
- `bin/` - the `ns-*` CLIs (extensionless POSIX entry point plus a `.cmd` Windows shim per
  tool).
- `hooks/` - the six wired hook scripts (`hooks.json` declares them); `hooks/lib/` holds the
  shared engine modules every hook and CLI actually calls into, so a hook and its CLI twin can
  never compute something differently.
- `scripts/` - CI-facing tooling; `scripts/checks/` holds the individual Tier A checkers plus
  some shared library modules consumed by `scripts/check.mjs` (not every file there is a
  standalone check - see "How to verify a change" below).
- `docs/` - reference material: `adr/` (decision records), `formats/` (file-format
  contracts), `gates/` (internal build-phase records), `reference/` (per-component pages).
- `examples/` - `sample-book/` (the committed integration fixture), `fixtures/`, `spikes/`.
- `templates/` - the two shipped `.studio/config.json` starting points plus scaffold and
  starter templates.
- `tests/` - unit and fixture suites: `checks/` (CI checkers and Tier B scripts), `engines/`
  (engine modules and their CLIs), `hooks/`, `lib/` (shared helpers from `hooks/lib/`),
  `schemas/`.
- `output-styles/` - the two shipped output styles.
- `library.json` - the component manifest (skills, agents, hooks, CLIs) and version.
- `.claude-plugin/` - the platform manifests (`plugin.json`, `marketplace.json`).

## How to verify a change

There is no `npm test`. Two suites plus the Tier A checker battery are the whole contract:

1. `node scripts/test-engines.mjs` and `node scripts/test-fixtures.mjs` - the unit and
   fixture suites.
2. Every `run:` line in [.github/workflows/tier-a.yml](.github/workflows/tier-a.yml), in
   order. Read that file and enumerate its steps directly rather than globbing a directory -
   `scripts/checks/` also holds library modules with no standalone check of their own, so a
   glob over that directory runs things that are not checks and misses steps that live
   elsewhere (`scripts/check.mjs`, `scripts/check-hooks-schema.mjs`, `scripts/check-links.mjs`,
   and others at the top level of `scripts/`).
3. Run `node scripts/checks/check-workspace-refs.mjs` and
   `node scripts/checks/check-compliance-stanza.mjs` on their own, even though both are also
   part of the Tier A battery: the first is the guard that stops any shipped file from
   pointing at a path that will not survive a clean checkout (see "Committed-content rules"),
   and the second locks the shared compliance stanza across every agent-dispatching skill.
   Both are easy to break silently with an unrelated edit nearby.

Both OS legs (`ubuntu-latest`, `windows-latest`) must be green; a failure on only one usually
means a determinism bug (see below), not a flaky runner.

Tier B (`.github/workflows/tier-b.yml`) is separate: manual dispatch only, maintainer-only,
authenticated with an OAuth token minted from the maintainer's own subscription rather than an
API key, per [ADR-0010 (Tier B trigger and credential)](docs/adr/ADR-0010-tier-b-trigger-and-credential.md).
It never blocks a pull request, and only someone with write access to the repository (in
practice, the maintainer) can dispatch it on GitHub. As a
contributor you can still run its two scripts locally against your own `claude` CLI login:
`node scripts/run-integration.mjs` and `node scripts/run-evals.mjs`; pass `--dry-run` to either
for a keyless run that spends nothing.

## Engineering norms

- **TDD with RED evidence.** Write the failing test first and show it fails for the right
  reason before making it pass. A fix with no preceding red run is not trusted.
- **New checks carry a mutation proof.** A new Tier A checker (or a change to an existing
  one's comparison logic) needs a fixture or test proving the check actually catches the
  defect it claims to catch, not just that it passes on clean input.
- **Hooks fail open.** Every hook script exits 0 unconditionally on its own internal errors;
  a read, parse, or lookup failure is caught, logged (where a log target exists), and the
  script continues with whatever partial output it already has. A hook must never be the
  reason a session breaks.
- **Guards and settings precedence follow ADR-0013 (wave 1 exit surfaces).** The precedence
  chain (defaults, then `.studio/config.json`, then the per-project settings file, then
  structural coercions) can raise `gate.mode` toward `block`, but settings can never un-coerce
  a structurally-coerced check back out of `warn`. A settings-file warning on one key must
  never silence an unrelated, validly-configured control. Read
  [ADR-0013 (wave 1 exit surfaces)](docs/adr/ADR-0013-wave-1-exit-surfaces.md) before changing
  settings, gate, or routing-enforcement behavior.
- **Determinism.** Where a CLI's reference page promises byte-identical output (ns-status,
  ns-overlap `--json`, and the ns-claims / ns-notes regenerations), keep that promise: no
  wall-clock value or other run-to-run variance in that output. The gate report's `ts` field
  and its timestamped file under `.studio/gate/` are the deliberate exception. Sort with plain
  code-unit (codepoint) comparison, never
  `localeCompare`: `localeCompare`'s ordering depends on the ICU data bundled with a given Node
  build, which is exactly the kind of platform difference the Windows CI leg exists to catch.
- **`hooks/lib/mini-yaml.mjs` is the only YAML reader reachable from hooks and CLIs.** It is a
  vendored, zero-dependency parser. Never `import` the `yaml` package (a `package.json`
  dependency, used elsewhere) from anything under `hooks/` or `bin/`: an installed plugin ships
  with no `node_modules/`, so a `yaml` import from either directory fails at runtime for every
  user.

## Committed-content rules

Every new file must obey these; several are CI-enforced.

- ASCII only. Prefer " - " (space hyphen space) over an em-dash.
- Never write a gitignored scratch directory's name followed by a slash and a further path
  segment, and never name a file that exists only in such a directory - the workspace-reference
  checker fails the build on either. Refer to "a gitignored scratch directory" generically
  instead of naming one.
- No ephemeral register IDs (planning-register numbers of the PF- series). Cite an established
  ADR or a locked decision with a short handle on first use, e.g. "ADR-0007 (agent identity
  resolution)" or "D-04 (Node everywhere)".
- Skill and CLI counts in prose are machine-checked
  (`scripts/checks/check-component-counts.mjs`; agent and output-style counts are outside its
  scope): state a count only when it matches the tree (the README's "At a glance" table
  carries the canonical totals), or avoid stating one at all.
- A Markdown link whose target is a component's own reference page must name that component
  in the link's label (`scripts/checks/check-link-labels.mjs`). Every relative link must
  resolve (`scripts/check-links.mjs`).
- Any `bin/ns-<name>` you write must be a real, shipped CLI. Any `/nonfiction-studio:<name>`
  invocation you write must be a real, shipped skill.
- The maintainer's public identity is "JP Prisant" / `@jprisant` / `prisant-labs`. Never write
  a personal email address, workstation path, OS username, or machine name into a committed
  file. There is no public contact email: a security report goes through GitHub private
  vulnerability reporting on the repository's Security tab; a conduct report goes through the
  same channel or by contacting `@jprisant` on GitHub.
- Wherever you write the marketplace install sequence, use
  `/plugin marketplace add prisant-labs/agent-plugins` then
  `/plugin install nonfiction-studio@prisant-labs` - the install suffix is the marketplace's
  registered name, `prisant-labs`.

## Decisions

Read the relevant ADR under `docs/adr/` before changing an engine, a hook's output contract,
or a checker's comparison logic; most non-trivial behavior in this repo traces to one. Record
a new non-trivial decision as a new ADR rather than only as a commit message or a code
comment.

## Naming

Skills are `nfs-<name>`; CLIs are `ns-<name>`. Keep new skills and CLIs inside those prefixes.
Agents and output styles are unprefixed (for example `fact-checker`, `manuscript`).

## CHANGELOG discipline

`CHANGELOG.md`'s `Unreleased` section is written from what actually landed, not from a plan or
a roadmap - an entry there means the change is in the tree. Add an entry for every
user-visible or contributor-visible change as part of the same pull request, not after.
