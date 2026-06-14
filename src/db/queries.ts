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
}

/** Number of reports stored for a given appId. */
export function countReports(db: DB, appId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM reports WHERE app_id = ?`)
    .get(appId) as { n: number };
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
  return rows.map(rowToReport);
}

/**
 * Turn arbitrary user input into a safe FTS5 MATCH expression. Each alphanumeric
 * token is quoted (so characters like '-' and ':' are not misread as FTS
 * operators) and combined with implicit AND. Returns null if no usable tokens.
 */
export function toFtsQuery(input: string): string | null {
  const tokens = input.match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(" ");
}

/**
 * General full-text keyword search across reports — matches notes, title, Proton
 * version, GPU, and OS. Optionally scoped to a single app. Returns up to `limit`
 * reports (hard-capped) ranked by relevance.
 */
export function searchReports(
  db: DB,
  query: string,
  opts: { appId?: string; limit?: number } = {},
): Report[] {
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
  const appClause = opts.appId ? "AND r.app_id = @appId" : "";
  const rows = db
    .prepare(
      `SELECT r.* FROM reports_fts f
       JOIN reports r ON r.id = f.rowid
       WHERE reports_fts MATCH @query ${appClause}
       ORDER BY rank LIMIT ${limit}`,
    )
    .all({ query: ftsQuery, appId: opts.appId }) as ReportRow[];
  return rows.map(rowToReport);
}

/** Total report count across the whole DB. */
export function totalReports(db: DB): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM reports`).get() as { n: number };
  return row.n;
}
