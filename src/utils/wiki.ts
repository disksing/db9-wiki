import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { contentHash } from "./hash.js";

export interface WikiPageFile {
  path: string;
  slug: string;
  shortName: string;
  content: string;
  hash: string;
}

export interface SourceFile {
  path: string;
  bytes: Uint8Array;
  hash: string;
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

export async function collectWikiPages(dir: string, base: string = dir): Promise<WikiPageFile[]> {
  const entries: WikiPageFile[] = [];
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
      entries.push(...(await collectWikiPages(full, base)));
      continue;
    }
    if (extname(item) !== ".md") continue;

    const content = await readFile(full, "utf-8");
    const rel = relative(base, full);
    const slug = rel.replace(/\.md$/, "");
    entries.push({
      path: rel,
      slug,
      shortName: basename(rel, ".md"),
      content,
      hash: contentHash(content),
    });
  }

  return entries;
}

export async function collectSourceFiles(dir: string, base: string = dir): Promise<SourceFile[]> {
  const entries: SourceFile[] = [];
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
      entries.push(...(await collectSourceFiles(full, base)));
      continue;
    }

    const bytes = await readFile(full);
    entries.push({
      path: relative(base, full),
      bytes,
      hash: contentHash(bytes),
    });
  }

  return entries;
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
