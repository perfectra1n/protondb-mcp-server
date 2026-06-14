import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchGames } from "./tools/search-games.js";
import { registerGetGameDetails } from "./tools/get-game-details.js";
import { registerGetReports } from "./tools/get-reports.js";
import { registerAnalyzeCompatibility } from "./tools/analyze-compatibility.js";
import { registerSearchReportNotes } from "./tools/search-report-notes.js";

// Read the version from package.json at runtime so it stays in sync with
// release tooling (release-please / the monthly CalVer job).
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

/** Build a fully-configured ProtonDB MCP server (no transport attached). */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: "protondb-mcp",
    version: pkg.version,
  });

  registerSearchGames(server);
  registerGetGameDetails(server);
  registerGetReports(server);
  registerAnalyzeCompatibility(server);
  registerSearchReportNotes(server);

  return server;
}
