import { fetchJson } from "../lib/http.js";
import type { GameHit } from "../lib/types.js";

interface StoreSearchItem {
  id: number;
  name: string;
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
}
interface StoreSearchResponse {
  total: number;
  items: StoreSearchItem[];
}

/**
 * Stable fallback name->appid resolver via Steam's storefront search (no key).
 */
export async function searchSteam(query: string, limit: number): Promise<GameHit[]> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
    query,
  )}&cc=us&l=en`;
  const data = await fetchJson<StoreSearchResponse>(url, {
    cacheTtlMs: 10 * 60_000,
    retries: 1,
  });
  return data.items.slice(0, limit).map((it) => ({
    appId: String(it.id),
    name: it.name,
    nativeLinux: it.platforms?.linux,
    source: "steam" as const,
  }));
}

export interface SteamDetails {
  appId: string;
  name: string;
  type?: string;
  shortDescription?: string;
  genres?: string[];
  releaseDate?: string;
  nativeLinux?: boolean;
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  metacritic?: number;
  website?: string;
}

interface AppDetailsData {
  type?: string;
  name?: string;
  short_description?: string;
  genres?: { description: string }[];
  release_date?: { date?: string };
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  metacritic?: { score?: number };
  website?: string;
}
interface AppDetailsResponse {
  [appid: string]: { success: boolean; data?: AppDetailsData };
}

/** Fetch Steam store details for an appid (genres, platforms, release, etc.). */
export async function getSteamDetails(appId: string): Promise<SteamDetails | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(
    appId,
  )}`;
  const data = await fetchJson<AppDetailsResponse>(url, {
    cacheTtlMs: 60 * 60_000,
    retries: 1,
  });
  const entry = data[appId];
  if (!entry?.success || !entry.data) return null;
  const d = entry.data;
  return {
    appId,
    name: d.name ?? "(unknown)",
    type: d.type,
    shortDescription: d.short_description,
    genres: d.genres?.map((g) => g.description),
    releaseDate: d.release_date?.date,
    nativeLinux: d.platforms?.linux,
    platforms: d.platforms,
    metacritic: d.metacritic?.score,
    website: d.website,
  };
}
