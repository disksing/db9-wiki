import { loadConfig } from "../config.js";
import { createClient, execSql } from "../db.js";

export async function indexCommand() {
  const config = await loadConfig();
  const client = createClient(config);
  const dbId = config.db9.database;

  const result = await execSql(client, dbId,
    "SELECT slug, title, description, tags FROM wiki_index ORDER BY slug"
  );

  if (result.rows.length === 0) {
    console.log("No pages in the wiki yet.");
    return;
  }

  for (const row of result.rows) {
    const [slug, title, description, rawTags] = row as [string, string, string, string | string[]];
    const tags = Array.isArray(rawTags) ? rawTags : parsePgArray(rawTags);
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
    console.log(`${slug}${tagStr}`);
    console.log(`  ${title}`);
    if (description) console.log(`  ${description}`);
    console.log();
  }

  console.log(`Total: ${result.rows.length} pages`);
}

function parsePgArray(s: string | null | undefined): string[] {
  if (!s) return [];
  // PostgreSQL array format: {val1,val2,val3}
  const inner = s.replace(/^\{|\}$/g, "");
  if (!inner) return [];
  return inner.split(",").map((t) => t.trim()).filter(Boolean);
}
