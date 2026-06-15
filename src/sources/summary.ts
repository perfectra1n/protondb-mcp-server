import { z } from "zod";
import { fetchJson } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { errMessage } from "../lib/coerce.js";
import type { Summary } from "../lib/types.js";

const SummaryResponseSchema = z
  .object({
    tier: z.string(),
    trendingTier: z.string(),
    bestReportedTier: z.string(),
    confidence: z.string(),
    score: z.number(),
    total: z.number(),
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
      trendingTier: d.trendingTier,
      bestReportedTier: d.bestReportedTier,
      confidence: d.confidence,
      score: d.score,
      total: d.total,
    };
  } catch (err) {
    // A missing summary (404) is expected for untracked games; log anything
    // else at debug so genuine outages are diagnosable without being noisy.
    logger.debug(`no summary for appId ${appId}:`, errMessage(err));
    return null;
  }
}
