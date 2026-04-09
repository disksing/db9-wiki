import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { syncCommand } from "./commands/sync.js";
import { searchCommand } from "./commands/search.js";
import { indexCommand } from "./commands/index.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("db9-wiki")
  .description("Agent-native LLM Wiki powered by DB9")
  .version("0.1.1");

program
  .command("init")
  .description("Initialize a new wiki project")
  .requiredOption("--db <id>", "DB9 database ID")
  .requiredOption("--token <token>", "DB9 access token")
  .option("--name <name>", "Wiki name", "My Knowledge Base")
  .action(async (opts) => {
    await initCommand(opts.db, opts.token, opts.name);
  });

program
  .command("sync")
  .description("Sync local wiki to DB9 (fs9 backup + vector index)")
  .option("--full", "Force a full sync instead of using the last successful sync timestamp")
  .action(async (opts) => {
    await syncCommand({ full: opts.full });
  });

program
  .command("search <query>")
  .description("Semantic search across wiki pages")
  .action(async (query) => {
    await searchCommand(query);
  });

program
  .command("index")
  .description("List all wiki pages")
  .action(async () => {
    await indexCommand();
  });

program
  .command("status")
  .description("Show wiki statistics")
  .action(async () => {
    await statusCommand();
  });

program.parse();
