import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Report } from "../lib/types.js";
import { runMigrations } from "./migrate.js";

export type DB = Database.Database;

/**
 * Open (creating if needed) the SQLite database and run pending migrations.
 * Safe to call repeatedly. Uses WAL for concurrent read performance.
 */
export function openDb(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  runMigrations(db);
  return db;
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
  launch_options: string | null;
  anti_cheat: number | null;
  timestamp: number | null;
  cpu: string | null;
  gpu: string | null;
  gpu_driver: string | null;
  kernel: string | null;
  os: string | null;
  ram: string | null;
  playtime_min: number | null;
  source: string;
  raw: string | null;
}

/** Convert a stored row back into the normalized {@link Report} shape. */
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function rowToReport(r: ReportRow, includeRaw = false): Report {
  // Parse the stored raw record once to surface every field structurally.
  let raw: Record<string, unknown> | null = null;
  if (r.raw) {
    try {
      raw = JSON.parse(r.raw) as Record<string, unknown>;
    } catch {
      raw = null;
    }
  }
  // Fallback systemInfo from flat columns for legacy rows that predate `raw`.
  const systemInfo =
    asObject(raw?.systemInfo) ??
    (r.cpu || r.gpu || r.os
      ? { cpu: r.cpu, gpu: r.gpu, gpuDriver: r.gpu_driver, kernel: r.kernel, os: r.os, ram: r.ram }
      : null);

  return {
    appId: r.app_id,
    title: r.title,
    verdict: r.verdict,
    works: r.works === null ? null : r.works === 1,
    notes: r.notes,
    protonVersion: r.proton_version,
    launcher: r.launcher,
    launchOptions: r.launch_options ?? null,
    antiCheat: r.anti_cheat === null || r.anti_cheat === undefined ? null : r.anti_cheat === 1,
    timestamp: r.timestamp,
    cpu: r.cpu,
    gpu: r.gpu,
    gpuDriver: r.gpu_driver,
    kernel: r.kernel,
    os: r.os,
    ram: r.ram,
    playtimeMinutes: r.playtime_min,
    source: r.source === "live" ? "live" : "dump",
    responses: asObject(raw?.responses),
    systemInfo,
    device: asObject(raw?.device),
    contributor: asObject(raw?.contributor),
    ...(includeRaw ? { raw } : {}),
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
      (app_id, title, verdict, works, notes, proton_version, launcher, launch_options,
       anti_cheat, timestamp, cpu, gpu, gpu_driver, kernel, os, ram, playtime_min, source, raw)
    VALUES
      (@app_id, @title, @verdict, @works, @notes, @proton_version, @launcher, @launch_options,
       @anti_cheat, @timestamp, @cpu, @gpu, @gpu_driver, @kernel, @os, @ram, @playtime_min, @source, @raw)
  `);
  const insertFts = db.prepare(
    `INSERT INTO reports_fts(rowid, notes, title, proton_version, gpu, os, launch_options, app_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      launch_options: rep.launchOptions,
      anti_cheat:
        rep.antiCheat === null || rep.antiCheat === undefined ? null : rep.antiCheat ? 1 : 0,
      timestamp: rep.timestamp,
      cpu: rep.cpu,
      gpu: rep.gpu,
      gpu_driver: rep.gpuDriver,
      kernel: rep.kernel,
      os: rep.os,
      ram: rep.ram,
      playtime_min: rep.playtimeMinutes,
      source: rep.source,
      raw: rep.raw ? JSON.stringify(rep.raw) : null,
    });
    insertFts.run(
      info.lastInsertRowid,
      rep.notes ?? "",
      rep.title ?? "",
      rep.protonVersion ?? "",
      rep.gpu ?? "",
      rep.os ?? "",
      rep.launchOptions ?? "",
      rep.appId,
    );
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
