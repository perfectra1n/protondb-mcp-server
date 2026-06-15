import { z } from "zod";
import { config } from "../lib/config.js";
import { fetchJson } from "../lib/http.js";
import { num, toStringArray } from "../lib/coerce.js";
import type { GameHit } from "../lib/types.js";

// Algolia hits are loosely typed (userScore can be null; releaseYear can be a
// string like "Soon" or a number), so only objectID is required — everything
// else stays `unknown` and is coerced defensively below.
const AlgoliaResponseSchema = z.object({
  hits: z
    .array(
      z
        .object({
          objectID: z.string(),
          name: z.unknown(),
          oslist: z.unknown(),
          tags: z.unknown(),
          userScore: z.unknown(),
          releaseYear: z.unknown(),
        })
        .passthrough(),
    )
    .optional(),
});

/**
 * Search ProtonDB's own Algolia "steamdb" index by game name. This is the
 * catalog the protondb.com site itself uses, so a hit guarantees the game is
 * tracked by ProtonDB. Returns name -> appid candidates.
 */
export async function searchAlgolia(query: string, limit: number): Promise<GameHit[]> {
  const { appId, apiKey, index } = config.algolia;
  const url = `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/${index}/query`;
  const body = JSON.stringify({
    query,
    facetFilters: [["appType:Game"]],
    hitsPerPage: Math.max(1, Math.min(limit, 50)),
    attributesToRetrieve: ["name", "objectID", "oslist", "releaseYear", "tags", "userScore"],
  });
  const data = await fetchJson(url, {
    method: "POST",
    body,
    headers: {
      "x-algolia-api-key": apiKey,
      "x-algolia-application-id": appId,
      "content-type": "application/x-www-form-urlencoded",
      // ProtonDB's search key is HTTP-referer restricted; mimic the site origin.
      Referer: "https://www.protondb.com/",
      Origin: "https://www.protondb.com",
    },
    cacheTtlMs: 10 * 60_000,
    retries: 1,
    schema: AlgoliaResponseSchema,
  });
  return (data.hits ?? []).map((h) => {
    const oslist = toStringArray(h.oslist);
    return {
      appId: h.objectID,
      name: typeof h.name === "string" ? h.name : "(unknown)",
      oslist,
      tags: toStringArray(h.tags)?.slice(0, 12),
      userScore: num(h.userScore) ?? undefined,
      releaseYear: num(h.releaseYear) ?? undefined,
      nativeLinux: oslist?.some((o) => /linux|steamos/i.test(o)) ?? undefined,
      source: "algolia" as const,
    };
  });
}
