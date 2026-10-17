# Release Notes

Curated, author-facing highlights of each Nonfiction Studio release, newest first: what a release means for someone writing a book with the plugin. For the complete, chronological record of every change, see [CHANGELOG.md](https://github.com/prisant-labs/nonfiction-studio/blob/main/CHANGELOG.md).

## 0.2.1 - 2026-10-16

A fix release. The plugin's Stop hook no longer sends Claude back to work at the end of every turn. Update now if you run any earlier version.

### What this means for you

- **Claude ends its turn normally again.** Every earlier release, 0.1.0 through 0.2.0, shipped a thesis-alignment check on the Stop hook. With current Claude Code, that check sent Claude back to work at the end of each turn, up to nine times in a row, in any session that loaded the plugin. It never received your thesis, so its verdicts carried no information. It is removed, and every other check runs as before.
- **No thesis-alignment judgment runs in this version.** The `thesis_alignment` setting in your book's `config.json` stays valid and changes nothing. `nfs-check-chapter` says plainly that its verdict is the deterministic gate alone.
- **Asking to capture your voice from samples reaches the right helper.** `nfs-capture-voice` told Claude that it hands off to the voice-capture agent only when you have no samples, so a request that came with samples could be routed elsewhere. Its description now matches what it does.
- **The interviewer agent's description is accurate.** It said the interviewer builds the book's folders itself; `nfs-new-book` does that, as before. Nothing about the interview changes.

To update an existing install, run `/plugin update nonfiction-studio@prisant-labs`. No book needs a migration step.

### Install

```
/plugin marketplace add prisant-labs/agent-plugins
/plugin install nonfiction-studio@prisant-labs
```

The marketplace entry pins to `v0.2.1`.

### Surface support

| Surface | Tested depth |
|---|---|
| Claude Code CLI | Full: exercised end to end by keyless Tier A CI on Ubuntu and Windows, plus a live Tier B run on the release candidate |
| Cowork | Not installable as shipped. Claude's [plugin platform-support page](https://claude.com/docs/plugins/platform-support) says Cowork refuses a plugin that keeps executables in a top-level `bin/` folder, and this plugin keeps its CLIs there. No upload has confirmed it yet. This corrects the 0.2.0 notes below, which said Cowork was expected to work |
| claude.ai chat | Not installable as shipped, for the same `bin/` reason. This corrects the 0.2.0 notes below, which said chat supports the skills |

### Known limitations

- Cowork and chat cannot install the plugin as shipped, as the table says. Whether to move the CLIs out of the top-level `bin/` folder is an open decision, tracked with [ADR-0002](https://github.com/prisant-labs/nonfiction-studio/blob/v0.2.1/docs/adr/ADR-0002-cowork-hook-execution.md) (Cowork hook execution).
- An adopted book still cannot adopt its claims. Until it can, claim coverage, fact-checking, the back-matter apparatus and agent drafting stay unavailable in an adopted book.
- Tier B (maintainer-run, model-integration CI) ran live on this release's candidate commit on 2026-10-16, from the maintainer's own Claude Code login rather than a GitHub runner, under the isolated harness of [ADR-0018](https://github.com/prisant-labs/nonfiction-studio/blob/v0.2.1/docs/adr/ADR-0018-tier-b-eval-harness-contract.md) (Tier B eval harness contract). The integration flow passed. The eval dispatch-accuracy step scored 18 of 18 chain cases (100%) against its 70% threshold. It no longer grades the 16 hook cases, because Claude Code fires hooks itself. That fixes the harness gap behind the red eval step in 0.2.0; [issue #5](https://github.com/prisant-labs/nonfiction-studio/issues/5) stays open until a run dispatched on GitHub confirms it.
- This is a pre-1.0 release: breaking changes to a book's own schema are possible in a future version. See [MIGRATION.md](https://github.com/prisant-labs/nonfiction-studio/blob/v0.2.1/MIGRATION.md) for what counts as a breaking change and how compatibility is handled.

### Known regressions

None.

## 0.2.0 - 2026-10-13

You can now bring in a book you already started, and each book's records move to a visible folder. The folder move is a breaking change for a book created by 0.1.x, and one command fixes it.

### What this means for you

- **Breaking: a book created by 0.1.x needs one command after the update.** The plugin now keeps a book's records in a visible `_nonfiction-studio/` folder instead of the hidden `.studio/` folder. Nothing is deleted or rewritten, but the plugin no longer finds `.studio/` by itself. Every skill, CLI and session-start message stops and names the fix: run `/nonfiction-studio:nfs-doctor migrate`. It asks before it writes anything. It either renames the folder, using `git mv` inside a git repository, or keeps the old name and records it in a new `nonfiction-studio.json` file at the book root. Commit the result. See the [state-folder note in MIGRATION.md](https://github.com/prisant-labs/nonfiction-studio/blob/v0.2.0/MIGRATION.md) for details.
- **You can adopt a manuscript you already have.** Run `/nonfiction-studio:nfs-adopt` in the book's folder. It shows what it will add and writes only after you say yes. It adds the state folder and a pointer to your own chapters folder, and it never changes a file you wrote. Word counts, chapter snapshots, the AI-use log, the status board and the gate's prose checks work at once. Your chapter files keep their own names.
- **You adopt the rest of the workflow one element at a time.** `nfs-adopt style`, `nfs-adopt brief` and `nfs-adopt structure` each take on one more element and hand off to the matching skill. A skill that needs an element you have not adopted stops before it writes and names the command that adopts it.
- **`nfs-new-book` no longer creates an empty project beside your manuscript.** In a folder that already holds Markdown writing, it stops, writes nothing, and points you to `nfs-adopt`. `nfs-start` offers adoption first in such a folder.
- **Working notes at the end of a chapter can stay out of the counts.** If your chapter files end with planning material under a fixed heading, set `"prose": {"ends_at_heading": "..."}` in the state folder's `config.json`. Everything from that heading down is then never counted, scored or scanned.
- **Each skill now shows its own version.** Every skill carries a version number and a `HISTORY.md` file that says what changed in it, so you can see which skills this release touched.
- **Fixes.** Hooks now work when the plugin is installed under a path that contains a space. `nfs-doctor` no longer reports every chapter snapshot as badly named. Saving or gating one chapter no longer deletes another chapter's snapshots or gate reports when one chapter's name begins with the other's, such as `ch01` and `ch01.x`.

To update an existing install, run `/plugin update nonfiction-studio@prisant-labs`.

### Install

```
/plugin marketplace add prisant-labs/agent-plugins
/plugin install nonfiction-studio@prisant-labs
```

The marketplace entry pins to `v0.2.0`.

### Surface support

| Surface | Tested depth |
|---|---|
| Claude Code CLI | Full: exercised end to end by keyless Tier A CI on Ubuntu and Windows, including the existing-writing guard's tests under Git Bash on Windows |
| Cowork | Expected to work the same way, but unverified; treat as "should work," not "proven to work" (see [ADR-0002](https://github.com/prisant-labs/nonfiction-studio/blob/v0.2.0/docs/adr/ADR-0002-cowork-hook-execution.md), Cowork hook execution) |
| claude.ai chat | Skills only: hooks do not fire on chat, so the quality gate does not run automatically; run `/nonfiction-studio:nfs-check-chapter` yourself for a verdict |

### Known limitations

- Cowork is expected to work the same way as the Claude Code CLI but is unverified: the Cowork hook-execution spike named above has not run yet.
- An adopted book cannot adopt its claims yet. Until it can, claim coverage, fact-checking, the back-matter apparatus and agent drafting stay unavailable in an adopted book, and the gate skips its claim checks there.
- Tier B (maintainer-run, model-integration CI) ran live on this release's candidate commit on 2026-10-13. It ran from the maintainer's own Claude Code login, not on a GitHub runner. The integration flow passed. The eval dispatch-accuracy step scored 11 of 34 cases (32%) against a 70% threshold, so that step finished red. This is the eval-harness limitation tracked in [issue #5](https://github.com/prisant-labs/nonfiction-studio/issues/5), not a product regression. All 16 hook cases expect an event name, but Claude Code runs hooks itself, and no model dispatches them. Three chain answers named the right agent but added reasoning on the same line, which the grader rejects. As for 0.1.0, the maintainer treats that step as advisory for this release.
- This is a pre-1.0 release: breaking changes to a book's own schema are possible in a future version. See [MIGRATION.md](https://github.com/prisant-labs/nonfiction-studio/blob/v0.2.0/MIGRATION.md) for what counts as a breaking change and how compatibility is handled.

### Known regressions

None.

## 0.1.1 - 2026-09-24

A hotfix for marketplace installs: skills that shell out to a CLI could not find it.

### What this means for you

- If you installed 0.1.0 from the marketplace, skills such as `nfs-quick-scan` and `nfs-tour` did not ask for help - they resolved a real but wrong directory (one level above the actual install) and then failed with a Node "Cannot find module .../nonfiction-studio/bin/ns-..." error partway through, or, for `nfs-tour`, could not find `examples/sample-book`. Update to 0.1.1 with `/plugin update nonfiction-studio@prisant-labs` and this goes away. A dev-mode checkout (running the plugin from a cloned repository) was never affected.
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
