---
title: "Output styles reference"
description: "Reference for the two output styles Nonfiction Studio ships - manuscript and review - what each changes, how to activate and deactivate them, and what they never touch"
audience: "non-engineer"
level: "beginner"
tags: ["output-style", "manuscript", "review", "config", "settings"]
---

# Output styles

Nonfiction Studio ships two optional output styles as plugin components: `manuscript` and `review`. Both change one thing only - how Claude's replies are worded and shaped in this project. Neither changes what any skill, agent, or engine reads, writes, or checks. The two style files live at `output-styles/manuscript.md` and `output-styles/review.md` in the plugin itself; nothing is ever copied into your project.

Neither style is on by default. `nfs-new-book` offers both once, at project init, and never imposes one - see [nfs-new-book](skills/nfs-new-book.md#output-style-offer) for the offer flow. You can also skip that offer entirely and manage a style yourself at any time, on any surface, with the built-in `/config` command.

## What each style changes

**`manuscript`** - prose-first responses for chapter drafting and line editing. No unrequested bullet summaries of a drafting turn. No code fences around chapter prose or quoted passages - manuscript text is not code. A proposed line edit is presented as quoted passages (current text and proposed text, each its own blockquote) rather than a diff. Claim markers (`[claim: EV-nnnn]`, `[UNVERIFIED]`, `[SOURCE-UNVERIFIABLE]`, `[MEANING CHANGE: <reason>]`) are treated as load-bearing evidence-chain state throughout, matching the conventions `nfs-draft` and its agents already use.

**`review`** - terse, verdict-first, tabular responses for gate, status, and diagnostic work. The verdict (PASS, WARN, BLOCK, or the equivalent top-line result for a status or doctor check) leads the reply; per-check detail follows as a compact table or list, not prose paragraphs. Framing language and repeated closing summaries are cut. This matches the verdict conventions `nfs-check-chapter` already presents.

Both styles ship `keep-coding-instructions: false` in their frontmatter, so each fully replaces the platform's default coding-assistant response shaping rather than layering on top of it, and neither sets `force-for-plugin` - the offer is consented, once, per project; a style is never forced on every session just because this plugin is loaded.

## Activation

Two ways to turn a style on:

1. **Accept the `nfs-new-book` offer.** On consent, the skill merge-writes `outputStyle` into your project's `.claude/settings.local.json`, preserving every other key already there.
2. **The built-in `/config` command's Output Styles picker**, on any surface, at any time - independent of whether you ever ran `nfs-new-book` or what it recorded.

Either way, the value the platform actually needs is the **namespaced** form: `plugin-name:<style frontmatter name>`, which for this plugin is `nonfiction-studio:Manuscript` or `nonfiction-studio:Review`. This is a real platform requirement, not a style choice this plugin invented: a bare style name (the frontmatter `name` alone, or the output-style file's own filename) silently fails to activate, with no error at all - a plugin-shipped output style is discovered and keyed the same way a plugin-shipped agent's `subagent_type` is, joined to the plugin's own manifest name with a colon. This was independently verified for the settings-key path: `nfs-new-book`'s merge-write always composes this namespaced form for you and writing it directly was confirmed to activate the style. The `/config` picker is the documented platform mechanism for choosing a plugin-provided style by name without typing the namespaced form yourself, but its own internal behavior was not independently verified the same way; take it as the intended path, not a re-confirmed one.

## Deactivation

Run `/config` again and choose a different style (including the platform default), or edit `.claude/settings.local.json` directly and change or remove the `outputStyle` key. Either action is yours to make at any time; nothing in this plugin re-imposes a style once you have changed it.

## Takes effect at session start

An `outputStyle` change - by either activation path above, or by deactivating - takes effect at the start of your next Claude Code session. It does not change the response shape of the session already in progress. This is ordinary Claude Code settings behavior, not something this plugin adds or works around.

## What switching styles does not change

Exactly two settings records exist per project for this feature, and switching styles - by either activation path, at any time - never produces a third:

- `.claude/settings.local.json`'s `outputStyle` key - the platform's own activation switch.
- `.claude/nonfiction-studio.local.md`'s `output_style` key - the `nfs-new-book` offer's own one-time outcome record (`manuscript`, `review`, or `declined`), which exists only so the offer does not repeat; it plays no role in activation.

Switching between `manuscript` and `review`, or turning either off, touches only whichever of those two records the switch actually goes through. No bible file, no `.studio/` state, and no gate, doctor, or status behavior changes as a result of an output style switch - the deterministic checks in `bin/ns-gate` and the other engines read chapter files and project state directly, never the active output style.

## What CI can and cannot verify here

Nothing today. Deterministic CI (Tier A) does not scan `output-styles/` at all - the plugin's check spine reads skills, subagents, commands, and MCP servers, and the two style files sit outside that scope, so no automated check currently confirms even a static fact like "both files carry `keep-coding-instructions: false`" or "neither carries `force-for-plugin`." Nor could Tier A ever assert the harder claim that matters more: that a live model response under an active style actually comes back as bullet-free prose or a verdict-first table. That is a claim about model behavior, not file content, and belongs to Tier B (model-integration, manual-dispatch, advisory-only CI) if it is ever built. A future Tier B eval - `evals/output-style-response-shape.eval.json`, shaped like the existing dispatch-accuracy evals under `evals/` and run by `scripts/run-evals.mjs` - would score a live drafting or gate-verdict response for the shape this page describes under each active style. It does not exist yet; this page is that future work's own citation.
