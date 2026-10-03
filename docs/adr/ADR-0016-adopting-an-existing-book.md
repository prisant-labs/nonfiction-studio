# ADR-0016: An Existing Book Is Adopted in Place, One Element at a Time

**TL;DR:** An author who already has a manuscript can bring it into Nonfiction Studio without moving or rewriting it. A new skill, `nfs-adopt`, shows a plan and, after an explicit yes, adds only the plugin's state folder and its pointer file. The pointer gains a second key that names the book's own chapters folder. The author's files stay canonical. Capabilities that need no conversion work at once: word counts, snapshots, the AI-use log, the status board, and the gate's prose checks. Each other part of the bible is adopted later, one element at a time, or never. A book's own claim ledger is not converted. A book can name a heading after which its chapter files hold no prose.

- Status: Accepted. On 2026-10-02 the maintainer ruled seven decisions and then accepted the record as a whole. The rulings were: adoption in place with per-element opt-in, a configurable chapters folder, the author's claim ledger staying canonical, a prose-boundary heading, shared folders under informed consent with narrowed agent scopes, the skill name `nfs-adopt`, and a guard against stamping a new book over existing writing that ships before this wave.
- Date: 2026-10-02
- Amends: [ADR-0015 (state folder name)](ADR-0015-state-folder-name.md). Its pointer file gains a `chapters_dir` key, and a directory whose pointer names a chapters folder is a book root even without `context/`.
- Related: [ADR-0007 (agent identity resolution)](ADR-0007-agent-identity-resolution.md) owns the per-agent write-scope table. [ADR-0009 (apparatus CLI)](ADR-0009-apparatus-cli.md) holds the growth policy for new CLIs. [ADR-0012 (voice verdict scope)](ADR-0012-voice-verdict-scope.md) limits what a voice baseline can claim. D-12 (versioned bible with a doctor) owns the bible's compatibility policy, and D-17 (guided front door) owns the first-run flow.
- Decision: ADOPT IN PLACE; THE AUTHOR'S FILES STAY CANONICAL; ADOPTION ADDS ONLY THE STATE FOLDER AND THE POINTER; THE POINTER CAN NAME THE CHAPTERS FOLDER; ELEMENTS ARE ADOPTED ONE AT A TIME, OR NEVER; A BOOK'S OWN CLAIM LEDGER IS NOT CONVERTED; A BOOK CAN NAME A PROSE-BOUNDARY HEADING; SHARED FOLDERS NEED ONE INFORMED YES, AND AGENT SCOPES IN THEM NARROW; THE SKILL IS `nfs-adopt`; `schema_version` STAYS "2"

---

## Context

Every flow in the plugin assumes a book that the plugin created. `nfs-new-book` stamps the bible tree (`context/`, `structure/`, `chapters/`, `research/`, `production/`) and the state folder into an empty directory, and every later skill, agent, hook and engine reads and writes that tree. Most nonfiction authors who arrive at the plugin are not starting from an empty directory. They have drafts, notes, and their own system for tracking sources.

The maintainer's first per-project install was into such a book: a manuscript written before the plugin existed, in a git repository with a clean history. Its shape shows what adoption has to handle:

- Its chapters live in `manuscript/`, named `chNN-<slug>.md`, beside an introduction and an author's note.
- Each drafted chapter ends with a non-prose section of tables, headed `## Drafting apparatus`. The section maps passages to claims, records decisions honored, and lists open items. The author strips it before publication.
- Its claim ledger is a single Markdown file outside `research/`. Claims carry IDs of the form `C<chapter>.<n> (handle)` and seven fields: layer, status, establishes, does not establish, counterevidence, reverses if, and dated verification passes. Sources are cited inside each claim, not kept in a separate registry. Chapters cite claims from the trailing tables, not inline.
- A `research/` folder exists, but it holds the author's interview guide and research-ethics protocol, not the plugin's ledgers.
- The author's README sets standing rules that the plugin would otherwise introduce: every empirical claim carries a status, preprints are labeled at every use, and every reference ID carries a readable handle.

Three facts about the plugin bound the design:

1. **The bible's folder names are hard-wired.** The string `chapters/` alone appears in 16 code files under `hooks/` and `bin/` and in 15 skill and agent files. The other bible paths add many more. A general path map, in which the plugin follows any layout, would repeat ADR-0015's resolver work once per element.
2. **The plugin's claim grammar is narrower than this ledger.** The evidence log (`research/evidence-log.md`) holds `EV-NNNN (handle)` entries with `claim`, `source`, `locator`, `verbatim`, `confidence`, `status`, `added-by` and `date`. It has no place for layer, establishes, does not establish, counterevidence or reverses if. Its status vocabulary (`pending`, `verified`, `unverified`, `source-unverifiable`, `interpretation`) shares only `verified` with the ledger's. Chapters cite claims inline as `[claim: EV-nnnn]`. A conversion would lose the fields the author considers the point of the ledger, and placing inline markers is a judgment made sentence by sentence.
3. **The plugin has no way to recognize such a book.** `findBookRoot` requires `context/` and `chapters/`, so the session start reports that no book exists and names the new-book flow. `nfs-new-book` then sees no state folder and no `context/brief.md`, takes its fresh-book branch, and stamps a complete empty bible beside the real manuscript. Nothing is overwritten, but the author ends up with two parallel books.

## Decision

### Adopt in place: the author's files stay canonical

Adoption attaches the plugin to a book without moving, renaming, or rewriting anything the author wrote. It adds two things at the book root:

- the state folder, `_nonfiction-studio/` by default (ADR-0015), with its usual files and its README;
- the pointer file, `nonfiction-studio.json`, which names the book's chapters folder.

Nothing else is created at adoption. The author's README, ledger, notes, and folders keep their roles, and the plugin never imports any of them as evidence or sources. Undoing an adoption means deleting the state folder and the pointer, plus any plugin files created later by adopting an element.

### The pointer can name the chapters folder

ADR-0015's pointer gains a second key: `{"state_dir": "<name>", "chapters_dir": "<name>"}`. Either key may be absent. A missing `state_dir` means `_nonfiction-studio`, and a missing `chapters_dir` means `chapters`. A pointer with neither key is invalid.

`chapters_dir` follows ADR-0015's name rule: one folder name of 1 to 64 ASCII letters, digits, `_`, `-` or `.`, and not `.` or `..`. It may not name the state folder, `context`, `structure`, `research`, `production`, `.git` or `.claude`; on Windows these are compared without regard to case. The reserved names are a security control here too, as the Security section explains. A bad `chapters_dir` is a bad pointer: it raises `STATE_POINTER_INVALID`, denies writes except a repair of the pointer, and never falls back to `chapters/`.

`hooks/lib/bible.mjs` gains one resolver for the chapters folder, beside the state-folder resolver, and every hook, engine and CLI reaches chapters through it. Skills name chapter paths as `<chapters-dir>/...`, resolved by the same shared stanza that resolves `<state-dir>`.

**Book-root detection.** A directory is a book root when it holds `context/` and `chapters/`, as before, or when it holds a pointer that names a chapters folder. Either way, the resolved state folder must hold `meta.json`. This amends ADR-0015, under which a pointer outside a directory holding `context/` and `chapters/` was ignored. A pointer that names a chapters folder that does not exist is a bad pointer, not an ignored file, so a broken adoption is reported instead of silently disappearing.

**What counts as a chapter.** In an adopted book, every Markdown file directly inside the chapters folder is manuscript prose, and its slug is its file name without `.md`. An introduction or an author's note is therefore measured like a chapter. Code that assumes the `NN-<slug>` naming of a plugin-created book must accept any file name. A skill that finds a chapter through `structure/chapter-list.md` falls back to the file names in the chapters folder when `structure` is not adopted.

### Elements are adopted one at a time, or never

The bible is divided into five elements, and the state folder's `meta.json` records each one's adoption state:

| Element | Plugin files | Created by |
|---|---|---|
| `chapters` | the chapters folder | `nfs-adopt`, at adoption (always adopted) |
| `style` | `context/style-profile.md`, the voice baseline in `config.json` | `nfs-adopt style`, which runs the `nfs-capture-voice` flow |
| `brief` | `context/brief.md`, `context/audience.md`, `context/decisions.md` | `nfs-adopt brief`, which runs the `nfs-interview` flow |
| `structure` | `structure/thesis.md`, `outline.md`, `chapter-list.md`, `comps.md`, and `research/open-questions.md` | `nfs-adopt structure`, which runs the `nfs-outline` flow |
| `claims` | `research/evidence-log.md`, `research/sources.md`, inline claim markers | not adoptable in this record; see below |

The record is additive: `meta.json` gains an `adoption` object holding the adoption date, each element's state (`adopted` or `not-adopted`), and the list of shared folders. A book created by `nfs-new-book` has no `adoption` object, and every element counts as adopted. `schema_version` stays "2", by the argument ADR-0015 made: the change adds an optional field and does not alter any existing one.

**A skill that needs an unadopted element stops.** Each skill's shared stanza reads the adoption record after it resolves the folders. A skill that needs an element the book has not adopted stops before its first write. It names the element and the `nfs-adopt` command that adopts it, instead of creating plugin files beside the author's own. The skills that create an element are the exception: running them through `nfs-adopt <element>` is how the element is adopted. An element whose flow needs another element is adopted after it: `structure` needs `brief`, because `nfs-outline` starts from a confirmed brief.

**What works on the day of adoption, with no element beyond `chapters`:**

- the PostToolBatch hook's word counts in `progress.json`, and the AI-use log for chapter writes;
- the PreToolUse hook's snapshot before each chapter edit;
- the status board (`nfs-status-dashboard`) and the status line;
- the doctor, which reports unadopted elements as notices, not findings;
- the session start's orientation block, which reports an unadopted element as not adopted rather than as missing work;
- the quality gate's `prompt_scrub`, `continuity`, `state_coherence`, `session_write_flag` and `overlap` checks. `overlap` compares chapters against source material that an adopted book does not yet have, so it must report that it had nothing to compare against, rather than pass silently.

The gate's `claim_coverage` and `quote_fidelity` checks skip in a book that has not adopted `claims`, `stylometry` skips until `style` is adopted, and `thesis_alignment` skips until `structure` is adopted. Each skip names the element and the command that adopts it, and a skip never counts as a pass or a failure.

Drafting with the plugin's agents needs every element, including `claims`. An adopted book therefore gets measurement, compliance logging, and the gate's prose checks in this record, not agent drafting.

### A book's own claim ledger is not converted

When a book arrives with its own claim system, that system stays the record of truth. The plugin does not create `research/evidence-log.md` or `research/sources.md` in such a book, and the claims-dependent skills (`nfs-research`, `nfs-fact-check`, `nfs-build-apparatus`, `nfs-draft`) stop with the "not adopted" message. Two ledgers that both claim to be the record would be worse than one ledger the plugin cannot read.

Adopting `claims` is left to a later record. That record should first decide whether the evidence-log grammar gains optional fields, such as `layer`, `establishes`, `does-not-establish`, `counterevidence` and `reverses-if`, so that a conversion loses nothing. It must also decide how a book's own claim IDs map to `EV-NNNN`, how citations become `SRC-NNNN` records, and how traceability kept outside the prose maps to inline markers.

### A book can name a prose-boundary heading

A book's `config.json` can name one heading line, for example `"prose": {"ends_at_heading": "## Drafting apparatus"}`. In each chapter file, everything from the first line that equals that heading to the end of the file is not prose. One shared function in `hooks/lib/` returns a chapter's prose, and every engine that measures chapter text uses it: word counts, the scrub and continuity scans, overlap, stylometry, and the claim-marker scan. A book without the setting is measured exactly as before.

`nfs-adopt` proposes the setting when the same trailing heading appears in most chapter files, and the author confirms it with the rest of the plan. The setting lives in `config.json`, the one state file meant for hand editing, so the author can change it later.

### Shared folders need one informed yes, and agent scopes in them narrow

A folder that the plugin uses can already exist with the author's own files in it, as `research/` does in the book above. Sharing such a folder is allowed. Two rules govern it.

1. **Informed consent, once per folder.** The first time a flow would create a plugin file in a folder that holds files the plugin did not create, the skill stops and says which file it will create and why. It says that the author's files in the folder will not be touched, and it asks for a quick yes. The answer is recorded in the state folder's `meta.json`, so the question is asked once per folder. A no writes nothing, and the skill names what it could not do.
2. **Agent write scopes narrow in a shared folder.** ADR-0007's table lets `research-librarian` write anywhere under `research/`, and `structure-architect` likewise. In a folder recorded as shared, an agent's scope covers only the plugin's own files in that folder, such as `research/evidence-log.md`, `research/sources.md`, `research/open-questions.md` and `research/packets/`. It does not cover the author's files. This is computed from the adoption record, in the same way that ADR-0015 computes the librarian's state-folder scope.

### `nfs-adopt` performs adoption, and `ns-doctor` plans it

A new skill, `nfs-adopt`, is the single entry point. It runs the same consent pattern as `nfs-doctor`'s move routine (ADR-0015):

1. **Plan, without writing.** `bin/ns-doctor --adopt-plan --json` reads the folder and reports what it found. It finds candidate chapters folders, a repeated trailing heading, and folders the plugin would share. It also reports files that look like a claim ledger, any existing state folder or pointer, and uncommitted changes in a git working tree. The engine stays read-only.
2. **Show the plan.** The skill states what it will add, what works at once, which elements stay unadopted and what adopting each would take, and that it changes none of the author's files. It recommends committing any uncommitted work first, so that the adoption is one reviewable change.
3. **Ask, then write.** On an explicit yes, it writes the state folder, its README, and the pointer, records the adoption in `meta.json`, and sets the prose boundary if the author confirmed one. It then re-runs the doctor report and states how to undo the adoption. Any other answer, or a non-interactive session, writes nothing.
4. **Later, one element at a time.** `nfs-adopt <element>` shows what adopting that element creates, asks, records it, and hands off to the skill that creates it.

The plan lives in `ns-doctor` rather than in a new CLI. It passes ADR-0009's first growth test, because the plan is deterministic and can be tested before it exists. The doctor is already the plugin's read-only inspector of a book folder, and it already reports state-folder problems, so extending it adds no CLI.

### The front door recognizes existing writing

A directory holds existing writing when it has no book root and contains Markdown files outside `.git/` and `.claude/`, other than a top-level `README.md`. In such a directory:

- the session start's message says that no Nonfiction Studio book was found, that the folder already holds writing, and that `/nonfiction-studio:nfs-adopt` brings it in. It names neither the new-book flow nor `nfs-start`'s new-book path;
- `nfs-start` offers adoption as its first path in place of a new book;
- `nfs-new-book` refuses to stamp a new bible, names `nfs-adopt`, and suggests an empty folder for a genuinely new book.

The refusal in `nfs-new-book` and the session start's change of message ship before this record's wave, as a guard. Until `nfs-adopt` exists, the guard's message says that adoption is planned and that the new-book flow will not write into existing writing.

## Security

`AGENT_WRITE_SCOPES` (ADR-0007) lets `drafting-partner` and `line-editor` write under `chapters/`. Once the chapters folder is configurable, their scope must follow the resolved folder, as the librarian's state-folder scope follows the state folder (ADR-0015). A fixed `chapters/` entry would deny their legitimate writes to an adopted book's chapters, which fails closed. Worse, it would leave `chapters/` writable if such a folder also existed, which fails open.

The reserved names for `chapters_dir` close the widening that a pointer could otherwise cause. A pointer naming `.claude` would let the drafting agents plant a project skill. One naming `context` or `research` would widen their scope into the brief or the ledgers. One naming the state folder would let them rewrite the AI-use log.

Narrowing agent scopes in shared folders protects the author's own files, such as interview protocols and ethics documents, from agents whose table entry names the whole folder. A missed narrowing fails open for those files, unlike ADR-0015's rename, so the implementation must pin each narrowed scope with a test.

## Alternatives considered

- **Convert the book into the plugin's layout.** One consented migration would make every capability work. It was rejected as the default because it loses information: the ledger fields the author considers essential have no home, and inline markers would replace a traceability system the author chose. It would also rewrite paths that the author's own documents refer to.
- **Make the plugin follow any layout.** A path map in the pointer for every element, plus a format adapter for each grammar, would fit any book. It was rejected for cost: the bible paths are hard-wired across dozens of files, and a format adapter for a foreign claim grammar is a parser per author. This record takes the one mapping that pays for itself, the chapters folder, and leaves the rest as elements to adopt.
- **Rename the author's chapters folder to `chapters/`.** A `git mv` would avoid new resolver work. It was rejected because it changes the author's layout and breaks every reference to the old path in the author's own README, ledger, and notes.
- **Keep plugin files out of folders the author uses.** A hard rule would avoid mixed ownership. It was rejected in favor of informed consent: the file names do not collide, and the real risks are a second ledger and agent scope, which the claims and scope rules address directly.
- **Start adoption from `nfs-new-book` or from `nfs-doctor`.** Fewer skills, but `nfs-new-book`'s name and its re-stamp rules both assume a plugin-created book, and a first-time author is unlikely to look for setup in a diagnostic tool.

## Consequences

- **An adopted book has two kinds of truth, divided by element.** For each unadopted element, the author's own files are canonical and the plugin does not read them. For each adopted element, the plugin's file is canonical. The adoption record in `meta.json` is the single place that says which is which.
- **Day one is narrower than a plugin-created book.** Without `claims`, an adopted book has no claim coverage, no fact-check, no apparatus generator, and no agent drafting. The plan must say so plainly, so that an author does not mistake adoption for full support.
- **Voice capture from existing chapters is capture, not a verdict.** `nfs-adopt style` can capture a baseline from the author's own chapters. ADR-0012 found that the drift check cannot separate ghostwritten prose from the author's own at chapter scale. The plan must not present the resulting `stylometry` check as a ghostwriting detector.
- **An author's standing rules stay the author's.** Conventions that predate the plugin, such as status tags on every claim, preprint labels, and handles on reference IDs, are the author's contract. Adoption does not treat them as gaps to fill.
- **The shared stanza changes.** Its sentence "the folder that holds `context/` and `chapters/`" is false for an adopted book. The stanza gains the `<chapters-dir>` placeholder and the adoption check, so all nine copies and the checker's sentinels change in one step.
- **Fixtures prove the model.** A fixture book in a foreign layout passes every suite after adoption. It has chapters in a non-default folder, a trailing apparatus heading, a shared `research/` folder, and its own ledger. Its tests prove that no author file changes, that each unadopted element is reported, and that each claims-dependent skill and gate check stops or skips with its message.
- **MIGRATION.md is unaffected.** Existing books gain no required change: the `adoption` object, the `chapters_dir` key, and the prose boundary are all optional and additive.

## Implementation wave

This record is the decision only. The guard against stamping a new book over existing writing ships first, as its own small pull request. The adoption wave then lands as its own pull request, in this order:

1. RED first: the foreign-layout fixture, and failing tests for the chapters resolver, the amended root detection, the prose boundary, the adoption record, the skips and stops, the narrowed scopes, and `--adopt-plan`.
2. The chapters resolver and the amended detection in `hooks/lib/bible.mjs`, then every caller of a literal `chapters/`, then the computed scopes for the drafting agents and the narrowed scopes in shared folders.
3. The prose-boundary function and its callers.
4. The adoption record, the doctor's notices, the gate's skips, and `--adopt-plan`.
5. The stanza change and its checker, then the skills' stops and the `nfs-adopt` skill.
6. Docs, the CHANGELOG entry, and the workspace-refs manifest refresh as the last commit.

## Out of scope

- **Adopting `claims`.** A later record decides the evidence-log grammar, the ID and source mapping, and how traceability kept outside the prose maps to inline markers.
- **Any element mapping beyond the chapters folder.** A book's own outline, brief, or style guide is not read as the plugin's. Adopting an element creates the plugin's file through the plugin's own flow.
- **Author conventions with no plugin equivalent.** Questions deliberately deferred to a later chapter, numbered rulings cited across chapters, decision memos, and research instruments such as interview protocols stay the author's. The plugin neither reads nor models them.
- **Source material the author has flagged as unverified.** Adoption never imports any author file as evidence or as a source, so such material cannot reach the plugin's ledgers.
- **Moving or renaming the author's other folders.** Only the chapters folder is mapped. ADR-0015 already left the bible's other folder names out of scope.
