# Style Profile Format

**Purpose.** This is the normative grammar for `context/style-profile.md`, the human-readable half of the voice system defined in S-08 (schemas and file formats) section 9. The numeric half of the voice system (the baseline vector) lives in `.studio/config.json` under `stylometry.baseline.markers` and is never duplicated in this file; the `Baseline reference` section points to it instead. The file is written by the `voice-capture` skill at intake and edited by the author. A parser author must be able to implement a conformant reader without consulting any other document.

## File structure

The style profile is a Markdown document with a top-level `# Style profile` heading followed by exactly seven named sections, each an H2 heading.

| Section | Content |
|---|---|
| `## Voice` | Tone, point-of-view, tense, and register: four bullet-list fields |
| `## Diction` | Word choice guidance: `prefer` and `avoid` bullet fields |
| `## Rhythm` | Sentence and paragraph length guidelines |
| `## Do` | Positive stylistic directives the agents apply when generating or editing |
| `## Do not` | Negative constraints; patterns the agents must avoid |
| `## Exemplars` | Paths to sample files under `context/samples/` that illustrate the voice |
| `## Baseline reference` | Pointer block linking to the numeric vector in `.studio/config.json` |

## Baseline reference block

The `Baseline reference` section carries three fixed fields and must not duplicate the numeric vector itself. It points to the single stored copy in `.studio/config.json`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `vector` | string | required | The JSON path into `config.json` where the markers live, expressed as `.studio/config.json -> stylometry.baseline.markers` |
| `captured` | string | required | RFC 3339 UTC timestamp of the voice-capture run; must agree with `config.json` `stylometry.baseline.captured` |
| `sample_count` | integer | required | Number of voice samples used in the baseline; must agree with `config.json` `stylometry.baseline.sample_count` |

`bin/ns-doctor` reports a finding if the `captured` timestamp or `sample_count` here disagrees with the corresponding value in `config.json`, whenever `config.json` carries a stylometry baseline to compare against.

## Doctor validation

`bin/ns-doctor` treats `context/style-profile.md` differently depending on whether it has been captured yet:

- **Pre-capture stub.** Before `capture-voice` runs, `context/style-profile.md` is an HTML-comment stub with no `# Style profile` heading (see `templates/book-scaffold/context/style-profile.md`). This is a legitimate state: the doctor reports a NOTICE ("style profile not yet captured; run capture-voice"), not a finding, and this does not affect the exit code. The one exception is a stub sitting alongside a `config.json` that already carries a stylometry baseline: `capture-voice` writes the profile and the baseline together, so a baseline with no captured profile is inconsistent state, and the doctor reports that as a finding instead.
- **Populated profile.** Once the `# Style profile` heading is present, the doctor reports a finding for any of the seven sections listed above that is missing or out of order; a `Baseline reference` block missing `vector`, `captured`, or `sample_count`; a `captured` or `sample_count` value that disagrees with `config.json`'s stylometry baseline (only checked when `config.json` carries one); or an `Exemplars` path that does not resolve relative to the book root. Each finding names the section, field, or path at fault.

## Placement rules

- `context/style-profile.md` is not append-only. `voice-capture` writes the file in full at intake; the author may edit any section at any time.
- Changes to `## Voice`, `## Diction`, `## Rhythm`, `## Do`, and `## Do not` take effect immediately; the `SessionStart` hook injects a compact form of these sections into the orientation block at each session start.
- Changes to `## Baseline reference` must be synchronized with `config.json`; `bin/ns-doctor` reports a finding on a `captured` or `sample_count` mismatch.
- Paths listed under `## Exemplars` must be valid relative paths under `context/samples/`; `bin/ns-doctor` reports a finding for a broken sample path.

## Example

```markdown
# Style profile

## Voice
- tone: plainspoken, warm, occasionally wry; never breathless.
- point-of-view: second person for instruction, first person singular for anecdote.
- tense: present for principles, past for stories.
- register: trade non-fiction, an informed friend, not a lecturer.

## Diction
- prefer: concrete nouns, short Anglo-Saxon verbs, named examples.
- avoid: jargon without a gloss, stacked qualifiers, throat-clearing openers.

## Rhythm
- sentence length: mostly short, one long sentence per paragraph for variation.
- paragraph length: three to five sentences.

## Do
- open sections with a scene or a concrete question.
- earn every abstraction with an example within two sentences.

## Do not
- start sentences with "In today's world" or "It is important to note".
- use em-dashes or en-dashes.

## Exemplars
- context/samples/voice-sample-01.md
- context/samples/voice-sample-02.md

## Baseline reference
- vector: .studio/config.json -> stylometry.baseline.markers
- captured: 2026-07-17T09:12:00Z
- sample_count: 4
```

## Consumed by

- `voice-capture` skill: writes the initial profile at intake, populating all seven sections from the structured author interview.
- `bin/ns-stylometry` (TSK-026 (ns-stylometry engine)): reads the numeric vector directly from `.studio/config.json`'s `stylometry.baseline.markers`, the location this file's `Baseline reference` block points to, and computes the `drift_score` stored in `progress.json`. It does not read this file itself and does not cross-check the `captured` timestamp; that cross-check is `bin/ns-doctor`'s, described under "Doctor validation" above.
- `bin/ns-doctor` (the eleventh check in `hooks/lib/doctor-engine.mjs`'s `runChecks`): reads this file's `Baseline reference` block directly and cross-checks its `captured` and `sample_count` fields against `.studio/config.json`'s stylometry baseline, per "Doctor validation" above.
- `drafting-partner`: reads `## Voice`, `## Diction`, `## Rhythm`, `## Do`, and `## Do not` for craft guidance when generating chapter prose.
- `line-editor`: reads the same craft sections to calibrate line edits against the author's voice.
- `voice-guardian`: monitors the active writing session against the profile and raises stylometry alerts when drift exceeds the threshold in `config.json`.
- `SessionStart` hook: injects a compact form of the craft guidance sections into the session orientation block.
