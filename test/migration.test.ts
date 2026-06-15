import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, makeInserter } from "../src/db/schema.js";
import { runMigrations, getSchemaVersion, SCHEMA_VERSION } from "../src/db/migrate.js";
import { getReports, totalReports } from "../src/db/queries.js";
import type { Report } from "../src/lib/types.js";

let workDir: string;
let dbPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "protondb-mig-"));
  dbPath = join(workDir, "db.sqlite");
});
afterEach(() => rmSync(workDir, { recursive: true, force: true }));

function rep(): Report {
  return {
    appId: "570",
    title: "Dota 2",
    verdict: "yes",
    works: true,
    notes: "ok",
    protonVersion: "Experimental",
    launcher: "steam",
    launchOptions: "mangohud %command%",
    antiCheat: false,
    timestamp: 1,
    cpu: null,
    gpu: "AMD",
    gpuDriver: null,
    kernel: null,
    os: "Arch",
    ram: null,
    playtimeMinutes: null,
    source: "dump",
    responses: { verdict: "yes" },
    systemInfo: { gpu: "AMD" },
    device: null,
    contributor: null,
    raw: { hello: "world" },
  };
}

describe("PRAGMA user_version migrations", () => {
  it("stamps a fresh DB at the current schema version and creates tables", () => {
    const db = openDb(dbPath);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    const cols = new Set(
      (db.prepare("PRAGMA table_info(reports)").all() as { name: string }[]).map((c) => c.name),
    );
    for (const c of ["launch_options", "anti_cheat", "raw"]) expect(cols.has(c)).toBe(true);
    // full round-trip incl. raw passthrough
    makeInserter(db)(rep());
    const r = getReports(db, { appId: "570", includeRaw: true })[0]!;
    expect(r.launchOptions).toBe("mangohud %command%");
    expect((r.raw as Record<string, unknown>).hello).toBe("world");
    db.close();
  });

  it("is idempotent — re-running migrations does nothing", () => {
    const db = openDb(dbPath);
    const before = getSchemaVersion(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(() => runMigrations(db)).not.toThrow();
    expect(getSchemaVersion(db)).toBe(before);
    db.close();
  });

  it("reads a legacy (pre-user_version) database defensively", () => {
    // Simulate an old DB: original column set, user_version still 0.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE reports (
        id INTEGER PRIMARY KEY, app_id TEXT NOT NULL, title TEXT, verdict TEXT,
        works INTEGER, notes TEXT, proton_version TEXT, launcher TEXT,
        timestamp INTEGER, cpu TEXT, gpu TEXT, gpu_driver TEXT, kernel TEXT,
        os TEXT, ram TEXT, playtime_min INTEGER, source TEXT NOT NULL
      );
      INSERT INTO reports (app_id, gpu, os, source) VALUES ('570','AMD','Arch','dump');
    `);
    expect(legacy.pragma("user_version", { simple: true })).toBe(0);
    legacy.close();

    // New code opens it: migrations run (no-op create), and reads don't error
    // even though launch_options/raw columns are absent (defensive rowToReport).
    const db = openDb(dbPath);
    const rows = getReports(db, { appId: "570" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.launchOptions).toBeNull();
    expect(rows[0]!.systemInfo).toEqual(expect.objectContaining({ gpu: "AMD", os: "Arch" }));
    expect(totalReports(db)).toBe(1);
    db.close();
  });
});
