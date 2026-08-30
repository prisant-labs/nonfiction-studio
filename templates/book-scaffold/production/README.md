<!-- production/README.md
     Output formats and production workflow for this project.
-->

# Production

## Output formats

The studio exports the manuscript via /export-manuscript in these formats:

- `docx` - Word document, standard for agent and publisher submissions
- `pdf` - Formatted PDF for review, distribution, or self-publishing
- `md` - Clean Markdown for archival or further processing

Exports are written to production/exports/ as `<title>.<format>`.

## Production steps

1. Complete all chapters and run /nfs-check-chapter on each.
2. Run /disclosure-report to generate the AI-use disclosure.
3. Run /publish-readiness for the pre-publication compliance checklist.
4. Run /export-manuscript [format] to assemble and export the final manuscript.

## Front and back matter

Edit production/front-matter.md and production/back-matter.md before exporting.
The export assembles them around the chapters in chapter-list order.
