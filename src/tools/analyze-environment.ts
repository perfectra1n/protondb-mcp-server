import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/store.js";
import { searchReports } from "../db/queries.js";
import { gpuVendor } from "../lib/normalize.js";
import { aggregatePatterns } from "../lib/analyze.js";
import { textResult, errorResult } from "./result.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Environment keyword(s) to aggregate across ALL games — e.g. 'nixos', 'bazzite', " +
        "'silverblue', 'steam deck', 'wayland', 'flatpak'. Matches report notes, OS, GPU, " +
        "Proton version and launch options. This is the cross-game answer to 'what flags/" +
        "fixes work for <environment>' — analyze_compatibility is per-game.",
    ),
  verdict: z
    .enum(["yes", "no"])
    .optional()
    .describe("Only aggregate reports with this verdict (yes = worked, no = did not)"),
  gpuVendor: z
    .enum(["nvidia", "amd", "intel"])
    .optional()
    .describe("Only aggregate reports from this GPU vendor"),
  sampleSize: z
    .number()
    .int()
    .min(50)
    .max(2000)
    .default(1000)
    .describe("Max matching reports to aggregate over (relevance-ranked)"),
});

const CountSchema = z.object({ key: z.string(), count: z.number(), workingCount: z.number() });

const outputSchema = z.object({
  query: z.string(),
  totalReports: z.number(),
  verdictBreakdown: z.object({ yes: z.number(), no: z.number(), unknown: z.number() }),
  workingRate: z.number().nullable(),
  topProtonVersions: z.array(CountSchema),
  bestProtonVersions: z.array(CountSchema),
  bestLaunchOptions: z.array(CountSchema),
  bestEnvVars: z.array(CountSchema),
  antiCheatReports: z.number(),
  gpuVendors: z.array(CountSchema),
  topDistros: z.array(CountSchema),
  noteSamples: z.array(
    z.object({
      works: z.boolean().nullable(),
      protonVersion: z.string().nullable(),
      gpu: z.string().nullable(),
      os: z.string().nullable(),
      timestamp: z.number().nullable(),
      notes: z.string(),
    }),
  ),
});

export function registerAnalyzeEnvironment(server: McpServer): void {
  server.registerTool(
    "analyze_environment",
    {
      title: "Analyze environment",
      description:
        "Cross-game aggregation for an environment keyword (e.g. 'nixos', 'bazzite', 'wayland', " +
        "'flatpak', 'steam deck'). Searches ALL ingested reports matching the keyword and rolls " +
        "them up into the same patterns as analyze_compatibility — verdict breakdown, working " +
        "rate, bestProtonVersions, bestLaunchOptions, bestEnvVars (ranked PROTON_*/DXVK_*/etc. " +
        "assignments), antiCheatReports, GPU-vendor/distro splits, and representative notes. Use " +
        "this for 'what flags/fixes work for <environment>' questions; use analyze_compatibility " +
        "when the question is about one specific game.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const db = getDb();
      let reports = searchReports(db, args.query, {
        limit: args.sampleSize,
        maxLimit: 2000,
        match: "all",
        sort: "relevance",
      });

      if (args.verdict) reports = reports.filter((r) => r.verdict === args.verdict);
      if (args.gpuVendor) {
        const want = args.gpuVendor;
        reports = reports.filter((r) => gpuVendor(r.gpu).toLowerCase() === want);
      }

      if (reports.length === 0) {
        return errorResult(
          `No reports matched "${args.query}". Try a broader keyword, or check the DB is ` +
            `ingested. (analyze_environment aggregates across games; for one game use ` +
            `analyze_compatibility.)`,
        );
      }

      const patterns = aggregatePatterns(reports);
      const structured = { query: args.query, ...patterns };

      const pct =
        patterns.workingRate === null ? "?" : `${Math.round(patterns.workingRate * 100)}%`;
      const text =
        `Environment "${args.query}" — aggregated ${patterns.totalReports} report(s); working rate ${pct}.\n` +
        `Common launch options (working): ${
          patterns.bestLaunchOptions
            .slice(0, 3)
            .map((v) => `${v.key} (${v.workingCount})`)
            .join(", ") || "none reported"
        }\n` +
        `Common env vars (working): ${
          patterns.bestEnvVars
            .slice(0, 5)
            .map((v) => `${v.key} (${v.workingCount})`)
            .join(", ") || "none reported"
        }\n` +
        `Best Proton versions: ${
          patterns.bestProtonVersions
            .slice(0, 3)
            .map((v) => `${v.key} (${v.workingCount} ok)`)
            .join(", ") || "n/a"
        }\n` +
        `GPU vendors: ${patterns.gpuVendors.map((v) => `${v.key} ${v.count}`).join(", ") || "n/a"}`;

      return textResult(text, structured as unknown as Record<string, unknown>);
    },
  );
}
