import type { DB, ReportRow } from "./schema.js";
import { rowToReport } from "./schema.js";
import type { Report } from "../lib/types.js";

export interface ReportFilters {
  appId: string;
  limit?: number;
  /** "yes" | "no" — filter on the raw per-report verdict. */
  verdict?: "yes" | "no";
  /** Substring match (case-insensitive) on proton version. */
  protonVersionContains?: string;
  /** Substring match (case-insensitive) on GPU string. */
  gpuContains?: string;
  /** Only reports at or after this unix-epoch-seconds timestamp. */
  since?: number;
  /** Include the complete original record (`raw`) on each report. */
  includeRaw?: boolean;
}

/** Number of reports stored for a given appId. */
export function countReports(db: DB, appId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE app_id = ?`).get(appId) as {
    n: number;
  };
  return row.n;
}

/** Fetch individual reports for an app with optional server-side filters. */
export function getReports(db: DB, f: ReportFilters): Report[] {
  const where: string[] = ["app_id = @appId"];
  const params: Record<string, unknown> = { appId: f.appId };
  if (f.verdict) {
    where.push("verdict = @verdict");
    params.verdict = f.verdict;
  }
  if (f.protonVersionContains) {
    where.push("LOWER(proton_version) LIKE @pv");
    params.pv = `%${f.protonVersionContains.toLowerCase()}%`;
  }
  if (f.gpuContains) {
    where.push("LOWER(gpu) LIKE @gpu");
    params.gpu = `%${f.gpuContains.toLowerCase()}%`;
  }
  if (typeof f.since === "number") {
    where.push("timestamp >= @since");
    params.since = f.since;
  }
  const limit = Math.max(1, Math.min(f.limit ?? 50, 500));
  const rows = db
    .prepare(
      `SELECT * FROM reports WHERE ${where.join(" AND ")}
       ORDER BY timestamp DESC NULLS LAST LIMIT ${limit}`,
    )
    .all(params) as ReportRow[];
  return rows.map((r) => rowToReport(r, f.includeRaw ?? false));
}

/** How to combine the tokens of a multi-word query. */
export type MatchMode = "any" | "all";

/**
 * Turn arbitrary user input into a safe FTS5 MATCH expression. Each alphanumeric
 * token is quoted (so characters like '-' and ':' are not misread as FTS
 * operators). Tokens are combined with OR by default (`mode: "any"`) so a
 * multi-keyword query like "vulkan dx11 stutter" finds reports matching ANY term
 * (ranked by relevance), instead of requiring all of them in one report. Pass
 * `mode: "all"` for the stricter implicit-AND behaviour. Returns null if no
 * usable tokens.
 */
export function toFtsQuery(input: string, mode: MatchMode = "any"): string | null {
  const tokens = input.match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t}"`);
  return quoted.join(mode === "all" ? " " : " OR ");
}

/**
 * General full-text keyword search across reports — matches notes, title, Proton
 * version, GPU, OS, and launch options. Optionally scoped to a single app.
 * Matches ANY keyword by default (`match: "any"`), ranked by FTS5 relevance
 * (BM25) so reports hitting more/rarer terms surface first; `match: "all"`
 * requires every term. `sort: "recent"` orders by timestamp instead of
 * relevance. Returns up to `limit` reports (hard-capped).
 */
export function searchReports(
  db: DB,
  query: string,
  opts: {
    appId?: string;
    limit?: number;
    includeRaw?: boolean;
    match?: MatchMode;
    sort?: "relevance" | "recent";
  } = {},
): Report[] {
  const ftsQuery = toFtsQuery(query, opts.match ?? "any");
  if (!ftsQuery) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
  const appClause = opts.appId ? "AND r.app_id = @appId" : "";
  const orderBy = opts.sort === "recent" ? "r.timestamp DESC NULLS LAST" : "rank";
  const rows = db
    .prepare(
      `SELECT r.* FROM reports_fts f
       JOIN reports r ON r.id = f.rowid
       WHERE reports_fts MATCH @query ${appClause}
       ORDER BY ${orderBy} LIMIT ${limit}`,
    )
    .all({ query: ftsQuery, appId: opts.appId }) as ReportRow[];
  return rows.map((r) => rowToReport(r, opts.includeRaw ?? false));
}

/** Total report count across the whole DB. */
export function totalReports(db: DB): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM reports`).get() as { n: number };
  return row.n;
}
