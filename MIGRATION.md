# Migration Guide

This file documents Nonfiction Studio's bible-schema compatibility story: what changes between plugin versions, what an author must do when their book's schema falls behind the installed plugin, and exactly how much of that is automated today versus intended for later. F-DX-13 (no shipped versioning policy) asks for this file to exist before the first schema bump, precisely so this honesty happens in advance rather than after an author's book is already affected.

For the mechanical sequence of steps a maintainer follows to cut a plugin release (as opposed to a book's own schema compatibility, which is this file's subject), see `RELEASE-NOTES.md`'s maintainer runbook.

## Where the schema version lives

Every book project carries a `.studio/meta.json` file with a `schema_version` field (currently `"2"` for every book scaffolded by this plugin version). `hooks/lib/doctor-engine.mjs` pins the version this installed plugin supports as `SUPPORTED_MAJOR = '2'`. `bin/ns-doctor` reads both and compares them on every `--check`, `--report`, and `--migrate` invocation.

## What `ns-doctor --migrate` does today

**Diagnosis only.** If a book's `schema_version` equals the installed plugin's `SUPPORTED_MAJOR`, `--migrate` reports "nothing to migrate" and exits 0: a current schema is a success state, not an error indistinguishable from a broken bible. If a book's `schema_version` is anything else, `--migrate` refuses and exits 2, naming both the book's version and the version the plugin supports.

**No automated transformation exists yet.** `--migrate` does not currently rewrite `.studio/meta.json`, does not touch chapter content, evidence-ledger entries, or voice-profile data, and does not write a migration-event log. There is nothing to transform yet, because the plugin has shipped exactly one schema major (`2`) since its first release, so this path has never had a real old-format bible to run against. The command exists today as a readiness check: it tells an author clearly whether their book needs attention, without silently doing (or silently failing to do) anything to their files.

Practically, this means: if you are reading this because `ns-doctor` told you a migration is required, the automated migration you might expect from the message does not exist yet for your specific version jump. Treat that outcome as a signal to check this file's migration log below and, if your target version genuinely lacks an entry, to treat the mismatch as a real blocker worth reporting rather than something to force past.

## Compatibility intent (design commitment, not yet exercised)

The intended policy, once a second schema major ships, is:

- A book's schema stays **read-compatible** with the plugin for at least one full MAJOR plugin version after the version that introduced the next schema major, so an author is never forced to migrate the moment they update the plugin.
- Read-compatible means `ns-doctor` and the other `bin/` engines (`ns-claims`, `ns-stylometry`, `ns-scrub`) can parse and process the older format without data loss, even if they do not rewrite it.
- Write-compatibility (writing the OLD format back out) is not guaranteed once a book has been migrated forward.
- No chapter content, evidence-ledger entry, or voice-profile data may be destroyed by a migration; anything that genuinely cannot be carried forward automatically is called out explicitly in that migration's own log entry below, never dropped silently.

This is a commitment about how the *next* migration will be built, not a description of code that exists. Until a migration log entry below says otherwise, no automated migration has ever run against a real book.

## Migration log

No migrations have shipped yet. When `schema_version` first changes, this section gains a dated entry in this shape:

```markdown
### schema_version "2" -> "3" (shipped in vX.Y.Z)

- What changed: <field rename / type change / removal, named exactly>
- What ns-doctor --migrate does automatically: <the real transformation, or "nothing yet, manual steps only">
- What the author must do manually: <steps, or "nothing">
- Data that cannot be migrated automatically: <named explicitly, or "none">
```

## What counts as a breaking change

For a prompt-and-Markdown plugin like this one, there is no REST endpoint to version: the compatibility surface is the bible schema, the component slugs, and the quality-gate semantics. A change needs a MAJOR version bump if it does any of the following:

- Renames, retypes, or removes a field in `.studio/meta.json`, `.studio/config.json`, `progress.json`, or the evidence-ledger format.
- Renames or removes any shipped agent, skill, or hook slug.
- Moves a deterministic quality-gate check from warn to block, or changes a block check's exit condition so that previously valid output starts failing.
- Changes a `bin/` CLI's exit code, removes a flag, or changes what an existing flag means.
- Removes or renames a previously documented `.studio/config.json` key.

A new skill, agent, hook, or template, a new optional config key, a new warn-only gate check, or a new `bin/` flag that does not remove an existing one, is feature-additive (MINOR). A correctness fix that does not change a contract (a check that was wrongly accepting bad output starting to reject it correctly, a prose update with no slug or schema affected) is a PATCH.

## Mid-book update promise

An author partway through a book must be able to take a MINOR or PATCH update with no migration step required at all. A MAJOR update may require running `ns-doctor --migrate`, but the migration must be runnable from the `nfs-doctor` skill without leaving the author's working session, any manual steps are surfaced before automated ones run, and no book content may be destroyed. `nfs-doctor` warns at session start whenever the installed plugin is ahead of a book's schema version, pointing at this file.

## Word-count note: chapters containing accented or non-Latin words

The stylometry engine's word tokenizer previously matched only the ASCII letters A to Z, so an
accented letter split a word in two: a chapter mentioning a cafe with an acute, or Munchen with
an umlaut, counted those as two tokens each. The tokenizer now matches any Unicode letter, so
they count as one word, which is what they always should have been.

That tokenizer is also `countWords`, the single word-counting authority for the whole plugin.
`hooks/post-tool-batch.mjs` uses it to write chapter word counts into `.studio/progress.json`,
and the doctor's coherence check reads those counts back and compares them against a fresh
recount.

**What this means if your book contains accented or non-Latin words.** The counts already
stored in `progress.json` were produced by the old tokenizer and are too high. On your next
gate or doctor run the recount will disagree with them, and you will see
`coherence.word-count-mismatch` findings naming the affected chapters. The default severity is
warn, so nothing blocks.

**The remedy is to touch the chapter.** `hooks/post-tool-batch.mjs` recounts and rewrites the
stored count whenever a chapter is edited, so the mismatch clears on the next edit to each
affected chapter. `/nonfiction-studio:nfs-doctor` will tell you which chapters are affected.

Unlike the `marker_set_version` case below, nothing versions a stored word count, so this
cannot be made to fail loudly. It is called out here because `MIGRATION.md` is where an author
would think to look, and because a book written entirely in unaccented English sees no change
at all.

## Voice-baseline note: marker_set_version (not a schema_version change)

Independent of `.studio/meta.json`'s `schema_version` (unchanged by this release), the stylometry engine now requires `stylometry.baseline.marker_set_version` on every voice baseline. Every book's baseline captured before this release lacks the field entirely, and the drift scorer treats an absent field as version 1, which no longer matches the engine's current marker set version.

What happens if you take this update without re-running `nfs-capture-voice`: the stylometry check inside `ns-gate` throws a stale-baseline error on every gate run. The gate turns that into a `skip` verdict for the stylometry check alone, with exit code 2 for that run; the top-level gate verdict is unaffected by the skip and can still read `pass`, so voice drift checking goes quiet without the run looking like a failure.

The remedy is one command: re-run `/nonfiction-studio:nfs-capture-voice` to recapture the baseline. A freshly captured baseline always carries the current `marker_set_version` and clears the skip.

**The current marker set version is whatever `CURRENT_MARKER_SET_VERSION` in `hooks/lib/stylometry-engine.mjs` says it is; this document deliberately does not restate the number, because an earlier revision restated it, went stale, and shipped a false claim.** The version has moved four times so far. Version 1 to 2 changed what `type_token_ratio` measures (a flat ratio became a moving average over a fixed token window). Version 2 to 3 made the engine fold typographic quotation characters to their ASCII equivalents before measuring; before that fold, `contraction_rate` read exactly 0 for prose written with the smart apostrophe (U+2019) that Word, Google Docs, and Obsidian emit by default, and `punctuation_rate` omitted every smart double quote. Version 3 to 4 widened `WORD_RE` to the Unicode letter category, so an accented word tokenizes as one whole word instead of fragmenting; the word-count consequence of that change is disclosed in its own section above. Version 4 to 5 (ADR-0012, voice verdict scope) added the `calibration` object described below: a baseline is no longer just an eight-marker vector, it is that vector plus a noise-scale and block-threshold ladder measured from the same corpus, so a v4 baseline is incomplete under the current scoring rule even though its markers themselves did not change shape.

The same one command fixes any of these. If your baseline predates the current marker set version for any reason, whether it lacks the field entirely or carries any older version number, re-run `/nonfiction-studio:nfs-capture-voice`. If your writing samples contain smart apostrophes, the recaptured `contraction_rate` will be genuinely different from the stored one rather than merely re-stamped, because the old value was wrong.

`ns-doctor` validates the style profile's structure (the seven named sections and the `Baseline reference` fields, including `captured` and `sample_count`) against `docs/formats/style-profile.md`, and `/nonfiction-studio:nfs-capture-voice` writes everything that check reads: a fresh capture writes both files in agreement and draws no style-profile findings on a correct book.

Version 4 to 5 replaced the single stored drift threshold with a calibrated baseline: `stylometry.baseline` now carries a `calibration` object (a five-rung noise-scale and block-threshold ladder, plus the chapter-vs-book regime call) measured directly from your own voice corpus by `bin/ns-stylometry --calibrate`, instead of one fixed number applied to every corpus size. A v4 baseline has no `calibration` object at all, so the drift check treats it the same as any other stale-marker-set baseline: it skips with the `nfs-capture-voice` remedy named in the skip detail. The same one command that fixes a missing `marker_set_version` also fixes this - recapturing under the current engine always produces the full calibrated baseline.

Recapturing under this release also changes what `/nonfiction-studio:nfs-capture-voice` does, not just what it produces: it now persists every writing sample under `context/samples/` before calibrating (an earlier build could read a sample from wherever the author pointed it without saving a copy into the book), and the baseline it writes carries three fields no earlier capture wrote at all - `captured`, `sample_count`, and a one-sentence `method` field naming how the baseline was produced. None of this requires a separate action: the same one command, `/nonfiction-studio:nfs-capture-voice`, produces the fuller baseline automatically.

Separately, and not book-affecting the same way: this release also retires `thresholds.drift_score_max` outright. The calibrated-null verdict reads its threshold from the baseline's own `calibration` ladder, not from a single fixed number in config, so this key is no longer read for scoring by anything. A book whose `.studio/config.json` still carries the key is unaffected functionally, but `ns-stylometry` and the gate's stylometry check both print a one-time deprecation notice naming the key when they see it; remove it from `.studio/config.json` at your convenience.

Neither change is a MAJOR version bump under "What counts as a breaking change" above (no field was renamed, retyped, or removed; `marker_set_version` and `calibration` are additive, and a config key that is merely ignored rather than rejected is not a removal), so `ns-doctor --migrate`'s `schema_version` check does not see either one, and the migration log format above does not apply. Both are called out here, outside that format, because the mid-book update promise above is the one place an author would think to look.

## Skill-invocation note: the `nfs-` rename (not a schema_version change)

Independent of `.studio/meta.json`'s `schema_version` (unchanged by this release), every skill this plugin ships has been renamed to carry the `nfs-` prefix, and `studio` is renamed outright to `nfs-start` rather than prefixed. This is a breaking change under "What counts as a breaking change" above: it renames every shipped skill slug. It is being made deliberately, before this plugin's first tagged release, precisely so it never has to be made after one. Renaming a skill after an author has learned its invocation form, written it into their own notes, or scripted around it costs a deprecation cycle and a MAJOR version bump; renaming it now, while the install count is zero, costs nothing but this note.

Every skill in this plugin is invoked as `/nonfiction-studio:<name>`; the table below lists the `<name>` portion only, old to new.

| Old name | New name |
|---|---|
| `build-apparatus` | `nfs-build-apparatus` |
| `capture-voice` | `nfs-capture-voice` |
| `doctor` | `nfs-doctor` |
| `draft-chapter` | `nfs-draft` |
| `fact-check-pass` | `nfs-fact-check` |
| `init-project` | `nfs-new-book` |
| `intake-interview` | `nfs-interview` |
| `outline-book` | `nfs-outline` |
| `quick-scan` | `nfs-quick-scan` |
| `research-pass` | `nfs-research` |
| `run-quality-gate` | `nfs-check-chapter` |
| `status-dashboard` | `nfs-status-dashboard` |
| `studio` | `nfs-start` |
| `tour` | `nfs-tour` |

The eight verb-alias shortcuts (`/draft`, `/factcheck`, `/book-init`, `/interview`, `/outline`, `/research`, `/gate`, `/status`) are also gone, with no replacement alias. They were never registered commands, since this plugin ships no `commands/` directory at all, only documentation shorthand for the same underlying invocation; the new short skill name in the table above is now the shortcut.

No book content, bible schema, or `.studio/` state is affected by this rename: it changes the invocation surface only. If you have notes, scripts, or saved prompts that name a skill by its old invocation form, update them to the new form above; the old form no longer resolves to anything this plugin ships.

## Wave 1 exit surfaces: new capabilities, nothing breaks

This release (ADR-0013, wave 1 exit surfaces) adds seven author-visible surfaces. Every one of them is additive: a book already in progress needs no action to keep working exactly as it did before, and every new default is chosen so that omitting the new capability entirely reproduces the old behavior.

**A per-project settings file is entirely optional.** `.claude/nonfiction-studio.local.md` does not exist in any book scaffolded before this release, and its absence is silent success: every default already in effect stays in effect. See [docs/formats/settings.md](docs/formats/settings.md) for the schema; the shipped, fully-commented starting point is `templates/nonfiction-studio.local.example.md`. A corrupt settings file never breaks a session or changes gate behavior beyond falling back to the no-settings-file case, with one warning sentence to stderr naming the file.

**A new gate check, `overlap`, ships warn-mode by default, and an existing book gets it automatically.** `hooks/lib/gate-engine.mjs`'s `loadGateConfig` merges every book's `.studio/config.json` against the full default check set (`DEFAULT_GATE.checks`) on every read, taking the shipped default for any check name a book's own config does not name. A book scaffolded before this release, whose `.studio/config.json` has never heard of `overlap`, therefore gates with `overlap: { enabled: true, mode: "warn" }` automatically, with no edit required. To adjust its threshold (the default is a 15-word overlapping span) or raise it to `block`, add an `overlap` entry to the book's own `.studio/config.json` `gate.checks`, or set `thresholds.overlap_min_words` in `.studio/config.json` or the new per-project settings file above - either merges over the default the same way every other threshold already does. The same detection also runs standalone as `ns-overlap`, the ninth shipped CLI, for a check outside of a gate run.

**Two output styles, `manuscript` and `review`, are optional and never imposed.** Neither activates itself; `nfs-new-book` offers a consented choice once per project (declining, or running in a non-interactive session, writes nothing), and the built-in `/config` command can activate or change either one at any time. A book that never runs the offer, or declines it, sees no behavior change at all - the two styles change only how Claude's replies are shaped, never anything on disk.

**First-session behavior changes only in a genuinely empty directory.** `SessionStart` now opens the studio dispatcher unprompted (`initialUserMessage`) only when no book project is found anywhere in the ancestor chain *and* the current directory holds nothing beyond an allowlist of `.claude`, `.git`, `.gitignore`, `.DS_Store`, and `Thumbs.db`. Any directory already holding a book project, or any other non-empty directory, is unaffected.

**A generated project book-context skill is optional and consent-gated.** `nfs-new-book` can generate `.claude/skills/book-context/SKILL.md`, a project-committed quick-reference (thesis one-liner, top style rules, chapter map, open-claims count) assembled from the bible content at generation time, each line naming the file it was read from. It is written only on an explicit yes; declining, or running in a non-interactive session, writes nothing, and no existing book has this file until that offer is accepted. `SessionStart`'s companion `reloadSkills` field fires only once the file exists, and even then only picks up the skill starting the next session or a resume, never the same session it was generated in. See [docs/privacy.md](docs/privacy.md) for what it contains and how to remove it.

**Routing enforcement at agent dispatch defaults to warn, not block.** `hooks/pre-tool-use.mjs`'s new dispatch-routing branch (model-tier and chain-edge checks) reports a caution via `additionalContext` by default; it never denies a dispatch unless a project's settings file explicitly sets `routing_enforce: block`. No book sees a dispatch newly refused by taking this update; at most, a warning appears where none did before.

**Chat-surface compliance logging is additive, not a behavior change to any hook.** The six agent-dispatching skills append their own `ai-use-log.jsonl` records only when a hook has not already logged the same write on the current surface (verified by a before/after count check around each flow's writes), so a Claude Code session with hooks already firing sees no duplicate records. `ns-doctor`'s twelfth check (AI-use-log coverage) is read-only and adds findings and notices to the report; it writes nothing and blocks nothing on its own.
