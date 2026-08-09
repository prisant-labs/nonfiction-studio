# Source Records Format

**Purpose.** This is the normative grammar for `research/sources.md`, the bibliography registry defined in S-08 (schemas and file formats) section 7. `bin/ns-claims` and `bin/ns-doctor` parse against this document; every field name, value constraint, and structural rule below is authoritative. A parser author must be able to implement a conformant reader without consulting any other document.

## ID format

Source record headings follow this pattern:

```
### SRC-NNNN (handle)
```

`NNNN` is a zero-padded four-digit decimal integer, starting at `0001` and incrementing monotonically. IDs are never reused. The parenthesized handle is required and must be a short, unique human-readable label for the record (for example, `SRC-0004 (Make It Stick)`).

`research-librarian` is the sole allocator of SRC IDs per the ledger interaction protocol in S-03 (agents: research and evidence) section 1.2. Before allocating a new record, the allocator checks whether the source is already registered to avoid duplicates.

**ID-width note.** Both EV IDs and SRC IDs are zero-padded four-digit integers: `EV-nnnn` (for example, `EV-0012`) and `SRC-nnnn` (for example, `SRC-0004`). The three-digit form that appeared in earlier examples is superseded. Four digits is authoritative per the TSK-015 (ledger grammar) adjudication (2026-07-18), which supersedes the prior controller ruling for this task.

## Field grammar

Each record is a Markdown bullet list directly under its heading. The parser reads each line as `- key: value`. The ten fields below are the complete set.

| Field | Type | Required | Allowed values and notes |
|---|---|---|---|
| `type` | enum | required | One of `book`, `article`, `web`, `interview`, `dataset`, `report`, `other` |
| `nature` | enum | required | One of `primary`, `secondary`; `type` records the medium while `nature` records the evidentiary standing the S-03 (research and evidence) protocol mandates so `drafting-partner` can signal it |
| `author` | string | required | Author name(s); multiple authors separated by semicolons |
| `title` | string | required | Full title of the work |
| `year` | integer | required | Publication year as a four-digit integer |
| `publisher` | string | optional | Publisher name; may be blank for web and dataset sources |
| `identifier` | string | optional | ISBN, DOI, or other persistent identifier; may be blank |
| `url` | string | optional | Canonical URL if the source is web-accessible; may be blank |
| `accessed` | YYYY-MM-DD | optional | Date the URL was last accessed; may be blank for non-web sources |
| `retrieval-status` | enum | required | One of `stable`, `unstable`, `unverifiable` |

### Type values

| Value | Use for |
|---|---|
| `book` | Monograph, edited volume, or book chapter |
| `article` | Journal article, magazine piece, or newspaper article |
| `web` | Web page, blog post, or online document without a print equivalent |
| `interview` | Personal interview, oral history, or transcript |
| `dataset` | Numeric or structured data file |
| `report` | Government, institutional, or industry report |
| `other` | Any source that does not fit the above categories |

### Nature values

| Value | Use for |
|---|---|
| `primary` | Original study, dataset, interview, legal text, or first-person account |
| `secondary` | Synthesis, commentary, or a report citing another source |

### Retrieval-status values

| Value | Meaning |
|---|---|
| `stable` | The source is a durable artifact (print, archival digital) not expected to change |
| `unstable` | The source is online and may change or disappear; a `url` and `accessed` date are important |
| `unverifiable` | The online resolution pass failed to resolve the DOI or URL; this value drives `[SOURCE-UNVERIFIABLE]` markers in chapters |

## Ordering and placement rules

- New records are appended at the end of the file.
- `research-librarian` and `citation-manager` are the only writers.
- A record is never deleted; the `retrieval-status` field is updated if a source is retracted or becomes unresolvable.
- When `research-librarian` corrects a prior record (for example, fixing a locator or publication date), it appends `changed: true` and a `change-note: <reason>` field to the affected record. `fact-checker` scans for `changed: true` at the start of each session to invalidate its verified-claims cache for all EV entries whose `source` field references the changed SRC ID.
- `bin/ns-doctor` reports any SRC ID referenced in `research/evidence-log.md` with no corresponding record here, and any record here that no EV entry references (orphaned source).

## Example

```markdown
### SRC-0004 (Make It Stick)
- type: book
- nature: secondary
- author: Brown, Peter C.; Roediger, Henry L.; McDaniel, Mark A.
- title: Make It Stick: The Science of Successful Learning
- year: 2014
- publisher: Belknap Press
- identifier: ISBN 978-0674729018
- url:
- accessed:
- retrieval-status: stable
```

## Consumed by

- `bin/ns-claims` (TSK-025 (ns-claims engine)): cross-references every `source` field in `research/evidence-log.md` against records here; reports missing or orphaned source IDs.
- `bin/ns-doctor` (TSK-028 (ns-doctor engine)): validates field presence, value constraints, and bidirectional EV-SRC linkage; warns on orphaned SRC records.
- `citation-manager`: the sole source of all citation data for formatted output and bibliography assembly; never retrieves bibliographic data from any other location.
- `fact-checker`: reads records and scans for `changed: true` flags to invalidate cached verifications before each pass.
