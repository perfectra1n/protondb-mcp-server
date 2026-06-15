#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { startAutoUpdate, stopAutoUpdate } from "./lib/auto-update.js";
import { closeBrowser } from "./sources/protondb-live.js";
import { closeDb } from "./db/store.js";
import { log } from "./lib/http.js";

async function main(): Promise<void> {
  const server = buildServer();
  startAutoUpdate();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("ProtonDB MCP server running on stdio");

  const shutdown = async () => {
    stopAutoUpdate();
    await closeBrowser();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log("fatal:", (err as Error).message);
  process.exit(1);
});
