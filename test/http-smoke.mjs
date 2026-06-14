// Smoke test against a running HTTP server (e.g. the Docker container).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const transport = new StreamableHTTPClientTransport(new URL(url));
const client = new Client({ name: "http-smoke", version: "1.0.0" });
await client.connect(transport);

const instr = client.getInstructions?.() ?? "";
console.log("INSTRUCTIONS:", instr ? `${instr.length} chars` : "MISSING");
console.log("  mentions troubleshooting:", /PROTON_LOG|protontricks|vulkaninfo/.test(instr));
const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.find((c) => c.type === "text")?.text ?? "";
  console.log(`\n### ${name} ${res.isError ? "[isError]" : ""}\n${text.slice(0, 240)}`);
  return res;
}

// DB-backed calls prove better-sqlite3 compiled and the volume DB is readable.
const r = await call("get_reports", { appId: "1091500", source: "db", limit: 3, verdict: "yes" });
console.log("  -> count:", r.structuredContent?.count, "source:", r.structuredContent?.source);
const a = await call("analyze_compatibility", { appId: "1091500" });
console.log(
  "  -> analyzed:", a.structuredContent?.totalReports,
  "workingRate:", a.structuredContent?.workingRate,
  "bestProton:", a.structuredContent?.bestProtonVersions?.[0]?.key,
);
// General keyword search across notes/proton/gpu/os
const s = await call("search_reports", { query: "nixos", limit: 5 });
console.log("  -> nixos matches:", s.structuredContent?.count);

await client.close();
console.log("\nHTTP SMOKE OK");
process.exit(0);
