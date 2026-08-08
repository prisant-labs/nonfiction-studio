# Attribution: Vendored Validation Spine

## Source

**Upstream project:** agent-skills-toolkit
**Repository URL:** https://github.com/product-on-purpose/agent-skills-toolkit
**Commit SHA:** 3629b0ab31e1efdeb8a800abbd4f3543c580988f
**Copy date:** 2026-07-17

## License

This directory contains code copied from the upstream project (agent-skills-toolkit)
under the Apache License 2.0. The upstream LICENSE text governs these files.
Modifications, if ever made, will be marked in this file alongside the reason.

The vendored files carry no embedded copyright notices or per-file license headers of
their own; the upstream project (see Repository URL above) licenses its `scripts/` tree
under Apache License 2.0 at the repository level, not with per-file headers, and none
were removed in copying. The governing license text is bundled at
[`scripts/LICENSE-APACHE`](./LICENSE-APACHE) so it travels with these files independent
of the upstream repository. No substantive modifications have been made to vendored
files.

## Files vendored

The following files were copied verbatim from the `scripts/` tree of the upstream
repo at the commit SHA above:

- `check.mjs` - aggregate conformance gate entry point
- `tier-report.mjs` - tier report rendering (direct unconditional import of check.mjs;
  see discrepancy note below)
- `checks/` - all check modules (see module count below)
- `lib/` - all support modules (see module count below)
- `generators/gen-manifest.mjs`
- `generators/gen-index.mjs`
- `generators/sync-agents-md.mjs`

## Module counts (true counts recorded per TSK-002 (vendor the validation spine))

The task catalog (TSK-002 (vendor the validation spine)) stated the expected counts as
30 check modules and 13 lib modules. The upstream repo at the copied commit contains a
different count. Upstream is the truth; the catalog counts came from a review snapshot.

| Directory | Items copied | .mjs modules | README.md | Task catalog stated |
|---|---|---|---|---|
| checks/ | 32 | 31 | 1 | 30 |
| lib/ | 17 | 16 | 1 | 13 |

**Discrepancy:** upstream checks/ has 31 .mjs modules (1 more than the catalog stated
30), and upstream lib/ has 16 .mjs modules (3 more than the catalog stated 13). All
upstream files were copied; nothing was omitted or added.

## Contract gap: tier-report.mjs

Q-02 (CI pipeline) section 3.1 lists the vendor files but does not explicitly name
`tier-report.mjs`. However, `check.mjs` contains an unconditional top-level import of
`./tier-report.mjs`. Without it, `check.mjs` throws ERR_MODULE_NOT_FOUND at startup and
cannot run at all - violating the TSK-002 (vendor the validation spine) acceptance
criterion that the spine run and print a tier report.

Resolution: `tier-report.mjs` was copied as a required transitive dependency of
`check.mjs`. The copy is byte-identical to upstream. The Q-02 section 3.1 vendor list
has an omission; this note records the gap and the resolution rationale for future
reviewers.

## Re-sync policy

Do not re-sync this vendored tree speculatively. See Q-02 (CI pipeline) section 3.4 for
the conditions and procedure for a deliberate re-sync.
