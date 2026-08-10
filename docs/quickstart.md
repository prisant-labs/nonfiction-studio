# Quickstart

This is the fast path: install the plugin, paste some of your own writing, and see three real outputs back before you decide whether to commit to a full book project. It is the on-ramp OPP-D17 (five-minute first win) was built to close: the full intake interview is a genuine, honest 45 to 90 minute session, and that duration should never be the only door in.

## 1. Install

There is no public marketplace listing yet. Clone or download this repository, then install it from your local copy:

```
claude plugin marketplace add /path/to/nonfiction-studio
claude plugin install nonfiction-studio@nonfiction-studio
```

Replace `/path/to/nonfiction-studio` with wherever you cloned or unzipped it. See the [README](../README.md) for the fuller install and surface-support picture.

## 2. Paste something and see three real outputs

In an empty folder, or any folder, run:

```
/nonfiction-studio:quick-scan
```

Paste 500 to 1000 words of your own prose - a book excerpt, an essay draft, anything you actually wrote. No project setup, no `.studio/` folder, nothing to scaffold first. You get back:

1. **A voice profile, measured.** `quick-scan` writes your pasted text to a temporary file and runs it through `bin/ns-stylometry`, the same deterministic engine this plugin uses everywhere else for voice-drift scoring. Eight named markers, by number: function-word rate, contraction rate, first- and second-person rate, type-token ratio, average word length, average sentence length, punctuation rate.
2. **A claim scan, read by the model.** Sentences that assert a fact a reader would want a source for. This part carries no engine behind it, and the skill says so explicitly: it is a first pass, not a verdict.
3. **A one-paragraph editorial read** on what the excerpt seems to be about, ending with a pointer to what to try next.

The engine measurement itself is close to instant (well under two seconds, start to finish, verified directly against the real CLI while building this skill); the time this step actually takes is mostly you pasting text and reading what comes back.

## 3. Take the guided tour

```
/nonfiction-studio:tour
```

This copies the bundled sample book, "The Quiet Network," to a disposable location (never touching the plugin's own shipped copy) and walks you through the quality gate directly: it passes on the untouched chapter, then a realistic planted defect (a leftover line of AI-drafting residue) makes it block with a named reason, then removing that line makes it pass again. Nine short steps; the underlying gate runs themselves are near-instant, and the walkthrough exists so you can see, not just be told, what a block actually looks like and why it names a specific reason instead of a vague warning.

## 4. When you're ready to commit: the real interview

Both steps above work with no project at all. When you decide to write an actual book with this plugin, the real starting point is:

```
/nonfiction-studio:studio
```

Choose "Start a new book," or run `/nonfiction-studio:init-project` directly. That scaffolds the project bible and hands off to `/nonfiction-studio:intake-interview`, which is a real 45 to 90 minute session that captures your book's thesis, audience, and voice. That duration is intentional and stays honest; nothing above shortens it or is a substitute for it. Quick-scan and the tour exist so you can see what the studio actually does before spending that time.

## Explore further

- [docs/README.md](README.md) - the full documentation index
- [examples/sample-book/](../examples/sample-book/) - the complete two-chapter project the tour walks through, browsable directly
- [docs/reference/skills/quick-scan.md](reference/skills/quick-scan.md) and [docs/reference/skills/tour.md](reference/skills/tour.md) - the full contract for each skill used above
- [docs/reference/skills/studio.md](reference/skills/studio.md) - the guided front door that routes to everything else
