import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { createClient, execSql, initSchema } from "../db.js";
import { escapeSqlLiteral, escapeSqlString } from "../utils/sql.js";
import {
  collectSourceFileEntries,
  collectWikiPageEntries,
  loadSourceFile,
  loadWikiPage,
  parseFrontmatter,
  type SourceFileEntry,
  type WikiPageEntry,
} from "../utils/wiki.js";

const SYNC_STATE_DIR = ".db9-wiki";
const SYNC_STATE_FILE = "sync-state.json";
const SYNC_STATE_VERSION = 1;

interface SyncOptions {
  full?: boolean;
}

interface SyncableFile {
  path: string;
  size: number;
  mtimeMs: number;
  write(): Promise<number>;
}

interface PageSourceRow {
  pageSlug: string;
  sourcePath: string;
}

interface SyncState {
  version: number;
  lastSuccessfulSyncAt: string;
  wikiPaths: string[];
  sourcePaths: string[];
  hasLogFile: boolean;
}

function isEntryChanged(
  entry: { path: string; mtimeMs: number },
  lastSyncMs: number,
  previousPaths: Set<string>,
): boolean {
  return entry.mtimeMs > lastSyncMs || !previousPaths.has(entry.path);
}

function escapeStr(s: string): string {
  return escapeSqlString(s);
}

function escapeArray(arr: string[]): string {
  if (arr.length === 0) return "'{}'";
  return `ARRAY[${arr.map((t) => `'${escapeStr(t)}'`).join(",")}]`;
}

function escapeSqlList(values: string[]): string {
  return values.map((value) => `'${escapeStr(value)}'`).join(", ");
}

function syncStatePath(dir: string): string {
  return join(dir, SYNC_STATE_DIR, SYNC_STATE_FILE);
}

async function loadSyncState(dir: string): Promise<SyncState | null> {
  try {
    const raw = await readFile(syncStatePath(dir), "utf-8");
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    if (
      parsed.version !== SYNC_STATE_VERSION
      || typeof parsed.lastSuccessfulSyncAt !== "string"
      || !Array.isArray(parsed.wikiPaths)
      || !Array.isArray(parsed.sourcePaths)
      || typeof parsed.hasLogFile !== "boolean"
    ) {
      return null;
    }
    return {
      version: SYNC_STATE_VERSION,
      lastSuccessfulSyncAt: parsed.lastSuccessfulSyncAt,
      wikiPaths: parsed.wikiPaths.filter((value): value is string => typeof value === "string"),
      sourcePaths: parsed.sourcePaths.filter((value): value is string => typeof value === "string"),
      hasLogFile: parsed.hasLogFile,
    };
  } catch {
    return null;
  }
}

async function saveSyncState(
  dir: string,
  wikiEntries: WikiPageEntry[],
  sourceEntries: SourceFileEntry[],
  hasLogFile: boolean,
): Promise<void> {
  const stateDir = join(dir, SYNC_STATE_DIR);
  await mkdir(stateDir, { recursive: true });
  const state: SyncState = {
    version: SYNC_STATE_VERSION,
    lastSuccessfulSyncAt: new Date().toISOString(),
    wikiPaths: wikiEntries.map((entry) => entry.path).sort(),
    sourcePaths: sourceEntries.map((entry) => entry.path).sort(),
    hasLogFile,
  };
  await writeFile(syncStatePath(dir), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function shouldWriteRemote(
  remote: { type: string; size: number; mtime: string } | null,
  local: { size: number; mtimeMs: number },
): boolean {
  if (!remote || remote.type !== "file") return true;
  if (remote.size !== local.size) return true;

  const remoteMtimeMs = Date.parse(remote.mtime);
  if (Number.isNaN(remoteMtimeMs)) return true;

  return remoteMtimeMs < local.mtimeMs;
}

function logProgress(label: string, current: number, total: number) {
  console.log(`  ${label}: ${current}/${total}`);
}

function pageSourceKey(row: PageSourceRow): string {
  return `${row.pageSlug}\0${row.sourcePath}`;
}

function pageSourceRowsEqual(local: PageSourceRow[], remote: PageSourceRow[]): boolean {
  if (local.length !== remote.length) return false;

  const remoteKeys = new Set(remote.map(pageSourceKey));
  for (const row of local) {
    if (!remoteKeys.has(pageSourceKey(row))) return false;
  }
  return true;
}

function buildPageSourceValues(rows: PageSourceRow[]): string {
  return rows
    .map((row) => `('${escapeStr(row.pageSlug)}', '${escapeStr(row.sourcePath)}')`)
    .join(",\n");
}

function chunkRows<T>(rows: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    chunks.push(rows.slice(start, start + chunkSize));
  }
  return chunks;
}

function toRemotePath(basePath: string, childPath: string): string {
  if (childPath.startsWith("/")) return childPath;
  return `${basePath.replace(/\/$/, "")}/${childPath.replace(/^\//, "")}`;
}

async function walkRemoteFiles(
  fsClient: { readdir(path: string): Promise<Array<{ path: string; type: string }>> },
  remotePath: string,
): Promise<string[]> {
  let entries: Array<{ path: string; type: string }>;
  try {
    entries = await fsClient.readdir(remotePath);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const childPath = toRemotePath(remotePath, entry.path);
    if (entry.type === "dir") {
      files.push(...(await walkRemoteFiles(fsClient, childPath)));
      continue;
    }
    files.push(childPath);
  }
  return files;
}

async function syncPageSourceReferencesFull(
  client: ReturnType<typeof createClient>,
  dbId: string,
  pageSourceRows: PageSourceRow[],
): Promise<void> {
  console.log(`Checking page-source references (${pageSourceRows.length} links)...`);
  const existing = await execSql(
    client,
    dbId,
    "SELECT page_slug, source_path FROM wiki_page_sources ORDER BY page_slug, source_path",
  );
  const existingRows: PageSourceRow[] = existing.rows.map((row) => ({
    pageSlug: row[0] as string,
    sourcePath: row[1] as string,
  }));

  if (pageSourceRowsEqual(pageSourceRows, existingRows)) {
    console.log("  page-source links unchanged; skipping rebuild");
    return;
  }

  console.log("  page-source links changed; rebuilding...");
  await execSql(client, dbId, "DELETE FROM wiki_page_sources");
  if (pageSourceRows.length === 0) {
    console.log("  page-source links: 0/0");
    return;
  }

  const chunks = chunkRows(pageSourceRows, 200);
  for (const [index, chunk] of chunks.entries()) {
    await execSql(client, dbId, `
      INSERT INTO wiki_page_sources (page_slug, source_path)
      VALUES ${buildPageSourceValues(chunk)}
    `);
    logProgress("page-source links", Math.min((index + 1) * 200, pageSourceRows.length), pageSourceRows.length);
  }
}

async function syncPageSourceReferencesLightweight(
  client: ReturnType<typeof createClient>,
  dbId: string,
  pageSourceRows: PageSourceRow[],
  affectedSlugs: string[],
): Promise<void> {
  console.log(`Checking page-source references (${affectedSlugs.length} affected pages)...`);
  if (affectedSlugs.length === 0) {
    console.log("  no page-source changes detected");
    return;
  }

  const existing = await execSql(
    client,
    dbId,
    `SELECT page_slug, source_path FROM wiki_page_sources WHERE page_slug IN (${escapeSqlList(affectedSlugs)}) ORDER BY page_slug, source_path`,
  );
  const existingRows: PageSourceRow[] = existing.rows.map((row) => ({
    pageSlug: row[0] as string,
    sourcePath: row[1] as string,
  }));

  if (pageSourceRowsEqual(pageSourceRows, existingRows)) {
    console.log("  page-source links unchanged; skipping update");
    return;
  }

  console.log("  page-source links changed; updating affected pages...");
  await execSql(client, dbId, `DELETE FROM wiki_page_sources WHERE page_slug IN (${escapeSqlList(affectedSlugs)})`);
  if (pageSourceRows.length === 0) {
    console.log("  page-source links: 0/0");
    return;
  }

  const chunks = chunkRows(pageSourceRows, 200);
  for (const [index, chunk] of chunks.entries()) {
    await execSql(client, dbId, `
      INSERT INTO wiki_page_sources (page_slug, source_path)
      VALUES ${buildPageSourceValues(chunk)}
    `);
    logProgress("page-source links", Math.min((index + 1) * 200, pageSourceRows.length), pageSourceRows.length);
  }
}

async function syncFs9Files(
  files: SyncableFile[],
  statsLabel: string,
  progressLabel: string,
  statFile?: (path: string) => Promise<{ type: string; size: number; mtime: string }>,
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;

  if (files.length === 0) {
    console.log(`  ${statsLabel}: no local files`);
    return { written, skipped };
  }

  const progressInterval = Math.max(1, Math.min(25, Math.floor(files.length / 4)));
  for (const [index, file] of files.entries()) {
    let shouldWrite = true;
    if (statFile) {
      let remote: { type: string; size: number; mtime: string } | null = null;
      try {
        remote = await statFile(file.path);
      } catch {
        remote = null;
      }
      shouldWrite = shouldWriteRemote(remote, file);
    }

    if (shouldWrite) {
      await file.write();
      written++;
    } else {
      skipped++;
    }

    const processed = index + 1;
    if (processed === files.length || processed % progressInterval === 0) {
      logProgress(progressLabel, processed, files.length);
    }
  }

  console.log(`  ${statsLabel}: ${written} written, ${skipped} skipped`);
  return { written, skipped };
}

async function removeFs9Paths(
  paths: string[],
  statsLabel: string,
  progressLabel: string,
  removePath: (path: string) => Promise<void>,
): Promise<number> {
  if (paths.length === 0) {
    console.log(`  ${statsLabel}: no remote files to remove`);
    return 0;
  }

  let removed = 0;
  const progressInterval = Math.max(1, Math.min(25, Math.floor(paths.length / 4)));
  for (const [index, path] of paths.entries()) {
    await removePath(path);
    removed++;
    const processed = index + 1;
    if (processed === paths.length || processed % progressInterval === 0) {
      logProgress(progressLabel, processed, paths.length);
    }
  }

  console.log(`  ${statsLabel}: ${removed} removed`);
  return removed;
}

async function buildLogSyncFile(
  dir: string,
  writer: (path: string, content: string) => Promise<number>,
): Promise<SyncableFile | null> {
  const logPath = join(dir, "log.md");
  try {
    const [logContent, logStats] = await Promise.all([
      readFile(logPath, "utf-8"),
      stat(logPath),
    ]);
    return {
      path: "/log.md",
      size: logStats.size,
      mtimeMs: logStats.mtimeMs,
      write: () => writer("/log.md", logContent),
    };
  } catch {
    return null;
  }
}

async function performFullSync(
  client: ReturnType<typeof createClient>,
  dbId: string,
  dir: string,
  wikiEntries: WikiPageEntry[],
  sourceEntries: SourceFileEntry[],
): Promise<{ created: number; updated: number; deleted: number; unchanged: number; fs9Succeeded: boolean; referencedSourcePaths: Set<string>; pageSourceRows: PageSourceRow[]; hasLogFile: boolean }> {
  const wikiFiles = await Promise.all(wikiEntries.map(loadWikiPage));
  const sourceFiles = await Promise.all(sourceEntries.map(loadSourceFile));

  console.log("Loading remote wiki index...");
  const existing = await execSql(client, dbId, "SELECT slug, content_hash FROM wiki_index");
  const existingMap = new Map<string, string>();
  for (const row of existing.rows) {
    existingMap.set(row[0] as string, row[1] as string);
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let unchanged = 0;
  const localSlugs = new Set(wikiFiles.map((file) => file.slug));
  const pageSourceRows: PageSourceRow[] = [];
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
      await execSql(client, dbId, `
        INSERT INTO wiki_index (slug, title, description, content_hash, content_vec, tags)
        VALUES ('${escapeStr(file.slug)}', ${escapeSqlLiteral(pageTitle)}, ${escapeSqlLiteral(pageDesc)},
                '${file.hash}', embedding(${embText})::vector(1024),
                ${escapeArray(tags)})
      `);
      created++;
    } else if (existingMap.get(file.slug) !== file.hash) {
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

  for (const [slug] of existingMap) {
    if (!localSlugs.has(slug)) {
      await execSql(client, dbId, `DELETE FROM wiki_index WHERE slug = '${escapeStr(slug)}'`);
      deleted++;
    }
  }
  console.log(`Wiki index diff complete: ${created} created, ${updated} updated, ${deleted} deleted, ${unchanged} unchanged.`);

  await syncPageSourceReferencesFull(client, dbId, pageSourceRows);

  console.log("Syncing to fs9...");
  let fs9Succeeded = true;
  const hasLogFile = await stat(join(dir, "log.md")).then(() => true).catch(() => false);
  try {
    const fsClient = await client.fs.connect(dbId);
    try {
      const wikiSyncFiles: SyncableFile[] = wikiFiles.map((file) => ({
        path: `/wiki/${file.path}`,
        size: file.size,
        mtimeMs: file.mtimeMs,
        write: () => fsClient.writeFile(`/wiki/${file.path}`, file.content),
      }));
      const sourceSyncFiles: SyncableFile[] = sourceFiles.map((file) => ({
        path: `/sources/${file.path}`,
        size: file.size,
        mtimeMs: file.mtimeMs,
        write: () => fsClient.writeFile(`/sources/${file.path}`, file.bytes),
      }));
      const logSyncFile = await buildLogSyncFile(dir, (path, content) => fsClient.writeFile(path, content));
      const currentRemotePaths = new Set([
        ...wikiSyncFiles.map((file) => file.path),
        ...sourceSyncFiles.map((file) => file.path),
        ...(logSyncFile ? [logSyncFile.path] : []),
      ]);
      const staleRemotePaths = [
        ...(await walkRemoteFiles(fsClient, "/wiki")).filter((path) => !currentRemotePaths.has(path)),
        ...(await walkRemoteFiles(fsClient, "/sources")).filter((path) => !currentRemotePaths.has(path)),
      ];
      const shouldRemoveLog = !logSyncFile && await fsClient.stat("/log.md").then(() => true).catch(() => false);
      if (shouldRemoveLog) {
        staleRemotePaths.push("/log.md");
      }

      const wikiFs9 = await syncFs9Files(wikiSyncFiles, "wiki files", "wiki files", (path) => fsClient.stat(path));
      const sourceFs9 = await syncFs9Files(sourceSyncFiles, "source files", "source files", (path) => fsClient.stat(path));
      const logFs9 = logSyncFile
        ? await syncFs9Files([logSyncFile], "log file", "log file", (path) => fsClient.stat(path))
        : { written: 0, skipped: 0 };
      const removedFs9 = await removeFs9Paths(staleRemotePaths, "stale remote files", "stale remote files", (path) => fsClient.rm(path, false));

      console.log(
        `  fs9 sync complete (${wikiFs9.written + sourceFs9.written + logFs9.written} written, ${wikiFs9.skipped + sourceFs9.skipped + logFs9.skipped} skipped, ${removedFs9} removed)`,
      );
    } finally {
      await fsClient.close();
    }
  } catch (err) {
    fs9Succeeded = false;
    console.error(`  fs9 sync failed: ${err instanceof Error ? err.message : err}`);
  }

  return { created, updated, deleted, unchanged, fs9Succeeded, referencedSourcePaths, pageSourceRows, hasLogFile };
}

async function performLightweightSync(
  client: ReturnType<typeof createClient>,
  dbId: string,
  dir: string,
  state: SyncState,
  wikiEntries: WikiPageEntry[],
  sourceEntries: SourceFileEntry[],
): Promise<{ created: number; updated: number; deleted: number; unchanged: number; fs9Succeeded: boolean; referencedSourcePaths: Set<string>; pageSourceRows: PageSourceRow[]; hasLogFile: boolean }> {
  const lastSyncMs = Date.parse(state.lastSuccessfulSyncAt);
  if (Number.isNaN(lastSyncMs)) {
    throw new Error("Stored sync state has an invalid timestamp. Re-run with `db9-wiki sync --full` once to reset it.");
  }

  const currentWikiPaths = new Set(wikiEntries.map((entry) => entry.path));
  const currentSourcePaths = new Set(sourceEntries.map((entry) => entry.path));
  const previousWikiPaths = new Set(state.wikiPaths);
  const previousSourcePaths = new Set(state.sourcePaths);
  const changedWikiEntries = wikiEntries.filter((entry) => isEntryChanged(entry, lastSyncMs, previousWikiPaths));
  const changedSourceEntries = sourceEntries.filter((entry) => isEntryChanged(entry, lastSyncMs, previousSourcePaths));
  const deletedWikiPaths = state.wikiPaths.filter((path) => !currentWikiPaths.has(path));
  const deletedWikiSlugs = state.wikiPaths
    .filter((path) => !currentWikiPaths.has(path))
    .map((path) => path.replace(/\.md$/, ""));
  const deletedSourcePaths = state.sourcePaths.filter((path) => !currentSourcePaths.has(path));

  console.log(
    `Using lightweight sync since ${state.lastSuccessfulSyncAt} (${changedWikiEntries.length} wiki pages changed, ${changedSourceEntries.length} source files changed, ${deletedWikiSlugs.length} wiki pages deleted, ${deletedSourcePaths.length} source files deleted).`,
  );

  const changedWikiFiles = await Promise.all(changedWikiEntries.map(loadWikiPage));
  const changedSourceFiles = await Promise.all(changedSourceEntries.map(loadSourceFile));
  const referencedSourcePaths = new Set<string>();
  const pageSourceRows: PageSourceRow[] = [];

  let created = 0;
  let updated = 0;
  let deleted = 0;

  const affectedSlugs = Array.from(new Set([
    ...changedWikiFiles.map((file) => file.slug),
    ...deletedWikiSlugs,
  ]));

  let existingMap = new Map<string, string>();
  if (affectedSlugs.length > 0) {
    console.log("Loading affected remote wiki index rows...");
    const existing = await execSql(
      client,
      dbId,
      `SELECT slug, content_hash FROM wiki_index WHERE slug IN (${escapeSqlList(affectedSlugs)})`,
    );
    existingMap = new Map(existing.rows.map((row) => [row[0] as string, row[1] as string]));
  }

  for (const file of changedWikiFiles) {
    const { title, description, tags, sources } = parseFrontmatter(file.content);
    const pageTitle = title || file.slug;
    const pageDesc = description || "";
    const embText = escapeSqlLiteral(file.content.slice(0, 8000));

    for (const sourcePath of sources) {
      pageSourceRows.push({ pageSlug: file.slug, sourcePath });
      referencedSourcePaths.add(sourcePath);
    }

    if (!existingMap.has(file.slug)) {
      await execSql(client, dbId, `
        INSERT INTO wiki_index (slug, title, description, content_hash, content_vec, tags)
        VALUES ('${escapeStr(file.slug)}', ${escapeSqlLiteral(pageTitle)}, ${escapeSqlLiteral(pageDesc)},
                '${file.hash}', embedding(${embText})::vector(1024),
                ${escapeArray(tags)})
      `);
      created++;
    } else if (existingMap.get(file.slug) !== file.hash) {
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
    }
  }

  if (deletedWikiSlugs.length > 0) {
    await execSql(client, dbId, `DELETE FROM wiki_index WHERE slug IN (${escapeSqlList(deletedWikiSlugs)})`);
    deleted = deletedWikiSlugs.length;
  }
  const unchanged = wikiEntries.length - created - updated;
  console.log(`Wiki index diff complete: ${created} created, ${updated} updated, ${deleted} deleted, ${unchanged} unchanged.`);

  await syncPageSourceReferencesLightweight(client, dbId, pageSourceRows, affectedSlugs);

  console.log("Syncing to fs9...");
  let fs9Succeeded = true;
  const hasLogFile = await stat(join(dir, "log.md")).then(() => true).catch(() => false);
  try {
    const fsClient = await client.fs.connect(dbId);
    try {
      const wikiSyncFiles: SyncableFile[] = changedWikiFiles.map((file) => ({
        path: `/wiki/${file.path}`,
        size: file.size,
        mtimeMs: file.mtimeMs,
        write: () => fsClient.writeFile(`/wiki/${file.path}`, file.content),
      }));
      const sourceSyncFiles: SyncableFile[] = changedSourceFiles.map((file) => ({
        path: `/sources/${file.path}`,
        size: file.size,
        mtimeMs: file.mtimeMs,
        write: () => fsClient.writeFile(`/sources/${file.path}`, file.bytes),
      }));
      const actualLogSyncFile = await buildLogSyncFile(dir, (path, content) => fsClient.writeFile(path, content));
      const changedLogSyncFile = actualLogSyncFile && (actualLogSyncFile.mtimeMs > lastSyncMs || !state.hasLogFile)
        ? [actualLogSyncFile]
        : [];
      const deletedRemotePaths = [
        ...deletedWikiPaths.map((path) => `/wiki/${path}`),
        ...deletedSourcePaths.map((path) => `/sources/${path}`),
        ...(state.hasLogFile && !hasLogFile ? ["/log.md"] : []),
      ];

      const wikiFs9 = await syncFs9Files(wikiSyncFiles, "wiki files", "wiki files");
      const sourceFs9 = await syncFs9Files(sourceSyncFiles, "source files", "source files");
      const logFs9 = await syncFs9Files(changedLogSyncFile, "log file", "log file");
      const removedFs9 = await removeFs9Paths(deletedRemotePaths, "deleted local files", "deleted local files", (path) => fsClient.rm(path, false));

      console.log(
        `  fs9 sync complete (${wikiFs9.written + sourceFs9.written + logFs9.written} written, ${wikiFs9.skipped + sourceFs9.skipped + logFs9.skipped} skipped, ${removedFs9} removed)`,
      );
    } finally {
      await fsClient.close();
    }
  } catch (err) {
    fs9Succeeded = false;
    console.error(`  fs9 sync failed: ${err instanceof Error ? err.message : err}`);
  }

  return { created, updated, deleted, unchanged, fs9Succeeded, referencedSourcePaths, pageSourceRows, hasLogFile };
}

export async function syncCommand(options: SyncOptions = {}) {
  const config = await loadConfig();
  const client = createClient(config);
  const dbId = config.db9.database;
  const dir = process.cwd();

  console.log("Scanning local files...");
  await initSchema(client, dbId);

  const wikiDir = join(dir, "wiki");
  const wikiEntries = await collectWikiPageEntries(wikiDir);
  const sourcesDir = join(dir, "sources");
  const sourceEntries = await collectSourceFileEntries(sourcesDir);
  console.log(`Collected ${wikiEntries.length} wiki pages and ${sourceEntries.length} source files.`);

  let result;
  if (options.full) {
    console.log("Running full sync...");
    result = await performFullSync(client, dbId, dir, wikiEntries, sourceEntries);
  } else {
    const state = await loadSyncState(dir);
    if (!state) {
      console.log("No previous successful sync state found; running full sync.");
      result = await performFullSync(client, dbId, dir, wikiEntries, sourceEntries);
    } else {
      result = await performLightweightSync(client, dbId, dir, state, wikiEntries, sourceEntries);
    }
  }

  if (result.fs9Succeeded) {
    try {
      await saveSyncState(dir, wikiEntries, sourceEntries, result.hasLogFile);
      console.log(`Saved sync state to ${syncStatePath(dir)}.`);
    } catch (err) {
      console.error(`Failed to save local sync state: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.log("Skipped updating sync state because fs9 sync did not complete successfully.");
  }

  console.log("\nSync complete:");
  console.log(`  wiki:    ${result.created} created, ${result.updated} updated, ${result.deleted} deleted, ${result.unchanged} unchanged`);
  console.log(`  sources: ${sourceEntries.length} files synced, ${result.referencedSourcePaths.size} referenced, ${result.pageSourceRows.length} page-source links`);
}
