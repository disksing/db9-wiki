import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, lstat, readlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb9Client } from "get-db9";

let testDir: string;
let dbId: string;
let token: string;
let tokenId: string;
let db9Client: ReturnType<typeof createDb9Client>;
let createdDatabase = false;
let createdToken = false;

function run(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    cwd: cwd ?? testDir,
    encoding: "utf-8",
    timeout: 60_000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  }).trim();
}

describe("db9-wiki integration", () => {
  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "db9-wiki-test-"));
    db9Client = createDb9Client();

    dbId = process.env.DB9_WIKI_TEST_DB_ID ?? "";
    if (!dbId) {
      try {
        const database = await db9Client.databases.create({
          name: `db9-wiki-test-${Date.now()}`,
        });
        dbId = database.id;
        createdDatabase = true;
      } catch (err) {
        throw new Error(
          `Failed to create a temporary DB9 database. If your account is at the database limit, set DB9_WIKI_TEST_DB_ID to a disposable existing database. Original error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    token = process.env.DB9_WIKI_TEST_TOKEN ?? "";
    if (!token) {
      const created = await db9Client.tokens.create({
        name: `db9-wiki-test-${Date.now()}`,
        expires_in_days: 1,
      });
      token = created.token;
      tokenId = created.id;
      createdToken = true;
    }
  }, 60_000);

  afterAll(async () => {
    if (createdToken && tokenId) {
      await db9Client.tokens.revoke(tokenId);
    }
    if (createdDatabase && dbId) {
      await db9Client.databases.delete(dbId);
    }
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("init creates project structure", async () => {
    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} init --db ${dbId} --token ${token} --name "Test Wiki"`, testDir);

    expect(output).toContain("Initializing db9-wiki");
    expect(output).toContain("Done!");

    const files = await readdir(testDir);
    expect(files).toContain("AGENTS.md");
    expect(files).toContain("db9-wiki.toml");
    expect(files).toContain("log.md");
    expect(files).toContain(".gitignore");
    expect(files).toContain(".agents");
    expect(files).toContain(".claude");
    expect(files).toContain("wiki");
    expect(files).toContain("sources");

    const skills = await readdir(join(testDir, ".agents", "skills"));
    expect(skills).toContain("ingest.md");
    expect(skills).toContain("query.md");
    expect(skills).toContain("lint.md");

    const claudeSkillsPath = join(testDir, ".claude", "skills");
    const claudeSkillsStat = await lstat(claudeSkillsPath);
    expect(claudeSkillsStat.isSymbolicLink()).toBe(true);
    expect(await readlink(claudeSkillsPath)).toBe("../.agents/skills");

    const config = await readFile(join(testDir, "db9-wiki.toml"), "utf-8");
    expect(config).toContain(dbId);
    expect(config).toContain('name = "Test Wiki"');

    const agents = await readFile(join(testDir, "AGENTS.md"), "utf-8");
    expect(agents).toContain("Test Wiki");
    expect(agents).toContain("wiki/");
    expect(agents).toContain(".agents/skills/");
    expect(agents).toContain(".claude/skills/");
    expect(agents).toContain("If the wiki is empty, do not start creating pages immediately.");
    expect(agents).toContain("Agree on directory organization, whether to use subdirectories, primary language, and filename format");
    expect(agents).toContain("discuss the plan with the user before editing wiki pages");

    const ingestSkill = await readFile(join(testDir, ".agents", "skills", "ingest.md"), "utf-8");
    expect(ingestSkill).toContain("If the wiki already has a clear structure and the change is only a small addition or minor refinement that fits the existing framework, you may proceed directly");
    expect(ingestSkill).toContain("If the ingest would change structure, naming, scope, page boundaries, or linking strategy in a non-obvious way, discuss the plan with the user first");
    expect(ingestSkill).toContain("If the wiki is still empty, do not start writing pages immediately");
    expect(ingestSkill).toContain("write those rules into `AGENTS.md` before ingesting content");

    const gitignore = await readFile(join(testDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("db9-wiki.toml");
    expect(gitignore).toContain(".db9-wiki/");
  });

  it("init pulls existing remote wiki data", async () => {
    const remoteDir = await mkdtemp(join(tmpdir(), "db9-wiki-remote-init-"));

    await db9Client.fs.mkdir(dbId, "/wiki/remote");
    await db9Client.fs.mkdir(dbId, "/sources/2026-04-07");
    await db9Client.fs.write(
      dbId,
      "/wiki/remote/seeded.md",
      `---
title: Seeded Page
description: Pulled from remote fs9 during init
tags: [seeded]
sources: [2026-04-07/seed.txt]
updated: 2026-04-07
---

# Seeded Page

Pulled from remote.
`,
    );
    await db9Client.fs.write(dbId, "/sources/2026-04-07/seed.txt", "remote source");
    await db9Client.fs.write(dbId, "/log.md", "## [2026-04-07] seed | Remote init\n");

    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} init --db ${dbId} --token ${token} --name "Remote Wiki"`, remoteDir);

    expect(output).toContain("Pulling remote wiki data...");
    expect(output).toContain("pulled");

    const seededPage = await readFile(join(remoteDir, "wiki", "remote", "seeded.md"), "utf-8");
    expect(seededPage).toContain("Seeded Page");
    expect(seededPage).toContain("Pulled from remote.");

    const seededSource = await readFile(join(remoteDir, "sources", "2026-04-07", "seed.txt"), "utf-8");
    expect(seededSource).toContain("remote source");

    const remoteLog = await readFile(join(remoteDir, "log.md"), "utf-8");
    expect(remoteLog).toContain("Remote init");

    await rm(remoteDir, { recursive: true, force: true });
  });

  it("sync indexes wiki pages to DB9", async () => {
    await mkdir(join(testDir, "wiki", "javascript"), { recursive: true });
    await mkdir(join(testDir, "sources", "2026-04-07"), { recursive: true });

    await writeFile(
      join(testDir, "wiki", "javascript", "closures.md"),
      `---
title: JavaScript Closures
description: How closures work in JavaScript
tags: [javascript, functions]
sources: [2026-04-07/mdn.txt]
updated: 2026-04-07
---

# JavaScript Closures

A closure is a function that has access to variables from its outer scope.
`,
    );

    await writeFile(
      join(testDir, "wiki", "javascript", "promises.md"),
      `---
title: JavaScript Promises
description: Async programming with Promises
tags: [javascript, async]
sources: [2026-04-07/mdn.txt]
updated: 2026-04-07
---

# JavaScript Promises

Promises represent eventual completion of async operations.

## Related

- [[javascript/closures]]
`,
    );

    await writeFile(
      join(testDir, "sources", "2026-04-07", "mdn.txt"),
      "# MDN Web Docs\nReference material from MDN.",
    );

    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} sync`, testDir);

    expect(output).toContain("Sync complete");
    expect(output).toContain("2 created");
    expect(output).toContain("sources: 1 files synced, 1 referenced, 2 page-source links");

    const relationResult = await db9Client.databases.sql(
      dbId,
      "SELECT page_slug, source_path FROM wiki_page_sources ORDER BY page_slug, source_path",
    );
    expect(relationResult.rows).toEqual([
      ["javascript/closures", "2026-04-07/mdn.txt"],
      ["javascript/promises", "2026-04-07/mdn.txt"],
    ]);
  });

  it("sync skips unchanged fs9 files and prints progress logs", async () => {
    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} sync`, testDir);

    expect(output).toContain("Collected 2 wiki pages and 1 source files.");
    expect(output).toContain("Using lightweight sync since");
    expect(output).toContain("Checking page-source references (0 affected pages)...");
    expect(output).toContain("no page-source changes detected");
    expect(output).toContain("Syncing to fs9...");
    expect(output).toContain("fs9 sync complete (0 written, 0 skipped, 0 removed)");
    expect(output).toContain("wiki:    0 created, 0 updated, 0 deleted, 2 unchanged");

    const state = JSON.parse(await readFile(join(testDir, ".db9-wiki", "sync-state.json"), "utf-8"));
    expect(state.lastSuccessfulSyncAt).toBeTypeOf("string");
  });

  it("sync --full keeps full scan behavior", async () => {
    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} sync --full`, testDir);

    expect(output).toContain("Running full sync...");
    expect(output).toContain("Checking page-source references (2 links)...");
    expect(output).toContain("page-source links unchanged; skipping rebuild");
  });

  it("index lists all pages", async () => {
    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} index`, testDir);

    expect(output).toContain("javascript/closures");
    expect(output).toContain("javascript/promises");
    expect(output).toContain("JavaScript Closures");
    expect(output).toContain("JavaScript Promises");
    expect(output).toContain("Total: 2 pages");
  });

  it("search returns relevant pages", async () => {
    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} search "async programming"`, testDir);

    expect(output).toContain("javascript/promises");
  });

  it("status shows correct counts", async () => {
    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} status`, testDir);

    expect(output).toContain("Test Wiki");
    expect(output).toContain("Local pages:    2");
    expect(output).toContain("Indexed pages:  2");
    expect(output).toContain("Unindexed:      0");
    expect(output).toContain("Local sources:  1");
    expect(output).toContain("Referenced sources: 1");
    expect(output).toContain("Source links:   2");
    expect(output).toContain("Duplicate wiki filenames: none");
    expect(output).toContain("Ambiguous short wiki links: none");
    expect(output).toContain("Unreferenced source files: none");
  });

  it("status reports duplicate filenames, ambiguous links, and unreferenced sources", async () => {
    await mkdir(join(testDir, "wiki", "advanced"), { recursive: true });
    await writeFile(
      join(testDir, "wiki", "advanced", "closures.md"),
      `---
title: Advanced Closures
description: Advanced closure patterns
tags: [javascript, functions]
sources: [2026-04-07/mdn.txt]
updated: 2026-04-07
---

# Advanced Closures

More closure patterns.
`,
    );

    await writeFile(
      join(testDir, "wiki", "references.md"),
      `---
title: References
description: Cross-reference examples
tags: [references]
updated: 2026-04-07
---

# References

- [[closures]]
- [[closures | Closures overview]]
`,
    );

    await writeFile(
      join(testDir, "sources", "2026-04-07", "unreferenced.txt"),
      "Unused source file",
    );

    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} status`, testDir);

    expect(output).toContain("Duplicate wiki filenames:");
    expect(output).toContain("  closures");
    expect(output).toContain("    - advanced/closures");
    expect(output).toContain("    - javascript/closures");
    expect(output).toContain("Ambiguous short wiki links:");
    expect(output).toContain("  references -> [[closures]]");
    expect(output).toContain("  references -> [[closures | Closures overview]]");
    expect(output).toContain("matches: advanced/closures, javascript/closures");
    expect(output).toContain("Unreferenced source files:");
    expect(output).toContain("  - 2026-04-07/unreferenced.txt");

    await rm(join(testDir, "wiki", "advanced", "closures.md"));
    await rm(join(testDir, "wiki", "references.md"));
    await rm(join(testDir, "sources", "2026-04-07", "unreferenced.txt"));
  });

  it("sync detects updates and deletes", async () => {
    await writeFile(
      join(testDir, "wiki", "javascript", "closures.md"),
      `---
title: JavaScript Closures
description: How closures work in JavaScript — updated
tags: [javascript, functions, scope]
sources: [2026-04-07/mdn.txt]
updated: 2026-04-07
---

# JavaScript Closures

A closure is a function bundled with its lexical environment.
Closures are created every time a function is created.
`,
    );

    await rm(join(testDir, "wiki", "javascript", "promises.md"));

    const cliPath = join(process.cwd(), "src/cli.ts");
    const output = run(`npx tsx ${cliPath} sync`, testDir);

    expect(output).toContain("Using lightweight sync since");
    expect(output).toContain("1 updated");
    expect(output).toContain("1 deleted");
    expect(output).toContain("sources: 1 files synced, 1 referenced, 1 page-source links");

    const indexOutput = run(`npx tsx ${cliPath} index`, testDir);
    expect(indexOutput).toContain("Total: 1 pages");
    expect(indexOutput).not.toContain("promises");

    const relationResult = await db9Client.databases.sql(
      dbId,
      "SELECT page_slug, source_path FROM wiki_page_sources ORDER BY page_slug, source_path",
    );
    expect(relationResult.rows).toEqual([
      ["javascript/closures", "2026-04-07/mdn.txt"],
    ]);
    expect(await db9Client.fs.exists(dbId, "/wiki/javascript/promises.md")).toBe(false);
  });

  it("lightweight sync removes deleted source files from fs9", async () => {
    const cliPath = join(process.cwd(), "src/cli.ts");
    const tempSourcePath = join(testDir, "sources", "2026-04-07", "notes.txt");

    await writeFile(tempSourcePath, "temporary note");
    run(`npx tsx ${cliPath} sync`, testDir);
    expect(await db9Client.fs.exists(dbId, "/sources/2026-04-07/notes.txt")).toBe(true);

    await rm(tempSourcePath);
    const output = run(`npx tsx ${cliPath} sync`, testDir);

    expect(output).toContain("1 source files deleted");
    expect(await db9Client.fs.exists(dbId, "/sources/2026-04-07/notes.txt")).toBe(false);
  });

  it("lightweight sync detects newly added files even with older mtimes", async () => {
    const cliPath = join(process.cwd(), "src/cli.ts");
    const staleWikiPath = join(testDir, "wiki", "stale-import.md");

    await writeFile(
      staleWikiPath,
      `---
title: Stale Import
description: Added after the last sync but with an older mtime
tags: [test]
updated: 2026-04-07
---

# Stale Import

Imported later, but timestamp preserved.
`,
    );
    await utimes(staleWikiPath, new Date("2020-01-01T00:00:00.000Z"), new Date("2020-01-01T00:00:00.000Z"));

    const output = run(`npx tsx ${cliPath} sync`, testDir);

    expect(output).toContain("1 created");

    const indexOutput = run(`npx tsx ${cliPath} index`, testDir);
    expect(indexOutput).toContain("stale-import");
  });

  it("sync handles dollar-prefixed page content safely", async () => {
    const cliPath = join(process.cwd(), "src/cli.ts");
    try {
      await readFile(join(testDir, "db9-wiki.toml"), "utf-8");
    } catch {
      run(`npx tsx ${cliPath} init --db ${dbId} --token ${token} --name "Test Wiki"`, testDir);
    }

    await writeFile(
      join(testDir, "wiki", "shell-variables.md"),
      `---
title: Shell Variables
description: Shell snippets with dollar-prefixed tokens
tags: [shell, snippets]
updated: 2026-04-07
---

# Shell Variables

Keep shell snippets literal:

\`\`\`
status=$?;
echo "$status";
echo '$txt$';
price=$5
path='C:\\tmp\\wiki'
\`\`\`
`,
    );

    const output = run(`npx tsx ${cliPath} sync`, testDir);

    expect(output).toContain("Sync complete");
    expect(output).toContain("1 created");

    const indexOutput = run(`npx tsx ${cliPath} index`, testDir);
    expect(indexOutput).toContain("shell-variables");
    expect(indexOutput).toContain("Shell Variables");
  });
});
