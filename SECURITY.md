# Security Policy

Nonfiction Studio is a pre-1.0, solo-maintained open-source project. This page
explains what "security" means for a Claude Code plugin like this one, how to
report a problem privately, and what to expect when you do.

## Supported versions

Pre-1.0, only the latest release receives fixes. If you find a problem on an older
tag, please upgrade to the latest release and confirm the problem still
reproduces there before reporting it.

## Reporting a vulnerability

Please do not open a public GitHub issue for a security vulnerability.

Report it privately through GitHub's private vulnerability reporting: open
this repository's **Security** tab and choose **Report a vulnerability**.
That channel reaches the maintainer directly and stays private between you
and the maintainer unless a security advisory is later published for it.

If, for some reason, that form is unavailable to you, contact
[@jprisant](https://github.com/jprisant) on GitHub instead. There is no
public contact email for this project; all reports should go through one of
the two channels above.

### What to include

- What you did, step by step, and what you expected versus what happened.
- The plugin version (or commit) and the platform (Claude Code or Cowork)
  you were running.
- The smallest reproduction you can manage - ideally a scratch book project
  and the exact command, skill, or agent dispatch that triggers the issue.
- Why you believe it is a security issue rather than an ordinary bug (see
  Scope below) - a hook that fails silently is often working as designed;
  a guard that can be bypassed is not.

### What to expect

This is a solo-maintained project. Reports are handled on a best-effort
basis - there is no SLA and no guaranteed response time. You will get a
reply acknowledging the report, and, once a fix ships, credit in the
release notes if you would like it. Please give the maintainer reasonable
time to investigate and ship a fix before disclosing publicly.

## Scope: what counts as a security issue here

Nonfiction Studio has no server, no network service, and no account system
of its own. Its security surface is the guardrails its hooks enforce inside
a Claude Code session, on your own machine, over your own book project.
(Hook execution on Cowork is not yet verified; see
[ADR-0002 (Cowork hook execution)](docs/adr/ADR-0002-cowork-hook-execution.md).)
The identity resolution the guardrails below depend on is recorded
in [ADR-0007 (agent identity resolution)](docs/adr/ADR-0007-agent-identity-resolution.md),
and the settings-file precedence rules that interact with them are recorded
in [ADR-0013 (wave 1 exit surfaces)](docs/adr/ADR-0013-wave-1-exit-surfaces.md).

These guardrails are enforced by the hooks declared in `hooks/hooks.json`. The
[hooks reference](docs/reference/hooks.md) covers the dispatch-routing rule; the
others are described in the ADRs linked above and in each hook's header comment.
The guardrails in scope:

- **Book-root containment.** Inside a book project, every `Write`, `Edit`, and
  `NotebookEdit` call, including the main session's own, must land inside the
  book's root. The target is checked lexically and again after symlinks are
  resolved, and an unresolvable target is denied rather than allowed.
- **Write-scope containment.** A constrained agent may only write inside the
  path prefixes (`AGENT_WRITE_SCOPES` in
  `hooks/lib/agent-identity.mjs`, rationale in
  [ADR-0007 (agent identity resolution)](docs/adr/ADR-0007-agent-identity-resolution.md))
  declares for it - one row per constrained agent, prefixes taken from that
  agent's own definition - and every target is checked against its real,
  symlink-resolved path, not just its lexical one, so a symlink cannot carry
  a constrained agent's write outside its declared scope while looking
  in-scope.
- **The untrusted-fetch envelope.** Every `WebFetch` and `WebSearch` result
  is wrapped in an envelope - a preamble stating the content is data, not
  instructions, plus a per-fetch nonce fence a hostile payload cannot forge
  - before Claude sees it. The hook fails open: if wrapping itself errors,
  the original result passes through unwrapped.
- **The web research gate.** Only specific research-facing agents ship
  `WebFetch`/`WebSearch` at all, and even for those, live web access stays
  closed unless a book project's own config explicitly opens it.
- **Routing and chain checks at dispatch.** Which of this plugin's own
  agents may dispatch which other ones, and at what model tier, per
  `agents/_chain-permitted.yaml` and each agent's own frontmatter. This is
  warn-only by default; it denies a dispatch only when a project opts in with
  `routing_enforce: block`, and `routing_enforce: off` silences it.
- **The Stop gate.** The quality checks that decide whether a chapter may
  reach a terminal status.

A report is in scope when it shows: any write tool landing outside a book's
root from inside that book project (including via a symlink); a constrained
agent writing outside its declared prefixes (including via a symlink); a
web-gated agent reaching live web access without the project's gate being
open; content returned from a fetch escaping or forging the
untrusted-content envelope, or reliably forcing the wrap to fail so it
reaches Claude unwrapped; a settings value
that lets a structurally-coerced quality check (one this plugin deliberately
never allows to block on its own) actually block; or any guard above making
a decision for the wrong agent because identity was resolved incorrectly.

### What is out of scope, by design

- **Hooks fail open, not closed, for internal errors that are not the
  guard's own core decision.** A hook bug must never lock an author out of
  their own session or their own files. Concretely: malformed hook input and
  a missing or unparseable `agents/_chain-permitted.yaml` resolve to silence
  (no warning, no deny, and the action proceeds); snapshot and session-flag
  write errors are logged to `.studio/logs/errors.jsonl` and the write still
  proceeds; an unreadable or unparseable settings file produces a one-line
  warning and falls back to defaults. (The one internal read failure that
  does not fail open: a book project whose `.studio/config.json` is corrupt
  denies write tools, because containment cannot be verified.) This is
  intentional and is not itself a vulnerability. What *is* in scope is the
  guard's own core decision going the wrong way: for example, the web gate
  is written to deny on every ambiguous case (no project found, unreadable
  config, the setting simply absent) rather than default open, so an
  ambiguous case that instead lets a web-gated agent through is a real bug,
  not the intended fail-open path.
- **Unconstrained agents and the main session are unaffected by design.**
  An unnamespaced or generic subagent, and the main session itself, are
  never subject to this plugin's write-scope or web-gate constraints; that
  is a scoping decision (see ADR-0007, agent identity resolution), not a gap.
- **No prompt-injection content scanner.** An earlier detector aimed at
  flagging instruction-override phrasing inside fetched content was built,
  adversarially tested, and deliberately removed - it false-positived on
  ordinary developer documentation and could not reliably tell an
  instruction addressed to an assistant from the same words describing one
  to a human reader. The envelope's unconditional wrap-and-fence is the
  actual, and only, defense here; a report that fetched content is not
  being scanned for injection phrasing is expected behavior, not a bug.
- **Settings are an author dial, not a bypass.** Book-root containment, the
  write-scope guard, the web gate, and the untrusted-fetch envelope have no
  settings key at all - nothing in `.claude/nonfiction-studio.local.md` can
  turn any of them off. The dispatch-routing checks (`routing_enforce`) and
  the Stop gate's overall mode (`gate_mode`) are author-facing dials by
  design, so a report that settings can relax or turn those off is not a
  vulnerability. The invariant that does hold: settings can raise the gate's
  strictness but can never make a structurally-coerced judgment check block.
  A report showing a settings value turning off one of the key-less guards,
  or making a coerced check block, is in scope.

## Data handling

Nonfiction Studio does not send your manuscript, research, or project state
anywhere beyond your own Claude session. See
[docs/privacy.md](docs/privacy.md) for what gets stored locally, where, and
how to clear it.
