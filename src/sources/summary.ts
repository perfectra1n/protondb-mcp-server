import { z } from "zod";
import { fetchJson } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { errMessage } from "../lib/coerce.js";
import type { Summary } from "../lib/types.js";

// Leaf values are nullish (not just optional): ProtonDB can return explicit
// `null` for any of these on a pending/untracked game.
const SummaryResponseSchema = z
  .object({
    tier: z.string().nullish(),
    trendingTier: z.string().nullish(),
    bestReportedTier: z.string().nullish(),
    confidence: z.string().nullish(),
    score: z.number().nullish(),
    total: z.number().nullish(),
  })
  .partial();

/**
 * Fetch the live ProtonDB tier summary for an appid. Returns null if ProtonDB
 * has no summary for the game (a 404 — or any other fetch error, which is
 * logged rather than swallowed silently).
 */
export async function getSummary(appId: string): Promise<Summary | null> {
  const url = `https://www.protondb.com/api/v1/reports/summaries/${encodeURIComponent(appId)}.json`;
  try {
    const d = await fetchJson(url, {
      cacheTtlMs: 30 * 60_000,
      retries: 1,
      schema: SummaryResponseSchema,
    });
    return {
      appId,
      tier: d.tier ?? "pending",
      trendingTier: d.trendingTier ?? undefined,
      bestReportedTier: d.bestReportedTier ?? undefined,
      confidence: d.confidence ?? undefined,
      score: d.score ?? undefined,
      total: d.total ?? undefined,
    };
  } catch (err) {
    // A missing summary (404) is expected for untracked games; log anything
    // else at debug so genuine outages are diagnosable without being noisy.
    logger.debug(`no summary for appId ${appId}:`, errMessage(err));
    return null;
  }
}
