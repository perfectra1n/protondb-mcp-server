import { resolve } from "node:path";

/** Read a string env var, falling back when unset/empty. */
function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v !== undefined && v.trim() !== "" ? v : fallback;
}

/** Read an integer env var, falling back when unset/invalid. */
function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Read a boolean env var. Anything but false/0/no/off (case-insensitive) is true. */
function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return !["false", "0", "no", "off", ""].includes(v.trim().toLowerCase());
}

/** Read a comma-separated list env var, or undefined when unset. */
function envList(key: string): string[] | undefined {
  const v = process.env[key];
  if (v === undefined || v.trim() === "") return undefined;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** First non-empty value among the given env keys, else undefined. */
function envFirst(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v.trim() !== "") return v;
  }
  return undefined;
}

/**
 * Centralized runtime configuration. Every value is overridable via environment
 * variables (see the README "Configuration" table for the full list).
 */
export const config = {
  // Storage
  dbPath: resolve(envStr("PROTONDB_MCP_DB", "./data/protondb.db")),

  // Outbound HTTP
  userAgent: envStr(
    "PROTONDB_MCP_USER_AGENT",
    "protondb-mcp/0.1 (+https://github.com/perfectra1n/protondb-mcp)",
  ),
  fetchTimeoutMs: envInt("PROTONDB_MCP_HTTP_TIMEOUT_MS", 15_000),
  fetchRetries: envInt("PROTONDB_MCP_HTTP_RETRIES", 2),
  // When set, overrides every per-request cache TTL (0 disables caching).
  cacheTtlOverrideMs:
    process.env.PROTONDB_MCP_CACHE_TTL_MS !== undefined
      ? envInt("PROTONDB_MCP_CACHE_TTL_MS", 0)
      : null,

  // Streamable HTTP transport (http-server.ts)
  httpHost: envStr("PROTONDB_MCP_HTTP_HOST", "127.0.0.1"),
  httpPort: envInt("PROTONDB_MCP_HTTP_PORT", 3000),
  httpPath: envStr("PROTONDB_MCP_HTTP_PATH", "/mcp"),
  // Optional shared-secret auth for the HTTP transport. One or more tokens
  // (comma-separated). When unset, the HTTP endpoint is unauthenticated.
  // Clients send `Authorization: Bearer <token>` (or `X-API-Key: <token>`).
  authTokens: envList("PROTONDB_MCP_AUTH_TOKEN"),
  // Override the DNS-rebinding allowlist (comma-separated host[:port]). When
  // unset, loopback binds use a sensible localhost allowlist and non-loopback
  // binds disable the check.
  httpAllowedHosts: envList("PROTONDB_MCP_HTTP_ALLOWED_HOSTS"),

  // Bulk-dump auto-update
  autoUpdate: envBool("PROTONDB_MCP_AUTO_UPDATE", true),
  updateIntervalHours: envInt("PROTONDB_MCP_UPDATE_INTERVAL_HOURS", 24),

  // Live headless capture
  enableLive: envBool("PROTONDB_MCP_ENABLE_LIVE", true),
  liveTimeoutMs: envInt("PROTONDB_MCP_LIVE_TIMEOUT_MS", 25_000),

  // GitHub (for listing bulk dumps; raises the API rate limit). Accepts a
  // dedicated var or the conventional GITHUB_TOKEN / GH_TOKEN.
  githubToken: envFirst("PROTONDB_MCP_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"),

  // ProtonDB Algolia search (public, search-only key by default)
  algolia: {
    appId: envStr("ALGOLIA_APP_ID", "94HE6YATEI"),
    apiKey: envStr("ALGOLIA_API_KEY", "9ba0e69fb2974316cdaec8f5f257088f"),
    index: envStr("ALGOLIA_INDEX", "steamdb"),
  },

  // bdefore/protondb-data — the ODbL bulk export of individual reports.
  dumpRepo: envStr("PROTONDB_MCP_DUMP_REPO", "bdefore/protondb-data"),
  dumpBranch: envStr("PROTONDB_MCP_DUMP_BRANCH", "master"),
} as const;
