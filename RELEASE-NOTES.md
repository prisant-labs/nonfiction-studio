# Release Notes

Curated, author-facing highlights of each Nonfiction Studio release, newest first: what a release means for someone writing a book with the plugin. For the complete, chronological record of every change, see [CHANGELOG.md](https://github.com/prisant-labs/nonfiction-studio/blob/main/CHANGELOG.md).

## 0.1.1 - 2026-09-24

A hotfix for marketplace installs: skills that shell out to a CLI could not find it.

### What this means for you

- If you installed 0.1.0 from the marketplace, skills such as `nfs-quick-scan` and `nfs-tour` could stop mid-run and ask you for the plugin path instead of finding their own CLI. Update to 0.1.1 with `/plugin update nonfiction-studio@prisant-labs` and this goes away. A dev-mode checkout (running the plugin from a cloned repository) was never affected.
- No project files, book bibles, or `.studio/` state are touched by this update; it changes only how the plugin locates its own installed files.

### Install

```
/plugin marketplace add prisant-labs/agent-plugins
/plugin install nonfiction-studio@prisant-labs
```

The marketplace entry pins to `v0.1.1`.

### Surface support

| Surface | Tested depth |
|---|---|
| Claude Code CLI | Full: exercised end to end by keyless Tier A CI on Ubuntu and Windows |
| Cowork | Expected to work the same way, but unverified; treat as "should work," not "proven to work" (see [ADR-0002](https://github.com/prisant-labs/nonfiction-studio/blob/v0.1.1/docs/adr/ADR-0002-cowork-hook-execution.md), Cowork hook execution) |
| claude.ai chat | Skills only: hooks do not fire on chat, so the quality gate does not run automatically; run `/nonfiction-studio:nfs-check-chapter` yourself for a verdict |

### Known limitations

- Cowork is expected to work the same way as the Claude Code CLI but is unverified: the Cowork hook-execution spike named above has not run yet.
- This is a pre-1.0 release: breaking changes to a book's own schema are possible in a future version. See [MIGRATION.md](https://github.com/prisant-labs/nonfiction-studio/blob/v0.1.1/MIGRATION.md) for what counts as a breaking change and how compatibility is handled.

### Known regressions

None.

## 0.1.0 - 2026-09-23

The first public release of Nonfiction Studio: a governed, Claude Code-native workflow that takes a non-fiction book from intake interview through drafted chapters to a fact-checked, gate-passed manuscript with full back matter.

### What this means for you

- A guided front door (`/nonfiction-studio:nfs-start`) that routes to the right step, plus a five-minute first look via the quick-scan and tour skills, with no project setup required.
- A real intake interview that captures your book's thesis, audience, and voice, and a measured voice baseline captured from your own writing rather than assumed.
- An outline step, research that builds an evidence ledger instead of a loose "sources" list, and drafting where every factual claim is anchored to that ledger or tagged `[UNVERIFIED]`.
- An adversarial fact-check pass and a deterministic quality gate that decides what counts as done, plus a status board showing chapter progress, open claims, and gate state at a glance.
- Back-matter generation - endnotes, bibliography, index candidates - built directly from the evidence ledger.
- Write-scope containment that keeps every write inside your book's folder and keeps each writing agent (research, thesis, structure, drafting, line editing) inside its own folders, an untrusted-fetch envelope marking fetched web content as data rather than instructions, an AI-use disclosure log recording which agent wrote what, per-project settings (`.claude/nonfiction-studio.local.md`) to tune the quality gate, and two optional output styles (`manuscript`, `review`).

### Install

```
/plugin marketplace add prisant-labs/agent-plugins
/plugin install nonfiction-studio@prisant-labs
```

The marketplace entry pins to `v0.1.0`.

### Surface support

| Surface | Tested depth |
|---|---|
| Claude Code CLI | Full: exercised end to end by keyless Tier A CI on Ubuntu and Windows |
| Cowork | Expected to work the same way, but unverified; treat as "should work," not "proven to work" (see [ADR-0002](https://github.com/prisant-labs/nonfiction-studio/blob/v0.1.0/docs/adr/ADR-0002-cowork-hook-execution.md), Cowork hook execution) |
| claude.ai chat | Skills only: hooks do not fire on chat, so the quality gate does not run automatically; run `/nonfiction-studio:nfs-check-chapter` yourself for a verdict |

### Known limitations

- Cowork is expected to work the same way as the Claude Code CLI but is unverified: the Cowork hook-execution spike named above has not run yet.
- Tier B (maintainer-run, model-integration CI) had its first live run on 2026-09-23. The integration flow passed on GitHub; the eval dispatch-accuracy step scored 16 of 34 cases (47%) against a 70% pass threshold, so that step, and with it the Tier B run, finished red. This is a known limitation of the eval harness, not a product regression: the harness does not load the plugin, grades hook evals as though a model had dispatched the hooks itself, and applies a 60-second timeout. The maintainer chose to treat that step as advisory for this release and to disclose it here rather than hold the release; a harness fix is planned for after this release.
- This is a pre-1.0 release: breaking changes to a book's own schema are possible in a future version. See [MIGRATION.md](https://github.com/prisant-labs/nonfiction-studio/blob/v0.1.0/MIGRATION.md) for what counts as a breaking change and how compatibility is handled.

### Known regressions

None.
