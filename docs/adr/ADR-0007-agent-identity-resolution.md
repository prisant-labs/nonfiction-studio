# ADR-0007: Agent Identity Resolution - Namespace-Prefix Matching from the Hook Envelope

**TL;DR:** A live platform probe on 2026-08-09 (`(local working notes, not published)`) proved that PreToolUse and PostToolBatch hook envelopes carry `agent_id` and `agent_type` when a subagent (plugin or generic) fires the tool call; the parent session's own calls carry neither field. Plugin agents report a namespaced slug (`nonfiction-studio:<slug>`); generic subagents report an unnamespaced type (`general-purpose`). `hooks/lib/agent-identity.mjs` resolves this into two functions with different jobs: `resolveActiveAgent` (enforcement, namespace-matched, returns null on any ambiguity) and `resolveAgentLabel` (attribution, keeps the raw string). This closes OQ-14 (agent identity in hook events), activates the dormant write-scope guard (F-AG-01, agents claim enforcement that does not exist) and the web research gate (F-AG-02, web gate unenforced), and gives `hooks/post-tool-batch.mjs` real per-agent attribution in the ai-use-log (D-10, compliance layer is a feature).

- Status: Accepted
- Date: 2026-08-09
- Probe: (local working notes, not published) (OQ-14, agent identity in hook events), `(local working notes, not published)`
- Task: Wave 1 item 1 (agent identity enforcement), roadmap row 1.1
- Decision: NAMESPACE-PREFIX MATCHING - `resolveActiveAgent` matches `agent_type` against `nonfiction-studio:<slug>`; absent, empty, non-string, or unnamespaced values (for example `general-purpose`) all resolve to null (unconstrained)
- PA resolved: OQ-14 (agent identity in hook events) closed; F-AG-01 (dormant write-path containment) and F-AG-02 (web gate unenforced) activated

---

## Context

D-13 (security posture) states that research-facing and drafting agents write only under specific book-root-relative directories, enforced by "the PreToolUse path guard." Five shipped agent files (`agents/drafting-partner.md`, `agents/line-editor.md`, `agents/research-librarian.md`, `agents/structure-architect.md`, `agents/thesis-architect.md`) made this claim in their own prose. Until this task, the claim was false: `resolveActiveAgent(event)` in `hooks/pre-tool-use.mjs` unconditionally returned `null`, so `checkResearchAgentConstraint` (its downstream consumer) always short-circuited to allow. The 2026-08-07 audit filed this as F-AG-01 (agents claim enforcement that does not exist) and, for the web research gate, F-AG-02 (web gate unenforced): no hook read `.studio/config.json`'s `research.web_enabled` key at all, so the gate existed only as agent-prose instruction.

The blocker was OQ-14 (agent identity in hook events): the live PreToolUse envelope captured by TSK-030 (hooks.json Phase 1 wiring) carried no agent-identity field, so there was nothing for `resolveActiveAgent` to read. OQ-14's working default assumed the platform might never provide one and sketched a fallback (a SubagentStart/Stop session-file ledger with TTL sweeps and cardinality limits) as a contingency.

## Probe evidence

A live platform probe on 2026-08-09 removed the blocker directly, without needing the ledger fallback. Method: a temporary user-scope install of the plugin from the local checkout, a scratch book outside the repo, headless haiku sessions with `NS_HOOK_TRACE` capturing raw hook stdin, full uninstall and registry-restore verified after. The full method and raw traces are recorded at `(local working notes, not published)` (raw traces archived at `(local working notes, not published)`); both paths are gitignored local working notes, so the two decisive envelope fragments are quoted directly below, not only pointed at, so this decision's evidence is inspectable from the published repo itself.

Generic (non-plugin) subagent, captured PreToolUse envelope fragment (PF-1):

```
"agent_id":"a92169de485c46c7b","agent_type":"general-purpose"
```

Plugin agent, captured PreToolUse envelope fragment (PF-2):

```
"agent_id":"a78c1243d1613944b","agent_type":"nonfiction-studio:voice-capture"
```

Findings:

- **PF-1.** A generic subagent's Write fired the plugin's PreToolUse hook carrying the PARENT session_id plus the two fields quoted above, which the 2026-07 A-02 (platform capability baseline) said did not exist.
- **PF-2.** The same probe against a real plugin agent yielded the namespaced form quoted above.
- **PF-3.** The parent session's own Write envelope carried neither `agent_id` nor `agent_type`. Absence of the fields identifies a main-session action; there is no false-attribution ambiguity.
- **PF-4.** The parent's Task/Agent dispatch itself fires PreToolUse with `"tool_name":"Agent"` and the full instruction in `tool_input` (relevant to OPP-P05, routing enforced at dispatch, out of scope for this task).

**Residual, resolved without a second live probe.** The probe's own raw traces were captured for PreToolUse; whether PostToolBatch envelopes carry the same fields was left as a residual to verify in-wave. The controller grepped the archived probe traces directly: `agent_type` appears on `PostToolBatch` events in both probe runs, not only `PreToolUse`. `hooks/post-tool-batch.mjs` reads it the same way `hooks/pre-tool-use.mjs` does.

This closes OQ-14. The ledger/TTL/cardinality fallback OQ-14 sketched is unneeded: `resolveActiveAgent(event)` reading `event.agent_type` directly is sufficient.

## Decision: namespace-prefix matching, not slug matching alone

`hooks/lib/agent-identity.mjs` exports `PLUGIN_NAMESPACE = 'nonfiction-studio'` (equal to the `name` field in `.claude-plugin/plugin.json`) and matches `event.agent_type` against the prefix `nonfiction-studio:`. `resolveActiveAgent` returns the slug after the prefix only when the field is a string that begins with it; every other case - field absent, empty, not a string, or an unnamespaced type like `general-purpose` (PF-1) - resolves to `null`.

The rationale is a scoping boundary, not a parsing convenience: this plugin's write-scope and web-gate constraints must bind only to THIS plugin's own agents. A user's unrelated agent that happens to be named `research-librarian` in some other context is not subject to `nonfiction-studio`'s D-13 (security posture) rules, and matching on the bare slug alone (ignoring the namespace) would have constrained it anyway. Matching the full `nonfiction-studio:` prefix is what PF-2 proves the platform actually sends for this plugin's agents, so it is also the only matching rule the probe evidence supports.

## Decision: enforcement and attribution are different questions, with different resolvers

`hooks/lib/agent-identity.mjs` exports two resolvers over the same `agent_type` field, deliberately returning different things:

- **`resolveActiveAgent(event)`** - enforcement-facing. Returns the slug ONLY for a namespaced `nonfiction-studio:` agent; `null` otherwise. Consumed by `checkAgentWriteConstraint` (F-AG-01) and the web gate branch (F-AG-02) in `hooks/pre-tool-use.mjs`. A guard must never bind to an identity it cannot be sure is this plugin's own.
- **`resolveAgentLabel(event)`** - attribution-facing. Returns the RAW `event.agent_type` string whenever it is present and non-empty, namespace included, and deliberately including unnamespaced types like `general-purpose`. Consumed by `hooks/post-tool-batch.mjs` for the `agent` field of each chapter-write record in `.studio/ai-use-log.jsonl` (D-10, compliance layer is a feature). A compliance log should record what actually happened, not a filtered view of it; `general-purpose` is a true and useful fact to log even though it is never a constraint target.

Neither function reads any other field or performs any I/O; both operate on the single `event` object each hook already has in hand.

## Decision: the write-scope table (F-AG-01) is a generalization, not scope creep

The dormant `checkResearchAgentConstraint` this task replaces knew only three research agents (`research-librarian`, `fact-checker`, `citation-manager`) and one shared scope (`research/`, `.studio/`). But the five agent files asserting the guard are not all research-facing - `drafting-partner`, `line-editor`, `structure-architect`, and `thesis-architect` are drafting and structure agents with their own, different, already-shipped scope claims. `AGENT_WRITE_SCOPES` in `hooks/lib/agent-identity.mjs` is a table, one row per constrained agent, each row's allowed prefixes taken verbatim from that agent's own shipped prose:

| slug | allowed write prefixes | source of truth |
|---|---|---|
| `research-librarian` | `research/`, `.studio/` | agents/research-librarian.md:73-74 |
| `drafting-partner` | `chapters/` | agents/drafting-partner.md:69-71 |
| `line-editor` | `chapters/` | agents/line-editor.md:62-64 |
| `structure-architect` | `structure/`, `research/` | agents/structure-architect.md:67-69 |
| `thesis-architect` | `context/`, `structure/` | agents/thesis-architect.md:64-66 |

`checkAgentWriteConstraint(agentSlug, realTargetAbsPath, bibleRoot, platformOverride)` allows unconditionally (returns `null`) when `agentSlug` is falsy OR absent from this table. Absence means unconstrained, not denied: `fact-checker` (writes span `research/`, `chapters/`, `.studio/fact-check-reports/`, and `.claude/agent-memory/` with no path-guard citation in its own prose), `interviewer` and `voice-capture` (neither claims a guard), and `citation-manager` (a Phase 2 agent that does not exist on disk) all stay unconstrained. Constraining an agent the shipped prose never authorized a boundary for would be a behavior change this task was not asked to make. This is also the acceptance criterion the roadmap states explicitly (row 1.1, "no false denies under ambiguity"): a guard that denies when identity is absent, unnamespaced, or untabled is worse than the dormant guard it replaces.

The function is evaluated against the REAL (symlink-resolved) target computed by the existing F-HK-04 re-verification block, not the lexical one, and runs AFTER the existing root-containment and real-path checks in `hooks/pre-tool-use.mjs` - so a write already denied for escaping the book root keeps that reason, and a symlink cannot carry a constrained agent's write outside its declared scope while looking in-scope lexically. Prefix comparison case-folds only when the platform is `win32` (`platformOverride`, defaulting to `process.platform`), matching the F-HK-13 convention already established for the root-containment guard: unconditional folding would widen containment the wrong way on a case-sensitive filesystem.

`isWebGatedAgent(agentSlug)` is a SEPARATE membership question, answering "does this agent ship WebSearch/WebFetch and is it therefore subject to the web gate," not "is this agent write-scoped." `research-librarian`, `fact-checker`, and `citation-manager` are web-gated; only one of the three (`research-librarian`) is also write-scoped. The two tables intentionally do not mirror each other.

## Decision: the web gate (F-AG-02) fails closed on every ambiguous case

`hooks/pre-tool-use.mjs` denies `WebSearch`/`WebFetch` from a web-gated agent (`isWebGatedAgent`) unless `.studio/config.json`'s `research.web_enabled` is exactly the boolean `true`. The rule for what counts as open was already documented and binding at `docs/reference/agents/research-librarian.md:135-149`; this task is what makes it enforced rather than merely instructed. Every ambiguous or error case denies, consistent with the corrupt-config precedent already in the file (`hooks/pre-tool-use.mjs`, citing D-13 fail-closed):

- no book root found - there is no `.studio/config.json` to read, so the gate cannot be verified open;
- the config is unreadable or unparseable;
- the `research` key is absent (including every book scaffolded from `templates/book-scaffold/`, which ships with no `research` key at all - absent means closed, and closed is the correct default);
- `web_enabled` is anything other than the boolean `true` - the string `"true"`, `false`, and `null` all leave the gate closed.

Main-session `WebSearch`/`WebFetch` calls and calls from non-gated agents are entirely unaffected by this branch, in every one of those same error conditions: the gate only ever narrows what a web-gated AGENT may do, never what the main session may do.

## Testing limitation (honest)

`agent_type` is a platform-provided field: this repository's own code never constructs it, and cannot generate it in a way a unit test could exercise short of actually invoking the platform. The tests added by this task (`tests/hooks/agent-identity.test.mjs`, and the agent-envelope cases in `tests/hooks/pre-tool-use.test.mjs`, `tests/hooks/pre-tool-use-symlink.test.mjs`, and `tests/hooks/post-tool-batch.test.mjs`) all use SYNTHETIC envelopes - JSON objects shaped like the probe traces, constructed by the test harness itself, not captured live. That the platform actually sends `agent_id`/`agent_type` in this shape, on both PreToolUse and PostToolBatch, is evidenced by the two captured fragments quoted in the Probe evidence section above (PF-1, PF-2) and the PF-1 through PF-4 findings generally, not by anything the automated test suite itself re-verifies on every run. The full raw traces at `(local working notes, not published)` are gitignored local working notes, kept only as supplementary detail beyond the fragments already quoted above; a reader of the published repo does not need access to them to see the decisive evidence this decision rests on. A future platform change to the envelope shape would not be caught by this test suite; it would require a new live probe, the same way OQ-14 itself was resolved.

## Consequences

- `hooks/pre-tool-use.mjs`'s Step 5 write-scope check and its new web-gate branch are both live in production for the first time; they were previously dormant (write-scope) or entirely absent (web gate).
- `hooks/post-tool-batch.mjs` chapter-write records in `.studio/ai-use-log.jsonl` now carry a real agent label instead of the fixed `'hook:PostToolBatch'` placeholder, except when the writing session genuinely was the main session (no `agent_type` on the envelope), which keeps that placeholder unchanged.
- D-13 (security posture) grows from "research-facing agents may write only under `research/` and `.studio/`" to the five-row table above; the planning-doc amendment lands separately (item 8, planning-doc sync).
- A-02 (platform capability baseline) gains a dated entry recording that hook envelopes carry `agent_id` and `agent_type`, superseding its 2026-07 baseline's claim that they do not; this amendment also lands separately.
- No SubagentStart/Stop hook, session-file ledger, TTL sweep, or cardinality fallback was implemented. The probe collapsed OPP-P01 (agent identity ledger) to a direct envelope read; none of that machinery is needed.
