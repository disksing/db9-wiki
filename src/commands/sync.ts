import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { createClient, execSql, initSchema } from "../db.js";
import { escapeSqlLiteral, escapeSqlString } from "../utils/sql.js";
import { collectSourceFiles, collectWikiPages, parseFrontmatter } from "../utils/wiki.js";

function escapeStr(s: string): string {
  return escapeSqlString(s);
}

function escapeArray(arr: string[]): string {
  if (arr.length === 0) return "'{}'";
  return `ARRAY[${arr.map((t) => `'${escapeStr(t)}'`).join(",")}]`;
}

export async function syncCommand() {
  const config = await loadConfig();
  const client = createClient(config);
  const dbId = config.db9.database;
  const dir = process.cwd();

  console.log("Scanning local files...");
  await initSchema(client, dbId);

  // Collect wiki pages
  const wikiDir = join(dir, "wiki");
  const wikiFiles = await collectWikiPages(wikiDir);

  // Collect sources
  const sourcesDir = join(dir, "sources");
  const sourceFiles = await collectSourceFiles(sourcesDir);

  // Get existing index from DB9
  const existing = await execSql(client, dbId, "SELECT slug, content_hash FROM wiki_index");
  const existingMap = new Map<string, string>();
  for (const row of existing.rows) {
    existingMap.set(row[0] as string, row[1] as string);
  }

  // Diff wiki pages
  let created = 0, updated = 0, deleted = 0, unchanged = 0;
  const localSlugs = new Set(wikiFiles.map((f) => f.slug));
  const pageSourceRows: Array<{ pageSlug: string; sourcePath: string }> = [];
  const referencedSourcePaths = new Set<string>();

  for (const file of wikiFiles) {
    const { title, description, tags, sources } = parseFrontmatter(file.content);
    const pageTitle = title || file.slug;
    const pageDesc = description || "";
    const embText = escapeSqlLiteral(file.content.slice(0, 8000));

    for (const sourcePath of sources) {
      pageSourceRows.push({ pageSlug: file.slug, sourcePath });
      referencedSourcePaths.add(sourcePath);
    }

    if (!existingMap.has(file.slug)) {
      // New page
      await execSql(client, dbId, `
        INSERT INTO wiki_index (slug, title, description, content_hash, content_vec, tags)
        VALUES ('${escapeStr(file.slug)}', ${escapeSqlLiteral(pageTitle)}, ${escapeSqlLiteral(pageDesc)},
                '${file.hash}', embedding(${embText})::vector(1024),
                ${escapeArray(tags)})
      `);
      created++;
    } else if (existingMap.get(file.slug) !== file.hash) {
      // Updated page
      await execSql(client, dbId, `
        UPDATE wiki_index
        SET title = ${escapeSqlLiteral(pageTitle)},
            description = ${escapeSqlLiteral(pageDesc)},
            content_hash = '${file.hash}',
            content_vec = embedding(${embText})::vector(1024),
            tags = ${escapeArray(tags)},
            updated_at = NOW()
        WHERE slug = '${escapeStr(file.slug)}'
      `);
      updated++;
    } else {
      unchanged++;
    }
  }

  // Delete removed pages
  for (const [slug] of existingMap) {
    if (!localSlugs.has(slug)) {
      await execSql(client, dbId, `DELETE FROM wiki_index WHERE slug = '${escapeStr(slug)}'`);
      deleted++;
    }
  }

  // Rebuild page -> source references
  await execSql(client, dbId, "DELETE FROM wiki_page_sources");
  for (const row of pageSourceRows) {
    await execSql(client, dbId, `
      INSERT INTO wiki_page_sources (page_slug, source_path)
      VALUES ('${escapeStr(row.pageSlug)}', '${escapeStr(row.sourcePath)}')
    `);
  }

  // Sync files to fs9
  console.log("Syncing to fs9...");
  try {
    for (const file of wikiFiles) {
      await client.fs.write(dbId, `/wiki/${file.path}`, file.content);
    }
    for (const file of sourceFiles) {
      await client.fs.write(dbId, `/sources/${file.path}`, file.bytes);
    }
    // Sync log.md
    try {
      const logContent = await readFile(join(dir, "log.md"), "utf-8");
      await client.fs.write(dbId, "/log.md", logContent);
    } catch { /* log.md may not exist */ }
    console.log("  fs9 sync complete");
  } catch (err) {
    console.error(`  fs9 sync failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log(`\nSync complete:`);
  console.log(`  wiki:    ${created} created, ${updated} updated, ${deleted} deleted, ${unchanged} unchanged`);
  console.log(`  sources: ${sourceFiles.length} files synced, ${referencedSourcePaths.size} referenced, ${pageSourceRows.length} page-source links`);
}
