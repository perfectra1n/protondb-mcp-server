import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/store.js";
import { searchReports } from "../db/queries.js";
import { resolveAppId } from "./resolve.js";
import { textResult, errorResult } from "./result.js";
import { errMessage } from "../lib/coerce.js";
import { ReportSchema } from "../lib/types.js";
import { projectAndFit } from "../lib/project.js";
import { SystemProfileSchema, rankByProfile } from "../lib/profile.js";
import { config } from "../lib/config.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Keyword(s) to search across all reports: notes, title, Proton version, GPU, OS and " +
        "launch options. Matches ANY keyword by default (see `match`). Examples: 'nixos " +
        "flatpak', 'anti-cheat', 'GE-Proton9', '6800 xt', 'vulkan dx11 stutter'.",
    ),
  appId: z.string().optional().describe("Optional: limit to one game by appId"),
  name: z.string().optional().describe("Optional: limit to one game by name (resolved to appId)"),
  match: z
    .enum(["any", "all"])
    .default("any")
    .describe(
      "Token matching. 'any' (default) matches reports containing ANY keyword, ranked by " +
        "relevance (BM25) so reports hitting more/rarer terms rank first — use this for " +
        "multi-word descriptive queries. 'all' requires EVERY keyword in one report (strict; " +
        "can return 0 for long queries). Punctuation like '-'/':'/'%' is ignored either way.",
    ),
  sort: z
    .enum(["relevance", "recent"])
    .default("relevance")
    .describe(
      "Ordering: 'relevance' (default, BM25 rank) or 'recent' (newest first by timestamp). " +
        "ProtonDB advice decays as games/Proton/drivers update — prefer 'recent' for current advice.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(25)
    .describe("Max matching reports to return (capped at 200)"),
  detail: z
    .enum(["compact", "full"])
    .default("compact")
    .describe(
      "Response detail. 'compact' (default) = flat fields only; 'full' adds the heavy nested " +
        "responses/systemInfo/device/contributor blobs. Prefer compact + `fields`.",
    ),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Exact field projection — return ONLY these keys (appId always included). Overrides " +
        '`detail`. E.g. ["appId","title","verdict","launchOptions","notes"].',
    ),
  includeRaw: z
    .boolean()
    .default(false)
    .describe("Add the verbatim original record (`raw`) to each report. Very large."),
  systemProfile: SystemProfileSchema.optional(),
});

const outputSchema = z.object({
  query: z.string(),
  appId: z.string().nullable(),
  count: z.number(),
  truncated: z.boolean(),
  /** How many matching reports were dropped to fit the response byte budget (0 if none). */
  dropped: z.number(),
  /** Set when results were trimmed — explains how to narrow. */
  note: z.string().optional(),
  reports: z.array(ReportSchema),
});

export function registerSearchReports(server: McpServer): void {
  server.registerTool(
    "search_reports",
    {
      title: "Search reports",
      description:
        "General keyword/full-text search across the ingested ProtonDB reports — matches " +
        "notes (all categories), title, Proton version, GPU, OS and launch options. Matches " +
        "ANY keyword by default, relevance-ranked (set match:'all' to require every term). Use " +
        "it globally to find environment-specific reports (e.g. 'nixos', 'silverblue', " +
        "'anti-cheat', 'gamemoderun', a GPU model, or a Proton version), or scope to one game " +
        "with appId/name. Returns COMPACT reports by default — set detail:'full' or pass " +
        "`fields:[...]` for more, `sort:'recent'` for freshest, `systemProfile` to rank by your " +
        "rig. Large result sets are trimmed to a byte budget (see `dropped`/`note`).",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      let appId: string | null = null;
      if (args.appId || args.name) {
        try {
          appId = (await resolveAppId(args)).appId;
        } catch (err) {
          return errorResult(errMessage(err));
        }
      }
      const db = getDb();
      const wantsRaw = args.includeRaw || (args.fields?.includes("raw") ?? false);
      let reports;
      try {
        reports = searchReports(db, args.query, {
          appId: appId ?? undefined,
          limit: args.limit,
          includeRaw: wantsRaw,
          match: args.match,
          sort: args.sort,
        });
      } catch (err) {
        return errorResult(`Invalid search query: ${errMessage(err)}. Use simple keywords.`);
      }

      // Profile ranking re-orders the matched set; when a profile is supplied it
      // takes precedence over the FTS/recency sort.
      if (args.systemProfile) reports = rankByProfile(reports, args.systemProfile);

      const fetchedCount = reports.length;
      const { reports: projected, dropped } = projectAndFit(
        reports,
        { fields: args.fields, detail: args.detail, includeRaw: args.includeRaw },
        config.maxResponseChars,
      );

      let note: string | undefined;
      if (dropped > 0) {
        note =
          `${dropped} more match(es) trimmed to fit the response budget. Narrow with a smaller ` +
          `limit, a tighter \`fields\` projection, or scope to a game with appId/name.`;
      }
      const structured = {
        query: args.query,
        appId,
        count: projected.length,
        truncated: fetchedCount >= args.limit || dropped > 0,
        dropped,
        note,
        reports: projected,
      };
      const samples = projected
        .slice(0, 8)
        .map(
          (r) =>
            `- (${r.appId}${r.title ? ` ${r.title}` : ""}) [${r.protonVersion ?? "?"}${r.gpu ? ` / ${r.gpu}` : ""}] ${(r.notes ?? "").slice(0, 140)}`,
        )
        .join("\n");
      return textResult(
        `${projected.length} report(s) matching "${args.query}"${appId ? ` for appId ${appId}` : ""}` +
          `${dropped > 0 ? ` (+${dropped} trimmed)` : ""}:\n${samples}`,
        structured,
      );
    },
  );
}
