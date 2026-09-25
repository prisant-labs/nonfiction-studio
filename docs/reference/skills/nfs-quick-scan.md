---
title: "nfs-quick-scan skill reference"
description: "Reference for the nfs-quick-scan skill - measures pasted prose with the deterministic ns-stylometry engine, reads it for sentences that need a source, and gives a one-paragraph editorial read, with no project required"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "quick-scan", "stylometry", "voice", "claims", "onboarding", "getting-started"]
---

# nfs-quick-scan

The `nfs-quick-scan` skill is the five-minute first win per OPP-D17 (five-minute first win). It takes 500 to 1000 words of pasted prose and returns three things: a voice profile measured by the deterministic `bin/ns-stylometry` engine, a claim scan identifying sentences that assert a fact needing a source, and a one-paragraph editorial read on what the excerpt seems to be about.

## Purpose

Before this skill existed, the shortest path to any value in this plugin ran through the intake interview, a genuine 45 to 90 minute session. That duration is honest and stays honest (see D-16, honest, resumable interview), but gating all value behind it loses a stranger who cannot see anything useful in the first five minutes. `nfs-quick-scan` closes that gap: paste writing, get a real measurement back.

**It never requires an initialized book project and reads no project file.** This is the property, stated in OPP-D17, that makes it "the only flow that works identically on all three surfaces since it needs no project tree." The only input is the prose the author pastes into the conversation.

**The voice profile and the claim scan carry different authority, and the output keeps that difference visible.** The voice profile comes from `bin/ns-stylometry --measure`, the same deterministic engine this plugin uses everywhere else for voice-drift scoring: a measurement, not an impression. The claim scan is the skill reading the pasted prose directly; no engine backs it. The skill presents these under separate, explicitly labeled headings and never lets the claim scan borrow the voice profile's numeric authority.

**No agents invoked.** This is a single deterministic-CLI-plus-model-reading skill. No chain edges exist in `agents/_chain-permitted.yaml`.

## Invocation

```
/nonfiction-studio:nfs-quick-scan
```

Paste 500 to 1000 words of prose either in the same message or in reply to the skill's prompt. No book project, `.studio/` directory, or prior setup is required.

Alternate entry points:
- The `nfs-start` dispatcher, Path 6 (Quick preview), including directly from the `NO_PROGRESS` branch before any project exists
- The README quickstart and `docs/quickstart.md`

## Inputs and Outputs

### Inputs

| Input | Source | Why |
|---|---|---|
| Pasted prose | The author's message | The only input; no project file is read |

### Outputs

`nfs-quick-scan` writes exactly one file, transiently: the pasted prose is written to a temporary file under the operating system's own temp directory (never inside this repository or inside `examples/`) so `bin/ns-stylometry --measure` can read it, then the file is deleted immediately after the measurement completes. No project file, and nothing under `examples/`, is ever written.

## Flow Summary

The skill runs seven steps:

1. **Receive the pasted prose.** Asks for it if none was supplied yet; otherwise proceeds immediately.
2. **Resolve the plugin root.** The same resolver (`installed_plugins.json`, then `settings.json`, then a plugins-cache scan, then the working directory) every skill in this plugin uses to locate `bin/ns-stylometry`.
3. **Write the pasted text to a temp file and measure it.** Gets the OS temp directory, writes the prose there, invokes `ns-stylometry --measure=<path>` through the resolved plugin root, then deletes the temp file immediately, success or failure.
4. **Word-count banding.** Reads `totalWords` from the measurement and branches: under 500 words gets a noisy-measurement caveat with the option to proceed anyway or paste more; 500 to 1000 needs no caveat; over 1000 is measured in full (never truncated) with a note stating the actual count measured.
5. **Present the voice profile (measured).** All eight markers by name, in plain language, labeled explicitly as coming from the engine.
6. **Claim scan (this skill's reading, not a measurement).** Lists sentences that assert a fact a reader would want a source for, labeled explicitly as a judgment call with no engine behind it.
7. **One-paragraph read and next step.** A short editorial read on the excerpt's apparent subject and audience, ending with a pointer to `/nonfiction-studio:nfs-tour` or to starting a real project (`nfs-start` or `nfs-new-book`, followed honestly by the real 45 to 90 minute intake interview).

## The `--measure` Mechanism

`bin/ns-stylometry` has a standalone `--measure=<path>[,<path>...]` mode that skips book-root discovery entirely, always emits JSON, and exits 0 on success or 2 on a missing or unreadable file. This is the deterministic, project-free measurement path quick-scan depends on; see the [ns-stylometry CLI reference](../cli/ns-stylometry.md) for the full flag and exit-code contract, and `hooks/lib/stylometry-engine.mjs`'s `measureChapter` function for the eight-marker computation itself. The marker names quick-scan presents are the same vocabulary `nfs-capture-voice` uses for a project's permanent baseline, so an author who later runs `nfs-capture-voice` sees consistent terminology.

## Word-Count Bands

| Band | Behavior |
|---|---|
| Under 500 words | States the exact count and that the measurement will be noisy at this length; offers to proceed anyway or wait for more text |
| 500 to 1000 words | The target band; no caveat |
| Over 1000 words | Measures the full text (never truncates or samples); states the actual count measured and that per-100-word ratios stay meaningful at any length |

## Failure Behavior

**No prose supplied and the author does not respond.** The skill waits; no further step runs.

**Plugin root cannot be resolved.** The skill halts before writing any temp file and names the paths it attempted.

**`ns-stylometry --measure` exits 2.** The temp file is still deleted. The voice profile section states the measurement could not run and names the stderr message; the claim scan and editorial read still proceed, since neither depends on the engine call.

**Pasted text does not look like prose.** The engine still measures whatever text it receives; the skill notes this before presenting the measurement and proceeds.

## Relationship to Other Skills

`nfs-quick-scan` shares its underlying engine call with `nfs-capture-voice`, which uses the same `--measure` mode to build a project's permanent voice baseline; `nfs-quick-scan` never writes that baseline and never touches `.studio/config.json`. `nfs-quick-scan` pairs with [`nfs-tour`](./nfs-tour.md): the two together are the try-before-you-commit path per OPP-D17 (five-minute first win), reachable from `nfs-start`'s Path 6 (Quick preview).

## See also

- [nfs-tour skill reference](./nfs-tour.md) - the paired guided walkthrough of the bundled sample book
- [ns-stylometry CLI reference](../cli/ns-stylometry.md) - the engine this skill measures with
- [nfs-capture-voice skill reference](./nfs-capture-voice.md) - builds a project's permanent voice baseline using the same engine mode
- [nfs-start skill reference](./nfs-start.md) - the dispatcher's Path 6 routes here
