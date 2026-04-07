export const skillQueryTemplate = `# Query

Search the wiki and synthesize answers.

## Usage

\`/query <question>\` — Ask a question and get an answer based on wiki content.

## Steps

1. Use hybrid search to find relevant pages:
   - Run \`db9-wiki search "<user's question>"\` for semantic (vector) search
   - Run \`grep -rl "<keyword>" wiki/\` for exact keyword matching in local files
   - Combine results from both — semantic search catches related concepts, grep catches exact terms
2. Read the returned markdown files from \`wiki/\`
3. Synthesize an answer based on the page contents
4. Cite relevant wiki pages using Obsidian-style wiki links
   - Use the shortest filename form when the target page name is unique
   - Use the full path relative to \`wiki/\` when filenames collide
5. If the answer produces valuable new knowledge or a useful synthesis:
   - Create a new wiki page capturing that knowledge
   - Update cross-references on related pages
   - Append to \`log.md\`:
     \`\`\`
     ## [YYYY-MM-DD] query | Question Summary
     - created \\\`slug\\\` — captured query synthesis
     \`\`\`
   - Run \`db9-wiki sync\`

## Guidelines

- Always ground answers in wiki content — don't fabricate
- If the wiki lacks information to answer, say so clearly
- Use both search methods: \`db9-wiki search\` for fuzzy/semantic matches, \`grep\` for precise keyword hits
- Valuable queries that produce new insights should be written back as pages
- This lets explorations compound over time
`;
