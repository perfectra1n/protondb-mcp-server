import { z } from "zod";

/**
 * Normalized ProtonDB report shape. Both the bulk-dump records and the live
 * (headless-captured) records are mapped into this single shape so every tool
 * is source-agnostic. See {@link ./normalize.ts}.
 */
// NOTE: every field except `appId` is BOTH nullable and optional. Optional is
// what makes field projection valid output — `get_reports`/`search_reports`
// return compact reports by omitting keys the caller didn't ask for, and the
// MCP output validator only accepts an omitted key when the field is optional
// (a bare `.nullable()` still requires the key to be present). See lib/project.ts.
export const ReportSchema = z.object({
  appId: z.string().describe("Steam application id the report is about"),
  title: z.string().nullable().optional().describe("Game title, when known"),
  works: z
    .boolean()
    .nullable()
    .optional()
    .describe("Whether the reporter said the game worked (verdict 'yes')"),
  verdict: z
    .string()
    .nullable()
    .optional()
    .describe("Raw per-report verdict ('yes'/'no') as submitted"),
  notes: z
    .string()
    .nullable()
    .optional()
    .describe("Free-text reporter notes (the most useful field for pattern mining)"),
  protonVersion: z
    .string()
    .nullable()
    .optional()
    .describe("Proton/GE-Proton version used, including custom builds"),
  launcher: z.string().nullable().optional().describe("Launcher used (e.g. Steam, Heroic)"),
  launchOptions: z
    .string()
    .nullable()
    .optional()
    .describe("Steam launch options / flags the reporter used (e.g. 'gamemoderun %command%')"),
  antiCheat: z
    .boolean()
    .nullable()
    .optional()
    .describe("Whether the reporter said the game is impacted by anti-cheat"),
  timestamp: z
    .number()
    .nullable()
    .optional()
    .describe("Unix epoch seconds when the report was submitted"),
  cpu: z.string().nullable().optional().describe("Reporter CPU (bulk dump only)"),
  gpu: z.string().nullable().optional().describe("Reporter GPU (bulk dump only)"),
  gpuDriver: z.string().nullable().optional().describe("Reporter GPU driver (bulk dump only)"),
  kernel: z.string().nullable().optional().describe("Reporter kernel version (bulk dump only)"),
  os: z.string().nullable().optional().describe("Reporter OS/distro (bulk dump only)"),
  ram: z.string().nullable().optional().describe("Reporter RAM (bulk dump only)"),
  playtimeMinutes: z
    .number()
    .nullable()
    .optional()
    .describe("Reporter playtime in minutes (live reports only)"),
  source: z.enum(["dump", "live"]).optional().describe("Where this normalized report came from"),
  // Full structured passthroughs so EVERY field is available, not just the
  // indexed/flat ones above. Returned only when requested (detail='full' or a
  // `fields` projection naming them) — they dominate response size otherwise.
  responses: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe(
      "The complete `responses` object: all faults (audio/graphical/performance/…), " +
        "installs/opens/startsPlay, frameRate, batteryPerformance, per-category notes, " +
        "verdictOob/triedOob, type/variant, multiplayer appraisals, launchOptions, etc. " +
        "Returned only with detail='full' or fields=[...,'responses'].",
    ),
  systemInfo: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe(
      "Full hardware/software info: cpu, gpu, gpuDriver, kernel, os, ram, steamRuntimeVersion, " +
        "xWindowManager. Returned only with detail='full' or fields=[...,'systemInfo'].",
    ),
  device: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe("Device info when present (e.g. live reports: hardwareType, inferred)"),
  contributor: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe("Contributor info when present (e.g. live: steam playtime, reportTally)"),
  raw: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe("The complete verbatim original record. Included only when includeRaw=true."),
  profileScore: z
    .number()
    .optional()
    .describe(
      "Similarity to the systemProfile you passed (higher = closer hardware/distro/session match). " +
        "Present only when systemProfile was supplied; reports are sorted by it.",
    ),
});

export type Report = z.infer<typeof ReportSchema>;

/** ProtonDB tier values, best to worst, plus native/pending. */
export const TIERS = [
  "platinum",
  "gold",
  "silver",
  "bronze",
  "borked",
  "native",
  "pending",
] as const;
export type Tier = (typeof TIERS)[number];

/** Live tier-summary payload from /api/v1/reports/summaries/{appid}.json */
export interface Summary {
  appId: string;
  tier: string;
  trendingTier?: string;
  bestReportedTier?: string;
  confidence?: string;
  score?: number;
  total?: number;
}

/** A game search hit (from Algolia or Steam storesearch). */
export interface GameHit {
  appId: string;
  name: string;
  oslist?: string[];
  tags?: string[];
  userScore?: number;
  releaseYear?: number;
  nativeLinux?: boolean;
  source: "algolia" | "steam";
}
