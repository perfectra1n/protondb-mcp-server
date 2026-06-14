import { resolve } from "node:path";

/** Centralized runtime configuration, all overridable via environment. */
export const config = {
  dbPath: resolve(process.env.PROTONDB_MCP_DB ?? "./data/protondb.db"),
  userAgent:
    process.env.PROTONDB_MCP_USER_AGENT ??
    "protondb-mcp/0.1 (+https://github.com/perfectra1n/protondb-mcp)",
  httpPort: Number(process.env.PROTONDB_MCP_HTTP_PORT ?? 3000),
  httpHost: process.env.PROTONDB_MCP_HTTP_HOST ?? "127.0.0.1",
  autoUpdate: (process.env.PROTONDB_MCP_AUTO_UPDATE ?? "true") !== "false",
  enableLive: (process.env.PROTONDB_MCP_ENABLE_LIVE ?? "true") !== "false",
  algolia: {
    appId: process.env.ALGOLIA_APP_ID ?? "94HE6YATEI",
    apiKey: process.env.ALGOLIA_API_KEY ?? "9ba0e69fb2974316cdaec8f5f257088f",
    index: "steamdb",
  },
  /** bdefore/protondb-data — the ODbL bulk export of individual reports. */
  dumpRepo: "bdefore/protondb-data",
} as const;
