import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSteamDetails } from "../sources/steam.js";
import { getSummary } from "../sources/summary.js";

const inputSchema = z.object({
  appId: z.string().min(1).describe("Steam application id (use search_games to find it)"),
});

const outputSchema = z.object({
  appId: z.string(),
  name: z.string(),
  type: z.string().optional(),
  shortDescription: z.string().optional(),
  genres: z.array(z.string()).optional(),
  releaseDate: z.string().optional(),
  nativeLinux: z.boolean().optional(),
  metacritic: z.number().optional(),
  website: z.string().optional(),
  protonTier: z.string().nullable(),
});

export function registerGetGameDetails(server: McpServer): void {
  server.registerTool(
    "get_game_details",
    {
      title: "Get game details",
      description:
        "Fetch Steam store details for a game (genres, release date, native-Linux " +
        "flag, description) plus its current ProtonDB tier.",
      inputSchema,
      outputSchema,
    },
    async ({ appId }) => {
      const [details, summary] = await Promise.all([
        getSteamDetails(appId),
        getSummary(appId),
      ]);
      if (!details) {
        return {
          content: [
            {
              type: "text",
              text: `No Steam store details found for appId ${appId}. It may be delisted or not a public app.`,
            },
          ],
          isError: true,
        };
      }
      const structured = {
        appId: details.appId,
        name: details.name,
        type: details.type,
        shortDescription: details.shortDescription,
        genres: details.genres,
        releaseDate: details.releaseDate,
        nativeLinux: details.nativeLinux,
        metacritic: details.metacritic,
        website: details.website,
        protonTier: summary?.tier ?? null,
      };
      const text =
        `${details.name} (appId ${details.appId})\n` +
        `Released: ${details.releaseDate ?? "?"} | Genres: ${details.genres?.join(", ") ?? "?"}\n` +
        `Native Linux: ${details.nativeLinux ? "yes" : "no"} | ProtonDB tier: ${summary?.tier ?? "unknown"}`;
      return {
        content: [{ type: "text", text }],
        structuredContent: structured,
      };
    },
  );
}
