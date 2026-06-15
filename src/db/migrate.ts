import type { DB } from "./schema.js";

/**
 * Schema management uses SQLite's native `PRAGMA user_version`.
 *
 * Two distinct version counters, on purpose:
 *  - user_version (this file): the DDL/structure version. {@link runMigrations}
 *    applies any pending ordered migrations and stamps user_version. A fresh DB
 *    is created at the latest structure in one step.
 *  - meta `data_version` (EXTRACTION_VERSION): the field-extraction version the
 *    rows were ingested with. Because the database is disposable (rebuilt from
 *    the upstream dump), when the extraction logic changes we bump this and the
 *    auto-updater triggers a full re-ingest to backfill newly-captured fields —
 *    rather than mutating existing rows in place. See ingest.ts / auto-update.ts.
 */

type Migration = (db: DB) => void;

/** v1: the full current structure (fresh databases are created directly here). */
const createInitialSchema: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id             INTEGER PRIMARY KEY,
      app_id         TEXT NOT NULL,
      title          TEXT,
      verdict        TEXT,
      works          INTEGER,
      notes          TEXT,
      proton_version TEXT,
      launcher       TEXT,
      launch_options TEXT,
      anti_cheat     INTEGER,
      timestamp      INTEGER,
      cpu            TEXT,
      gpu            TEXT,
      gpu_driver     TEXT,
      kernel         TEXT,
      os             TEXT,
      ram            TEXT,
      playtime_min   INTEGER,
      source         TEXT NOT NULL,
      raw            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reports_app ON reports(app_id);
    CREATE INDEX IF NOT EXISTS idx_reports_app_ts ON reports(app_id, timestamp);

    CREATE VIRTUAL TABLE IF NOT EXISTS reports_fts USING fts5(
      notes, title, proton_version, gpu, os, launch_options,
      app_id UNINDEXED, content='reports', content_rowid='id'
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
};

/**
 * Ordered DDL migrations. Index i upgrades the schema from version i to i+1.
 * Append new entries here for future structural changes; never edit shipped ones.
 */
const MIGRATIONS: Migration[] = [createInitialSchema];

/** Current DDL structure version (number of migrations). */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Current data-extraction version. Bump when normalizeReport changes which
 * fields are captured, so existing deployments re-ingest to backfill them.
 */
export const EXTRACTION_VERSION = 2;

/** Apply any pending DDL migrations, advancing PRAGMA user_version each step. */
export function runMigrations(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const migrate = MIGRATIONS[v]!;
    db.transaction(() => {
      migrate(db);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** The DB's current DDL version (PRAGMA user_version). */
export function getSchemaVersion(db: DB): number {
  return db.pragma("user_version", { simple: true }) as number;
}
