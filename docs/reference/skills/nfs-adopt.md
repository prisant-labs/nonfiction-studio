---
title: "nfs-adopt skill reference"
description: "Reference for the nfs-adopt skill - adopts an existing book in place, without changing the author's files, then takes on the bible's other elements one at a time"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "adopt", "existing-book", "onboarding", "state-folder", "getting-started"]
---

# nfs-adopt

The `nfs-adopt` skill brings a book that already exists into Nonfiction Studio, in place, per [ADR-0016 (adopting an existing book)](../../adr/ADR-0016-adopting-an-existing-book.md). The author's files stay canonical and untouched. The skill adds the plugin's state folder beside them, and a pointer that names the folder holding the chapters, so the hooks, the doctor, the status board and the gate's prose checks work on the book as it is.

## Purpose

A plugin-created book starts from an empty folder, and `nfs-new-book` stamps every part of the bible at once. A book that already exists has its own chapters folder, its own notes, and often its own claim system. Stamping the plugin's layout over it would put a second set of files beside the author's and blur which one is the record. `nfs-adopt` takes the other route: it adopts the chapters on day one and lets the author take on the rest of the bible one element at a time, or never.

The bible has five elements:

| Element | Plugin files | How it is adopted |
|---|---|---|
| `chapters` | the chapters folder | at adoption, always |
| `style` | `context/style-profile.md`, the voice baseline in `config.json` | `nfs-adopt style`, which runs the `nfs-capture-voice` flow |
| `brief` | `context/brief.md`, `context/audience.md`, `context/decisions.md` | `nfs-adopt brief`, which runs the `nfs-interview` flow |
| `structure` | `structure/thesis.md`, `outline.md`, `chapter-list.md`, `comps.md`, and `research/open-questions.md` | `nfs-adopt structure`, which runs the `nfs-outline` flow, after `brief` |
| `claims` | `research/evidence-log.md`, `research/sources.md`, inline claim markers | not adoptable in this release |

**It writes only on an explicit yes, and never an author file.** The plan comes first, from the read-only `bin/ns-doctor --adopt-plan --json`. A non-interactive session plans and writes nothing.

**No agents invoked.** The skill writes the state files itself. In element mode it hands off to the skill that creates the element.

## Invocation

```
/nonfiction-studio:nfs-adopt
/nonfiction-studio:nfs-adopt style
/nonfiction-studio:nfs-adopt brief
/nonfiction-studio:nfs-adopt structure
```

Run it at the root of the book's folder. Alternate entry points: the session start's message in a folder of existing writing, `nfs-start`'s first path in such a folder, and `nfs-new-book`'s existing-writing stop all name this skill.

## Inputs and Outputs

### Inputs

| Input | Source | Why |
|---|---|---|
| The adoption plan | `bin/ns-doctor --adopt-plan --json` | Finds the chapters folder, a repeated trailing heading, shared folders, ledger-like files, the README title, and any existing state folder, pointer or uncommitted change |
| Scaffold templates | `templates/config-defaults.json`, `templates/book-scaffold/_nonfiction-studio/README.md` and `progress.schema.json` | The state files, as `nfs-new-book` writes them |
| The plugin version | `.claude-plugin/plugin.json` | Recorded in `meta.json` |
| The state folder's `meta.json` | the book | Element mode reads the adoption record |

### Outputs

Adopt mode writes the state folder `_nonfiction-studio/` (README, `meta.json` with the `adoption` record, `config.json` with the prose boundary when the author confirms one, `progress.json` seeded from the chapters at status `drafting`, `progress.schema.json`, an empty `ai-use-log.jsonl`, and empty `gate/`, `logs/` and `snapshots/` folders), and then the pointer `nonfiction-studio.json`, which names the chapters folder. The pointer is written last, because it is what makes the folder a book.

Element mode edits only the `adoption` record in `meta.json`: it marks the element adopted, and records the date of the author's consent for each shared folder the element's flow will write in. The flow it hands off to writes the element's files.

## Flow Summary

Adopt mode:

1. **Plan.** Runs `ns-doctor --project=. --adopt-plan --json`.
2. **Decide whether adoption applies.** Stops when the book is already adopted, was created by the plugin, holds a state folder or pointer that does not resolve, or has no folder of Markdown chapters.
3. **Show the plan.** The chapters with titles and word counts, the proposed prose boundary, what will be added, what works at once, what stays unadopted and what adopting each takes, the shared folders, the author's own ledger, and a recommendation to commit uncommitted work first.
4. **Ask.** The title, the chapters folder (another candidate re-runs the plan with `--chapters-dir`), the prose boundary, and then an explicit yes.
5. **Write, then report.** The state files, then the pointer; then the doctor's report, which should show no findings and one notice per unadopted element. It closes with how to undo: delete `_nonfiction-studio/` and `nonfiction-studio.json`.

Element mode (`style`, `brief`, `structure`): checks that the book is adopted and the element is not, that `brief` comes before `structure`, shows what the element creates and asks for consent in any shared folder, records the adoption on an explicit yes, and hands off to `nfs-capture-voice`, `nfs-interview` or `nfs-outline`.

## What works on the day of adoption

Word counts in `progress.json`, counted on prose only when a boundary is set; the AI-use log for chapter writes; a snapshot before each chapter edit; the status board and the status line; the doctor, which reports unadopted elements as notices; the session start's orientation block; and the gate's `prompt_scrub`, `continuity`, `state_coherence`, `session_write_flag` and `overlap` checks. The gate skips `claim_coverage` and `quote_fidelity` until `claims` is adopted, and `stylometry` until `style` is. Drafting with the plugin's agents needs every element, including `claims`.

A baseline captured by `nfs-adopt style` from the author's own chapters is a capture, not a ghostwriting detector: [ADR-0012 (voice verdict scope)](../../adr/ADR-0012-voice-verdict-scope.md) found that the drift check cannot separate ghostwritten prose from the author's own at chapter scale.

## Failure Behavior

- **The plan fails (exit 2):** the first line of stderr is shown and nothing is written.
- **A write fails:** the skill stops, names the path, and says that deleting `_nonfiction-studio/` removes everything written so far. The pointer is never written after a failure.
- **Any answer but an explicit yes, or a non-interactive session:** nothing is written.

## Relationship to Other Skills

- `nfs-new-book` refuses a folder of existing writing and an adopted book, and names this skill.
- `nfs-start` offers this skill first in a folder of existing writing, and in an adopted book replaces its new-book path with adopting another element.
- Every skill that needs an element it does not have stops before its first write and names `nfs-adopt <element>`.
- `nfs-doctor` repairs a state folder or pointer; this skill never does.

## See also

- [ns-doctor CLI reference](../cli/ns-doctor.md) - the `--adopt-plan` mode this skill plans with
- [nfs-new-book skill reference](./nfs-new-book.md) - the flow for a new book in an empty folder
- [nfs-start skill reference](./nfs-start.md) - the front door, which routes here for existing writing
- [nfs-doctor skill reference](./nfs-doctor.md) - repairs a state folder or pointer
