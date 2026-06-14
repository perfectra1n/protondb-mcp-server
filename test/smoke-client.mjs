// Manual end-to-end smoke test: spins up the stdio server as a subprocess and
// calls each tool through the real MCP client. Run: node test/smoke-client.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, PROTONDB_MCP_DB: "./data/protondb.db", PROTONDB_MCP_AUTO_UPDATE: "false" },
});
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

console.log("INSTRUCTIONS present:", Boolean(client.getInstructions?.()));
const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.find((c) => c.type === "text")?.text ?? "";
  console.log(`\n### ${name}(${JSON.stringify(args)}) ${res.isError ? "[isError]" : ""}`);
  console.log(text.slice(0, 400));
  return res;
}

// search_games (live Algolia/Steam)
await call("search_games", { query: "Cyberpunk 2077", limit: 3 });
// get_game_details (live Steam + summary)
await call("get_game_details", { appId: "1091500" });
// get_reports from the ingested DB (appId present in the 2020 dump)
const r = await call("get_reports", { appId: "1091500", source: "db", limit: 5 });
console.log("  -> structured count:", r.structuredContent?.count, "source:", r.structuredContent?.source);
// analyze_compatibility (DB + live summary)
const a = await call("analyze_compatibility", { appId: "1091500" });
console.log("  -> workingRate:", a.structuredContent?.workingRate, "bestProton:", a.structuredContent?.bestProtonVersions?.[0]?.key);
// search_reports (general keyword search across notes/title/proton/gpu/os)
await call("search_reports", { query: "crash", limit: 5 });
// error path: unknown game name
await call("get_reports", { name: "asdkjfhqwoeiuzzz nonexistent game", source: "db" });

await client.close();
console.log("\nSMOKE OK");
process.exit(0);
