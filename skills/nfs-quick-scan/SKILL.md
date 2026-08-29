---
name: nfs-quick-scan
user-invocable: true
argument-hint: "[paste 500-1000 words]"
description: "Measures 500 to 1000 words of pasted prose with the deterministic ns-stylometry engine, scans it for sentences that assert a fact needing a source, and returns a one-paragraph editorial read, keeping the engine-measured voice profile and the model-judged claim scan clearly distinguished per OPP-D17 (five-minute first win). Use when the author pastes writing and wants a fast first look with no project setup, asks what quick-scan or a five-minute preview shows, or is new to the plugin and wants a taste of it before committing to the intake interview."
when_to_use: "Use when the author pastes or types a substantial block of their own prose and wants a fast read on voice and claims, explicitly asks for quick-scan or a five-minute preview, or is new to the plugin with no project yet and wants to see value before starting init-project or intake-interview. Do not invoke inside an existing book project against a real chapter file (use capture-voice for the baseline or fact-check-pass for claims instead); this skill never reads project files."
---

This skill is the five-minute first win per OPP-D17 (five-minute first win). It measures pasted prose with the deterministic voice engine, reads the prose for sentences that would need a source, and gives a one-paragraph editorial read. **It never requires an initialized book project** and reads no project file; the only input is the prose the author pastes into the conversation. This is the property that makes it work identically on CLI, Cowork, and chat.

Two of the three outputs have different authority, and the output must keep that difference visible:
- The **voice profile** is a measurement from `bin/ns-stylometry --measure`, the same deterministic engine this plugin uses everywhere else for voice-drift scoring.
- The **claim scan** is this skill reading the prose itself. No engine backs it. Presenting it with the same confidence as the voice profile would be exactly the enforcement-theater failure this plugin's credibility depends on avoiding.

Skill inputs read: none. No `.studio/` file, no `context/` file, nothing under any project tree is read or required.

---

## Step 1 - Receive the pasted prose (no tool call unless prose is already present)

If the author invoked this skill without pasting any prose, ask:

> Paste 500 to 1000 words of your own prose here and I'll measure the voice, scan for claims that need sourcing, and give you a quick read on what it's about. Don't worry about polish; a rough draft works fine.

Wait for the reply. Once prose is present (in the invocation itself or in the reply), continue to Step 2. Do not attempt to estimate word count by eye; Step 3's engine call reports the authoritative count.

---

## Step 2 - Resolve the plugin root

Use the Bash tool to run the primary lookup:
```
node -e "const s=require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8');const m=JSON.parse(s).extraKnownMarketplaces;const ns=m&&m['nonfiction-studio'];console.log(ns&&ns.source&&ns.source.path||'not-found')"
```

The output is the plugin root. If it prints `not-found`, run the platform cache fallback:
```
find "$HOME/.claude/plugins/cache" -maxdepth 3 -type d -name "nonfiction-studio*" 2>/dev/null | head -1
```

If that also returns nothing, run the dev-mode fallback:
```
test -f bin/ns-stylometry && pwd || echo not-found
```

If all three lookups fail: halt immediately. Report the settings.json path attempted (`$HOME/.claude/settings.json`) and the cache path attempted (`$HOME/.claude/plugins/cache`). Do not write any file. Ask the author how to proceed (verify plugin installation or provide the path manually).

Carry the resolved path forward as `<plugin-root>`.

---

## Step 3 - Write the pasted text to a temp file and measure it

**Never write the pasted text inside this repository or inside `examples/`.** Use the operating system's own temp directory, never a repo-relative path.

**3a - Get the OS temp directory.** Use the Bash tool:
```
node -e "console.log(require('os').tmpdir())"
```
Carry the output forward as `<tmpdir>`.

**3b - Write the pasted prose verbatim.** Use the Write tool to write the author's pasted text, unmodified, to `<tmpdir>/nonfiction-studio-quick-scan.md`.

**3c - Measure it (one Bash call).** Use the Bash tool:
```
node "<plugin-root>/bin/ns-stylometry" --measure="<tmpdir>/nonfiction-studio-quick-scan.md"
```
This mode skips book-root discovery entirely, always emits JSON, and exits 0 on success or 2 on a read error. Capture stdout (`{"markers": {...}, "files": [...], "totalWords": N}`) and stderr.

**3d - Clean up immediately.** Use the Bash tool:
```
rm -f "<tmpdir>/nonfiction-studio-quick-scan.md"
```
Do this whether the measurement succeeded or failed. No pasted text is left on disk after this step.

On exit 2 (measurement failed), skip to "Failure behavior" below for the voice-profile portion only; the claim scan and editorial read in Steps 5-6 do not depend on this call and still proceed.

---

## Step 4 - Word-count banding

Read `totalWords` from Step 3's JSON output and branch:

- **Under 500 words:** Tell the author plainly: "This is `<totalWords>` words, under the 500-word floor where the voice measurement gets noisy with this few data points. I can still show you what it found, or you can paste more first." If they choose to proceed, present the measurement from Step 3 with that caveat attached. If they paste more text, return to Step 3 with the combined text (a fresh write and a fresh measurement; do not attempt to merge marker values by hand).
- **500 to 1000 words:** No caveat needed. Proceed normally.
- **Over 1000 words:** Do not truncate or sample. State plainly: "This is `<totalWords>` words, more than the standard 500 to 1000 word sample. I measured all of it; the per-100-word ratios below stay meaningful at any length, so this is a complete reading, not a partial one."

---

## Step 5 - Present the voice profile (measured)

Present all eight markers from Step 3's `markers` object by name, in plain language, the same way `capture-voice` previews a baseline. Label this section as measured, for example:

> **Voice profile (measured by `ns-stylometry`).** These eight numbers came from the same deterministic engine this plugin uses for voice-drift scoring elsewhere; they are a count, not an impression.
> - Function-word rate: `<value>` - ...
> - Contraction rate: `<value>` - ...
> - First-person rate: `<value>` - ...
> - Second-person rate: `<value>` - ...
> - Type-token ratio: `<value>` - ...
> - Average word length: `<value>` - ...
> - Average sentence length: `<value>` - ...
> - Punctuation rate: `<value>` - ...

Choose plain-language framing for each value (short vs. long sentences, formal vs. contraction-heavy, first-person-anchored vs. distant) the way Step 5 of `capture-voice` does. Do not round away precision that changes the reading; state the numbers as measured.

If Step 3 failed (exit 2), skip this section and state instead: "The voice measurement could not run: `<first line of stderr>`. The claim scan and editorial read below do not depend on it and are unaffected."

---

## Step 6 - Claim scan (this skill's reading, not a measurement)

Using the prose already in this conversation from Step 1 (no additional tool call needed), read it for sentences that **assert** a fact a reader would reasonably ask "how do you know that" about: statistics, named studies or researchers, historical claims, specific quantities, or causal claims stated as settled fact. List each such sentence.

Label this section explicitly as a judgment call, distinct from Step 5's measurement, for example:

> **Claim scan (my reading, not a measurement).** Unlike the voice profile above, no engine backs this list; I read your prose and flagged sentences that assert something a reader might want a source for. Treat it as a first pass, not a verdict.
> - "`<sentence>`" - asserts `<what it asserts>`.
> - ...
>
> If none: "I didn't find a sentence in this excerpt that asserts an uncited fact."

Never present this list with the same numeric-confidence framing as Step 5. If the distinction between the two sections is not visible in your response, restate it before continuing; this is the honesty line the whole plugin's credibility rests on (see the description-quality and enforcement-theater findings this task closes, OPP-D17 and the related audit finding).

---

## Step 7 - One-paragraph read and next step

Write one short paragraph giving an editorial read on what the excerpt seems to be about: the apparent subject, angle, and audience. End the paragraph by pointing at a concrete next step, choosing between:

- **`/nonfiction-studio:tour`** - a guided walkthrough of a complete sample book: watch the quality gate pass, catch a planted problem, and pass again.
- **Starting a real project** - `/nonfiction-studio:studio` (or `/nonfiction-studio:init-project` directly) to scaffold a book, followed by `/nonfiction-studio:intake-interview` when ready. State honestly that the intake interview is a real 45 to 90 minute session per D-16 (honest, resumable interview); do not understate it. This quick scan is a preview, not a substitute for it.

Do not present both as mandatory; either is a reasonable next step depending on whether the author wants to see more or is ready to commit.

---

## Failure behavior

**No prose supplied and the author does not respond.** Step 1 waits; no further step runs.

**Plugin root cannot be resolved.** Step 2 halts before any write. No temp file is created. The author is told which paths were attempted.

**`ns-stylometry --measure` exits 2.** Step 3d still cleans up the temp file. Step 5 states the voice profile could not be computed and names the stderr message. Steps 6 and 7 still run; a broken engine call never blocks the claim scan or the editorial read, and the failed portion is never presented as if it had succeeded.

**Pasted text does not look like prose (code, a link, a list).** The engine still measures whatever text it is given; note plainly that the input does not look like manuscript prose before presenting the measurement, and proceed.

**Author pastes replacement text mid-flow.** Treat it as a fresh invocation from Step 3: a new temp file, a new measurement, a new claim scan. Never merge or average two separate measurements.
