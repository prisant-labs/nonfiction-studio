# Privacy and data

Nonfiction Studio keeps a few small caches so it does not repeat work across sessions, and it keeps a compliance log to help you meet AI-disclosure requirements when you publish. This page explains what each one is, where it lives, and how to clear it.

Nothing described on this page ever leaves your project folder and your own machine. Nonfiction Studio does not send your manuscript, your research, or your project state anywhere beyond your own Claude session.

## What gets stored, and where

### 1. Fact-checker memory

**Location:** `.claude/agent-memory/nonfiction-studio-fact-checker/` inside your book project folder.

The fact-checker agent remembers which claims it has already verified against which sources, so it does not redo the same check every session. It stores verification outcomes only (a claim, a source, and a verdict); it never stores your unpublished manuscript text wholesale.

**To clear it:** delete the directory. It rebuilds itself as you keep working; nothing else is affected.

### 2. Project state (`.studio/`)

**Location:** the `.studio/` folder inside your book project, created when you first set up the project.

This is the plugin's working memory for your book: progress tracking and configuration, plus two things worth knowing about specifically.

- **`.studio/ai-use-log.jsonl`** is an append-only log of AI involvement in your manuscript. Each entry records which agent acted, when, what kind of assistance it was (fully AI-generated text, AI-assisted editing of your own text, or purely mechanical work such as formatting or snapshotting), which files it touched, and a one-sentence summary. This log exists to support the kind of AI-use disclosure that publishing platforms such as Amazon KDP increasingly ask authors to provide. A skill that turns this log into a finished disclosure report is planned for a later release; the log itself is already being kept so that history is there when that skill arrives.
- **`.studio/snapshots/`** holds a timestamped copy of a chapter file taken before certain edits, so you can recover a prior version if something goes wrong.

**To clear it:** delete the whole `.studio/` folder, or just the piece you want gone, for example `.studio/snapshots/` to drop old chapter snapshots, or the contents of `.studio/ai-use-log.jsonl` to reset the disclosure history. Deleting all of `.studio/` also resets your project's progress tracking and configuration; the plugin recreates the basic structure the next time it needs it, but the deleted history itself is not recoverable.

### 3. Generated book-context skill

**Location:** `.claude/skills/book-context/SKILL.md` inside your book project folder.

The `nfs-new-book` skill can generate this file: a short, project-committed quick-reference assembled from your bible content at the time it was generated - your thesis one-liner, your top three style rules, your chapter map, and your open-claims count - each line naming the exact file (or CLI) it was read from. Unlike the fact-checker cache and `.studio/`, which the plugin maintains on its own, this file is written only after you say yes to an explicit question; a non-interactive session skips the offer and writes nothing, and declining the question writes nothing.

It is generated once and does not update itself as your bible changes. Because a skill file written during a running session only becomes usable at the start of your next session (a confirmed Claude Code platform behavior, not a plugin choice), the offer says so plainly before you decide.

**To clear it:** delete the file. The offer to generate it repeats the next time `/nonfiction-studio:nfs-new-book` runs against that project, since the offer only re-fires when the file is absent.

## Per-project isolation

Every book project keeps its own `.studio/` folder, its own fact-checker memory, and its own generated book-context skill (if any), scoped to that project's folder. One book's state is never read by, or mixed into, another book's. If you write two books with Nonfiction Studio, each keeps a completely separate history.

## Further reading

For the technical file-format details behind the log and the snapshots, see [formats/ai-use-log.md](formats/ai-use-log.md) and [formats/snapshots.md](formats/snapshots.md). For how the book-context skill is generated, see the [nfs-new-book skill reference](reference/skills/nfs-new-book.md#book-context-skill-generation). For general orientation, see the main [README](../README.md).
