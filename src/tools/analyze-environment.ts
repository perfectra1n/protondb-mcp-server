import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/store.js";
import { searchReports } from "../db/queries.js";
import { gpuVendor } from "../lib/normalize.js";
import { aggregatePatterns, CountSchema, NoteSampleSchema } from "../lib/analyze.js";
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
  oobWorkingRate: z.number().nullable(),
  oobReports: z.number(),
  oobWorkingCount: z.number(),
  faultBreakdown: z.array(CountSchema),
  topLaunchers: z.array(CountSchema),
  topWindowManagers: z.array(CountSchema),
  gpuVendors: z.array(CountSchema),
  topDistros: z.array(CountSchema),
  noteSamples: z.array(NoteSampleSchema),
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
        "rate, oobWorkingRate (works without tinkering vs needing flags), bestProtonVersions, " +
        "bestLaunchOptions, bestEnvVars (ranked PROTON_*/DXVK_*/etc. assignments), faultBreakdown " +
        "(per-category fault prevalence), antiCheatReports, topLaunchers, topWindowManagers, " +
        "GPU-vendor/distro splits, and representative notes (with each reporter's launchOptions + " +
        "kernel/driver). Use this for 'what flags/fixes work for <environment>' questions; use " +
        "analyze_compatibility when the question is about one specific game.",
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
      const oobPct =
        patterns.oobWorkingRate === null ? "?" : `${Math.round(patterns.oobWorkingRate * 100)}%`;
      const text =
        `Environment "${args.query}" — aggregated ${patterns.totalReports} report(s); working rate ${pct}` +
        `${patterns.oobReports > 0 ? `, out-of-the-box ${oobPct} (n=${patterns.oobReports})` : ""}.\n` +
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
        `Common faults: ${
          patterns.faultBreakdown
            .slice(0, 4)
            .map((v) => `${v.key} ${v.count}`)
            .join(", ") || "none reported"
        }\n` +
        `Launchers: ${patterns.topLaunchers.map((v) => `${v.key} ${v.count}`).join(", ") || "n/a"}\n` +
        `GPU vendors: ${patterns.gpuVendors.map((v) => `${v.key} ${v.count}`).join(", ") || "n/a"}`;

      return textResult(text, structured as unknown as Record<string, unknown>);
    },
  );
}
