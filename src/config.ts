import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface WikiConfig {
  wiki: { name: string };
  db9: { database: string; token: string };
  search: { top_k: number };
}

const CONFIG_FILE = "db9-wiki.toml";

export async function loadConfig(dir: string = process.cwd()): Promise<WikiConfig> {
  const path = join(dir, CONFIG_FILE);
  const raw = await readFile(path, "utf-8");
  const parsed = parse(raw) as unknown as WikiConfig;
  return {
    wiki: { name: parsed.wiki?.name ?? "Wiki" },
    db9: {
      database: parsed.db9?.database ?? "",
      token: parsed.db9?.token ?? "",
    },
    search: { top_k: parsed.search?.top_k ?? 5 },
  };
}
