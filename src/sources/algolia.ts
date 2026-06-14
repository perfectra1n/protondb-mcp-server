import { config } from "../lib/config.js";
import { fetchJson } from "../lib/http.js";
import type { GameHit } from "../lib/types.js";

interface AlgoliaHit {
  objectID: string;
  name?: string;
  oslist?: string[];
  tags?: string[];
  userScore?: number;
  releaseYear?: number;
}
interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

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
    attributesToRetrieve: [
      "name",
      "objectID",
      "oslist",
      "releaseYear",
      "tags",
      "userScore",
    ],
  });
  const data = await fetchJson<AlgoliaResponse>(url, {
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
  });
  return data.hits.map((h) => ({
    appId: h.objectID,
    name: h.name ?? "(unknown)",
    oslist: h.oslist,
    tags: h.tags?.slice(0, 12),
    userScore: h.userScore,
    releaseYear: h.releaseYear,
    nativeLinux: h.oslist?.some((o) => /linux|steamos/i.test(o)) ?? undefined,
    source: "algolia" as const,
  }));
}
