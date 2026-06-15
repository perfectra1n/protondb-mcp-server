import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/store.js";
import { searchReports } from "../db/queries.js";
import { resolveAppId } from "./resolve.js";
import { ReportSchema } from "../lib/types.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Keyword(s) to search across all reports: notes, title, Proton version, GPU and OS. " +
        "Examples: 'nixos flatpak', 'anti-cheat', 'GE-Proton9', '6800 xt', 'wayland stutter'.",
    ),
  appId: z.string().optional().describe("Optional: limit to one game by appId"),
  name: z.string().optional().describe("Optional: limit to one game by name (resolved to appId)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(25)
    .describe("Max matching reports to return (capped at 200)"),
});

const outputSchema = z.object({
  query: z.string(),
  appId: z.string().nullable(),
  count: z.number(),
  truncated: z.boolean(),
  reports: z.array(ReportSchema),
});

export function registerSearchReports(server: McpServer): void {
  server.registerTool(
    "search_reports",
    {
      title: "Search reports",
      description:
        "General keyword/full-text search across the ingested ProtonDB reports — matches " +
        "notes (all categories), title, Proton version, GPU, OS and launch options. Use it " +
        "globally to find environment-specific reports (e.g. 'nixos', 'silverblue', " +
        "'anti-cheat', 'gamemoderun', a GPU model, or a Proton version), or scope to one " +
        "game with appId/name. Each result carries the full report fields (responses, " +
        "systemInfo, device/contributor) like get_reports.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      let appId: string | null = null;
      if (args.appId || args.name) {
        try {
          appId = (await resolveAppId(args)).appId;
        } catch (err) {
          return { content: [{ type: "text", text: (err as Error).message }], isError: true };
        }
      }
      const db = getDb();
      let reports;
      try {
        reports = searchReports(db, args.query, { appId: appId ?? undefined, limit: args.limit });
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid search query: ${(err as Error).message}. Use simple keywords.`,
            },
          ],
          isError: true,
        };
      }
      const structured = {
        query: args.query,
        appId,
        count: reports.length,
        truncated: reports.length >= args.limit,
        reports,
      };
      const samples = reports
        .slice(0, 8)
        .map(
          (r) =>
            `- (${r.appId}${r.title ? ` ${r.title}` : ""}) [${r.protonVersion ?? "?"}${r.gpu ? ` / ${r.gpu}` : ""}] ${(r.notes ?? "").slice(0, 140)}`,
        )
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${reports.length} report(s) matching "${args.query}"${appId ? ` for appId ${appId}` : ""}:\n${samples}`,
          },
        ],
        structuredContent: structured,
      };
    },
  );
}
