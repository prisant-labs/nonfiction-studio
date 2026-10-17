# ADR-0018: The Tier B Eval Harness Loads the Plugin, Grades Chain Evals Only, and Isolates Every Call

**TL;DR:** `scripts/run-evals.mjs` now asks its questions of a session that has this plugin loaded, and of nothing else. Each call runs from an empty temporary folder, loads the plugin with `--plugin-dir`, and turns off user settings, every hook and every `CLAUDE.md`. Only the 18 chain cases count toward dispatch accuracy. The 16 hook cases stay under `evals/`, where the G3 conformance rule needs them, but no model dispatches a hook, so none of them is graded. The grader reads the component name at the start of the `DISPATCH:` line and ignores reasoning after it, but still fails a hedge between two names. The per-call timeout is 180 seconds with one retry on timeout. The threshold stays at 70% and the budget cap falls to $0.50. Both rest on three live runs, recorded below.

- Status: Accepted. On 2026-10-14 the maintainer asked for the fixes that issue #5 proposes. This record fixes the details that the issue left open and adds the isolation that the live runs showed was missing.
- Date: 2026-10-14
- Related: [ADR-0010 (Tier B trigger and credential)](ADR-0010-tier-b-trigger-and-credential.md) still governs who runs Tier B, how it authenticates, and the skip-versus-fail contract. This record supersedes the case counts and the threshold rationale in its Decision 5. [Issue #5 (the Tier B eval harness measures guessing, not dispatch)](https://github.com/prisant-labs/nonfiction-studio/issues/5) tracks the work.
- Decision: LOAD THE PLUGIN AND NOTHING ELSE; GRADE CHAIN EVALS ONLY; READ THE LEADING NAME AND FAIL A HEDGE; 180-SECOND TIMEOUT WITH ONE RETRY ON TIMEOUT; KEEP 70%; CAP THE BUDGET AT $0.50.

---

## Context

Tier B's eval step asks haiku which component a situation would dispatch, and grades the reply. It finished red on both live runs before this record: 16 of 34 cases on the 2026-09-23 GitHub run, and 11 of 34 on the 2026-10-13 local run. Issue #5 named four causes, and the second run added two.

1. **The plugin was never loaded.** The model had to name a component it had never been shown.
2. **The hook evals asked a question no model answers.** Claude Code fires a hook when its event happens; no model dispatches one. All 16 hook cases scored 0 of 16 on the second run, because the prompt asked for the "hook handler" and the model named the script.
3. **The 60-second timeout was too short on a hosted runner.** Five calls timed out on the first run.
4. **The budget cap had little headroom** for a longer timeout and a retry.
5. **The prompt and the grader disagreed about reasoning.** The prompt allowed a sentence of reasoning without saying where. The grader read everything after the colon as the name, so three replies that named the right agent failed.
6. **The calls were not isolated.** Each child session ran in the repository with the caller's own settings. It could read the repository's files, it loaded the repository's coding-agent guide and the user's global instructions, and it fired the user's hooks: the second run left 34 records in the maintainer's own session-capture log.

Probes on 2026-10-14 added a seventh. Loading the plugin also loads its hooks, and in an empty folder the plugin's prompt-based Stop hook replaced the model's answer with its own and took the session to three turns.

## Decision

### 1. What a live call loads

Each call runs from one empty temporary folder, created once per run and removed on every exit path. The script refuses to start a call whose working folder is inside the repository. The arguments are these:

| Argument | Why |
|---|---|
| `--plugin-dir <repository root>` | The model sees this plugin's agents and skills as Claude Code presents them, named `nonfiction-studio:<name>`. |
| `--setting-sources project` | The user's settings, and with them the user's hooks and installed plugins, stay out. The empty folder has no project settings. |
| `--settings {"disableAllHooks":true}` | No hook runs, including the plugin's own, so none can rewrite the answer. |
| `--permission-mode dontAsk` | No tool runs. This replaces `--dangerously-skip-permissions`. |
| `--no-session-persistence` | Nothing is written to the user's session history. |

The child's environment adds `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, because `--setting-sources` does not stop the user's own `CLAUDE.md` from loading, and this documented variable does without touching authentication. `--bare` would isolate in one flag, but it refuses OAuth, which Tier B authenticates with (ADR-0010).

Probes on 2026-10-14 verified the result on the maintainer's login. With these arguments and that variable, the child listed all 8 plugin agents and all 15 plugin skills, reported no instructions file, answered in one turn, and left the maintainer's session-capture log unchanged. The model still sees Claude Code's built-in agents and skills, which is why the grader strips only the plugin's own namespace (section 3).

### 2. What is graded

A set is graded only when its `covers` names a chain, and it is graded against `covers.chain[1]`. Hook sets stay in `evals/`, because the G3 rule in `scripts/checks/library-regression.mjs` requires an eval case for every hook event, and `--dry-run` still validates them. A live run logs each hook set as not graded and reports the count. Tier A's `tests/hooks/` remains the proof of hook behavior.

### 3. How a reply is read

The grader reads the first line that starts with `DISPATCH:`, as before. From that line it skips markdown wrapping and a leading `/`, strips the literal plugin namespace `nonfiction-studio:` (read from `.claude-plugin/plugin.json`), and takes the first run of letters, digits, hyphens and underscores as the name. Anything after the name is ignored, unless it starts a hedge: `/`, `,`, `;`, `&`, `+`, `or` or `and` before a second name fails the reply even when the first name is right. Names compare in lowercase with hyphens removed.

Only the literal namespace is stripped. A generic `<word>:` strip would let `DISPATCH: agent: thesis-architect` pass. The prompt now asks for "the one agent or skill", never a hook handler, and asks for any reasoning on the next line. The grader tolerates reasoning on the same line anyway, because a correct name followed by a reason is a correct answer.

### 4. Timeout and retry

Each call has 180 seconds. A call that times out is retried once. No other failure is retried, because a missing CLI, a malformed reply or a model error will not change on a second try.

### 5. Case texts

Five case texts changed. Each was checked against the shipped skill or agent before it changed, and each `expect` field is unchanged.

| File | Case | Problem | New `given` |
|---|---|---|---|
| `nfs-interview-to-interviewer` | 1 | A raw user request that never names the caller, so it measured top-level routing | "nfs-interview runs because the author wants to start a new nonfiction book project" |
| `nfs-interview-to-interviewer` | 2 | Named the skill as an instruction, so the skill itself was a fair answer | "nfs-interview runs for a book about professional learning networks" |
| `interviewer-to-nfs-new-book` | 1 | Never said the interviewer was the one running | "the interviewer agent starts an intake interview and no project directory structure is present" |
| `nfs-capture-voice-to-voice-capture` | 2 | Two paragraphs fall below the skill's 2,200-word floor, where it stops without dispatching | "...the author supplies samples of their own prose totalling about 2,500 words" |
| `nfs-draft-to-line-editor` | 2 | "The initial draft is written" reads as either finished or still to do | "...and drafting-partner has already written the initial draft" |

### 6. Threshold and budget

The threshold stays at 70%. Against 18 graded cases, 13 must pass, so the gate absorbs 5 misses and fails at 6. A chain file holds one or two cases, so three two-case files misrouting completely fail the run. The report lists every failed case, and that list is the per-edge signal.

The budget cap falls from $1.50 to $0.50. A run costs about $0.066. Every call retried once would cost about $0.14, and every reply also trying a tool and taking three turns would cost about $0.41.

Three live runs on 2026-10-14, all on the maintainer's login with CLI 2.1.299 and the isolation above, ground these numbers.

| Run | Case texts | Passed | Spend | Misses |
|---|---|---|---|---|
| 1 | Before section 5 | 14 of 18 (78%) | $0.0655 | The three defective texts in section 5, plus `nfs-capture-voice` case 1 |
| 2 | Four of the five corrected | 16 of 18 (89%) | $0.0682 | `nfs-capture-voice` case 1; `nfs-draft -> line-editor` case 2, the ambiguous text |
| 3 | All five corrected | 15 of 18 (83%) | $0.0656 | `nfs-capture-voice` case 1; `interviewer -> nfs-new-book` case 2; `nfs-draft -> line-editor` case 1 |

`nfs-capture-voice` case 1 failed in all three runs, and it is a real defect rather than noise. The skill's body dispatches `voice-capture` whenever samples are supplied, but its description says it delegates "when no samples are available", and the model believed the description. The other misses moved between cases from run to run.

## Alternatives considered

**Delete the hook evals.** This is simpler, and issue #5 offered it. G3 forbids it: every hook event must keep an eval case. Rejected.

**Give the model a list of components in the prompt instead of loading the plugin.** This is cheaper and needs no CLI flags. It would test a list this script writes, not the descriptions Claude Code actually shows, which is what dispatch depends on. Rejected.

**Grade the actual tool call.** Allow the Agent and Skill tools, stop after one turn, and read which component the model invoked. That is the most faithful measure of top-level routing, but a chain case describes a skill that is already running, which a single tool call cannot represent. It also lets work run. Rejected for now.

**Run with `CLAUDE_CONFIG_DIR` pointed at an empty folder.** This isolates everything at once on a runner that authenticates with the token, but it drops a local login, so a contributor could no longer run Tier B locally. Rejected.

**Raise the threshold to the observed score.** That would turn ordinary haiku variance into red runs. Rejected.

## Consequences

- A live eval run now costs about 7 cents on the maintainer's login, down from roughly $0.30 to $1.08.
- Pass rates before 2026-10-14 are not comparable with later ones: the denominator, the prompt, the grader and what the model can see all changed.
- `tests/checks/run-evals.test.mjs` pins every argument and every deliberate absence, the child environment, the refusal to run inside the repository, the timeout and the retry rule, and the grader's new reading. A mutation of each rule turns the suite red.
- A local eval run no longer loads the maintainer's own configuration. `scripts/run-integration.mjs` still spawns its calls the old way, with the caller's settings, so its local runs still do. Bringing it under the same isolation is a follow-up.
  - **Note, 2026-10-16:** the follow-up landed for [issue #24 (run-integration.mjs isolation)](https://github.com/prisant-labs/nonfiction-studio/issues/24). Both runners now take `--plugin-dir`, `--setting-sources project`, `--no-session-persistence` and `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` from one module, `scripts/lib/claude-isolation.mjs`. The integration runner differs in two ways, on purpose. It keeps the plugin's own hooks on, because it tests the plugin as an author runs it, and that became safe once [ADR-0019 (Stop hook judgment layer)](ADR-0019-stop-hook-judgment-layer.md) removed the Stop prompt handler. It also keeps tools allowed, because its prompts ask the model to inspect files. A live integration run then passed for $0.018, and the first eval run after the description fixes for issues #22 and #23 scored 18 of 18 for $0.068. Neither run added a record to the maintainer's session-capture log.
- The `nfs-capture-voice` description defect, and a softer one in the `interviewer` agent's description (it says the agent will "scaffold the book tree", while its body hands scaffolding to `nfs-new-book`), are product fixes for a separate pull request. Each needs a skill or agent change, and the skill change needs a version bump under ADR-0017 (per-skill versioning).
- Issue #5 stays open until a dispatched Tier B run on GitHub passes the eval step. That needs the `CLAUDE_CODE_OAUTH_TOKEN` repository secret.
