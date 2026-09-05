---
# nonfiction-studio.local.md -- per-project studio settings (schema v1)
#
# Copy this file to .claude/nonfiction-studio.local.md in your book project (the directory
# containing .studio/, or any of its ancestors -- the studio walks UP from wherever a session
# starts, the same way it locates the book root itself, and uses the first one it finds).
# Everything under the "---" fences below is YAML; everything after the closing "---" is your
# own Markdown -- the studio never reads or interprets it beyond surfacing a one-line pointer at
# session start telling Claude to read and honor it.
#
# This file is optional. Absent, it changes nothing -- every key below has a default already in
# effect. A corrupt or unreadable file never breaks a session (hooks fail open): it is ignored,
# with a one-sentence warning naming the file printed to stderr, and every default still applies.
# Delete any key you do not want to set; unknown keys are preserved but otherwise ignored, so this
# file stays forward-compatible with schema additions in a later release.

# gate_mode: off | warn | block
# Overrides .studio/config.json's top-level gate.mode for THIS project only. Use "block" to make
# the Stop gate actually fail a session on a check that is already configured to block (rather
# than being capped to a warning), "warn" to report everything without ever blocking, or "off" to
# silence the gate's own summary entirely. Leave commented out to use whatever config.json says
# (its own default is "warn").
# gate_mode: warn

# thresholds: an object, shallow-merged OVER .studio/config.json's own "thresholds" object.
# Each key you set here overrides the same key in config.json; every key you do NOT set here
# passes through from config.json unchanged. Use this for a per-project tuning that should live
# with you locally rather than in the shared, version-controlled config.json.
# thresholds:
#   overlap_min_words: 20

# routing_enforce: off | warn | block
# Controls how strictly the studio enforces agent-dispatch routing rules (model-tier mismatches,
# undeclared chain edges) at PreToolUse time. "warn" reports a mismatch without stopping anything
# (the default when this key is absent); "block" denies the dispatch outright; "off" silences the
# check. Consumed by the PreToolUse dispatch guard.
# routing_enforce: warn

# output_style: a plain string recording which output style you have accepted, if any
# ("manuscript", "review", or "declined"). This is a RECORD of the nfs-new-book offer outcome, not
# an activation switch -- the style itself is activated through Claude Code's own "outputStyle"
# setting. You normally never edit this by hand; the nfs-new-book flow writes it once, on your
# explicit consent, so the offer is not repeated on a later session.
# output_style: manuscript
---

## House notes

Anything you write below the closing "---" fence is a standing instruction Claude reads at the
start of every session in this project (SessionStart prints a one-line pointer back to this file
whenever this section is non-empty, so Claude knows to come read it). Use it for author-specific
conventions the shared, version-controlled bible files should not carry -- for example:

- Always spell out numbers under one hundred; never use "over 100" style prose numerals.
- Cite page numbers, not chapter numbers, when quoting the comp titles.
- Prefer " - " (space hyphen space) to an em-dash in body prose.

Delete this section (or the whole file) at any time; its absence is silent and changes nothing.
