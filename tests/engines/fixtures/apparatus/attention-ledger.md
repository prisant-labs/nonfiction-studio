<!-- research/evidence-log.md (test fixture)
     One clean control entry (EV-0002) plus one entry per attention trigger: blank locator
     (EV-0001), source ID absent from sources.md (EV-0003), blank source field (EV-0004),
     source missing a Chicago-required field (EV-0005), and unknown source type (EV-0006).
     The chapter fixture that reads this ledger also anchors EV-0099, which does not appear
     here at all, to plant the sixth trigger (chapter anchor with no matching ledger entry).
-->

# Evidence Log

### EV-0001 (blank locator claim)
- claim: A claim whose locator was never filled in.
- source: SRC-0001
- locator:
- confidence: medium
- status: verified
- added-by: research-librarian
- date: 2026-08-09

### EV-0002 (fine claim)
- claim: A claim with everything filled in correctly.
- source: SRC-0001
- locator: p. 5
- confidence: high
- status: verified
- added-by: research-librarian
- date: 2026-08-09

### EV-0003 (nonexistent source claim)
- claim: A claim whose source ID was never registered.
- source: SRC-9999
- locator: p. 1
- confidence: medium
- status: verified
- added-by: research-librarian
- date: 2026-08-09

### EV-0004 (blank source claim)
- claim: A claim with no source recorded at all.
- source:
- locator: p. 1
- confidence: low
- status: verified
- added-by: research-librarian
- date: 2026-08-09

### EV-0005 (incomplete source claim)
- claim: A claim whose source is missing a field Chicago requires.
- source: SRC-0002
- locator: para. 2
- confidence: medium
- status: verified
- added-by: research-librarian
- date: 2026-08-09

### EV-0006 (unknown type claim)
- claim: A claim whose source type has no chicago.json entry.
- source: SRC-0003
- locator: 00:12:30
- confidence: medium
- status: verified
- added-by: research-librarian
- date: 2026-08-09
