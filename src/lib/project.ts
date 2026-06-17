import type { Report } from "./types.js";

/**
 * Field projection + a soft byte budget for report-bearing responses.
 *
 * `get_reports` and `search_reports` used to embed the full `responses` /
 * `systemInfo` / `device` / `contributor` blobs on every report by default —
 * ~90% of the bytes, and almost always more than the caller wanted. That blew
 * the MCP host's token limit and forced a dump-to-disk + `jq` dance.
 *
 * Now the default is compact (flat fields only), the caller can ask for exactly
 * the keys it needs, and whatever is returned is trimmed to a byte budget so a
 * large result set degrades gracefully (drop the tail, say how many) instead of
 * overflowing.
 */

/** Heavy nested passthrough fields — excluded from the compact default. */
export const NESTED_FIELDS: (keyof Report)[] = [
  "responses",
  "systemInfo",
  "device",
  "contributor",
];

/** Every Report key. Keep in sync with ReportSchema in types.ts. */
export const ALL_FIELDS: (keyof Report)[] = [
  "appId",
  "title",
  "works",
  "verdict",
  "notes",
  "protonVersion",
  "launcher",
  "launchOptions",
  "antiCheat",
  "timestamp",
  "cpu",
  "gpu",
  "gpuDriver",
  "kernel",
  "os",
  "ram",
  "playtimeMinutes",
  "source",
  "responses",
  "systemInfo",
  "device",
  "contributor",
  "raw",
  "profileScore",
];

/** Compact default: all flat fields, none of the heavy nested blobs or `raw`. */
export const FLAT_FIELDS: (keyof Report)[] = ALL_FIELDS.filter(
  (f) => !NESTED_FIELDS.includes(f) && f !== "raw" && f !== "profileScore",
);

export type Detail = "compact" | "full";

export interface ProjectOptions {
  /** Explicit allow-list of field names; wins over `detail`. Unknown names are ignored. */
  fields?: string[];
  /** "compact" (flat fields only, default) or "full" (flat + nested blobs). */
  detail?: Detail;
  /** Add the verbatim `raw` record on top of whatever else is selected. */
  includeRaw?: boolean;
}

/** Resolve the effective key set for a projection request. */
export function resolveFields(opts: ProjectOptions): Set<keyof Report> {
  const keep = new Set<keyof Report>();
  if (opts.fields && opts.fields.length > 0) {
    for (const f of opts.fields) {
      if (ALL_FIELDS.includes(f as keyof Report)) keep.add(f as keyof Report);
    }
  } else {
    for (const f of FLAT_FIELDS) keep.add(f);
    if (opts.detail === "full") for (const f of NESTED_FIELDS) keep.add(f);
  }
  // appId is required by the output schema; it is always present.
  keep.add("appId");
  if (opts.includeRaw) keep.add("raw");
  return keep;
}

/**
 * Project one report down to the requested key set, omitting everything else.
 * `appId` is always included; `profileScore`, when set, is always kept (it's
 * tiny and explains the sort order).
 */
export function projectReport(report: Report, keep: Set<keyof Report>): Partial<Report> {
  const out: Partial<Report> = { appId: report.appId };
  for (const k of keep) {
    const v = report[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  if (report.profileScore !== undefined) out.profileScore = report.profileScore;
  return out;
}

export interface BudgetResult<T> {
  kept: T[];
  dropped: number;
}

/**
 * Trim a list of already-projected items so their serialized JSON stays under
 * `maxChars`. Returns as many leading items as fit plus the dropped count. Order
 * is preserved, so sort by relevance/recency BEFORE calling this. The first item
 * is always kept (so a single oversized report never yields an empty result).
 */
export function fitToBudget<T>(items: T[], maxChars: number): BudgetResult<T> {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const size = JSON.stringify(item).length + 1; // +1 ≈ the array separator
    if (kept.length > 0 && used + size > maxChars) break;
    kept.push(item);
    used += size;
  }
  return { kept, dropped: items.length - kept.length };
}

/** Project every report, then trim the list to the byte budget. */
export function projectAndFit(
  reports: Report[],
  opts: ProjectOptions,
  maxChars: number,
): { reports: Partial<Report>[]; dropped: number } {
  const keep = resolveFields(opts);
  const projected = reports.map((r) => projectReport(r, keep));
  const { kept, dropped } = fitToBudget(projected, maxChars);
  return { reports: kept, dropped };
}
