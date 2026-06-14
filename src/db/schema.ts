import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Report } from "../lib/types.js";

export type DB = Database.Database;

/**
 * Open (creating if needed) the SQLite database and apply the schema. Safe to
 * call repeatedly. Uses WAL for concurrent read performance.
 */
export function openDb(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  applySchema(db);
  return db;
}

export function applySchema(db: DB): void {
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
      timestamp      INTEGER,
      cpu            TEXT,
      gpu            TEXT,
      gpu_driver     TEXT,
      kernel         TEXT,
      os             TEXT,
      ram            TEXT,
      playtime_min   INTEGER,
      source         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reports_app ON reports(app_id);
    CREATE INDEX IF NOT EXISTS idx_reports_app_ts ON reports(app_id, timestamp);

    CREATE VIRTUAL TABLE IF NOT EXISTS reports_fts USING fts5(
      notes, title, app_id UNINDEXED, content='reports', content_rowid='id'
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

/** Row shape as stored in SQLite. */
export interface ReportRow {
  id: number;
  app_id: string;
  title: string | null;
  verdict: string | null;
  works: number | null;
  notes: string | null;
  proton_version: string | null;
  launcher: string | null;
  timestamp: number | null;
  cpu: string | null;
  gpu: string | null;
  gpu_driver: string | null;
  kernel: string | null;
  os: string | null;
  ram: string | null;
  playtime_min: number | null;
  source: string;
}

/** Convert a stored row back into the normalized {@link Report} shape. */
export function rowToReport(r: ReportRow): Report {
  return {
    appId: r.app_id,
    title: r.title,
    verdict: r.verdict,
    works: r.works === null ? null : r.works === 1,
    notes: r.notes,
    protonVersion: r.proton_version,
    launcher: r.launcher,
    timestamp: r.timestamp,
    cpu: r.cpu,
    gpu: r.gpu,
    gpuDriver: r.gpu_driver,
    kernel: r.kernel,
    os: r.os,
    ram: r.ram,
    playtimeMinutes: r.playtime_min,
    source: r.source === "live" ? "live" : "dump",
  };
}

/**
 * Create a prepared insert bound to `db`. Returns a function that inserts one
 * normalized report and keeps the FTS index in sync. Call within a transaction
 * for bulk loads.
 */
export function makeInserter(db: DB): (rep: Report) => void {
  const insert = db.prepare(`
    INSERT INTO reports
      (app_id, title, verdict, works, notes, proton_version, launcher, timestamp,
       cpu, gpu, gpu_driver, kernel, os, ram, playtime_min, source)
    VALUES
      (@app_id, @title, @verdict, @works, @notes, @proton_version, @launcher, @timestamp,
       @cpu, @gpu, @gpu_driver, @kernel, @os, @ram, @playtime_min, @source)
  `);
  const insertFts = db.prepare(
    `INSERT INTO reports_fts(rowid, notes, title, app_id) VALUES (?, ?, ?, ?)`,
  );
  return (rep: Report) => {
    const info = insert.run({
      app_id: rep.appId,
      title: rep.title,
      verdict: rep.verdict,
      works: rep.works === null ? null : rep.works ? 1 : 0,
      notes: rep.notes,
      proton_version: rep.protonVersion,
      launcher: rep.launcher,
      timestamp: rep.timestamp,
      cpu: rep.cpu,
      gpu: rep.gpu,
      gpu_driver: rep.gpuDriver,
      kernel: rep.kernel,
      os: rep.os,
      ram: rep.ram,
      playtime_min: rep.playtimeMinutes,
      source: rep.source,
    });
    insertFts.run(info.lastInsertRowid, rep.notes ?? "", rep.title ?? "", rep.appId);
  };
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
