# ADR-0010: Tier B Trigger and Credential - Weekly Schedule on Subscription Authentication

**TL;DR:** Tier B (model-integration CI) now triggers on a weekly schedule plus manual dispatch, replacing the `workflow_dispatch`-only trigger that contradicted D-20 (two-tier CI)'s own "on main or nightly" design. The credential is `CLAUDE_CODE_OAUTH_TOKEN`, an OAuth token the maintainer mints with `claude setup-token` and sets as a repo secret, not an API key - subscription authentication, consistent with the self-sufficiency invariant. Both live steps' scripts (`scripts/run-integration.mjs`, `scripts/run-evals.mjs`) now share one credential decision (`scripts/lib/credential-mode.mjs`) that distinguishes three states: a credential present means live; no credential on an unattended CI runner means a **named green skip** (exit 0, naming the missing secret, since an unset secret on a repo the maintainer has not yet configured is expected, not broken); no credential on a developer machine means the existing local-CLI probe and dry-run fallback. This closes F-CI-02 (Tier B trigger contradicts D-20) and fixes a defect the kickoff plan for this wave did not know about: the prior probe asked only `claude --version`, which proves the binary exists, never that anyone is authenticated, so a keyless GitHub runner used to proceed into live mode and fail instead of skip. `run-evals.mjs` also gains a real failure condition: a dispatch-accuracy pass rate below 70% (`scripts/lib/dispatch-threshold.mjs`) now exits nonzero, so a genuinely broken dispatch table turns a scheduled or dispatched Tier B run red, per roadmap row 1.12. The posture this preserves: Tier B is advisory to merges (it has no `pull_request` trigger at all, so it cannot block one) and blocking to releases (a maintainer should not cut a tag off a run that failed or that only skipped).

- Status: Accepted
- Date: 2026-08-09
- Task: Wave 1 item 7 (release ceremony and Tier B weekly), roadmap row 1.12
- Decision: WEEKLY SCHEDULE PLUS MANUAL DISPATCH, on `CLAUDE_CODE_OAUTH_TOKEN` - `.github/workflows/tier-b.yml`'s `on:` block gains a `schedule` trigger (`37 14 * * 3`, chosen off the hour and off midnight UTC) alongside the existing `workflow_dispatch`; both live steps' `env:` block reads `secrets.CLAUDE_CODE_OAUTH_TOKEN` in place of the API-key secret it previously read
- Amends: D-20 (two-tier CI) - its "on main or nightly" trigger language is superseded by weekly plus manual dispatch; the credential and skip-versus-fail posture described here are new ground D-20 did not cover at all
- PA resolved: F-CI-02 (Tier B trigger contradicts D-20) closed; the "named green skip" design element of roadmap row 1.12, previously assumed already built, is built by this decision, not merely wired

---

## Context

D-20 (two-tier CI) established two CI tiers: Tier A, fully deterministic and keyless, gating every pull request; and Tier B, model-integration smoke and dispatch-accuracy testing, running "on main or nightly." The shipped `.github/workflows/tier-b.yml` never implemented that trigger. Its own header comments explained why: the push-to-main and nightly cron triggers were removed "so this workflow does not demand a credential GitHub does not yet have," leaving `workflow_dispatch` as the only trigger. That gap between the decision and the shipped file is F-CI-02 (Tier B trigger contradicts D-20).

The kickoff plan for this wave's roadmap row 1.12 described the fix as wiring up a "named green skip" design that it believed was already in place, needing only the trigger restored. Verifying the two scripts directly before making any change showed that assumption was false.

## The defect this closes: a probe that proves existence, not authentication

`scripts/run-integration.mjs`'s credential gate (prior to this task) read:

```js
function claudeCliUsable() {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 20000 });
  return !probe.error && probe.status === 0;
}

const hasApiKey = !!(process.env.ANTHROPIC_API_KEY);
const hasUsableCli = hasApiKey ? true : claudeCliUsable();
const forcedDryRun = !hasApiKey && !hasUsableCli && !dryRun;
```

`claude --version` succeeds whenever the binary is installed and runnable. It proves nothing about whether anyone is logged in. Tier B's own workflow installs that binary, via `npm install -g @anthropic-ai/claude-code`, in an "Install claude CLI" step that runs before either live step. So on a real, credential-less GitHub runner: the binary exists, `claudeCliUsable()` returns `true`, `forcedDryRun` evaluates to `false`, and the script proceeds into live mode - where it fails on ordinary model-call errors instead of skipping cleanly. The dry-run fallback this code appears to provide could never actually trigger in the one environment it was written for.

`scripts/run-evals.mjs` carried the identical `claude --version`-only probe, but a different outcome for the same situation: `process.exit(2)`, a hard operational error, rather than any fallback at all. The two Tier B scripts disagreed about what "no credential" means, which is the second half of what "wiring, not building" got wrong: there was no single design to wire in the first place.

Both defects were reproduced directly during this task's own verification, against the real scripts, before any code changed: driving each script's decision through a controlled environment (unattended-CI signals, with the local `claude` CLI made genuinely unreachable so no cost could be incurred) showed `run-integration.mjs` falling back to the misnamed dry-run path instead of naming the missing secret, and `run-evals.mjs` hard-exiting with `ERROR: no model access available`. An earlier, since-corrected version of that same verification also reproduced the ORIGINAL live-mode failure directly and unintentionally: leaving the local, genuinely-authenticated `claude` CLI reachable while simulating an unattended-CI, no-credential environment caused the pre-fix script to spend a small real amount (two haiku calls) proceeding into live mode exactly as described above, rather than skipping - concrete, first-hand confirmation of the defect this decision closes.

## Decision 1: trigger - weekly, not "on main or nightly"

D-20 (two-tier CI) called for Tier B on "main or nightly." This decision instead sets a weekly schedule plus the existing manual dispatch. Weekly, not nightly: nightly model-integration runs at roughly $1-1.50 of spend per run (this file's companion scripts document their own budget caps) have a materially different cost profile over a year than weekly ones, for a signal - dispatch-accuracy drift, model-integration breakage - that does not typically develop night to night. "On main," meaning a trigger on every push to the default branch, was also not adopted: it would run Tier B far more often than the weekly cadence intends and would couple an advisory-only tier to every commit's cadence rather than a fixed schedule. This is a locked user decision for this wave: weekly governs, and D-20's "nightly" language is superseded by it, recorded here rather than silently drifted from.

The chosen cron is `37 14 * * 3` - 14:37 UTC every Wednesday, roughly 7:37am US Pacific or 10:37am US Eastern. GitHub's own scheduling guidance is that runs queued for the top of the hour, and especially for midnight UTC, are the most heavily contended and the most likely to be delayed; `37 14` avoids both.

## Decision 2: credential - OAuth token, not an API key

The credential is `CLAUDE_CODE_OAUTH_TOKEN`, minted by the maintainer with `claude setup-token` and set as a repository secret with `gh secret set`. This is subscription authentication: the same mechanism a logged-in `claude` CLI session already uses locally, expressed as a token a GitHub runner (which has no interactive login of its own) can present non-interactively. `ANTHROPIC_API_KEY` continues to work if a caller happens to set it - the credential-decision function in `scripts/lib/credential-mode.mjs` checks it as a fallback - but it is no longer the documented path, is never required, and both live steps' workflow wiring now reads only the OAuth token secret.

This is not a stylistic preference. The plugin's central promise, stated in `scripts/check-self-sufficiency.mjs`'s own enforced invariant, is that Nonfiction Studio works entirely on a working Claude Code (or Cowork) login, with no additional API keys, accounts, or paid services. A CI credential that is itself an API key would make Tier B the one place that promise quietly did not hold. An OAuth token minted from the maintainer's own subscription keeps Tier B inside the same self-sufficiency boundary as everything else this plugin ships.

## Decision 3: the named green skip

The middle row of the credential decision - no credential set, `process.env.CI` truthy - is the deliverable this ADR exists to record. A GitHub Actions runner sets `CI=true` on every run and never has an interactive login; absence of both `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` there is decisive on its own; verifying anything further like consulting the freshly-installed `claude` binary would only reproduce the F-CI-02 defect. `scripts/lib/credential-mode.mjs` therefore returns a skip decision, keyed on `CI` truthiness alone, before the local-CLI probe is ever consulted - not merely written to eventually reach that outcome, but structurally unable to invoke the probe once the unattended-CI branch is taken.

The skip exits `0`, so a repository that has not yet had `CLAUDE_CODE_OAUTH_TOKEN` set stays green rather than red, and prints a reason naming the exact missing secret and stating plainly that this is expected configuration, not a failure. An unset secret is not a defect: the maintainer mints it on their own schedule, and the workflow that demands it has to stay usable, and legible about why it is doing nothing, in the meantime. This is why the skip is a deliberate design element and not merely "the absence of an error": a silent pass would look identical to a real success in the Actions UI, and a bare `process.exit(0)` with no explanation is what an earlier design's unnamed "skipped" state amounted to before this task.

The skip is also proven, directly, never to fire when a credential is present: `scripts/lib/credential-mode.mjs`'s three-state precedence checks `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` before it ever examines `CI`, so a credentialed run cannot reach the skip branch structurally, not merely by convention. An end-to-end test drives both real scripts with a credential present and the `claude` binary made genuinely unreachable, confirming the resulting failure still surfaces as a nonzero exit rather than being swallowed.

## Decision 4: posture - advisory to merges, blocking to releases

`.github/workflows/tier-b.yml` has never had a `pull_request` trigger and still does not; Tier B cannot block a merge because it never runs against one. It is, and remains, purely advisory with respect to pull requests. That is a different question from whether a Tier B failure should ever block anything at all, and roadmap row 1.12 answers it: a scheduled or manually dispatched Tier B run that fails - whether from a genuine model-integration break or from a dispatch-accuracy collapse - should block a release. This decision makes both facts true without contradiction: the trigger surface (never on pull requests) is what makes Tier B merge-advisory; the exit code (now genuinely nonzero on a real failure, including a dispatch-accuracy collapse) is what makes it release-blocking, once a maintainer treats "Tier B is green" as a release precondition. Nothing in this workflow enforces that precondition mechanically - there is no branch-protection rule requiring Tier B before a tag - so `RELEASE-NOTES.md`'s maintainer runbook states it as a manual step: do not cut a release on a Tier B run that failed, and do not cut one on skip evidence alone, since a skip proves nothing about whether the model-integration flow actually still works.

## Decision 5: the dispatch-accuracy threshold

Before this task, `scripts/run-evals.mjs` always exited `0` once every eval case had been graded, "whatever the pass rate," by explicit design: dispatch accuracy was advisory signal only. Roadmap row 1.12 requires that a deliberately broken dispatch table turn a live run red, which that design could never do. `scripts/lib/dispatch-threshold.mjs` now gates the exit code on `passedCases / totalCases >= 0.70`.

70% was chosen, not derived: grading uses a small model (haiku) against an intentionally loose match (does the response name the expected callee, not exact phrasing or output quality), so a healthy dispatch table is expected to produce occasional grading misses that are noise, not defects. Against the eval set's size at the time this was written - 34 cases across 16 files under `evals/`, counted directly from each file's `cases[]` array rather than assumed - a threshold of 70% tolerates roughly a third of cases missing before it fails the run, comfortably above what ordinary grading noise on a healthy table should produce, while still catching the kind of severe, multi-file breakage ("most of the dispatch table is now wrong") the roadmap language describes. A batch that grades zero cases (for example, every call failing operationally) also fails this gate rather than passing vacuously - `scripts/lib/dispatch-threshold.mjs` treats zero total cases as a failure, since a run that graded nothing is not evidence a dispatch table is healthy.

This exit code repurposes what used to be exit `2` ("operational error: no model access") in `scripts/run-evals.mjs`'s taxonomy. That old meaning no longer occurs: a missing credential now resolves to either the named skip (Decision 3) or an automatic dry-run fallback on a developer machine, never a hard error. The script's own header comment documents the repurposing explicitly, so a reader comparing behavior across versions is not misled by an unexplained code-meaning change.

## Consequences

- `.github/workflows/tier-b.yml` runs weekly and on manual dispatch, reads only `CLAUDE_CODE_OAUTH_TOKEN` for its two live steps, and its header comments describe the current three-state credential decision instead of the API-key-only world that preceded this task.
- `scripts/run-integration.mjs` and `scripts/run-evals.mjs` both call the shared `scripts/lib/credential-mode.mjs` decision, so the two scripts can no longer disagree about what "no credential" means.
- `scripts/run-evals.mjs` can now fail for a genuinely new reason (dispatch accuracy below threshold), which is why its header's exit taxonomy comment was rewritten rather than merely patched.
- `scripts/self-sufficiency-exceptions.json`'s entry for `.github/workflows/tier-b.yml` was removed, since the workflow no longer contains any literal `ANTHROPIC_API_KEY` reference to except; the two script entries were kept and their reasons updated to describe the credential as a legacy fallback rather than a CI-runner-preferred path.
- What is proven by local test, and what can only prove on a real scheduled or dispatched run: the credential decision's three states, the skip's exact wording, the dispatch-accuracy gate's arithmetic, and that a credentialed run's real failures still propagate are all proven locally, against the real scripts, without any live model call. What is NOT proven locally, and first proves on this workflow's first real execution: that `secrets.CLAUDE_CODE_OAUTH_TOKEN` resolves and authenticates the way this decision assumes, that a live run against the real API succeeds end to end once the secret is set, and that a genuinely broken dispatch table produces the expected red run in the real GitHub Actions environment rather than only in a local simulation of one.

## Files

- `.github/workflows/tier-b.yml` - trigger and credential wiring
- `.github/workflows/release.yml` - new tag-triggered release workflow (a separate concern from Tier B, sharing this ADR only for the release-blocking posture described in Decision 4)
- `scripts/lib/credential-mode.mjs` - the shared three-state decision
- `scripts/lib/dispatch-threshold.mjs` - the dispatch-accuracy gate
- `scripts/run-integration.mjs`, `scripts/run-evals.mjs` - both call the two modules above
- `scripts/self-sufficiency-exceptions.json` - updated to match
