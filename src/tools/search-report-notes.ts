import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/store.js";
import { searchNotes } from "../db/queries.js";
import { resolveAppId } from "./resolve.js";
import { ReportSchema } from "../lib/types.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("FTS5 query over report notes (e.g. 'anti-cheat', 'crash', 'vsync stutter')"),
  appId: z.string().optional().describe("Limit to one game by appId"),
  name: z.string().optional().describe("Limit to one game by name (resolved to appId)"),
  limit: z.number().int().min(1).max(200).default(25).describe("Max matching reports"),
});

const outputSchema = z.object({
  query: z.string(),
  appId: z.string().nullable(),
  count: z.number(),
  reports: z.array(ReportSchema),
});

export function registerSearchReportNotes(server: McpServer): void {
  server.registerTool(
    "search_report_notes",
    {
      title: "Search report notes",
      description:
        "Full-text search across the free-text notes of ingested ProtonDB reports " +
        "(optionally scoped to one game). Great for finding mentions of specific " +
        "issues or fixes like anti-cheat, launchers, or crashes.",
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
        reports = searchNotes(db, args.query, { appId: appId ?? undefined, limit: args.limit });
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid search query: ${(err as Error).message}. Use simple FTS5 terms.`,
            },
          ],
          isError: true,
        };
      }
      const structured = { query: args.query, appId, count: reports.length, reports };
      const samples = reports
        .slice(0, 8)
        .map((r) => `- (${r.appId}${r.title ? ` ${r.title}` : ""}) ${(r.notes ?? "").slice(0, 160)}`)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${reports.length} note match(es) for "${args.query}":\n${samples}`,
          },
        ],
        structuredContent: structured,
      };
    },
  );
}
