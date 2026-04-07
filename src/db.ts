import { createDb9Client, type Db9Client } from "get-db9";
import WebSocket from "ws";
import type { WikiConfig } from "./config.js";

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS embedding;

CREATE TABLE IF NOT EXISTS wiki_index (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  content_vec VECTOR(1024),
  tags TEXT[] DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TABLE IF EXISTS wiki_sources;

CREATE TABLE IF NOT EXISTS wiki_page_sources (
  page_slug TEXT NOT NULL,
  source_path TEXT NOT NULL,
  PRIMARY KEY (page_slug, source_path)
);
`;

// HNSW index created separately (fails silently if exists)
const INDEX_SQL = `CREATE INDEX idx_wiki_vec ON wiki_index USING hnsw (content_vec vector_cosine_ops);`;
const PAGE_SOURCES_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_wiki_page_sources_source_path ON wiki_page_sources (source_path);`;

export function createClient(config: WikiConfig): Db9Client {
  return createDb9Client({
    token: config.db9.token,
    WebSocket: WebSocket as unknown as undefined,
  });
}

export async function initSchema(client: Db9Client, dbId: string): Promise<void> {
  const result = await client.databases.sql(dbId, SCHEMA_SQL);
  if (result.error) {
    throw new Error(`Schema init failed: ${JSON.stringify(result.error)}`);
  }
  // Try creating HNSW index, ignore if already exists
  await client.databases.sql(dbId, INDEX_SQL);
  await client.databases.sql(dbId, PAGE_SOURCES_INDEX_SQL);
}

export async function execSql(
  client: Db9Client,
  dbId: string,
  sql: string,
): Promise<{ columns: { name: string; type: string }[]; rows: unknown[][]; row_count: number }> {
  const result = await client.databases.sql(dbId, sql);
  if (result.error) {
    throw new Error(`SQL error: ${JSON.stringify(result.error)}`);
  }
  return { columns: result.columns, rows: result.rows, row_count: result.row_count };
}
