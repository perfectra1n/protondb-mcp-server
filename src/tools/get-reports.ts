import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/store.js";
import { getReports, countReports } from "../db/queries.js";
import { tryFetchLiveReports } from "../sources/protondb-live.js";
import { withResolvedAppId, textResult } from "./result.js";
import { ReportSchema, type Report } from "../lib/types.js";
import { projectAndFit } from "../lib/project.js";
import { SystemProfileSchema, rankByProfile } from "../lib/profile.js";
import { config } from "../lib/config.js";

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
  detail: z
    .enum(["compact", "full"])
    .default("compact")
    .describe(
      "Response detail. 'compact' (default) returns only the flat fields " +
        "(verdict, works, protonVersion, launcher, launchOptions, antiCheat, " +
        "gpu/cpu/os/kernel/ram, notes, timestamp). 'full' ADDS the heavy nested blobs " +
        "(responses, systemInfo, device, contributor). Prefer compact + a `fields` " +
        "projection; only go 'full' when you truly need per-category faults or systemInfo.",
    ),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Exact field projection — return ONLY these keys (appId is always included). " +
        "Overrides `detail`. Use this to slash response size, e.g. " +
        '["verdict","launchOptions","protonVersion","gpu","notes"]. Valid keys are any ' +
        "Report field, including the nested 'responses'/'systemInfo'/'device'/'contributor'/'raw'.",
    ),
  includeRaw: z
    .boolean()
    .default(false)
    .describe(
      "Add the complete verbatim original record (`raw`) to each report, on top of " +
        "whatever `detail`/`fields` selected. Very large — use a small limit.",
    ),
  systemProfile: SystemProfileSchema.optional(),
});

const outputSchema = z.object({
  appId: z.string(),
  name: z.string().nullable(),
  source: z.enum(["db", "live"]),
  count: z.number(),
  truncated: z.boolean(),
  /** How many reports were dropped to fit the response byte budget (0 if none). */
  dropped: z.number(),
  /** Set when live capture failed, or when results were trimmed — explains how to narrow. */
  note: z.string().optional(),
  reports: z.array(ReportSchema),
});

function applyInMemoryFilters(
  reports: Report[],
  f: {
    verdict?: "yes" | "no";
    protonVersionContains?: string;
    gpuContains?: string;
    since?: number;
  },
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
        "Fetch individual community ProtonDB reports for a game. Returns COMPACT reports by " +
        "default — flat fields only (verdict, works, protonVersion, launcher, launchOptions, " +
        "antiCheat, gpu/cpu/os/kernel/ram, notes, timestamp). To get more, choose explicitly: " +
        "`fields:[...]` for an exact subset (smallest), `detail:'full'` for the nested " +
        "responses/systemInfo/device/contributor blobs, or `includeRaw:true` for the verbatim " +
        "original. Server-side filters: verdict, protonVersionContains, gpuContains, since. " +
        "Pass `systemProfile` to rank reports by similarity to the user's rig. Large result " +
        "sets are trimmed to a byte budget (see `dropped`/`note`) so responses never overflow — " +
        "narrow with filters/fields or call analyze_compatibility for an aggregated overview first.",
      inputSchema,
      outputSchema,
    },
    async (args) =>
      withResolvedAppId(args, async ({ appId, name }) => {
        const filters = {
          verdict: args.verdict,
          protonVersionContains: args.protonVersionContains,
          gpuContains: args.gpuContains,
          since: args.since,
        };

        let reports: Report[] = [];
        let usedSource: "db" | "live" = "db";
        let note: string | undefined;

        // `raw` and the nested blobs are needed up front only when the caller
        // asked for them; fetch with raw when includeRaw or a fields list names it.
        const wantsRaw = args.includeRaw || (args.fields?.includes("raw") ?? false);

        const db = getDb();
        const dbCount = countReports(db, appId);

        // Live capture never throws here: failures are logged and we continue,
        // falling back to the DB (for 'auto') or returning an empty, non-error
        // result with an explanatory note (for explicit 'live').
        if (args.source === "live" || (args.source === "auto" && dbCount === 0)) {
          const { reports: live, error } = await tryFetchLiveReports(appId, args.limit);
          if (live.length > 0 || args.source === "live") {
            reports = applyInMemoryFilters(live, filters).slice(0, args.limit);
            usedSource = "live";
            if (error) note = `Live capture unavailable, returned no reports: ${error}`;
          } else if (error) {
            note = `Live fallback failed (${error}); returning local DB results.`;
          }
        }

        if (usedSource === "db") {
          reports = getReports(db, {
            appId,
            limit: args.limit,
            includeRaw: wantsRaw,
            ...filters,
          });
        }

        // Rank by similarity to the user's setup before projecting/trimming, so
        // the most relevant reports are the ones that survive the byte budget.
        if (args.systemProfile) reports = rankByProfile(reports, args.systemProfile);

        const fetchedCount = reports.length;
        const { reports: projected, dropped } = projectAndFit(
          reports,
          { fields: args.fields, detail: args.detail, includeRaw: args.includeRaw },
          config.maxResponseChars,
        );

        const moreInStore =
          usedSource === "db" ? dbCount > fetchedCount : fetchedCount >= args.limit;
        const truncated = moreInStore || dropped > 0;
        if (dropped > 0) {
          const hint =
            `${dropped} more report(s) trimmed to fit the response budget. Narrow with ` +
            `filters (verdict/gpuContains/since), a smaller limit, a tighter \`fields\` ` +
            `projection, or call analyze_compatibility for an aggregated overview.`;
          note = note ? `${note}\n${hint}` : hint;
        }

        const structured = {
          appId,
          name,
          source: usedSource,
          count: projected.length,
          truncated,
          dropped,
          note,
          reports: projected,
        };
        const head =
          `${projected.length} report(s) for appId ${appId}${name ? ` (${name})` : ""} from ${usedSource}` +
          (dropped > 0 ? ` (+${dropped} trimmed)` : "") +
          "." +
          (note ? `\n${note}` : "");
        const samples = projected
          .slice(0, 5)
          .map(
            (r) =>
              `- [${r.works === true ? "works" : r.works === false ? "borked" : "?"}] ${r.protonVersion ?? "?"}${r.gpu ? ` / ${r.gpu}` : ""}: ${(r.notes ?? "(no notes)").slice(0, 160)}`,
          )
          .join("\n");
        return textResult(`${head}\n${samples}`, structured);
      }),
  );
}
