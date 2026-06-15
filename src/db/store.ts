import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../lib/config.js";
import { log } from "../lib/http.js";
import { openDb, type DB } from "./schema.js";
import { totalReports } from "./queries.js";

let db: DB | null = null;

/**
 * Pure helper: copy `seedPath` to `dbPath` when the target DB is missing or has
 * no reports. Returns true if a copy happened. Does not touch the shared
 * connection — callers must close it first if it points at `dbPath`.
 */
export function seedDatabaseFile(seedPath: string, dbPath: string): boolean {
  if (!seedPath || seedPath === dbPath || !existsSync(seedPath)) return false;

  if (existsSync(dbPath)) {
    try {
      const probe = openDb(dbPath);
      const n = totalReports(probe);
      probe.close();
      if (n > 0) return false; // already populated — keep it
    } catch {
      // unreadable/corrupt — fall through and reseed
    }
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p, { force: true });
  }
  copyFileSync(seedPath, dbPath);
  return true;
}

/**
 * If a baked seed snapshot exists and the live DB is missing or empty, copy the
 * seed into place so the server serves data immediately (no cold-start ingest).
 * No-op when the live DB already has reports, or when no seed is present.
 * Call once at startup before getDb()/auto-update.
 */
export function seedIfEmpty(): void {
  closeDb();
  if (seedDatabaseFile(config.seedDbPath, config.dbPath)) {
    log("seeded database from baked snapshot:", config.seedDbPath);
  }
}

/** Get (lazily opening) the shared database connection. */
export function getDb(): DB {
  if (!db) db = openDb(config.dbPath);
  return db;
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
