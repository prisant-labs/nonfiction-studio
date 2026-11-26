# ADR-0022: A Source Correction Reopens Its Claims Once

**TL;DR:** A corrected source record carries `changed: true` and a `change-note`. The `fact-checker` agent resets every ledger entry that cites a flagged source to `pending` at the start of each session. Before this record, nothing ever cleared or aged the flag. So the reset ran again every session, and a claim re-verified after the correction was reopened the next time the agent started. This record makes each correction reopen its claims once. The `change-note` now begins with the date of the correction. The fact-checker's cache records, for each entry it verifies, the `change-note` of its source at that moment. A flagged source resets only the entries whose cache record does not carry its current `change-note`. The flag on an evidence entry, which nothing read, is retired.

- Status: Accepted. The maintainer approved building this fix on 2026-11-26. The design choices below were the implementer's judgment and are open to the maintainer's review. The record ships with the instruction changes.
- Date: 2026-11-26
- Related: [ADR-0021 (orphan sources in the gate)](ADR-0021-orphan-sources-in-the-gate.md) covers the other source-registry case, a record that was deleted. [ADR-0004 (plugin agent memory)](ADR-0004-plugin-agent-memory.md) provides the cache directory. The registry grammar is in [docs/formats/sources.md](../formats/sources.md).
- Decision: A CORRECTION IS IDENTIFIED BY ITS DATED CHANGE-NOTE; THE FACT-CHECKER'S CACHE RECORDS WHICH CORRECTION EACH ENTRY WAS VERIFIED AGAINST; THE EV-LEVEL CHANGED FLAG IS RETIRED.

---

## Context

The correction protocol has two halves. The `research-librarian` agent flags a corrected source record. The `fact-checker` agent reads the flag at session start, invalidates its cache for the entries that cite that source, and resets them to `pending`. That reset is the only backward status move any agent may make.

An audit of the shipped instructions found three gaps:

1. **The flag never settles.** The fact-checker cannot write `research/sources.md`, and the librarian has no step that clears the flag. Every line in the shipped tree that mentions the flag was read, and none clears or ages it. So the reset runs at the start of every session. A claim the fact-checker re-verified after the correction is reset again the next time it starts, and a corrected source can never settle.
2. **A second correction looks like the first.** The `change-note` is free text, so nothing distinguishes a new correction of the same record from the old one.
3. **The evidence-entry flag has no reader.** The librarian may also set `changed: true` on the evidence entries that cite a corrected source. `docs/formats/evidence-log.md` does not define that field, and the fact-checker scans only `research/sources.md`.

These are instruction-level findings. No live agent run reproduced them, and none proves this fix; the agents are expected to follow their instructions.

## Decision

### 1. The change-note names its correction

When the librarian corrects a source record, it sets `changed: true` and writes `change-note: YYYY-MM-DD: <reason>`, with the date of the correction first. A later correction of the same record replaces the `change-note` with a new dated note. The flag stays set: it records that the source was corrected, and it is not the thing that settles.

The field keeps its name and its free-text type, so the parser and the doctor accept old and new records alike. An older record whose note has no date still works. Its text identifies its correction until the note is replaced.

### 2. The cache records which correction each entry saw

When the fact-checker resolves an entry, its cache record for that entry holds the entry ID, the source ID, the session, and the source's `change-note` at that moment, or none if the source carried no flag.

At session start, for each source with `changed: true`, the fact-checker compares the source's current `change-note` with the one recorded for each citing entry:

- **They match.** The entry was already checked against this correction. It stays as it is.
- **They differ, or no cache record exists.** The entry was verified before this correction, or the cache was lost. The fact-checker invalidates the record and resets the entry to `pending`, if it is not already `pending`.

A lost cache therefore errs toward checking again, once.

### 3. The author hears about the other chapters

The reset is book-wide, because every claim that cites a corrected source needs a fresh check. The pass that follows re-verifies only the target chapter's markers. So the per-chapter report now lists the entries the session reset outside the target chapter, so the author knows which chapters to fact-check next.

### 4. The author can name an entry to re-check

The README tells an author who rewords a checked claim to have it checked again. Before this record, no instruction allowed that, because a cached entry is always skipped. Now an entry that the author, or the `nfs-fact-check` skill on the author's behalf, names by EV ID is treated as a cache miss and verified again. This does not detect a reworded claim. It gives the author a way to act on one.

### 5. The evidence-entry flag is retired

The librarian no longer sets `changed: true` on evidence entries. The source flag carries the whole signal. An existing book that already has such a field is unaffected, because the parser keeps unknown fields and no engine reads them.

## What this does not fix

- **A reworded sentence or ledger claim.** The cache record holds no claim text. A verified entry still survives an edit to the sentence it sits on, an edit to its ledger claim, or a marker copied onto another sentence. Closing that needs a fingerprint of what was verified, and it needs its own record.
- **A source that changed with no correction.** An edited web page is out of reach unless the librarian learns of it and records a correction.
- **Proof.** The cache format is the agent's own memory, so no deterministic test can show that the agent follows this protocol.

## Alternatives considered

- **Let the librarian clear the flag after a re-check.** Rejected. The flag must stay until every citing entry in every chapter has been re-checked, and the librarian cannot see the fact-checker's cache. It would also need a hand-off between the two agents that does not exist.
- **Add a new correction-ID field.** Rejected for now. A dated `change-note` identifies a correction without a new field, so the registry grammar is unchanged.
- **Wire up the evidence-entry flag.** Rejected. It only copies the source flag and is not defined in the format. A second reader would add a way for the two flags to disagree.

## Consequences

- The instruction changes ship with this record: `agents/fact-checker.md`, `agents/research-librarian.md`, their reference pages, `docs/formats/sources.md`, the `nfs-fact-check` reference page, the `nfs-fact-check` skill, the README's advice on reworded claims, and the status line of ADR-0021.
- The `nfs-fact-check` skill's step list changes, which an author can see, so its version moves under ADR-0017 (per-skill versioning).
- No engine, hook, or CLI changes. The Tier B evals run against the branch, and their results are reported in the pull request.
