import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { contentHash } from "./hash.js";

export interface WikiPageFile {
  fullPath: string;
  path: string;
  slug: string;
  shortName: string;
  content: string;
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface SourceFile {
  fullPath: string;
  path: string;
  bytes: Uint8Array;
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface WikiPageEntry {
  fullPath: string;
  path: string;
  slug: string;
  shortName: string;
  size: number;
  mtimeMs: number;
}

export interface SourceFileEntry {
  fullPath: string;
  path: string;
  size: number;
  mtimeMs: number;
}

export interface FrontmatterData {
  title: string;
  description: string;
  tags: string[];
  sources: string[];
}

export interface WikiLink {
  raw: string;
  target: string;
  display: string | null;
}

export async function collectWikiPageEntries(dir: string, base: string = dir): Promise<WikiPageEntry[]> {
  const entries: WikiPageEntry[] = [];
  let items: string[];

  try {
    items = await readdir(dir);
  } catch {
    return entries;
  }

  for (const item of items) {
    const full = join(dir, item);
    const s = await stat(full);
    if (s.isDirectory()) {
      entries.push(...(await collectWikiPageEntries(full, base)));
      continue;
    }
    if (extname(item) !== ".md") continue;

    const rel = relative(base, full);
    const slug = rel.replace(/\.md$/, "");
    entries.push({
      fullPath: full,
      path: rel,
      slug,
      shortName: basename(rel, ".md"),
      size: s.size,
      mtimeMs: s.mtimeMs,
    });
  }

  return entries;
}

export async function collectSourceFileEntries(dir: string, base: string = dir): Promise<SourceFileEntry[]> {
  const entries: SourceFileEntry[] = [];
  let items: string[];

  try {
    items = await readdir(dir);
  } catch {
    return entries;
  }

  for (const item of items) {
    const full = join(dir, item);
    const s = await stat(full);
    if (s.isDirectory()) {
      entries.push(...(await collectSourceFileEntries(full, base)));
      continue;
    }
    entries.push({
      fullPath: full,
      path: relative(base, full),
      size: s.size,
      mtimeMs: s.mtimeMs,
    });
  }

  return entries;
}

export async function loadWikiPage(entry: WikiPageEntry): Promise<WikiPageFile> {
  const content = await readFile(entry.fullPath, "utf-8");
  return {
    fullPath: entry.fullPath,
    path: entry.path,
    slug: entry.slug,
    shortName: entry.shortName,
    content,
    hash: contentHash(content),
    size: entry.size,
    mtimeMs: entry.mtimeMs,
  };
}

export async function loadSourceFile(entry: SourceFileEntry): Promise<SourceFile> {
  const bytes = await readFile(entry.fullPath);
  return {
    fullPath: entry.fullPath,
    path: entry.path,
    bytes,
    hash: contentHash(bytes),
    size: entry.size,
    mtimeMs: entry.mtimeMs,
  };
}

export async function collectWikiPages(dir: string, base: string = dir): Promise<WikiPageFile[]> {
  const entries = await collectWikiPageEntries(dir, base);
  return Promise.all(entries.map(loadWikiPage));
}

export async function collectSourceFiles(dir: string, base: string = dir): Promise<SourceFile[]> {
  const entries = await collectSourceFileEntries(dir, base);
  return Promise.all(entries.map(loadSourceFile));
}

export function parseFrontmatter(content: string): FrontmatterData {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { title: "", description: "", tags: [], sources: [] };

  const fm = match[1];
  const title = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const tagsMatch = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const sourcesMatch = fm.match(/^sources:\s*\[([^\]]*)\]/m);
  const sources = sourcesMatch
    ? sourcesMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalizeSourceRef)
    : [];

  return { title, description, tags, sources };
}

export function normalizeSourceRef(path: string): string {
  return path.replace(/^sources\//, "").trim();
}

export function parseWikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = [];
  const regex = /\[\[([^[\]]+)\]\]/g;

  for (const match of content.matchAll(regex)) {
    const raw = match[0];
    const inner = match[1].trim();
    const [targetPart, displayPart] = inner.split("|", 2);
    links.push({
      raw,
      target: targetPart.trim(),
      display: displayPart?.trim() ?? null,
    });
  }

  return links;
}

export function normalizeWikiLinkTarget(target: string): string {
  return target.split("#", 1)[0].trim();
}
