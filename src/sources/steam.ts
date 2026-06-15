import { z } from "zod";
import { fetchJson } from "../lib/http.js";
import type { GameHit } from "../lib/types.js";

const PlatformsSchema = z
  .object({ windows: z.boolean(), mac: z.boolean(), linux: z.boolean() })
  .partial()
  .optional();

const StoreSearchSchema = z.object({
  items: z
    .array(z.object({ id: z.number(), name: z.string(), platforms: PlatformsSchema }))
    .optional(),
});

/**
 * Stable fallback name->appid resolver via Steam's storefront search (no key).
 */
export async function searchSteam(query: string, limit: number): Promise<GameHit[]> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
    query,
  )}&cc=us&l=en`;
  const data = await fetchJson(url, {
    cacheTtlMs: 10 * 60_000,
    retries: 1,
    schema: StoreSearchSchema,
  });
  return (data.items ?? []).slice(0, limit).map((it) => ({
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

const AppDetailsDataSchema = z
  .object({
    type: z.string(),
    name: z.string(),
    short_description: z.string(),
    genres: z.array(z.object({ description: z.string() }).partial()),
    release_date: z.object({ date: z.string() }).partial(),
    platforms: z.object({ windows: z.boolean(), mac: z.boolean(), linux: z.boolean() }).partial(),
    metacritic: z.object({ score: z.number() }).partial(),
    website: z.string(),
  })
  .partial();

const AppDetailsResponseSchema = z.record(
  z.string(),
  z.object({ success: z.boolean(), data: AppDetailsDataSchema.optional() }),
);

/** Fetch Steam store details for an appid (genres, platforms, release, etc.). */
export async function getSteamDetails(appId: string): Promise<SteamDetails | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}`;
  const data = await fetchJson(url, {
    cacheTtlMs: 60 * 60_000,
    retries: 1,
    schema: AppDetailsResponseSchema,
  });
  const entry = data[appId];
  if (!entry?.success || !entry.data) return null;
  const d = entry.data;
  return {
    appId,
    name: d.name ?? "(unknown)",
    type: d.type,
    shortDescription: d.short_description,
    genres: d.genres?.map((g) => g.description).filter((x): x is string => typeof x === "string"),
    releaseDate: d.release_date?.date,
    nativeLinux: d.platforms?.linux,
    platforms: d.platforms,
    metacritic: d.metacritic?.score,
    website: d.website,
  };
}
