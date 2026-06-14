import { config } from "../lib/config.js";
import { fetchJson } from "../lib/http.js";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export interface DumpInfo {
  /** e.g. "reports_oct2_2025.tar.gz" */
  name: string;
  /** Direct download URL. */
  url: string;
  year: number;
  month: number;
  /** In-month sequence number (e.g. the "2" in oct2). */
  seq: number;
  /** Monotonic sortable key: higher = newer. */
  sortKey: number;
}

interface GhContentItem {
  name: string;
  download_url: string | null;
}

/** Parse "reports_<mon><n>_<year>.tar.gz" into structured info, or null. */
export function parseDumpName(name: string, url: string): DumpInfo | null {
  const m = /^reports_([a-z]{3})(\d+)_(\d{4})\.tar\.gz$/i.exec(name);
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  const seq = Number(m[2]);
  const year = Number(m[3]);
  return { name, url, year, month, seq, sortKey: year * 10000 + month * 100 + seq };
}

/** List all available bulk dumps from the bdefore repo, newest first. */
export async function listDumps(): Promise<DumpInfo[]> {
  const url = `https://api.github.com/repos/${config.dumpRepo}/contents/reports`;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;
  const items = await fetchJson<GhContentItem[]>(url, {
    headers,
    cacheTtlMs: 60 * 60_000,
    retries: 1,
  });
  return items
    .map((it) =>
      parseDumpName(
        it.name,
        it.download_url ??
          `https://github.com/${config.dumpRepo}/raw/${config.dumpBranch}/reports/${it.name}`,
      ),
    )
    .filter((d): d is DumpInfo => d !== null)
    .sort((a, b) => b.sortKey - a.sortKey);
}

/** The newest available dump, or null if none could be listed. */
export async function latestDump(): Promise<DumpInfo | null> {
  const dumps = await listDumps();
  return dumps[0] ?? null;
}

/** Find a dump by exact filename. */
export async function findDump(name: string): Promise<DumpInfo | null> {
  const dumps = await listDumps();
  return dumps.find((d) => d.name === name) ?? null;
}
