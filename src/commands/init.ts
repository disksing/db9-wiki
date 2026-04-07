import { writeFile, mkdir, access, lstat, readlink, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { agentsMdTemplate } from "../templates/agents-md.js";
import { skillIngestTemplate } from "../templates/skill-ingest.js";
import { skillQueryTemplate } from "../templates/skill-query.js";
import { skillLintTemplate } from "../templates/skill-lint.js";
import { createClient, initSchema } from "../db.js";
import type { WikiConfig } from "../config.js";
import type { Db9Client } from "get-db9";

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function writeIfMissing(path: string, content: string) {
  try {
    await access(path);
    console.log(`  skip ${path} (exists)`);
  } catch {
    await writeFile(path, content, "utf-8");
    console.log(`  create ${path}`);
  }
}

async function ensureSymlink(path: string, target: string) {
  try {
    const stat = await lstat(path);
    if (!stat.isSymbolicLink()) {
      console.log(`  skip ${path} (exists and is not a symlink)`);
      return;
    }

    const existingTarget = await readlink(path);
    if (existingTarget === target) {
      console.log(`  skip ${path} (symlink exists)`);
      return;
    }

    console.log(`  skip ${path} (points to ${existingTarget})`);
  } catch {
    await symlink(target, path, "dir");
    console.log(`  create ${path} -> ${target}`);
  }
}

async function writeBinaryIfMissing(path: string, content: Uint8Array) {
  try {
    await access(path);
    console.log(`  skip ${path} (exists)`);
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    console.log(`  create ${path}`);
  }
}

function toRemotePath(basePath: string, childPath: string): string {
  if (childPath.startsWith("/")) return childPath;
  return `${basePath.replace(/\/$/, "")}/${childPath.replace(/^\//, "")}`;
}

async function pullRemoteTree(client: Db9Client, dbId: string, dir: string, remotePath: string): Promise<number> {
  if (!(await client.fs.exists(dbId, remotePath))) {
    return 0;
  }

  let downloaded = 0;
  const entries = await client.fs.list(dbId, remotePath);
  for (const entry of entries) {
    const childRemotePath = toRemotePath(remotePath, entry.path);
    if (entry.type === "dir") {
      downloaded += await pullRemoteTree(client, dbId, dir, childRemotePath);
      continue;
    }

    const localPath = join(dir, childRemotePath.replace(/^\//, ""));
    const content = await client.fs.readBinary(dbId, childRemotePath);
    await writeBinaryIfMissing(localPath, content);
    downloaded++;
  }

  return downloaded;
}

async function pullRemoteFile(client: Db9Client, dbId: string, dir: string, remotePath: string): Promise<boolean> {
  if (!(await client.fs.exists(dbId, remotePath))) {
    return false;
  }

  const localPath = join(dir, remotePath.replace(/^\//, ""));
  const content = await client.fs.readBinary(dbId, remotePath);
  await writeBinaryIfMissing(localPath, content);
  return true;
}

export async function initCommand(db: string, token: string, name: string) {
  const dir = process.cwd();
  const wikiName = name || "My Knowledge Base";

  console.log(`Initializing db9-wiki in ${dir}...\n`);

  // Create directories
  for (const sub of ["wiki", "sources", ".agents/skills", ".claude"]) {
    await ensureDir(join(dir, sub));
    console.log(`  create ${sub}/`);
  }

  // Write config
  const configContent = `[wiki]\nname = "${wikiName}"\n\n[db9]\ndatabase = "${db}"\ntoken = "${token}"\n\n[search]\ntop_k = 5\n`;
  await writeIfMissing(join(dir, "db9-wiki.toml"), configContent);

  // Write .gitignore entry for config (contains credentials)
  const gitignorePath = join(dir, ".gitignore");
  try {
    const { readFile } = await import("node:fs/promises");
    const existing = await readFile(gitignorePath, "utf-8");
    if (!existing.includes("db9-wiki.toml")) {
      await writeFile(gitignorePath, existing.trimEnd() + "\ndb9-wiki.toml\n", "utf-8");
      console.log(`  update .gitignore`);
    }
  } catch {
    await writeFile(gitignorePath, "db9-wiki.toml\n", "utf-8");
    console.log(`  create .gitignore`);
  }

  // Write AGENTS.md
  await writeIfMissing(join(dir, "AGENTS.md"), agentsMdTemplate(wikiName));

  // Write skills
  await writeIfMissing(join(dir, ".agents", "skills", "ingest.md"), skillIngestTemplate);
  await writeIfMissing(join(dir, ".agents", "skills", "query.md"), skillQueryTemplate);
  await writeIfMissing(join(dir, ".agents", "skills", "lint.md"), skillLintTemplate);
  await ensureSymlink(join(dir, ".claude", "skills"), "../.agents/skills");

  // Initialize DB9 schema
  console.log(`\nInitializing DB9 schema...`);
  const config: WikiConfig = {
    wiki: { name: wikiName },
    db9: { database: db, token },
    search: { top_k: 5 },
  };
  try {
    const client = createClient(config);
    await initSchema(client, db);
    console.log(`  DB9 schema initialized`);

    console.log(`\nPulling remote wiki data...`);
    const pulledWiki = await pullRemoteTree(client, db, dir, "/wiki");
    const pulledSources = await pullRemoteTree(client, db, dir, "/sources");
    const pulledLog = await pullRemoteFile(client, db, dir, "/log.md");
    console.log(`  pulled ${pulledWiki} wiki files, ${pulledSources} source files${pulledLog ? ", 1 log file" : ""}`);
  } catch (err) {
    console.error(`  DB9 schema init failed: ${err instanceof Error ? err.message : err}`);
    console.error(`  You can retry later with: db9-wiki sync`);
  }

  // Write log.md
  await writeIfMissing(join(dir, "log.md"), "# Wiki Log\n");

  console.log(`\nDone! Open this directory with your AI agent to get started.`);
}
