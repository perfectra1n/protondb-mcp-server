import { searchAlgolia } from "../sources/algolia.js";
import { searchSteam } from "../sources/steam.js";
import { log } from "../lib/http.js";
import type { GameHit } from "../lib/types.js";

/** Search for games by name: ProtonDB's Algolia index, Steam as a fallback. */
export async function searchGames(query: string, limit = 10): Promise<GameHit[]> {
  try {
    const hits = await searchAlgolia(query, limit);
    if (hits.length > 0) return hits;
  } catch (err) {
    log("algolia search failed, falling back to steam:", (err as Error).message);
  }
  try {
    return await searchSteam(query, limit);
  } catch (err) {
    log("steam search failed:", (err as Error).message);
    return [];
  }
}

export interface ResolvedGame {
  appId: string;
  name: string | null;
}

/**
 * Resolve a tool's {appId?, name?} input to a single appId. Throws an Error
 * with an actionable message the model can act on if it cannot resolve.
 */
export async function resolveAppId(input: {
  appId?: string;
  name?: string;
}): Promise<ResolvedGame> {
  if (input.appId && input.appId.trim()) {
    return { appId: input.appId.trim(), name: null };
  }
  if (input.name && input.name.trim()) {
    const hits = await searchGames(input.name, 5);
    if (hits.length === 0) {
      throw new Error(
        `No game found matching "${input.name}". Try a different spelling or call ` +
          `search_games to list candidates.`,
      );
    }
    return { appId: hits[0]!.appId, name: hits[0]!.name };
  }
  throw new Error("Provide either an appId or a game name.");
}
