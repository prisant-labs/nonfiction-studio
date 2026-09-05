---
name: nfs-new-book
user-invocable: true
argument-hint: "[book title] [guided|blank]"
description: "Scaffolds the flat bible tree (context/, structure/, chapters/, research/, production/) and creates .studio/ state files for a new nonfiction book project. Use when an author starts a new book or follows the studio Path 1 prompt."
when_to_use: "Use when the author explicitly wants to initialize, start, or set up a new book project, says 'create a new book', or is routed here from the studio dispatcher Path 1 prompt. Do not invoke for authors with an existing book project layout (.studio/ or context/brief.md) unless they explicitly ask to re-initialize only the missing pieces."
---

This skill scaffolds a new nonfiction book project. It is surface-independent: no hooks or subagents are needed.

Skill inputs read:
- `templates/book-scaffold/` (scaffold tree)
- `templates/project-init.guided.md` (guided setup template)
- `templates/project-init.blank.md` (blank setup template)
- `templates/config-defaults.json` (config defaults)
- `.claude-plugin/plugin.json` (plugin version, read at Step 6, never hardcoded)
- `.claude/nonfiction-studio.local.md` (Step 7's own gate check and outcome record; the project's optional studio settings file)
- `templates/nonfiction-studio.local.example.md` (Step 7 stamp source when the studio settings file does not yet exist)
- `.claude/settings.local.json` (Step 7, read before a consented merge-write of the `outputStyle` key)
- `.claude/skills/book-context/SKILL.md` (Step 7a's own gate check: does the generated skill already exist)
- `context/brief.md`, `context/style-profile.md`, `structure/outline.md` (Step 7a content-assembly sources)
- `bin/ns-claims` (Step 7a, invoked via the Bash tool for the open-claims count)

## Step 1 - Run the existence check (mandatory first tool call)

Use the Bash tool to run:
```
if [ -d .studio ] || [ -f context/brief.md ]; then echo REINIT; else echo NEWINIT; fi
```

The output will be exactly one of two values:
- `REINIT` - this directory already contains a book project
- `NEWINIT` - no book project found yet

### Step 1a - If the output is REINIT

Use the Bash tool to enumerate every expected scaffold path against what is present on disk:

```bash
for f in \
  context/brief.md context/audience.md context/style-profile.md \
  context/decisions.md context/project-init.md \
  structure/thesis.md structure/outline.md structure/comps.md \
  chapters/.gitkeep \
  research/evidence-log.md research/sources.md research/open-questions.md \
  production/exports/.gitkeep production/README.md \
  production/front-matter.md production/back-matter.md \
  .studio/meta.json .studio/config.json .studio/progress.json \
  .studio/progress.schema.json .studio/ai-use-log.jsonl \
  .studio/snapshots/.gitkeep .studio/gate/.gitkeep .studio/logs/.gitkeep; do
  [ -e "$f" ] || printf "MISSING: %s\n" "$f"
done
printf "SCAN_DONE\n"
```

**If the output is only `SCAN_DONE` (no MISSING lines):** Output this verbatim. Do not stamp, read, or write any bible or `.studio/` file in this branch:

> Warning: This directory already contains a book project. All 24 expected scaffold files are present. No bible or `.studio/` files were written. Run /nonfiction-studio:nfs-interview to continue setting up your project.

Then run the output style offer (Step 7) followed by the book-context skill generation step (Step 7a); this REINIT run stops after Step 7a. This is the one reachable path for a legitimate re-offer against a fully-scaffolded existing project: Step 7 self-gates on an already-recorded `output_style` value and on non-interactive context, and Step 7a self-gates on the generated skill file's existence, so either adds a write here only when its own outcome has never been recorded for this project and the author actually consents or declines in this interaction.

**If the output contains one or more `MISSING:` lines:** The lines name the paths not yet on disk. Report the exact delta:

> Warning: This directory already contains a book project. The following scaffold files are missing: [list each MISSING path from the tool output, one per line]. Re-stamping only the missing files.

Then:
- **Non-interactive context (headless -p session):** State "Proceeding automatically in non-interactive context." Then resolve the plugin root (Step 4, plugin root resolution), stamp the missing files (Step 5, scaffold stamping), and fill state placeholders (Step 6, state files) below, but write ONLY the paths that appeared in the MISSING list. Do not read or write any other file. For `context/project-init.md` if it is in the missing list, use blank mode. After writing, report which files were stamped, then run the output style offer (Step 7 - its own non-interactive branch applies here, since this whole branch is non-interactive) followed by the book-context skill generation step (Step 7a - also non-interactive here, so it skips the same way), and STOP.
- **Interactive context:** Ask "May I stamp only these missing files? (yes/no)" and wait for author confirmation before writing anything. On confirmation, resolve the plugin root (Step 4, plugin root resolution), confirm the working directory if Step 4b applies, stamp the missing files (Step 5, scaffold stamping), and fill state placeholders (Step 6, state files), writing ONLY the missing paths. After writing, report which files were stamped, then run the output style offer (Step 7 - this is the reachable path for a legitimate re-offer on a REINIT run whose earlier offer outcome was never recorded) followed by the book-context skill generation step (Step 7a - the same reachable-path logic applies to it), and STOP.

**Note on .studio/meta.json:** If .studio/meta.json is in the missing list, first acquire the book title (from the argument, or by asking the author; in non-interactive contexts reuse the title recorded in context/brief.md if present, otherwise report that the title is required) before filling its placeholders.

### Step 1b - If the output is NEWINIT

Continue with Steps 2-7 below.

---

## Step 2 - Resolve the book title

Use the title provided in the author's message. If no title is present in the message, ask: "What is the title of this book?"

## Step 3 - Resolve the mode

Check whether the author's message contains the word "guided" or "blank".

- If "guided" is present: use guided mode. Template source: `PLUGIN_ROOT/templates/project-init.guided.md`.
- If "blank" is present: use blank mode. Template source: `PLUGIN_ROOT/templates/project-init.blank.md`.
- If neither is present AND this is an interactive session: ask "Guided setup (walkthrough with explanations) or blank (fast scaffold with no explanations)?" and wait for the answer.
- If neither is present AND this is a non-interactive session (headless -p): use blank mode and state: "No mode argument supplied; defaulting to blank mode in non-interactive context."

## Step 4 - Find the plugin root

Use the Bash tool to run the primary lookup:
```
node -e "const s=require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8');const m=JSON.parse(s).extraKnownMarketplaces;const ns=m&&m['nonfiction-studio'];console.log(ns&&ns.source&&ns.source.path||'not-found')"
```

The output is PLUGIN_ROOT. If it prints `not-found`, run the platform cache fallback:
```
find "$HOME/.claude/plugins/cache" -maxdepth 3 -type d -name "nonfiction-studio*" 2>/dev/null | head -1
```

If that also returns nothing, run the dev-mode fallback (current working repo checkout):
```
test -d templates/book-scaffold && pwd || echo not-found
```

If all three lookups fail: halt immediately. Report the settings.json path attempted (`$HOME/.claude/settings.json`) and the cache path attempted (`$HOME/.claude/plugins/cache`). Do not write any files. Ask the author how to proceed (verify plugin installation or provide the path manually).

Once PLUGIN_ROOT is resolved, verify it is correct:
```
test -f "PLUGIN_ROOT/templates/book-scaffold/context/brief.md" && echo OK || echo TEMPLATE_NOT_FOUND
```

If the output is `TEMPLATE_NOT_FOUND`: halt. Report the exact path that was not readable and ask the author to verify the plugin installation. Do not write any files.

### Step 4b - Confirm the working directory (uncertain surface only)

This is the S-06 chat safeguard: on chat, no hooks or `bin/` are available and the author has less visibility into where files land than on CLI or Cowork, where the terminal or workspace already makes the working directory unambiguous. Skip this step silently and continue to Step 5 when either applies:

- PLUGIN_ROOT above resolved via the primary settings.json lookup or the platform cache fallback (the normal installed-plugin path on CLI and Cowork), and the working directory is not otherwise in doubt.
- This is a non-interactive session (headless `-p`): there is no author present to answer, so proceed the same as the rest of this skill does in non-interactive mode.

Otherwise, confirm before writing. This covers both signals named in the S-06 requirement: PLUGIN_ROOT resolved only via the dev-mode fallback (the third lookup, `test -d templates/book-scaffold && pwd`), which means no settings.json entry or plugins cache match was found and hooks and `bin/` are typically unavailable in that same session; or the working directory is not otherwise confirmed by any completed tool call. State the absolute directory about to receive the new book tree (the path the dev-mode fallback already returned, or the result of running `pwd` via the Bash tool if that path is not yet known) and ask: "This will create the new book project in `<path>`. Shall I proceed? (yes/no)" Wait for an explicit "yes" before continuing to Step 5. Any other answer, or inability to confirm a path at all, halts here; no files are written.

## Step 5 - Stamp the flat bible tree

For each mapping below: use the Read tool on the source path, then the Write tool for the destination (relative to the current working directory).

Token substitutions for prose files:
- Replace `{{DATE}}` with today's date in YYYY-MM-DD format (calendar date, not timestamp).

**context/**
- `PLUGIN_ROOT/templates/book-scaffold/context/brief.md` -> `context/brief.md`
- `PLUGIN_ROOT/templates/book-scaffold/context/audience.md` -> `context/audience.md`
- `PLUGIN_ROOT/templates/book-scaffold/context/style-profile.md` -> `context/style-profile.md`
- `PLUGIN_ROOT/templates/book-scaffold/context/decisions.md` -> `context/decisions.md`
- Template from Step 3 (`project-init.guided.md` or `project-init.blank.md`) -> `context/project-init.md` (write verbatim; no token substitution)

**structure/**
- `PLUGIN_ROOT/templates/book-scaffold/structure/thesis.md` -> `structure/thesis.md`
- `PLUGIN_ROOT/templates/book-scaffold/structure/outline.md` -> `structure/outline.md`
- `PLUGIN_ROOT/templates/book-scaffold/structure/comps.md` -> `structure/comps.md`

**chapters/**
- Write an empty file to `chapters/.gitkeep`

**research/**
- `PLUGIN_ROOT/templates/book-scaffold/research/evidence-log.md` -> `research/evidence-log.md` (replace `{{DATE}}` with YYYY-MM-DD)
- `PLUGIN_ROOT/templates/book-scaffold/research/sources.md` -> `research/sources.md`
- `PLUGIN_ROOT/templates/book-scaffold/research/open-questions.md` -> `research/open-questions.md`

**production/**
- Write an empty file to `production/exports/.gitkeep`
- `PLUGIN_ROOT/templates/book-scaffold/production/README.md` -> `production/README.md`
- `PLUGIN_ROOT/templates/book-scaffold/production/front-matter.md` -> `production/front-matter.md`
- `PLUGIN_ROOT/templates/book-scaffold/production/back-matter.md` -> `production/back-matter.md`

On any Read or Write error: stop immediately. Name the exact path that failed and the operation attempted (Read or Write). Do not stamp any additional files.

## Step 6 - Write .studio/ state files

Create `.studio/` at the bible root alongside `context/` and `chapters/`.

Token substitutions for state files:
- Replace `{{DATETIME}}` with the current UTC date-time in RFC 3339 format (example: `2026-07-18T14:22:07Z`). This is a full timestamp, not a calendar date.
- Replace `{{BOOK_TITLE}}` with the title from Step 2.
- Replace `{{PLUGIN_VERSION}}` with the `version` field read from `PLUGIN_ROOT/.claude-plugin/plugin.json` (PLUGIN_ROOT was already resolved in Step 4). Read the file and use its current value; never write a version number from memory or from an earlier run.

**`.studio/meta.json`** - write with all placeholders filled:
```json
{
  "schema_version": "2",
  "created": "<RFC 3339 UTC timestamp>",
  "plugin_version_at_creation": "<version field read from PLUGIN_ROOT/.claude-plugin/plugin.json>",
  "book_title": "<title from Step 2>"
}
```
Note: `created` uses `{{DATETIME}}` (RFC 3339 UTC), not `{{DATE}}` (YYYY-MM-DD). Do not write a calendar date here.

**`.studio/config.json`**: read `PLUGIN_ROOT/templates/config-defaults.json`, write verbatim.

**`.studio/progress.json`**:
```json
{
  "version": 2,
  "updated": "<RFC 3339 UTC timestamp>",
  "chapters": [],
  "totals": {
    "word_count": 0,
    "open_claim_count": 0,
    "chapters_final": 0,
    "chapters_total": 0
  }
}
```
Note: `updated` uses `{{DATETIME}}` (RFC 3339 UTC), not `{{DATE}}` (YYYY-MM-DD).

**`.studio/progress.schema.json`**: read `PLUGIN_ROOT/templates/book-scaffold/.studio/progress.schema.json`, write verbatim.

**`.studio/ai-use-log.jsonl`**: write as an empty file.

**Empty directory sentinels** (write empty files):
- `.studio/snapshots/.gitkeep`
- `.studio/gate/.gitkeep`
- `.studio/logs/.gitkeep`

On any Read or Write error: stop immediately. Name the exact path that failed and the operation attempted. Do not write any additional state files.

## Step 7 - Output style offer (once per project)

Nonfiction Studio ships two optional output styles as plugin components: `manuscript` (prose-first drafting responses - no unrequested bullet summaries, no code fences around manuscript prose, quoted passages instead of diffs for line edits, claim-marker discipline preserved throughout) and `review` (terse, verdict-first, tabular responses for gate and status work). This offer presents them once per project. It never activates a style without an explicit answer, and it never re-asks once an outcome has actually been recorded.

**Where this step returns.** Step 7 is reachable two ways: from Step 6 below, on a fresh NEWINIT run, and from Step 1a above, on a REINIT run (both the SCAN_DONE sub-branch and the MISSING-files sub-branch). Every branch below ends with "Continue to Step 7a" - unconditionally, regardless of which origin reached this step. Step 7a (book-context skill generation) is where the NEWINIT-versus-REINIT distinction is actually decided: it continues to Step 8's closing report only on the NEWINIT origin, and stops on the REINIT origin, since Step 8's "Book project has been initialized" report must never print for a REINIT run (no fresh initialization happened) and Step 1a's own warning has already reported that invocation's outcome.

**Non-interactive context (headless `-p` session).** There is nobody present to answer a three-way choice, and a style is never activated by assumption. State: "Skipping the output style offer in this non-interactive session; no output style was set. Run `/nonfiction-studio:nfs-new-book` again from an interactive session to see the offer, or set a style directly with `/config`." Do not read or write any file for this step. Continue to Step 7a.

**Gate check (chat and interactive CLI/Cowork alike - both branches below share this precondition).** Use the Bash tool to check whether the studio settings file already exists:
```
test -f .claude/nonfiction-studio.local.md && echo HAS_SETTINGS || echo NO_SETTINGS
```
- `HAS_SETTINGS`: use the Read tool on `.claude/nonfiction-studio.local.md` and parse its YAML frontmatter (the same fenced-block shape `hooks/lib/settings.mjs` reads; this step never assumes the file is well-formed). If an `output_style` key is present with any value (`manuscript`, `review`, or `declined`), the offer has already run for this project on ANY surface: state that fact, naming the recorded value, make no further reads or writes for this step, and continue to Step 7a - this is what makes the offer fire once per project regardless of which surface later runs `nfs-new-book` again. If the frontmatter fails to parse (malformed YAML, or no fenced block at all), treat this the same as no `output_style` key set - continue below - but skip the Edit-tool path in "Recording the outcome" below when the moment comes; instead name the parse problem to the author and ask before touching the file at all.
- `NO_SETTINGS`, or `HAS_SETTINGS` with no `output_style` key set: no outcome is recorded yet for this project. Continue to the surface-specific branch below.

**Chat surface.** Chat has no reliable path to activate a project-scoped `outputStyle` setting the way CLI and Cowork do (the same working-directory concern Step 4b already guards against for chat), so this offer never attempts the `.claude/settings.local.json` write on chat. State: "Nonfiction Studio ships two optional output styles, `manuscript` and `review`. On chat, activate one yourself with `/config` (Output Styles) rather than through this offer. I will record `output_style: declined` in `.claude/nonfiction-studio.local.md` so this offer does not repeat, since no style was actually activated." Then follow the "Recording the outcome" procedure below with `output_style: declined` - this is the one branch where a decline is recorded without the author having been asked to choose. Continue to Step 7a.

**Interactive CLI or Cowork session.** Present the offer, stating exactly what each answer does before asking - byte-parallel to the doctor's `install-statusline` consent language (`skills/nfs-doctor/SKILL.md`, "state exactly what will be written, and ask"):

> Nonfiction Studio ships two optional output styles:
> - `manuscript` - prose-first drafting responses: no unrequested bullet summaries, no code fences around manuscript prose, quoted passages instead of diffs for line edits, claim-marker discipline preserved throughout.
> - `review` - terse, verdict-first, tabular responses for gate and status work.
>
> Activating one changes how Claude's replies are shaped in this project; it changes nothing else on disk. Saying yes to one writes `{"outputStyle": "nonfiction-studio:Manuscript"}` (or `{"outputStyle": "nonfiction-studio:Review"}`) into `.claude/settings.local.json` - created if absent, merged preserving every other key if present. Saying no records `output_style: declined` in `.claude/nonfiction-studio.local.md` instead, so this offer does not repeat.
>
> Would you like to activate `manuscript`, `review`, or no thanks? (You can always change this later with `/config`.)

Wait for an explicit answer: `manuscript`, `review`, or a decline (a "no," "no thanks," "neither," or any similarly explicit refusal). Any other reply is not an answer - ask again rather than guessing.

**On `manuscript` or `review` (consent):**

Compose the exact namespaced value from the plugin manifest name and the chosen style's frontmatter `name` - `nonfiction-studio:Manuscript` or `nonfiction-studio:Review` - per the platform's plugin output-style activation contract: a bare style name (the frontmatter `name` alone, or the filename) silently fails to activate with no error, and only the namespaced `plugin-name:<frontmatter name>` form works.

Use the Read tool on `.claude/settings.local.json`:
- **Does not exist:** treat the existing object as `{}`.
- **Exists and parses as JSON:** hold the parsed object.
- **Exists but does not parse as JSON:** halt this step. State: "`.claude/settings.local.json` exists but is not valid JSON, so I cannot safely merge into it without risking the rest of your settings. Please fix or back up that file and re-run `/nonfiction-studio:nfs-new-book`, or activate the style yourself with `/config`." Write nothing for either file - since no outcome was actually recorded, the offer remains open for a later run. Continue to Step 7a.

On a parseable object: merge `{"outputStyle": "<the namespaced value>"}` at the top level - a shallow merge, so every other existing key is preserved unchanged. Use the Write tool to write the merged object back to `.claude/settings.local.json` as formatted JSON. Note for the author before writing: the Write tool shows its own permission prompt for this file, same as any file write; this skill does not suppress or work around it, and a denial there is a real refusal (see "an author refuses a file write" in Failure behavior below).

Then follow the "Recording the outcome" procedure below with `output_style: manuscript` or `output_style: review`, matching the activated style. After both writes succeed, report: "`.claude/settings.local.json` now activates the `<style>` output style (`nonfiction-studio:<Name>`). It takes effect at the start of your next Claude Code session." Continue to Step 7a.

**On decline:** follow the "Recording the outcome" procedure below with `output_style: declined`. Continue to Step 7a.

**Recording the outcome (studio settings file).** This procedure writes exactly one thing - the `output_style` key in `.claude/nonfiction-studio.local.md` - never anything else in that file, and never touches the body content below its frontmatter fence.

- `HAS_SETTINGS` (the file already exists, confirmed with no `output_style` key set, above): use the Edit tool to add `output_style: <value>` to the existing YAML frontmatter block, leaving every other key and the body untouched.
- `NO_SETTINGS` (the file does not exist): if PLUGIN_ROOT was not already resolved earlier in this run (this is the case on the SCAN_DONE sub-branch of Step 1a, which reaches Step 7 without ever running Step 4), perform Step 4's plugin-root resolution now. Use the Read tool on `PLUGIN_ROOT/templates/nonfiction-studio.local.example.md`, then use the Write tool to create `.claude/nonfiction-studio.local.md` from that template's content with only the `output_style` example line uncommented and set to `<value>`; every other commented-out example key is left exactly as the template ships it. This file creation was already disclosed, in the same interaction, by whichever branch above led here (the chat redirect message, or the "Saying no records..." / "Saying yes to one writes..." sentences of the interactive offer) - no separate prompt is asked here.

The Write or Edit tool's own permission prompt still applies to this write, same as any file write. If it is denied, no outcome is recorded: state plainly that no output style outcome was recorded, and that this offer will run again the next time `/nonfiction-studio:nfs-new-book` runs against this project.

## Step 7a - Book-context skill generation (once per project)

This step writes an opt-out-able, project-committed `book-context` skill: a small quick-reference (thesis, top style rules, chapter map, open-claims count) generated from the project bible, so a future session can orient without re-reading the whole bible by hand. It writes into the AUTHOR's project tree (`.claude/skills/book-context/SKILL.md`, relative to the current working directory), never into this plugin's own installation. It never activates without an explicit yes, and it never re-offers once the file actually exists.

**Where this step returns.** Step 7a is reachable two ways, immediately after Step 7 concludes: on a fresh NEWINIT run (Step 7 was itself reached from Step 6), and on a REINIT run (Step 7 was itself reached from Step 1a, either the SCAN_DONE sub-branch or the MISSING-files sub-branch). Every branch below ends with "Continue to Step 8" - that instruction applies ONLY on the NEWINIT origin. On the REINIT origin, STOP here instead, whichever branch below concluded: Step 1a's own warning already reported this invocation's outcome, and Step 8's "Book project has been initialized" report must never print for a REINIT run, since no fresh initialization happened.

**Gate check (once per project).** Use the Bash tool to check whether the generated skill already exists:
```
test -f .claude/skills/book-context/SKILL.md && echo HAS_SKILL || echo NO_SKILL
```
- `HAS_SKILL`: a book-context skill already exists for this project. State that fact, naming the path. Make no further reads or writes for this step. Continue per the origin rule above.
- `NO_SKILL`: continue to the surface-specific branch below.

**Non-interactive context (headless `-p` session).** There is nobody present to consent, and committing content into the project tree is never done by assumption. State: "Skipping the book-context skill generation in this non-interactive session; no skill was generated. Run `/nonfiction-studio:nfs-new-book` again from an interactive session to be asked." Do not read or write any file for this step. Continue per the origin rule above.

**Interactive context.** Ask the consent question, stating plainly what a yes commits and when it becomes usable:

> Generate a book-context skill? It commits thesis and style content into your project tree, at `.claude/skills/book-context/SKILL.md`. It becomes usable starting your next Claude Code session, not this one - a skill file written during a session is not available until the session restarts or resumes, a Claude Code platform behavior. (yes/no)

Wait for an explicit `yes` or `no`. Any other reply is not an answer - ask again rather than guessing.

**On `no` (decline):** state "No book-context skill was generated. Nothing was written to `.claude/skills/`." Write nothing. Continue per the origin rule above.

**On `yes` (consent):** assemble the four items below, each citing the source path it was read from, then write the skill file.

1. **Book title.** On the NEWINIT origin, use the title resolved in Step 2. On the REINIT origin (Step 2 never ran), read `book_title` from `.studio/meta.json`; if that file is unreadable or the field is absent, ask the author for the title.
2. **Thesis one-liner.** Use the Read tool on `context/brief.md`. Extract the first non-empty, non-heading, non-comment line under the `## 2. Thesis` heading (the same extraction rule `hooks/lib/orientation.mjs` uses for the SessionStart orientation block). If the heading is missing, the section is empty, or it holds only a `<!-- DRAFT: 2 - thesis -->` placeholder comment, write "Not yet recorded - run `nfs-interview`." Cite the source as `context/brief.md`.
3. **Top style rules.** Use the Read tool on `context/style-profile.md`. Extract up to three bullet lines (`- `) from the `## Do` and `## Do not` sections, in document order (the same rule `hooks/lib/orientation.mjs` uses). If none are found (an unfilled style profile), write "Not yet captured - run `nfs-capture-voice`." Cite the source as `context/style-profile.md`.
4. **Chapter map.** Use the Read tool on `structure/outline.md`. Extract every `### Chapter N: Title` heading line, in document order. If none are found, write "Not yet outlined - run `nfs-outline`." Cite the source as `structure/outline.md`.
5. **Open-claims count.** PLUGIN_ROOT is needed here too; resolve it now if it was not already resolved earlier in this run, the same fallback Step 7's "Recording the outcome" procedure uses. Then use the Bash tool to run `node "PLUGIN_ROOT/bin/ns-claims" --all --json`. Read `totalMarkers` and `resolvedCount` from the JSON; the open-claims count is `totalMarkers - resolvedCount`. Exit 0 (full coverage) and exit 1 (some markers unresolved) both carry valid data - read the JSON either way, do not treat exit 1 as a failure. Only exit 2 (no evidence log, no chapters directory, or an argument error) is a real failure: in that case write "Open claims: not yet countable (no evidence log or chapters yet)." Cite the source as `bin/ns-claims`.

Write the skill file with the Write tool:

`.claude/skills/book-context/SKILL.md`:
```
---
name: book-context
user-invocable: true
description: "Quick-reference for '<book title>': thesis, style rules, chapter map, and open-claims count, assembled from the project bible."
---

# Book context: <book title>

Generated once, on <today's date, YYYY-MM-DD>, from the project bible. It does not update automatically as the bible changes; delete this file and re-run `/nonfiction-studio:nfs-new-book` to regenerate it.

## Thesis
<thesis one-liner, or the not-yet-recorded note>
Source: `context/brief.md`

## Style rules
<up to three bullet lines, or the not-yet-captured note>
Source: `context/style-profile.md`

## Chapter map
<chapter heading list, or the not-yet-outlined note>
Source: `structure/outline.md`

## Open claims
<count, or the not-yet-countable note>
Source: `bin/ns-claims`
```

After writing, report: "`.claude/skills/book-context/SKILL.md` has been generated. It becomes usable starting your next Claude Code session, not this one." Continue per the origin rule above.

**Failure behavior (Step 7a).** On any Read or Write error while assembling or writing the skill file, stop immediately, name the exact path and operation that failed, and do not write a partial skill file. A denied Write-tool permission prompt is the same as a decline: no outcome is recorded, and a later `nfs-new-book` run against this project finds the file still absent and legitimately re-offers.

## Step 8 - Report success

List all files created. Output:

> Book project '{title}' has been initialized. The bible tree and .studio/ state files are ready.

Then: "The next step is nfs-interview. Invoke it with `/nonfiction-studio:nfs-interview` to conduct the structured intake interview and build your project brief. The interview typically takes 45-90 minutes and produces a confirmed context/brief.md."

---

## Failure behavior

- **Plugin root unresolved.** If all three lookups in Step 4 fail, halt before writing any file. Report the settings.json path attempted and the cache path attempted. Ask the author how to proceed (verify plugin installation or provide the path manually).
- **Working directory not confirmed (Step 4b).** If the author does not answer yes, or no path can be confirmed at all, halt before Step 5. No files are written.
- **Read or write error.** On any file operation failure, stop immediately. Name the exact path and operation that failed. Never continue stamping remaining files after a failure.
- **Missing template.** If a template file is not readable after PLUGIN_ROOT is confirmed, halt. Name the exact template path and ask the author to verify the plugin installation.
- **Output style offer: `.claude/settings.local.json` is not valid JSON (Step 7).** Halt that step only; write nothing. The offer's outcome is not recorded, so it remains open for a later run. Continue to Step 7a regardless.
- **Output style offer: an author refuses a file write (Step 7).** Whether the refusal is a declined conversational answer or a denied Write/Edit tool permission prompt, no `output_style` outcome is recorded in that case. A later `/nonfiction-studio:nfs-new-book` run against this project - including a REINIT run - finds no recorded value and legitimately re-offers the styles.
