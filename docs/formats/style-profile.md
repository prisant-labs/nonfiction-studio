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

`bin/ns-doctor` warns if the `captured` timestamp here disagrees with the corresponding value in `config.json`.

## Placement rules

- `context/style-profile.md` is not append-only. `voice-capture` writes the file in full at intake; the author may edit any section at any time.
- Changes to `## Voice`, `## Diction`, `## Rhythm`, `## Do`, and `## Do not` take effect immediately; the `SessionStart` hook injects a compact form of these sections into the orientation block at each session start.
- Changes to `## Baseline reference` must be synchronized with `config.json`; `bin/ns-doctor` warns on a timestamp mismatch.
- Paths listed under `## Exemplars` must be valid relative paths under `context/samples/`; `bin/ns-doctor` reports broken sample paths.

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
- `bin/ns-stylometry` (TSK-026 (ns-stylometry engine)): reads the `Baseline reference` block to locate the numeric vector in `config.json` and cross-checks the `captured` timestamp; computes the `drift_score` stored in `progress.json`.
- `drafting-partner`: reads `## Voice`, `## Diction`, `## Rhythm`, `## Do`, and `## Do not` for craft guidance when generating chapter prose.
- `line-editor`: reads the same craft sections to calibrate line edits against the author's voice.
- `voice-guardian`: monitors the active writing session against the profile and raises stylometry alerts when drift exceeds the threshold in `config.json`.
- `SessionStart` hook: injects a compact form of the craft guidance sections into the session orientation block.
