import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/store.js";
import { getReports, countReports } from "../db/queries.js";
import { tryFetchLiveReports } from "../sources/protondb-live.js";
import { getSummary } from "../sources/summary.js";
import { analyzeReports } from "../lib/analyze.js";
import { gpuVendor } from "../lib/normalize.js";
import { withResolvedAppId, textResult, errorResult } from "./result.js";
import { logger } from "../lib/logger.js";
import type { Report } from "../lib/types.js";

const inputSchema = z.object({
  appId: z.string().optional().describe("Steam application id (preferred)"),
  name: z.string().optional().describe("Game name; resolved to an appId if appId is omitted"),
  includeLive: z
    .boolean()
    .default(false)
    .describe("Also pull the freshest live reports and merge them into the analysis"),
  sampleSize: z
    .number()
    .int()
    .min(50)
    .max(5000)
    .default(2000)
    .describe("Max DB reports to aggregate over (most recent first)"),
  // Scoping filters — narrow the population BEFORE aggregating, e.g. "what works
  // for NVIDIA users" or "what works in the last year".
  gpuVendor: z
    .enum(["nvidia", "amd", "intel"])
    .optional()
    .describe("Only aggregate reports from this GPU vendor"),
  gpuContains: z
    .string()
    .optional()
    .describe("Only aggregate reports whose GPU contains this substring (e.g. '7900', 'rtx 40')"),
  protonVersionContains: z
    .string()
    .optional()
    .describe("Only aggregate reports whose Proton version contains this substring"),
  since: z
    .number()
    .int()
    .optional()
    .describe(
      "Only aggregate reports at/after this Unix epoch-seconds timestamp — use for recency-" +
        "scoped advice, since ProtonDB reports go stale as games and Proton update.",
    ),
});

const CountSchema = z.object({ key: z.string(), count: z.number(), workingCount: z.number() });

const outputSchema = z.object({
  appId: z.string(),
  title: z.string().nullable(),
  totalReports: z.number(),
  summary: z
    .object({
      appId: z.string(),
      tier: z.string(),
      trendingTier: z.string().optional(),
      bestReportedTier: z.string().optional(),
      confidence: z.string().optional(),
      score: z.number().optional(),
      total: z.number().optional(),
    })
    .nullable(),
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

export function registerAnalyzeCompatibility(server: McpServer): void {
  server.registerTool(
    "analyze_compatibility",
    {
      title: "Analyze compatibility",
      description:
        "START HERE for 'what works best' / 'what should I set'. Aggregates a game's reports " +
        "into compatibility patterns: verdict breakdown, working rate, best Proton versions, " +
        "bestLaunchOptions (full launch strings working reports used), bestEnvVars (individual " +
        "PROTON_*/DXVK_*/etc. assignments ranked by frequency), antiCheatReports, GPU-vendor " +
        "and distro splits, and representative notes. Scope the population with gpuVendor, " +
        "gpuContains, protonVersionContains, or since — e.g. 'what works for NVIDIA users in " +
        "the last year' — to get targeted answers without paging raw reports.",
      inputSchema,
      outputSchema,
    },
    async (args) =>
      withResolvedAppId(args, async ({ appId, name }) => {
        const db = getDb();

        let reports: Report[] = getReports(db, {
          appId,
          limit: args.sampleSize,
          protonVersionContains: args.protonVersionContains,
          gpuContains: args.gpuContains,
          since: args.since,
        });
        if (args.includeLive) {
          // Live capture is best-effort: on any failure we log and continue with
          // the DB-only analysis rather than failing the call.
          const { reports: live, error } = await tryFetchLiveReports(appId, 40);
          if (error) logger.warn("includeLive failed, continuing with DB only:", error);
          if (live.length > 0) reports = [...reports, ...live];
        }

        // GPU vendor isn't a DB column, so classify and filter in memory. (Also
        // re-applies proton/gpu/since filters to any merged live reports.)
        if (args.gpuVendor) {
          const want = args.gpuVendor;
          reports = reports.filter((r) => gpuVendor(r.gpu).toLowerCase() === want);
        }

        const summary = await getSummary(appId);

        if (reports.length === 0 && !summary) {
          return errorResult(
            `No reports found for appId ${appId}${name ? ` (${name})` : ""}. The local DB may ` +
              `not be ingested yet — try get_reports with source:"live", or run ingestion.`,
          );
        }

        const analysis = analyzeReports(appId, reports, summary);
        if (name && !analysis.title) analysis.title = name;

        const dbTotal = countReports(db, appId);
        const pct =
          analysis.workingRate === null ? "?" : `${Math.round(analysis.workingRate * 100)}%`;
        const text =
          `${analysis.title ?? appId} — ProtonDB tier: ${summary?.tier ?? "unknown"}` +
          `${summary?.total ? ` (${summary.total} total reports)` : ""}\n` +
          `Analyzed ${analysis.totalReports} report(s)${dbTotal > analysis.totalReports ? ` of ${dbTotal} in DB` : ""}; working rate ${pct}.\n` +
          `Best Proton versions: ${
            analysis.bestProtonVersions
              .slice(0, 3)
              .map((v) => `${v.key} (${v.workingCount} ok)`)
              .join(", ") || "n/a"
          }\n` +
          `Common launch options (working): ${
            analysis.bestLaunchOptions
              .slice(0, 3)
              .map((v) => `${v.key} (${v.workingCount})`)
              .join(", ") || "none reported"
          }\n` +
          `Common env vars (working): ${
            analysis.bestEnvVars
              .slice(0, 5)
              .map((v) => `${v.key} (${v.workingCount})`)
              .join(", ") || "none reported"
          }\n` +
          `Anti-cheat-impacted reports: ${analysis.antiCheatReports}\n` +
          `GPU vendors: ${analysis.gpuVendors.map((v) => `${v.key} ${v.count}`).join(", ") || "n/a"}`;

        return textResult(text, analysis as unknown as Record<string, unknown>);
      }),
  );
}
