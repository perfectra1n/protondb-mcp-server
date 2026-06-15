import { existsSync, renameSync, rmSync } from "node:fs";
import { config } from "../lib/config.js";
import { log } from "../lib/logger.js";
import { openDb, type DB } from "./schema.js";
import { totalReports } from "./queries.js";

let db: DB | null = null;

/** Get (lazily opening) the shared database connection. */
export function getDb(): DB {
  if (!db) db = openDb(config.dbPath);
  return db;
}

/**
 * Readiness: true once the database has at least one report. Used by the HTTP
 * /ready probe so the pod isn't marked Ready (and routed traffic) until the
 * first-boot ingest has populated an otherwise-empty database. Never throws.
 */
export function isReady(): boolean {
  try {
    return totalReports(getDb()) > 0;
  } catch {
    return false;
  }
}

/** Close the shared connection if open. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Atomically replace the live database file with a freshly-built one, then
 * reopen. Closes the current connection, moves the new file into place
 * (removing stale WAL/SHM sidecars), and reopens so callers transparently see
 * the new data on their next getDb().
 */
export function swapDb(newDbPath: string): void {
  closeDb();
  for (const suffix of ["-wal", "-shm"]) {
    const side = config.dbPath + suffix;
    if (existsSync(side)) rmSync(side, { force: true });
  }
  renameSync(newDbPath, config.dbPath);
  db = openDb(config.dbPath);
  log("database swapped in:", config.dbPath);
}
