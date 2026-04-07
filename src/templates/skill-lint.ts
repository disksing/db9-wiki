export const skillLintTemplate = `# Lint

Health-check the wiki for issues.

## Usage

\`/lint\` — Run a full wiki health check.

## Steps

1. Run \`db9-wiki index\` to get all pages
2. Read all wiki pages from \`wiki/\`
3. Check for:
   - **Broken links**: \`[[slug]]\` references pointing to non-existent pages
   - **Ambiguous short wiki links**: Short links such as \`[[FileName]]\` used when multiple pages share that filename
   - **Orphan pages**: Pages with no incoming links and no source attribution
   - **Missing frontmatter**: Pages lacking required fields (title, description, tags, updated)
   - **Unreferenced source files**: Files in \`sources/\` that are not listed by any wiki page's \`sources\` field
   - **Stale content**: Pages whose sources have been updated but the page hasn't
   - **Duplicate topics**: Multiple pages covering the same subject
   - **Missing cross-references**: Related pages that should link to each other but don't
4. Present a report to the user with findings and suggested fixes
5. After user confirms, apply fixes:
   - Add missing cross-references
   - Update stale pages
   - Merge duplicate pages
   - Fix or remove broken links
6. Append to \`log.md\`:
   \`\`\`
   ## [YYYY-MM-DD] lint | Health Check
   - updated \\\`slug\\\` — fix description
   - deleted \\\`slug\\\` — reason
   \`\`\`
7. Run \`db9-wiki sync\`

## Guidelines

- Always present findings before making changes
- Wait for user confirmation before applying fixes
- Prefer merging over deleting when handling duplicates
- Respect the shortest-unique wiki link rule used by Obsidian-style wiki links
`;
