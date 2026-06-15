import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSteamDetails } from "../sources/steam.js";
import { getSummary } from "../sources/summary.js";
import { textResult, errorResult } from "./result.js";
import { errMessage } from "../lib/coerce.js";

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
      // getSummary already swallows its own errors (returns null); getSteamDetails
      // throws on a network/HTTP failure, so settle it explicitly to distinguish
      // "Steam unreachable" from a genuinely delisted app (and keep both in flight).
      const [summary, steam] = await Promise.all([
        getSummary(appId),
        getSteamDetails(appId).then(
          (d) => ({ ok: true as const, details: d }),
          (e: unknown) => ({ ok: false as const, error: e }),
        ),
      ]);
      if (!steam.ok) {
        return errorResult(
          `Could not reach the Steam store for appId ${appId}: ${errMessage(steam.error)}. Try again shortly.`,
        );
      }
      const details = steam.details;
      if (!details) {
        return errorResult(
          `No Steam store details found for appId ${appId}. It may be delisted or not a public app.`,
        );
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
      return textResult(text, structured);
    },
  );
}
