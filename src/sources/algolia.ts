import { config } from "../lib/config.js";
import { fetchJson } from "../lib/http.js";
import type { GameHit } from "../lib/types.js";

interface AlgoliaHit {
  objectID: string;
  name?: unknown;
  oslist?: unknown;
  tags?: unknown;
  // Algolia returns these loosely typed: userScore can be null, and releaseYear
  // can be a string like "Soon" or "2026" as well as a number.
  userScore?: unknown;
  releaseYear?: unknown;
}
interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

/** Coerce an unknown value to a finite number, or undefined. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/** Coerce an unknown value to a string array (of strings), or undefined. */
function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter((x): x is string => typeof x === "string");
  return arr.length > 0 ? arr : undefined;
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
  return data.hits.map((h) => {
    const oslist = toStringArray(h.oslist);
    return {
      appId: h.objectID,
      name: typeof h.name === "string" ? h.name : "(unknown)",
      oslist,
      tags: toStringArray(h.tags)?.slice(0, 12),
      userScore: toNumber(h.userScore),
      releaseYear: toNumber(h.releaseYear),
      nativeLinux: oslist?.some((o) => /linux|steamos/i.test(o)) ?? undefined,
      source: "algolia" as const,
    };
  });
}
