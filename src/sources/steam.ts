import { z } from "zod";
import { fetchJson } from "../lib/http.js";
import type { GameHit } from "../lib/types.js";

const PlatformsSchema = z
  .object({ windows: z.boolean(), mac: z.boolean(), linux: z.boolean() })
  .partial()
  .nullable()
  .optional();

const StoreSearchSchema = z.object({
  items: z
    .array(z.object({ id: z.number(), name: z.string().nullish(), platforms: PlatformsSchema }))
    .nullish(),
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
    name: it.name ?? "(unknown)",
    nativeLinux: it.platforms?.linux ?? undefined,
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

// Steam returns explicit `null` for many of these leaf fields (e.g. `website`
// on unreleased games), so each value is nullish — not just optional — to keep
// a single null from failing the whole parse. See get_game_details regression.
const AppDetailsDataSchema = z
  .object({
    type: z.string().nullish(),
    name: z.string().nullish(),
    short_description: z.string().nullish(),
    genres: z.array(z.object({ description: z.string().nullish() }).partial()).nullish(),
    release_date: z.object({ date: z.string().nullish() }).partial().nullish(),
    platforms: z
      .object({ windows: z.boolean(), mac: z.boolean(), linux: z.boolean() })
      .partial()
      .nullish(),
    metacritic: z.object({ score: z.number().nullish() }).partial().nullish(),
    website: z.string().nullish(),
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
    type: d.type ?? undefined,
    shortDescription: d.short_description ?? undefined,
    genres: d.genres?.map((g) => g.description).filter((x): x is string => typeof x === "string"),
    releaseDate: d.release_date?.date ?? undefined,
    nativeLinux: d.platforms?.linux ?? undefined,
    platforms: d.platforms ?? undefined,
    metacritic: d.metacritic?.score ?? undefined,
    website: d.website ?? undefined,
  };
}
