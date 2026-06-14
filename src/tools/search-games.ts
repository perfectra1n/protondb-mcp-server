import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchGames } from "./resolve.js";

const inputSchema = z.object({
  query: z.string().min(1).describe("Game name to search for (e.g. 'Cyberpunk 2077')"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum number of candidate games to return"),
});

const GameHitSchema = z.object({
  appId: z.string(),
  name: z.string(),
  oslist: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  userScore: z.number().optional(),
  releaseYear: z.number().optional(),
  nativeLinux: z.boolean().optional(),
  source: z.enum(["algolia", "steam"]),
});

const outputSchema = z.object({
  count: z.number(),
  games: z.array(GameHitSchema),
});

export function registerSearchGames(server: McpServer): void {
  server.registerTool(
    "search_games",
    {
      title: "Search games",
      description:
        "Resolve a game name to its Steam appId (and basic metadata) so other " +
        "ProtonDB tools can be called. Returns candidate games to disambiguate.",
      inputSchema,
      outputSchema,
    },
    async ({ query, limit }) => {
      const games = await searchGames(query, limit);
      if (games.length === 0) {
        return {
          content: [{ type: "text", text: `No games found matching "${query}".` }],
          isError: true,
        };
      }
      const structured = {
        count: games.length,
        games: games.map((g) => ({
          appId: g.appId,
          name: g.name,
          oslist: g.oslist,
          tags: g.tags,
          userScore: g.userScore,
          releaseYear: g.releaseYear,
          nativeLinux: g.nativeLinux,
          source: g.source,
        })),
      };
      const lines = games
        .map((g) => `- ${g.name} (appId ${g.appId}${g.releaseYear ? `, ${g.releaseYear}` : ""})`)
        .join("\n");
      return {
        content: [
          { type: "text", text: `Found ${games.length} game(s):\n${lines}` },
        ],
        structuredContent: structured,
      };
    },
  );
}
