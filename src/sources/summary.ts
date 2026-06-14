import { fetchJson } from "../lib/http.js";
import type { Summary } from "../lib/types.js";

interface SummaryResponse {
  tier?: string;
  trendingTier?: string;
  bestReportedTier?: string;
  confidence?: string;
  score?: number;
  total?: number;
}

/**
 * Fetch the live ProtonDB tier summary for an appid. Returns null if ProtonDB
 * has no summary for the game (404).
 */
export async function getSummary(appId: string): Promise<Summary | null> {
  const url = `https://www.protondb.com/api/v1/reports/summaries/${encodeURIComponent(
    appId,
  )}.json`;
  try {
    const d = await fetchJson<SummaryResponse>(url, { cacheTtlMs: 30 * 60_000, retries: 1 });
    return {
      appId,
      tier: d.tier ?? "pending",
      trendingTier: d.trendingTier,
      bestReportedTier: d.bestReportedTier,
      confidence: d.confidence,
      score: d.score,
      total: d.total,
    };
  } catch {
    return null;
  }
}
