import { join } from "node:path";
import { loadConfig } from "../config.js";
import { createClient, execSql } from "../db.js";
import {
  collectSourceFiles,
  collectWikiPages,
  normalizeWikiLinkTarget,
  parseFrontmatter,
  parseWikiLinks,
} from "../utils/wiki.js";

export async function statusCommand() {
  const config = await loadConfig();
  const client = createClient(config);
  const dbId = config.db9.database;
  const dir = process.cwd();

  const wikiPages = await collectWikiPages(join(dir, "wiki"));
  const sourceFiles = await collectSourceFiles(join(dir, "sources"));
  const localPages = wikiPages.length;
  const localSources = sourceFiles.length;

  let indexedPages = 0;
  let referencedSourceCount = 0;
  let pageSourceLinks = 0;
  try {
    const pResult = await execSql(client, dbId, "SELECT COUNT(*) FROM wiki_index");
    indexedPages = Number(pResult.rows[0]?.[0] ?? 0);
    const sResult = await execSql(client, dbId, "SELECT COUNT(DISTINCT source_path), COUNT(*) FROM wiki_page_sources");
    referencedSourceCount = Number(sResult.rows[0]?.[0] ?? 0);
    pageSourceLinks = Number(sResult.rows[0]?.[1] ?? 0);
  } catch (err) {
    console.error(`DB9 query failed: ${err instanceof Error ? err.message : err}`);
  }

  const duplicatePageNames = new Map<string, typeof wikiPages>();
  for (const page of wikiPages) {
    const group = duplicatePageNames.get(page.shortName) ?? [];
    group.push(page);
    duplicatePageNames.set(page.shortName, group);
  }
  const duplicateGroups = [...duplicatePageNames.entries()]
    .filter(([, pages]) => pages.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));
  const duplicateNames = new Set(duplicateGroups.map(([name]) => name));

  const ambiguousLinks: { page: string; link: string; matches: string[] }[] = [];
  const referencedSources = new Set<string>();
  for (const page of wikiPages) {
    const { sources } = parseFrontmatter(page.content);
    for (const source of sources) referencedSources.add(source);

    for (const link of parseWikiLinks(page.content)) {
      const target = normalizeWikiLinkTarget(link.target);
      if (!target || target.includes("/")) continue;
      if (!duplicateNames.has(target)) continue;

      const matches = duplicatePageNames.get(target)?.map((p) => p.slug).sort() ?? [];
      ambiguousLinks.push({
        page: page.slug,
        link: link.raw,
        matches,
      });
    }
  }

  const unreferencedSources = sourceFiles
    .map((file) => file.path)
    .filter((path) => !referencedSources.has(path))
    .sort();

  console.log(`Wiki: ${config.wiki.name}`);
  console.log(`DB9:  ${config.db9.database}`);
  console.log();
  console.log(`Local pages:    ${localPages}`);
  console.log(`Indexed pages:  ${indexedPages}`);
  console.log(`Unindexed:      ${Math.max(0, localPages - indexedPages)}`);
  console.log();
  console.log(`Local sources:  ${localSources}`);
  console.log(`Referenced sources: ${referencedSourceCount}`);
  console.log(`Source links:   ${pageSourceLinks}`);

  console.log();
  if (duplicateGroups.length === 0) {
    console.log("Duplicate wiki filenames: none");
  } else {
    console.log("Duplicate wiki filenames:");
    for (const [name, pages] of duplicateGroups) {
      console.log(`  ${name}`);
      for (const page of pages.sort((a, b) => a.slug.localeCompare(b.slug))) {
        console.log(`    - ${page.slug}`);
      }
    }
  }

  console.log();
  if (ambiguousLinks.length === 0) {
    console.log("Ambiguous short wiki links: none");
  } else {
    console.log("Ambiguous short wiki links:");
    for (const finding of ambiguousLinks.sort((a, b) => {
      const byPage = a.page.localeCompare(b.page);
      if (byPage !== 0) return byPage;
      return a.link.localeCompare(b.link);
    })) {
      console.log(`  ${finding.page} -> ${finding.link}`);
      console.log(`    matches: ${finding.matches.join(", ")}`);
    }
  }

  console.log();
  if (unreferencedSources.length === 0) {
    console.log("Unreferenced source files: none");
  } else {
    console.log("Unreferenced source files:");
    for (const path of unreferencedSources) {
      console.log(`  - ${path}`);
    }
  }
}
