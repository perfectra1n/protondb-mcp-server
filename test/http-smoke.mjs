// Smoke test against a running HTTP server (e.g. the Docker container).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const transport = new StreamableHTTPClientTransport(new URL(url));
const client = new Client({ name: "http-smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.find((c) => c.type === "text")?.text ?? "";
  console.log(`\n### ${name} ${res.isError ? "[isError]" : ""}\n${text.slice(0, 220)}`);
  return res;
}

// DB-backed call proves better-sqlite3 compiled and the volume DB is readable.
const r = await call("get_reports", { appId: "41000", source: "db", limit: 3 });
console.log("  -> count:", r.structuredContent?.count, "source:", r.structuredContent?.source);
const a = await call("analyze_compatibility", { appId: "41000" });
console.log("  -> analyzed:", a.structuredContent?.totalReports, "workingRate:", a.structuredContent?.workingRate);
await call("search_report_notes", { query: "anti-cheat", limit: 3 });

await client.close();
console.log("\nHTTP SMOKE OK");
process.exit(0);
