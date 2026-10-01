# ADR-0015: The Book's State Folder Defaults to `_nonfiction-studio/` and Can Be Renamed

**TL;DR:** Every book project keeps its machine-managed records in one state folder at the book root. The folder's default name changes from `.studio/` to `_nonfiction-studio/`. An author can choose a different name, and the choice is recorded in a committed pointer file, `nonfiction-studio.json`, beside the bible folders at the book root. A missing, invalid or dangling pointer never falls back to the default, and no flow creates a second state folder beside an existing book. The `nfs-doctor` skill performs every move, with the author's consent.

- Status: Accepted. On 2026-09-30 the maintainer ruled the default name, the folder README, a configurable name, a visible pointer file at the book root, and no new question at book creation, and then accepted the record as a whole.
- Date: 2026-09-30
- Supersedes: the fixed `.studio/` folder name, used since the first bible layout and never argued for in a recorded decision
- Related: D-12 (versioned bible with a doctor) owns the bible's compatibility policy. [MIGRATION.md](../../MIGRATION.md) holds the breaking-change list and the mid-book update promise that this record must satisfy. [ADR-0007 (agent identity resolution)](ADR-0007-agent-identity-resolution.md) owns the per-agent write-scope table, which names the folder. [ADR-0013 (wave 1 exit surfaces)](ADR-0013-wave-1-exit-surfaces.md) set the namespacing precedent for the settings file and the output styles. [ADR-0014 (plugin-root resolution)](ADR-0014-plugin-root-resolution.md) set the pattern of one shared, test-pinned resolution step inside skills.
- Decision: DEFAULT NAME `_nonfiction-studio/`; THE NAME IS CONFIGURABLE THROUGH A COMMITTED, VISIBLE POINTER FILE, `nonfiction-studio.json`, AT THE BOOK ROOT; A BAD POINTER NEVER FALLS BACK TO THE DEFAULT; NO FLOW STAMPS A SECOND STATE FOLDER; THE `nfs-doctor` SKILL MOVES AND MIGRATES THE FOLDER; `schema_version` STAYS "2"

---

## Context

The plugin writes two kinds of material into an author's book folder. The bible is the author's own plain-Markdown content: `context/`, `structure/`, `research/`, `chapters/` and `production/`. The state folder holds machine-managed records: `meta.json`, `config.json`, `progress.json` and its schema, `ai-use-log.jsonl`, and the `gate/`, `logs/`, `snapshots/` and `fact-check-reports/` subfolders.

Every other name that the plugin places in a user's environment is namespaced. Skills carry the `nfs-` prefix, and CLIs carry the `ns-` prefix. The per-project settings file is `.claude/nonfiction-studio.local.md`, and an output style activates as `nonfiction-studio:<style name>` (ADR-0013). The state folder is the exception. The name `.studio/` does not say which tool created the folder, and another tool could plausibly claim the same generic name.

The question came up during the maintainer's first per-project install into an existing book repository. That install also showed that generic top-level names can collide in practice: the repository already had a `research/` folder of its own. The maintainer then asked that an author be able to choose where the plugin's records go.

The folder name is part of the book's on-disk contract, not an internal constant. `isBookRoot` in `hooks/lib/bible.mjs` requires `.studio/meta.json` beside `context/` and `chapters/`. Skills name `.studio/` paths directly in their instructions to the model. Before this record was written, the name appeared on 1,010 lines across 177 tracked files, including hooks, engines, skills, agents, format pages, tests and every fixture book.

The plugin has been public since 2026-09-24, at v0.1.1. No external book is known to exist on the current layout. A change now costs one migration note. The same change after authors adopt the plugin would cost a deprecation cycle.

## Decision

### The default name is `_nonfiction-studio/`

The default name spells out the plugin's own name. It matches the settings file and the output-style namespace.

The leading underscore was chosen over a leading dot. The maintainer ruled that a hidden folder would confuse authors. A dot-folder is hidden by default in macOS Finder and in `ls`, so an author might not see the folder at all. The underscore keeps the folder visible, and most file browsers sort it near the top of the book folder.

The underscore has one accepted cost. In some repositories, a leading underscore marks uncommitted local material. This folder is meant to be committed, because it holds the AI-use log, which is the author's compliance record. Nothing in the scaffold gitignores the folder, and this record does not change that.

### An author can choose a different name, recorded in a committed pointer

The configurable unit is the name of one folder directly under the book root. A book with no pointer uses the default name. A book with a pointer uses the name that the pointer records:

```json
{ "state_dir": "records" }
```

The pointer is a file named `nonfiction-studio.json` at the book root, which is the directory that holds `context/` and `chapters/`. It sits beside the bible folders, where an author browsing the book can see it. It exists only in a book that uses a non-default name, so a default book gains no top-level file.

The pointer is read only from the book root, never from an ancestor directory. A pointer in an ancestor could sit above several books, and it would be ambiguous which book it governs.

The maintainer chose a visible file for the same reason as the visible folder: an author should be able to see where the plugin's records go without knowing about hidden files. Three other homes were rejected:

- **A committed file inside `.claude/`.** That location would mirror Claude Code's own split between a committed `settings.json` and a personal `settings.local.json`. It was rejected because `.claude/` is itself a hidden folder. Some repositories also gitignore `.claude/` as a whole, which would lose the pointer on every clone.
- **The personal settings file, `.claude/nonfiction-studio.local.md`.** Collaborators who share a book must agree on where its records live. A personal file would let two clones of the same book write to two different folders. The settings reader therefore ignores a `state_dir` key there and warns about it.
- **`config.json`.** That file lives inside the state folder, so it cannot say where the state folder is.

A pointer can still be lost, for example when an author's `.gitignore` happens to match it. The clone then sees a book with no state folder at the default name. The never-stamp rule below makes that failure visible instead of silent. The doctor also runs `git check-ignore` on the pointer and warns when git ignores it.

### The name is validated, and a bad pointer never falls back to the default

A valid `state_dir` is a single path segment of ASCII letters, digits, `_`, `-` and `.`. It may not be `.` or `..`. It may not name one of the five bible folders, `.git` or `.claude`. On Windows, those reserved names are compared without regard to case.

A pointer is bad when it is unreadable, is not valid JSON, carries an invalid `state_dir`, or names a folder that does not exist. A bad pointer belongs to the same class as a corrupt bible file:

- `findBookRoot` raises a book error that is not the ordinary "no book root" error.
- `hooks/pre-tool-use.mjs` already denies write tools when it meets that class of error, under D-13 (security posture). That existing behavior now covers a bad pointer.
- The deny exempts writes that target the pointer file itself. Without the exemption, the author could not repair the pointer from inside the session.
- `hooks/session-start.mjs` warns, and `bin/ns-doctor` reports the bad pointer as a finding.

Nothing falls back to the default name. A fallback would send new records to a second folder while the real history stayed in the first.

### One resolver for code, and one stanza for skills

`hooks/lib/bible.mjs` gains one resolver for the state folder. `findBookRoot`, every hook and every CLI use it, so a hook and its CLI twin cannot disagree about where the records are. `isBookRoot` becomes: `context/` and `chapters/` exist, and `meta.json` exists inside the resolved state folder.

Skills cannot import that resolver, because many of them never run `node`. Every skill that touches state therefore carries one byte-identical stanza, "Locate the state folder". The stanza tells the model to read `nonfiction-studio.json` at the book root with the Read tool, apply the validation rule above, and otherwise use the default. It needs no `node` call, so it works on all three D-14 (three surfaces) surfaces. A parity checker locks the stanza across skills, as `scripts/checks/check-compliance-stanza.mjs` locks the compliance stanza today. After the stanza, a skill's prose names state paths as `<state-dir>/progress.json` and so on.

A dispatching skill passes the resolved folder to an agent in the dispatch brief. Agents never resolve the folder themselves. Format pages under `docs/formats/` keep the default name in their examples, and each adds one sentence that points to the pointer file.

### An unpointed state folder is detected, never shadowed

The most dangerous failure is a book whose state folder exists under a name that the resolver does not expect. Without detection, that book falls into the empty-state path:

1. `hooks/session-start.mjs` would tell the author that no book project exists, and it would point to the new-book flow.
2. `nfs-new-book` would find `context/brief.md` and take its re-initialize branch.
3. That branch would stamp a fresh, empty state folder beside the real one.

The author's AI-use log and progress would stay behind in the real folder, and every later record would go to the new one. The result would be a silent split of the compliance record.

This failure has several causes: a legacy `.studio/` book, a clone that lost its gitignored pointer, a typo in the pointer, or a move interrupted halfway. One rule covers them all. When `context/` and `chapters/` exist but nothing exists at the resolved name, the shared detector scans the book root's immediate children. Any folder that holds both `meta.json` and `progress.json` is reported by name as an unpointed state folder. The scan runs only on this failure path, so a healthy book pays nothing for it.

Five callers handle an unpointed state folder explicitly:

- **`hooks/session-start.mjs`** checks for one before its empty-state path. On a match, it names the folder it found and names `/nonfiction-studio:nfs-doctor` as the fix. It does not point to the new-book flow.
- **`nfs-start`**, the dispatcher, decides whether a project exists by testing for `progress.json`. It runs the detector first and routes the author to `nfs-doctor` on a match, so it never offers to start a new book.
- **`nfs-new-book`** adds the detector to its existence check. On a match, it stops, writes nothing, and routes the author to `nfs-doctor`.
- **`bin/ns-doctor`** reports each unpointed folder as a finding, with the move or the pointer as its remedy. The engine stays read-only without exception.
- **`findBookRoot`** names the unpointed folder in its missing-book-root error. Every CLI-backed skill that surfaces that error then inherits the pointer to `nfs-doctor` with no change of its own.

The other hooks stay silent on such a book, as they already are on any directory without a book root. They must not write into any state folder.

### The `nfs-doctor` skill moves and migrates the folder, with consent

The mid-book update promise in MIGRATION.md binds every move. A breaking update must be migratable from the `nfs-doctor` skill without leaving the working session. Manual steps must be surfaced before automated ones run, and no book content may be destroyed.

The skill performs every move; the engine never does. This follows the precedent of the skill's `install-statusline` mode, in which the skill makes a single consented write and `bin/ns-doctor` stays read-only. The skill's reference page currently says that its `migrate` mode writes nothing. That claim widens to the consented move below, in the same way that ADR-0013 recorded the output-style offer widening the plugin's settings-write claim.

One shared move routine runs in this order:

1. The skill shows the author the move that it proposes, including the pointer change and the README, and it asks for an explicit yes.
2. It refuses to act if the target folder already exists. It never merges two state folders. It reports both folders to the author instead.
3. It writes the pointer. When the target is the default name, it deletes the pointer file instead, so that a default book has no extra top-level file.
4. It renames the folder. In a git working tree it runs `git mv`, so that each file keeps its history. Outside git, it performs a plain directory rename.
5. It writes the folder README described below, if the folder does not already have one.
6. It re-runs the doctor report to confirm that the book root resolves.

If step 4 fails after step 3 has written the pointer, the pointer is dangling. That state is already handled above: writes are denied, the doctor reports it, and no content is lost. The skill tells the author what happened and how to finish or undo the move.

Two modes use the routine:

- **`migrate`** handles a legacy or unpointed folder. It offers two choices: rename the folder to the default name, or keep its current name by recording that name in the pointer. A legacy book can therefore keep `.studio/` if its author prefers.
- **`move-state <name>`** performs an author-chosen move of a healthy book.

### `nfs-new-book` does not ask

The first run stays as short as it is today, under D-17 (guided front door). `nfs-new-book` creates the default folder without asking. Its closing summary names the folder and tells the author that `nfs-doctor move-state` can rename it.

### The folder carries a short README

A visible folder will be noticed, so it explains itself. The scaffold gains `<state-dir>/README.md`, a single paragraph that says five things:

- the folder holds Nonfiction Studio's records for this book;
- it should be committed, because it holds the AI-use log;
- `config.json` is the only file in it that is meant to be edited by hand;
- its name can be changed with `nfs-doctor move-state`, and a non-default name is recorded in `nonfiction-studio.json` at the book root;
- the plugin's documentation explains each file.

The README is guidance, not structure. A missing README is not a doctor finding, and the book root resolves without it. `nfs-new-book` writes it with the rest of the scaffold, and its re-initialize branch re-stamps it when it is missing. The move routine above adds it after a move.

### `schema_version` stays "2"

The change moves where the state files live, not what they contain, and the pointer is a new optional file. Detection has to be layout-based in any case, because the engines cannot read `meta.json` from a folder that they do not know to look in.

A version bump would also misfire. A book moved by `nfs-doctor` would still carry "2" in its `meta.json`. The doctor's older-major check would then demand a field migration that does not exist. MIGRATION.md already records two changes outside `schema_version` in this same way: the voice-baseline `marker_set_version` note and the skill-rename note. The skill rename was a breaking change, so it is the direct precedent for this one.

### MIGRATION.md names the state folder in its breaking-change list

The breaking-change list in MIGRATION.md names field renames inside the state files, but it does not name the folder itself. The list gains one entry: moving or renaming the state folder's default location, or any path under it. The change also gets its own dated note, in the same style as the skill-rename note.

The release that carries the change is a breaking release. Its version number is chosen at release time by step 2 of [docs/releasing.md](../releasing.md).

## Security

`AGENT_WRITE_SCOPES` in `hooks/lib/agent-identity.mjs` grants `research-librarian` writes under `research/` and `.studio/` (ADR-0007). A fixed table cannot name a configurable folder. The librarian's state-folder scope therefore becomes a function of the resolved state folder, pinned by a test.

The validation rule is a security control, not only a tidiness rule. The librarian may write to whatever the state folder is. Without the reserved names, a pointer set to `chapters` would widen the librarian's scope into the manuscript. A pointer set to `.claude` would let it plant a project skill. The reserved-name check closes both.

A missed occurrence in the rename fails closed, not open. The path guard would deny the librarian's legitimate writes to the state folder; it would not widen any agent's scope. This is the fail-closed behavior that D-13 requires.

## Alternatives considered

- **A fixed name with no configuration.** This was the first draft of this record. The maintainer ruled for configuration so that an author can choose where the records go.
- **A folder that identifies itself by its contents, with no pointer.** Any child folder holding `meta.json` would count as the state folder. This was rejected for two reasons. First, a copied backup of the folder would create two candidates, and the book would stop working until one was removed. Second, the scan would run on every tool call in every directory where the plugin is enabled. The detector above uses the same scan, but only on the failure path.
- **An environment variable set in the committed `.claude/settings.json`.** This was rejected because a CLI run by hand in a terminal would not see the variable. It would also put the setting where an author would not think to look.

## Consequences

- **The plugin now has two sources of truth for the records' location.** The pointer and the folder can disagree. The doctor reconciles them, the move routine changes both in one consented step, and the never-stamp rule makes any disagreement visible.
- **The chat surface relies on the model reading the pointer.** Chat has no hooks, so no write guard backs the stanza there. A model that misreads the pointer on chat could write to the wrong folder. CLI and Cowork sessions keep the hook enforcement.
- **The implementation costs materially more than a fixed rename.** The change adds the skill stanza and its parity checker, the computed write scope, the validation rule, the unpointed-folder detector, a new doctor mode and new fixtures. The plugin has one maintainer, so this cost competes directly with the next wave's features.
- **Snapshots become visible to Markdown tools under the default name.** Before each chapter edit, `hooks/pre-tool-use.mjs` saves a copy of the chapter as a `.md` file under `snapshots/`. In a visible folder, a Markdown-aware app such as Obsidian will index those copies alongside the real chapters. The maintainer accepted this cost with the underscore. Changing the snapshot extension is a possible follow-up. It would touch the snapshot-naming contract in [docs/formats/snapshots.md](../formats/snapshots.md) and the doctor's naming check, so this record does not decide it.
- **Every normative format page that names the folder changes.** Those pages are `gate-report.md`, `style-profile.md`, `decisions.md`, `snapshots.md`, `settings.md`, `fetch-log.md`, `claim-markers.md` and `ai-use-log.md`, all under `docs/formats/`. The settings page also documents that a `state_dir` key in the personal settings file is ignored with a warning.
- **Fixture books and the scaffold move with the code.** The sample book, every fixture book and `templates/book-scaffold/` rename their state folders in the same change, so the suites exercise the default layout.
- **Directory walks that skip dot-prefixed names stop skipping the state folder.** Several repository checkers walk directories and skip any name that starts with a dot, and `scripts/check-links.mjs` says in a comment that the skip exists for the state folder. After the change, those walks descend into the fixture books' state folders. The implementation audits each such walk and either excludes state folders by name or confirms that descending into them is harmless. No engine under `hooks/` or `bin/` walks the whole book folder, so runtime behavior is not affected.
- **Fixtures prove that the detection works.** A fixture book with a custom folder name and a pointer passes every suite. Deleting its pointer makes the detector name the orphaned folder, and `nfs-new-book` then writes nothing. A second fixture book on the legacy `.studio/` layout is detected the same way. Tests cover session start, `findBookRoot` and `bin/ns-doctor` directly. The checks inside `nfs-start` and `nfs-new-book` are skill text, so tests pin that text, as `tests/checks/plugin-root-resolver.test.mjs` already pins the resolver line inside each CLI-backed skill (ADR-0014).
- **The generated book-context skill is checked.** `nfs-new-book` generates a project-local skill from the bible. The implementation confirms that the template for that skill names no state-folder path, or it updates the template.

## Implementation wave

This record is the decision only. The implementation lands as its own pull request, in this order:

1. RED first: the custom-name and legacy fixtures, plus failing tests for the resolver, the validation rule, the detector, the five callers and the computed write scope.
2. The resolver, the validation rule and the detector in `hooks/lib/bible.mjs`, then the write-deny exemption for the pointer, then the five callers.
3. The skill stanza and its parity checker, with a mutation proof that the checker fails when one skill's copy drifts.
4. The mechanical rename across live docs, skills, agents, code, tests, fixture directories and the scaffold. Dated historical records keep the old name, because they correctly describe the layout as it was on their dates. Those records are the released sections of `CHANGELOG.md`, `RELEASE-NOTES.md`, earlier ADRs and the build-phase records under `docs/gates/`. This step is complete when a `git grep` for the old name finds only those records, plus this ADR and the new MIGRATION.md note.
5. The `nfs-doctor` move routine and its `migrate` and `move-state` modes, the folder README in the scaffold, the MIGRATION.md entry and the CHANGELOG entry.
6. The workspace-refs manifest refresh as the last commit, then Tier A green on both operating systems.

## Out of scope

- **Any location other than one folder directly under the book root.** A nested path, a path outside the book, and moving the bible folders themselves are separate questions. So is a book that lives in a subfolder of a larger repository while sessions start at the repository root.
- **The names of the bible's top-level folders.** `context/`, `structure/`, `research/`, `chapters/` and `production/` hold the author's own content, so a generic name there may be intended. The `research/` collision described above suggests revisiting them in a separate record.
- **Adopting a book that already exists in a different layout.** Version 0.1.1 has no path for this. It is recorded as input for the next wave's scoping.
