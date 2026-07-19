# Phase 1 Gate Verification Report

- Task: TSK-057 (Phase 1 gate verification)
- Date: 2026-07-19
- Verifier: independent cold re-run (opus), no inherited build context
- Repo: <repo-root>
- Branch: build/phase-1 at 5c0381e, 78 commits from merge-base 6f5596b
- Method: every verdict below was re-run by the verifier on this Windows machine; the working tree was used directly, temp clones were kept outside the repo, and the tree was left clean.
- Acceptance source: X-02 (task catalog) TSK-057 acceptance line and Q-02 (CI pipeline) section 1.1.

## Summary of the six checklist verdicts

| # | Item | Tag | Verdict |
|---|---|---|---|
| 1 | Engine fixture tests pass both directions | CI | PASS |
| 2 | Stop gate blocks planted-unsourced-claim, passes golden, live | model-run | PASS (live confirmed; see the block-vs-warn nuance) |
| 3 | Interview-to-chapter cookbook recipes run | model-run | NOT APPLICABLE at Phase 1 (cookbook is TSK-088, Phase 3) |
| 4 | Tier A green on Windows and Linux | CI | Windows PASS; Linux BLOCKED-until-push |
| 5 | Spine reports Bronze | CI | PASS |
| 6 | Every component has its reference page and example | CI | PASS |

The gate DECISION is the maintainer's ([human]). This report records what the verifier proved cold and what remains blocked or carried; it does not itself open or close the gate.

---

## 1. [CI] Engine fixture tests pass in both directions - PASS

Ran the two runners and all four node --test suites cold.

`node scripts/test-fixtures.mjs` exit 0, final lines:

```
[test-fixtures] asserting committed tree is clean after fixture runs
[test-fixtures] examples/ tree is clean: temp-clone discipline confirmed
[test-fixtures] pass: all fixture matrix assertions passed
```

The matrix runs each fixture against the engines in both directions, for example the ai-injection fixture: `bin/ns-scrub: expected exit 1, got 1` (catcher fires) alongside `bin/ns-doctor: expected exit 0, got 0` and `bin/ns-claims: expected exit 0, got 0` (other engines stay silent). The clean-tree assertion at the end is the codified residue-hygiene decision.

`node scripts/test-engines.mjs` exit 0: `# tests 261 / # pass 261 / # fail 0`.

Suite totals via the node --test glob form (the Windows-safe glob per the build convention):

| Suite | tests | pass | fail |
|---|---|---|---|
| tests/engines/*.test.mjs | 115 | 115 | 0 |
| tests/lib/*.test.mjs | 71 | 71 | 0 |
| tests/hooks/*.test.mjs | 57 | 57 | 0 |
| tests/schemas/*.test.mjs | 18 | 18 | 0 |

The four suites sum to 261, matching the test-engines.mjs aggregate. All green in both directions.

---

## 2. [model-run] Stop gate blocks the planted-unsourced-claim fixture and passes the golden fixture - PASS (live), with a precise block-vs-warn nuance

The live model run was ATTEMPTED and SUCCEEDED via the TSK-030 (hooks.json Phase 1 wiring) headless mechanics. Nested `claude -p` is available in this environment (a trivial haiku probe returned `PONG`, exit 0), so this was not blocked. Procedure: captured the plugin registry baseline (12 marketplaces, 20 plugins, no nonfiction-studio); added the local marketplace and installed at user scope (`Successfully installed plugin: nonfiction-studio@nonfiction-studio (scope: user)`); ran one `claude -p` haiku session in each of two book clones outside the repo, with `NS_HOOK_TRACE` set and the session-write flag pre-seeded so the Stop gate would run; then uninstalled, removed the marketplace, and verified the registry restored to baseline (12 marketplaces, nonfiction-studio absent from both lists).

Live results (the deterministic Stop command hook, `hooks/stop-gate.mjs`, writing `.studio/gate/last-gate.json`):

- GOLDEN (clone of `examples/sample-book`): trace shows `SessionStart x1`, `Stop (stop_hook_active=false) x1`, then `Stop (stop_hook_active=true) x4`. `last-gate.json verdict = pass` (fresh ts 2026-07-19T11:43:30Z); session-write flag CONSUMED. The one false-fire ran the gate; the four re-fires short-circuited without re-running it (live confirmation of the re-fire semantics discovered in TSK-030).
- UNSOURCED-CLAIM (clone of `examples/fixtures/unsourced-claim`): `last-gate.json verdict = warn`, non-pass check `state_coherence:warn`; flag CONSUMED. The planted defect was caught and surfaced.

Nuance the maintainer should weigh: under its COMMITTED config the unsourced-claim fixture gates to `warn`, not a hard `block`. This is by design. Its planted defect is a word-count coherence mismatch (PLANTED.md: chapter 2 file count no longer matches `.studio/progress.json`), and the `state_coherence` check runs in warn mode by default per OQ-13 (gate coherence check) and TSK-029b (state-coherence gate check). Warn is a non-passing verdict, which satisfies the operational contract in Q-02 (CI pipeline) section 2.1 step 5: "a known-bad chapter (planted unsourced claim) produces a non-passing gate result; the golden chapter produces a passing result." The literal `decision: block` path was also proven (see the deterministic substitute).

Deterministic substitute (also run explicitly, mandate-sanctioned, driving the REAL `hooks/stop-gate.mjs` with crafted snake_case Stop events per the pattern in tests/hooks/stop-gate.test.mjs, against clones outside the repo):

- (A) GOLDEN + flag: exit 0, empty stdout, `last-gate verdict = pass`, flag consumed. Passing and silent.
- (B) UNSOURCED-CLAIM + flag, committed config: exit 0, `decision undefined`, additionalContext `"Gate warn:\nstate_coherence: 1 word-count mismatch(es); coherence.word-count-mismatch; chapter 02-finding-your-network: progress.json records 462 words but the file contains 481 words (by stylometry tokenizer)"`, `last-gate verdict = warn`.
- (C) UNSOURCED-CLAIM + flag, block-mode overlay (coherence -> block): exit 0, `decision = block`, reason names the blocking check `state_coherence: ...`, `last-gate verdict = block`. This is the literal block path.
- (D) re-fire (stop_hook_active true) on golden: exit 0, empty stdout, gate not re-run.

Conclusion: live and deterministically, the Stop gate distinguishes bad from good. Golden passes silently; the planted-unsourced-claim fixture is caught as non-passing (warn under the committed reporting config, hard block when a config sets coherence to block). PASS, with the block-vs-warn distinction recorded so the maintainer is not surprised that the committed fixture warns rather than hard-blocks.

---

## 3. [model-run] Interview-to-chapter cookbook recipes run against the sample book - NOT APPLICABLE at Phase 1

Searched the shipped tree (`docs/`, `examples/`, `skills/`, `agents/`, `templates/`, `README.md`) for cookbook or recipe files. None exist: no `docs/cookbook/`, no `*recipe*` or `*cookbook*` files anywhere outside the git-ignored planning workspace.

This is expected and honest, not a failure. X-02 (task catalog) places TSK-088 (cookbook completion) in Phase 3: line 62 lists it under "Phase 3", and its own entry (lines 559-562) declares `Files: docs/cookbook/*.md (nine recipes ...)` with `deps: TSK-064, TSK-083, TSK-084` (all Phase 3). The TSK-057 (Phase 1 gate verification) acceptance line does name "the interview-to-chapter cookbook recipes run against the sample book [model-run]", so this is an internal tension in the acceptance list itself: the Phase 1 gate references an artifact its own plan does not build until Phase 3. No proof was invented. The cookbook and its model-run recipe proof belong to TSK-089 (three-surface compatibility verification) and TSK-091 (Phase 3 gate verification).

Recommendation for the maintainer: treat this checklist line as deferred to Phase 3 and, if desired, correct the TSK-057 acceptance text so it does not claim a Phase 3 artifact.

---

## 4. [CI] Tier A green on Windows and Linux - Windows PASS; Linux BLOCKED-until-push

Ran the full nine-step Q-02 (CI pipeline) section 1.1 sequence on this Windows 11 machine, in order, recording each exit code. Node v22.12.0, claude CLI 2.1.215.

| # | Step | Exit | Evidence line |
|---|---|---|---|
| 1 | `npm ci` | 0 | `found 0 vulnerabilities` |
| 2 | `node scripts/check.mjs --profile plain-plugin` | 0 | `Tier: Universal (no blockers detected)` / `0 error(s), 0 warning(s).` |
| 3 | `claude plugin validate --strict .` | 0 | `Validation passed` |
| 4 | `node scripts/check-hooks-schema.mjs` | 0 | `pass: hooks/hooks.json is well-formed; 5 event(s) validated` |
| 5 | `node scripts/check-frontmatter.mjs` | 0 | `pass: 8 agent(s) and 11 skill(s) validated; chain contract enforced` |
| 6 | `node scripts/check-docs-completeness.mjs` | 0 | `pass: all 8 agent(s), 11 skill(s), and 5 CLI(s) have reference pages` |
| 7 | `node scripts/check-links.mjs` | 0 | `pass: 58 file(s) checked, no broken relative links` |
| 8 | `node scripts/test-engines.mjs` | 0 | `# pass 261 / # fail 0` |
| 9 | `node scripts/test-fixtures.mjs` | 0 | `pass: all fixture matrix assertions passed` |

All nine steps green on Windows.

Linux: BLOCKED-until-push, recorded honestly. The workflow `.github/workflows/tier-a.yml` exists and its matrix declares both `ubuntu-latest` and `windows-latest` with `fail-fast: false`, so the Ubuntu leg will run on the first PR. It cannot run yet because the repo has no remote (no push has occurred). The workflow file itself states this: "The ubuntu leg proves on first push." One additional honest caveat lives in the same file and in X-04 (open questions): step 3, `claude plugin validate --strict`, needs the `claude` binary on the runner, which is not present by default on standard GitHub Actions runners; a setup step must be added before that leg is green in CI. The verifier confirms the workflow contains zero validation logic (each step is exactly one node or claude call), matching the Q-02 parity contract.

---

## 5. [CI] The spine reports Bronze - PASS

The tier ladder in the vendored spine is `TIER_ORDER = [universal, convergent, advanced]`, which the profile modules name Bronze / Silver / Gold. `library.json` declares `"tier": "universal"` (Bronze) and pins `"standard": "0.12"`. The repo pins its grading profile in `askit.config.json`: `{"profile":"plain-plugin"}`.

`node scripts/check.mjs --profile plain-plugin` (the exact Q-02 CI step) exit 0:

```
Tier: Universal (no blockers detected)

0 error(s), 0 warning(s).
```

`node scripts/tier-report.mjs --json` agrees: `{"tier":"universal","satisfies":["universal"],"blocked":{},"declaredTier":"universal"}`. Universal is Bronze, so the spine reports Bronze cleanly under the profile the plugin ships.

The fuller profile the spine documents for tier reporting is `askit-library` (the full Bronze/Silver/Gold ladder as the modules declare it). `node scripts/check.mjs --profile askit-library` exit 1: `Tier: None (Universal blocked: 1 issue)` with `1 error(s), 11 warning(s)`. This is expected and not a Phase 1 defect: the full askit library ladder demands artifacts the plugin deliberately does not target in Phase 1 (a root AGENTS.md for U2, `prefix`/`components` for the Silver S-checks, and the entire Gold G-set: RELEASE-NOTES.md, INDEX.md, per-folder READMEs, docs frontmatter, the Diataxis quadrants). Q-02 section 3.3 and the plain-plugin profile design (ADR-0028, re-homed house preferences) commit the plugin to being graded as a plain plugin, not against the askit library contract, until it intentionally climbs to Silver (TSK-076) and Gold. The Bronze verdict under the pinned profile is the operative one and it passes.

---

## 6. [CI] Every shipped Phase 1 component has its reference page and example - PASS

`node scripts/check-docs-completeness.mjs` exit 0: `pass: all 8 agent(s), 11 skill(s), and 5 CLI(s) have reference pages`. The script (D-24 docs release gate) verifies reference-page existence under `docs/reference/{agents,skills,cli}/` for every non-spike component.

The completeness script checks page existence only, not worked-example presence. Spot-checked three components for the example surface it does not cover. Each agent and skill ships a separate worked-example file `docs/reference/<kind>/<name>.example.md` alongside the reference page; each CLI page carries an embedded example section:

- `docs/reference/skills/draft-chapter.example.md`: 14733 bytes, 226 lines, a full worked session (setup, transcript, drafted chapter, key assertions).
- `docs/reference/agents/fact-checker.example.md`: 15842 bytes, 353 lines, claim-by-claim resolution plus a per-chapter fact-check report and a synthetic unverified-disposition case.
- `docs/reference/cli/ns-gate.md`: carries a `## Example invocations` section with real command forms.

A sweep confirmed no zero-length `.example.md` files and no reference page lacking an example section. Every shipped Phase 1 component has both its reference page and a substantive example.

---

## Roll-up triage

Triaged the ROLL-UP and deferred-minor entries accumulated across the build ledger. Headline: 0 MUST-FIX before merge; all items are ACCEPTABLE-to-carry. Two carried items are flagged "fix recommended soon" because they touch content that will be showcased or a degraded-state message.

| Item (handle) | Ledger source | Triage | Rationale |
|---|---|---|---|
| Fixture chapter-list and outline format normalization | TSK-028 (ns-doctor engine) M-1; TSK-047 (outline-book skill); TSK-039 (structure-architect agent) | CARRY | Cosmetic fixture metadata (banned word-count columns, pre-contract outline format). No deterministic test depends on it; test-fixtures is green. Bundle into one tokenizer-driven sweep of all five fixtures before the fixtures are used as public teaching material (cookbook, Phase 3). |
| EV-source scholarly spot-check, nine remaining pairings | TSK-041 (fact-checker agent) | CARRY (fix recommended) | The verifier performed the spot-check (see below). Found one further questionable pairing (EV-0003) of the same class as the EV-0006 error the roll-up was opened for. Not a code defect - the engines do not judge scholarship. Fix in the fixture sweep before the golden book is showcased as exemplary scholarship. |
| D-08 calibration granularity | TSK-051 (run-quality-gate skill) | CARRY | Explicitly Phase 2 (TSK-075 calibration run). Per-chapter drift scored against a book-aggregate baseline warns by construction; documented, not a Phase 1 defect. |
| Corrupt-config ripple in the three non-Stop hooks | TSK-034 (stop-gate hook) DESIGN RIPPLE roll-up | CARRY (fix recommended) | On a corrupt config.json, session-start emits a misleading "no book project" empty-state; pre-tool-use and post-tool-batch silently no-op (defensible - not the always-on layer). All stay fail-open, exit 0. Apply the TSK-034 error-code discrimination to session-start as a small hardening; the other two are acceptable as-is. |
| Tautological schema tests | ROLL-UP 2026-07-19 from TSK-055 (Tier A check scripts) | CARRY | tests/schemas tests 13 and 15 assert properties of locally-built objects with no code path. Acknowledged honest-limitation. Redundant, not wrong; convert to doctor-driven negatives or drop in a test-quality pass. 18 schema tests green. |
| Date normalization in _local notes | TSK-046 (capture-voice skill) note | CARRY | Cosmetic; _local is git-ignored planning. Ledger dates are authoritative. |
| Deferred line-comment rewords and missing negative tests | TSK-030/031/032/033 Minor ROLL-UPs; TSK-028 M-2 | CARRY | Comment hygiene (post-tool-batch line 163, session-start line 248) and additional negative coverage (malformed-src / orphan-src fixtures, a backslash-separator containment case). No correctness impact; the guarded behavior is proven live. |
| intake-interview skip-voice-if-profile-exists unimplemented | TSK-045 (intake-interview skill) system-level roll-up | CARRY | Feature-completeness gap: the interviewer covers all ten sections regardless of an existing style profile. Documented; fix shape known (pass profile existence into the delegation). Not a correctness defect. |
| progress.json unowned responsibilities (status lifecycle, open-claims total) | ROLL-UP 2026-07-19 skills-lane | LARGELY RESOLVED | TSK-050b (progress entry ownership) routed entry creation, creation-status, and the open-claims total to the single PostToolBatch writer per D-06. Full status lifecycle transitions (drafting -> final) remain Phase 2 scope. |

EV-source spot-check detail (the substantive triage item). Reviewed all ten golden pairings in `examples/sample-book/research/evidence-log.md` against `sources.md`:

- Canonically correct: EV-0006 (Dunbar 150) -> SRC-0005 (Dunbar 1992, neocortex/group size); EV-0008 (weak-tie novelty) -> SRC-0002 (Granovetter 1973, The Strength of Weak Ties). Both exemplary.
- Appropriately labeled non-verified: EV-0005 (PLN compounding, status interpretation, low confidence); EV-0010 (pacing, low confidence). Correct hedging.
- One questionable pairing worth fixing: EV-0003 attributes "legitimate peripheral participation ... a concept first developed through research on craft apprentices" to SRC-0001 (Hart 2015). That concept is canonically Lave and Wenger 1991 (Situated Learning), which is precisely the apprenticeship research the claim describes. This is the same mis-pairing class as the EV-0006 Dunbar/Granovetter error the roll-up was opened to hunt. Recommend repointing EV-0003 to a Lave and Wenger source during the fixture sweep.
- Loose but acceptable for a fixture (generic claims to plausible secondary sources, invented locators expected): EV-0001, EV-0002, EV-0004, EV-0007, EV-0009. EV-0002 (a 3-to-1 listen-speak ratio pinned to Hart 2015 pp. 44-46) is the loosest and worth a second look in the same sweep.

None of these affect any deterministic proof: the golden fixture's engine results (100 percent claim coverage, coherent word counts, clean scrub and stylometry) are independent of whether a source attribution is scholarly-correct. Fixture-content quality, not Phase 1 build soundness.

---

## Seam checks

Spot-verified three cross-component contracts at their seams. All three hold.

Seam 1 - a hook-created progress entry passes the doctor's coherence check. Cloned `examples/sample-book` outside the repo. The committed progress records chapter 1 at 422 words and `ns-doctor` exits 0 (coherent). Appended a paragraph to the chapter without updating progress: `ns-doctor` then exits 1 (the coherence check fires on the stale count). Ran the real `hooks/post-tool-batch.mjs` with a synthetic snake_case PostToolBatch event naming the edit: the hook recounted and wrote progress chapter 1 to 448 words, and `ns-doctor` returned to exit 0. The single-writer hook and the doctor's coherence check agree on the tokenizer and the schema; the seam holds in both directions.

Seam 2 - the chain yaml against skills' actual delegation text. `agents/_chain-permitted.yaml` declares `fact-check-pass: [fact-checker]` and `draft-chapter: [drafting-partner, line-editor]`. `skills/fact-check-pass/SKILL.md` lists `fact-checker` in its agents-invoked frontmatter, states "Skill chain edge: fact-check-pass -> fact-checker per agents/_chain-permitted.yaml", and delegates to the fact-checker agent in its body. `skills/draft-chapter/SKILL.md` lists both `drafting-partner` and `line-editor`, cites both edges by name, and has a "Delegate to drafting-partner" step invoking the `draft-chapter -> drafting-partner` edge. Delegation text matches the declared edges exactly. (Tier A step 5 additionally enforces this bidirectionally: `check-frontmatter` reports "chain contract enforced".)

Seam 3 - a CLI reference page against its binary's real flags. `docs/reference/cli/ns-gate.md` documents flags `--check`, `--chapter`, `--project`, `--json`, and a `--check` value set of `claims, stylometry, scrub, continuity-quick, coherence` with a flag-to-report-name mapping. `bin/ns-gate` calls `parseArgs(process.argv.slice(2), ['check','chapter','project','json'])` - exactly the four documented flags - and rejects an unknown check with the real valid set: running `ns-gate --check=bogus` prints `unknown check "bogus"; valid checks: claims, stylometry, scrub, continuity-quick, coherence` and exits 2. The documented usage line matches the binary's usage string. The reference page is faithful to the binary.

---

## OVERALL

What is proven, cold, on this Windows machine at 5c0381e:

- The deterministic engine layer is sound: 261 unit tests green across four suites, and the bidirectional fixture matrix passes with a clean-tree assertion (checklist 1).
- The Stop gate works end-to-end, live: it passes the golden book silently and catches the planted-unsourced-claim fixture as non-passing, with the session-write flag consumed and re-fires correctly short-circuited; the literal hard-block path is proven under a block-mode config (checklist 2).
- Tier A is fully green on Windows across all nine Q-02 steps (checklist 4, Windows leg).
- The spine reports Bronze cleanly under the pinned plain-plugin profile, with 0 errors and 0 warnings (checklist 5).
- Every shipped Phase 1 component (8 agents, 11 skills, 5 CLIs) has both a reference page and a substantive worked example (checklist 6).
- All three spot-checked cross-component seams hold.
- The tree is clean; the live install was fully reverted (plugin registry restored to its 12-marketplace, 20-plugin baseline).

What is blocked or not applicable, and why:

- Checklist 3 (cookbook recipes) is NOT APPLICABLE at Phase 1: no cookbook exists because TSK-088 (cookbook completion) is Phase 3 work. The TSK-057 acceptance list references a Phase 3 artifact; no proof was fabricated.
- Checklist 4 (Linux leg) is BLOCKED-until-push: the tier-a.yml matrix includes ubuntu-latest and will prove on the first PR, but the repo has no remote yet. A separate honest caveat: the `claude plugin validate` step needs a claude-binary setup step added before the CI leg is green.
- Checklist 2 carries a design nuance, not a defect: under its committed config the unsourced-claim fixture warns (a non-passing verdict) rather than hard-blocking; hard-block requires a block-mode config, which was demonstrated.

What the maintainer should weigh for the gate DECISION ([human], the maintainer's call):

1. Phase 1 build soundness is not in question. Zero MUST-FIX items surfaced; every roll-up is cosmetic, Phase-2-scoped, or fixture-content quality, and none breaks a deterministic proof, the Stop gate, Tier A, Bronze, or docs completeness.
2. Two carried items deserve a near-term fix even though they do not block merge: the EV-0003 scholarly mis-pairing in the golden fixture (repoint to Lave and Wenger), and the misleading session-start message on a corrupt config (apply the TSK-034 error-code pattern). Both fit naturally in the queued fixture/hardening sweep.
3. Two acceptance lines in TSK-057 are out of phase with the plan the branch executed: the cookbook line (Phase 3) and, secondarily, the Linux leg (needs a remote and a claude-CLI setup step). Neither reflects a build gap; both reflect the acceptance list reaching ahead of Phase 1. Consider reconciling the TSK-057 acceptance text.

The verifier's recommendation: the Phase 1 build meets its gate on every criterion that is in-phase and runnable here (checklists 1, 2, 4-Windows, 5, 6, plus all three seams), with the two out-of-phase criteria (3, and 4-Linux) blocked for honest, documented reasons rather than defects; on the evidence, Phase 1 is ready to gate open once the maintainer accepts the Linux-on-first-push and cookbook-in-Phase-3 deferrals and the zero-MUST-FIX roll-up triage.
