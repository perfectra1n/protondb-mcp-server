import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config.js";
import { log } from "./http.js";
import { getDb, swapDb } from "../db/store.js";
import { getMeta } from "../db/schema.js";
import { totalReports } from "../db/queries.js";
import { latestDump, type DumpInfo } from "../sources/dump-registry.js";
import { ingestToDb } from "../scripts/ingest.js";

export interface StalenessInput {
  now: Date;
  hasData: boolean;
  /** sortKey of the currently-ingested dump (year*10000+month*100+seq), or null. */
  ingestedSortKey: number | null;
  /** year/month of the currently-ingested dump, or null. */
  ingestedYearMonth: { year: number; month: number } | null;
  latest: DumpInfo | null;
}

export interface StalenessDecision {
  update: boolean;
  reason: string;
}

/**
 * Pure decision function (unit-tested). Refresh when:
 *  - the DB has no data and a dump is available (first-run bootstrap), OR
 *  - a newer dump exists upstream AND our data predates the current month AND
 *    today is on/after the 1st of the month (the monthly upload has landed).
 */
export function shouldUpdate(i: StalenessInput): StalenessDecision {
  if (!i.latest) return { update: false, reason: "no upstream dump available" };
  if (!i.hasData || i.ingestedSortKey === null) {
    return { update: true, reason: "local database is empty (bootstrap)" };
  }
  const newer = i.latest.sortKey > i.ingestedSortKey;
  if (!newer) return { update: false, reason: "local data is already the newest dump" };

  const year = i.now.getUTCFullYear();
  const month = i.now.getUTCMonth() + 1;
  const ym = i.ingestedYearMonth;
  const predatesCurrentMonth =
    !!ym && (ym.year < year || (ym.year === year && ym.month < month));
  if (!predatesCurrentMonth) {
    return { update: false, reason: "local data is from the current month" };
  }
  const pastFirst = i.now.getUTCDate() >= 1;
  if (!pastFirst) return { update: false, reason: "not yet the 1st of the month" };

  return {
    update: true,
    reason: `newer dump ${i.latest.name} available and local data is stale`,
  };
}

/** Parse stored "YYYY-MM-seq" dump-date metadata into comparable parts. */
export function parseDumpDateMeta(
  value: string | null,
): { year: number; month: number; sortKey: number } | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d+)$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const seq = Number(m[3]);
  return { year, month, sortKey: year * 10000 + month * 100 + seq };
}

let running = false;

/** Check staleness and, if needed, download + ingest + atomically swap. */
export async function runAutoUpdate(now: Date = new Date()): Promise<boolean> {
  if (!config.autoUpdate) return false;
  if (running) {
    log("auto-update already in progress, skipping");
    return false;
  }
  running = true;
  try {
    const db = getDb();
    const hasData = totalReports(db) > 0;
    const parsed = parseDumpDateMeta(getMeta(db, "dump_date"));
    const latest = await latestDump();
    const decision = shouldUpdate({
      now,
      hasData,
      ingestedSortKey: parsed?.sortKey ?? null,
      ingestedYearMonth: parsed ? { year: parsed.year, month: parsed.month } : null,
      latest,
    });
    log("auto-update decision:", JSON.stringify(decision));
    if (!decision.update || !latest) return false;

    const workDir = mkdtempSync(join(tmpdir(), "protondb-swap-"));
    const tmpDb = join(workDir, "protondb.db");
    await ingestToDb({ dumpName: latest.name }, tmpDb);
    swapDb(tmpDb);
    return true;
  } catch (err) {
    log("auto-update error:", (err as Error).message);
    return false;
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;

/** Run an update check now (non-blocking) and every 24h thereafter. */
export function startAutoUpdate(): void {
  if (!config.autoUpdate) {
    log("auto-update disabled");
    return;
  }
  void runAutoUpdate();
  timer = setInterval(() => void runAutoUpdate(), 24 * 60 * 60 * 1000);
  timer.unref();
}

export function stopAutoUpdate(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
