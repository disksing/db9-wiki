# db9-wiki

Agent-native LLM Wiki powered by [DB9](https://db9.io). Based on [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

Instead of traditional RAG, the LLM incrementally builds and maintains a persistent wiki — a structured, interlinked collection of markdown files. Instead of embedding LLM calls in the tool itself, db9-wiki generates `AGENTS.md` + skill files so any AI agent (Claude Code, Cursor, Windsurf, etc.) can operate the wiki directly.

## Why DB9

- DB9 has built-in vector support, which makes it a natural fit for powering vector indexes and semantic search for a knowledge base.
- A knowledge base can be shared simply by sharing the DB9 instance, making it easier to distribute pages, indexes, and backups across a team.

```
User ↔ AI Agent (Claude Code / Cursor / ...)
         │  reads AGENTS.md for instructions
         │  uses skills: ingest, query, lint
         │  reads/writes local markdown files
         ▼
    Local filesystem (primary)
    ├── wiki/       ← wiki pages
    ├── sources/    ← raw source materials
    └── log.md      ← edit history
         │
         │  db9-wiki sync
         ▼
    DB9 Database
    ├── wiki_index   ← vector search index
    ├── wiki_page_sources ← page ↔ source references
    ├── fs9:/wiki/   ← page backups
    └── fs9:/sources/← source backups
```

## Quick Start

```bash
# Create a DB9 database
db9 create --name my-wiki

# Create an API token
db9 token create --name wiki-agent

# Initialize the wiki
cd my-knowledge-base
db9-wiki init --db <database-id> --token <api-token>
```

This generates:

```
my-knowledge-base/
├── AGENTS.md          # Agent instructions (works with any AI agent)
├── .agents/
│   └── skills/
│       ├── ingest.md  # Ingest skill: process sources into wiki pages
│       ├── query.md   # Query skill: search + synthesize answers
│       └── lint.md    # Lint skill: health-check the wiki
├── .claude/
│   └── skills -> ../.agents/skills
├── db9-wiki.toml      # Config (DB9 credentials — auto-added to .gitignore)
├── log.md             # Append-only edit log
├── wiki/              # Wiki pages (markdown)
└── sources/           # Raw source materials
```

Now open the project with your AI agent and start using the skills.

## CLI Commands

```bash
db9-wiki init --db <id> --token <token>   # Initialize project + DB9 schema
db9-wiki sync                              # Sync local files → DB9 (vector index + fs9 backup)
db9-wiki search "query"                    # Semantic search across wiki pages
db9-wiki index                             # List all pages (slug, title, description, tags)
db9-wiki status                            # Wiki stats
```

## Skills

### ingest

Process new source material into wiki pages. The agent reads the source, copies it into `sources/YYYY-MM-DD/`, preserves the original file or directory name when possible, renames on conflicts, creates/updates wiki pages in `wiki/`, maintains Obsidian-style cross-references, and runs `db9-wiki sync`.

### query

Answer questions from the wiki. The agent runs `db9-wiki search` to find relevant pages, reads them, and synthesizes an answer. Valuable answers get written back as new wiki pages so explorations compound over time.

### lint

Health-check the wiki. The agent scans all pages for broken links, ambiguous short wiki links, orphan pages, missing frontmatter, stale content, duplicate topics, and unreferenced files in `sources/`. Reports findings and applies fixes after user confirmation.

## Wiki Page Format

```markdown
---
title: JavaScript Closures
description: How closures work in JavaScript
tags: [javascript, functions, scope]
sources: [2026-04-07/mdn-closures.md]
updated: 2026-04-07
---

# JavaScript Closures

A closure is a function bundled with its lexical environment.

## Related

- [[scope]]
- [[javascript/functions]]
```

Use `sources` entries as paths relative to `sources/` without the `sources/` prefix. Use Obsidian-style wiki links with the shortest unique filename, and switch to the full path relative to `wiki/` when filenames collide.

## Edit Log

Every operation is recorded in `log.md`:

```markdown
## [2026-04-07] ingest | MDN Closures Article
- created `javascript/closures` — extracted from 2026-04-07/mdn-closures.md
- updated `javascript/scope` — added [[javascript/closures]] reference

## [2026-04-07] query | What are closures?
- created `javascript/closures-explained` — captured query synthesis
```

## How Sync Works

`db9-wiki sync` diffs local files against DB9:

1. Scans `wiki/`, `sources/`, and `log.md`
2. Computes content hashes, compares with DB9 records
3. For changed wiki pages: generates embeddings via DB9's built-in `embedding()` function, upserts to `wiki_index`
4. Rebuilds `wiki_page_sources` from each page's `sources` frontmatter
5. Backs up all files to DB9's fs9 filesystem

## Development

```bash
npm install
npm run dev -- sync           # Run commands in dev mode
npm run build                 # Build with tsup
npm run typecheck             # Type check
npx vitest run                # Run integration tests (creates a temporary DB9 database by default)
```

If your account is already at the DB9 database limit, set `DB9_WIKI_TEST_DB_ID` to a disposable database reserved for tests. You can also set `DB9_WIKI_TEST_TOKEN` to provide an explicit test token.

## License

BSD-3-Clause
