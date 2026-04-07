import { loadConfig } from "../config.js";
import { createClient, execSql } from "../db.js";

function escapeStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

export async function searchCommand(query: string) {
  const config = await loadConfig();
  const client = createClient(config);
  const dbId = config.db9.database;
  const topK = config.search.top_k;

  const result = await execSql(client, dbId, `
    SELECT slug, title, description, tags,
           vec_embed_cosine_distance(content_vec, E'${escapeStr(query)}') AS distance
    FROM wiki_index
    ORDER BY distance ASC
    LIMIT ${topK}
  `);

  if (result.rows.length === 0) {
    console.log("No results found.");
    return;
  }

  for (const row of result.rows) {
    const [slug, title, description, rawTags, distance] = row as [string, string, string, string | string[], number];
    const tags = Array.isArray(rawTags) ? rawTags : parsePgArray(rawTags);
    const score = (1 - distance).toFixed(3);
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
    console.log(`${slug} (${score})${tagStr}`);
    console.log(`  ${title}`);
    if (description) console.log(`  ${description}`);
    console.log();
  }
}

function parsePgArray(s: string | null | undefined): string[] {
  if (!s) return [];
  const inner = s.replace(/^\{|\}$/g, "");
  if (!inner) return [];
  return inner.split(",").map((t) => t.trim()).filter(Boolean);
}
