export const skillIngestTemplate = `# Ingest

Process new source material into the wiki.

## Usage

\`/ingest <path-or-url>\` — Ingest a file, directory, or URL into the wiki.

## Steps

1. Read the source material provided by the user
2. Decide whether this ingest needs discussion before editing wiki pages
   - If the wiki already has a clear structure and the change is only a small addition or minor refinement that fits the existing framework, you may proceed directly
   - If the ingest would change structure, naming, scope, page boundaries, or linking strategy in a non-obvious way, discuss the plan with the user first
   - When discussion is needed, summarize the proposed new pages, updated pages, naming, and link strategy before editing
3. If the wiki is still empty, do not start writing pages immediately
   - First discuss and agree on the wiki's organization rules with the user
   - Cover at least directory structure, whether to use subdirectories, wiki language, and filename format
   - After agreement, write those rules into \`AGENTS.md\` before ingesting content
4. Copy the raw source into \`sources/\` using date-based storage rules:
   - A single file goes to \`sources/YYYY-MM-DD/<original-filename>\`
   - A directory goes to \`sources/YYYY-MM-DD/<original-directory>/\`
   - Preserve the original file or directory name whenever possible
   - If a name already exists inside that date folder, rename the incoming file or directory with a version suffix or timestamp
5. Run \`db9-wiki index\` to see existing wiki pages
6. Analyze the source content and decide:
   - Which new wiki pages to create
   - Which existing pages to update with new information
   - What cross-references to add using Obsidian-style wiki links
   - Use \`[[FileName]]\` when the target filename is unique in \`wiki/\`
   - Use \`[[path/to/file|Display Name]]\` when filenames collide, with the path relative to \`wiki/\` and no \`.md\` extension
7. Write/update markdown files in \`wiki/\` with proper frontmatter (title, description, tags, sources, updated)
   - The \`sources\` field must list paths relative to \`sources/\`, without the \`sources/\` prefix
   - Example: \`sources: [2026-04-07/original-file.pdf]\`
8. Append an entry to \`log.md\` in this format:
   \`\`\`
   ## [YYYY-MM-DD] ingest | Source Title
   - created \\\`slug\\\` — reason
   - updated \\\`slug\\\` — what changed
   \`\`\`
9. Run \`db9-wiki sync\` to update the search index and backup

## Guidelines

- Each page should focus on a single topic
- Keep pages concise but comprehensive
- A single source may touch 5-15 wiki pages
- Ingestion should be collaborative when structure, naming, or scope is uncertain, but straightforward additions within an established framework can be applied directly
- Always add cross-references between related pages
- Use descriptive slugs with directory structure (e.g., \`javascript/closures\`)
- Set the \`sources\` field in frontmatter to track provenance using \`sources/\`-relative paths
`;
