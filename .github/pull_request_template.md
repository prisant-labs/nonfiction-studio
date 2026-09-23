<!--
Thanks for contributing to Nonfiction Studio. See CONTRIBUTING.md for the full local battery,
commit message style, and mutation-proof expectations before you open this PR.
-->

## Summary

<!-- What changed, and why. Two or three sentences is usually enough. -->

## Related issue or discussion

<!-- Link an issue, or say "none" if this is unprompted. -->

## Test plan

Local battery (`CONTRIBUTING.md`, "The local battery" - every line below is one Tier A step):

- [ ] `node scripts/check.mjs --profile plain-plugin`
- [ ] `claude plugin validate --strict .`
- [ ] `node scripts/check-hooks-schema.mjs`
- [ ] `node scripts/check-frontmatter.mjs`
- [ ] `node scripts/check-docs-completeness.mjs`
- [ ] `node scripts/check-links.mjs`
- [ ] `node scripts/checks/check-plugin-root.mjs`
- [ ] `node scripts/check-self-sufficiency.mjs`
- [ ] `node scripts/checks/check-inventory.mjs`
- [ ] `node scripts/checks/check-workspace-refs.mjs`
- [ ] `node scripts/checks/check-skill-cli-targets.mjs`
- [ ] `node scripts/checks/check-advertised-invocations.mjs`
- [ ] `node scripts/checks/check-link-labels.mjs`
- [ ] `node scripts/checks/check-component-counts.mjs`
- [ ] `node scripts/checks/check-compliance-stanza.mjs`
- [ ] `node scripts/test-engines.mjs`
- [ ] `node scripts/test-fixtures.mjs`
- [ ] `node scripts/verify-sample-book.mjs`

If a new check or engine was added or changed:

- [ ] A test was written red first, against a planted, realistic violation (not a synthetic case the checker could only see in its own test file).
- [ ] The fix was reverted (or the specific condition flipped) to confirm the test actually fails without it - a checker that cannot fail is not a checker.
- [ ] Any bidirectional engine test runs against a temp clone, never a committed fixture.

## CHANGELOG entry

- [ ] Added an entry under `Unreleased` in `CHANGELOG.md`, written from what actually landed in this PR, not from what was planned.
- [ ] N/A - this change has no user- or contributor-visible effect (for example: internal test-only cleanup).

## No private paths

- [ ] This PR contains no machine-specific path, OS username, workstation name, or personal email address, and no bare filename or path segment belonging to a gitignored scratch directory.

## Checklist

- [ ] I read [CONTRIBUTING.md](https://github.com/prisant-labs/nonfiction-studio/blob/main/CONTRIBUTING.md).
- [ ] Component counts stated in any prose I added or edited match the plugin's true counts, or I avoided stating a count.
- [ ] Any new or edited Markdown link resolves, and its label names the component its target documents, where applicable.
