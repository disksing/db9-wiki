export function agentsMdTemplate(wikiName: string): string {
  return `# ${wikiName}

This project is an LLM-maintained wiki — a structured, interlinked collection of markdown files.

## Structure

- \`wiki/\` — Wiki pages (one markdown file per topic)
- \`sources/\` — Raw source materials (immutable once ingested)
- \`.agents/skills/\` — Canonical skill files for operating the wiki
- \`.claude/skills/\` — Symlink to \`.agents/skills/\` for Claude compatibility
- \`log.md\` — Append-only edit log
- \`db9-wiki.toml\` — Configuration (do not modify manually)

## Page Format

Every wiki page must have YAML frontmatter:

\`\`\`markdown
---
title: Page Title
description: A short one-line summary of this page
tags: [tag1, tag2]
sources: [2026-04-07/filename.md]
updated: YYYY-MM-DD
---

# Page Title

Content here...

## Related

- [[other-page]]
- [[folder/other-page|Display Name]]
\`\`\`

## Source Storage Rules

- Copy a single file into \`sources/YYYY-MM-DD/<original-filename>\`
- Copy a directory into \`sources/YYYY-MM-DD/<original-directory>/\`
- If a file or directory name collides within the same date folder, rename it with a version suffix or timestamp
- In frontmatter, \`sources\` entries must be paths relative to \`sources/\` and must not include the \`sources/\` prefix

## Cross-References

Use Obsidian-style wiki links: \`[[FileName]]\` or \`[[path/to/file|Display Name]]\`.

- If a target filename is unique across \`wiki/\`, use the shortest filename form
- If multiple pages share the same filename, use the full path relative to \`wiki/\` without the \`wiki/\` prefix
- Do not include the \`.md\` extension in wiki links

## Workflow

1. After modifying any wiki pages or sources, run \`db9-wiki sync\` to update the search index
2. To find relevant pages, run \`db9-wiki search "query"\`
3. To see all pages, run \`db9-wiki index\`
4. To check wiki health, run \`db9-wiki status\`

## Initial Setup

If the wiki is empty, do not start creating pages immediately.

- First discuss the wiki conventions with the user
- Agree on directory organization, whether to use subdirectories, primary language, and filename format
- Write the agreed conventions back into this \`AGENTS.md\` file before ingesting content

## Available Skills

- **ingest** (\`.agents/skills/ingest.md\`) — Process new source material into wiki pages
- **query** (\`.agents/skills/query.md\`) — Search and answer questions from the wiki
- **lint** (\`.agents/skills/lint.md\`) — Health-check the wiki for issues

## Rules

- Every edit must be logged in \`log.md\`
- Pages should be focused on a single topic
- Always maintain cross-references between related pages
- Source files in \`sources/\` are immutable — never modify them after ingestion
- Use the shortest unique wiki link form, and switch to full relative paths when filenames collide
- When ingestion only adds or refines content within an established framework, direct edits are fine
- When ingestion affects structure, naming, scope, or conventions in a non-obvious way, discuss the plan with the user before editing wiki pages
`;
}
