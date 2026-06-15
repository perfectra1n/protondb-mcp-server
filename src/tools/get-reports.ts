import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/store.js";
import { getReports, countReports } from "../db/queries.js";
import { tryFetchLiveReports } from "../sources/protondb-live.js";
import { resolveAppId } from "./resolve.js";
import { ReportSchema, type Report } from "../lib/types.js";

const inputSchema = z.object({
  appId: z.string().optional().describe("Steam application id (preferred)"),
  name: z.string().optional().describe("Game name; resolved to an appId if appId is omitted"),
  source: z
    .enum(["auto", "db", "live"])
    .default("auto")
    .describe(
      "Where to read reports: 'db' = local bulk-dump DB (rich, includes hardware), " +
        "'live' = freshest reports scraped from protondb.com, 'auto' = db then live fallback",
    ),
  limit: z.number().int().min(1).max(500).default(50).describe("Max reports to return"),
  verdict: z
    .enum(["yes", "no"])
    .optional()
    .describe("Only reports with this verdict (yes = worked, no = did not)"),
  protonVersionContains: z
    .string()
    .optional()
    .describe("Only reports whose Proton version contains this substring"),
  gpuContains: z
    .string()
    .optional()
    .describe("Only reports whose GPU contains this substring (DB source only)"),
  since: z
    .number()
    .int()
    .optional()
    .describe("Only reports at/after this Unix epoch-seconds timestamp"),
  includeRaw: z
    .boolean()
    .default(false)
    .describe(
      "Include the complete original record (every field: all responses, per-category " +
        "notes, full systemInfo, device/contributor) on each report. Verbose — use a " +
        "small limit. The normalized fields already cover the common ones.",
    ),
});

const outputSchema = z.object({
  appId: z.string(),
  name: z.string().nullable(),
  source: z.enum(["db", "live"]),
  count: z.number(),
  truncated: z.boolean(),
  /** Set when live capture was attempted but failed/returned nothing. */
  note: z.string().optional(),
  reports: z.array(ReportSchema),
});

function applyInMemoryFilters(
  reports: Report[],
  f: { verdict?: "yes" | "no"; protonVersionContains?: string; gpuContains?: string; since?: number },
): Report[] {
  return reports.filter((r) => {
    if (f.verdict && r.verdict !== f.verdict) return false;
    if (
      f.protonVersionContains &&
      !(r.protonVersion ?? "").toLowerCase().includes(f.protonVersionContains.toLowerCase())
    )
      return false;
    if (f.gpuContains && !(r.gpu ?? "").toLowerCase().includes(f.gpuContains.toLowerCase()))
      return false;
    if (typeof f.since === "number" && (r.timestamp ?? 0) < f.since) return false;
    return true;
  });
}

export function registerGetReports(server: McpServer): void {
  server.registerTool(
    "get_reports",
    {
      title: "Get reports",
      description:
        "Fetch individual community ProtonDB reports for a game so you can read the " +
        "raw notes, Proton versions, hardware and verdicts. Supports server-side " +
        "filtering. Use analyze_compatibility first for an aggregated overview.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      let resolved;
      try {
        resolved = await resolveAppId(args);
      } catch (err) {
        return { content: [{ type: "text", text: (err as Error).message }], isError: true };
      }
      const { appId, name } = resolved;
      const filters = {
        verdict: args.verdict,
        protonVersionContains: args.protonVersionContains,
        gpuContains: args.gpuContains,
        since: args.since,
      };

      let reports: Report[] = [];
      let usedSource: "db" | "live" = "db";
      let note: string | undefined;

      const db = getDb();
      const dbCount = countReports(db, appId);

      // Live capture never throws here: failures are logged and we continue,
      // falling back to the DB (for 'auto') or returning an empty, non-error
      // result with an explanatory note (for explicit 'live').
      if (args.source === "live" || (args.source === "auto" && dbCount === 0)) {
        const { reports: live, error } = await tryFetchLiveReports(appId, args.limit);
        if (live.length > 0 || args.source === "live") {
          const filtered = applyInMemoryFilters(live, filters).slice(0, args.limit);
          // Live records always carry `raw`; drop it unless explicitly requested.
          reports = args.includeRaw ? filtered : filtered.map(({ raw, ...rest }) => rest);
          usedSource = "live";
          if (error) note = `Live capture unavailable, returned no reports: ${error}`;
        } else if (error) {
          note = `Live fallback failed (${error}); returning local DB results.`;
        }
      }

      if (usedSource === "db") {
        reports = getReports(db, { appId, limit: args.limit, includeRaw: args.includeRaw, ...filters });
      }

      const truncated = usedSource === "db" ? dbCount > reports.length : reports.length >= args.limit;
      const structured = {
        appId,
        name,
        source: usedSource,
        count: reports.length,
        truncated,
        note,
        reports,
      };
      const head =
        `${reports.length} report(s) for appId ${appId}${name ? ` (${name})` : ""} from ${usedSource}.` +
        (note ? `\n${note}` : "");
      const samples = reports
        .slice(0, 5)
        .map(
          (r) =>
            `- [${r.works === true ? "works" : r.works === false ? "borked" : "?"}] ${r.protonVersion ?? "?"}${r.gpu ? ` / ${r.gpu}` : ""}: ${(r.notes ?? "(no notes)").slice(0, 160)}`,
        )
        .join("\n");
      return {
        content: [{ type: "text", text: `${head}\n${samples}` }],
        structuredContent: structured,
      };
    },
  );
}
