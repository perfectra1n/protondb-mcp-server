import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, makeInserter, type DB } from "../src/db/schema.js";
import { seedDatabaseFile } from "../src/db/store.js";
import { totalReports } from "../src/db/queries.js";
import type { Report } from "../src/lib/types.js";

let workDir: string;

function rep(): Report {
  return {
    appId: "570", title: "Dota 2", works: true, verdict: "yes", notes: "ok",
    protonVersion: "Experimental", launcher: null, timestamp: 1, cpu: null, gpu: null,
    gpuDriver: null, kernel: null, os: null, ram: null, playtimeMinutes: null, source: "dump",
  };
}

function makeSeed(path: string, rows: number): void {
  const db: DB = openDb(path);
  const insert = makeInserter(db);
  for (let i = 0; i < rows; i++) insert(rep());
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "protondb-seed-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("seedDatabaseFile", () => {
  it("copies the seed when the target DB is missing", () => {
    const seed = join(workDir, "seed.db");
    const target = join(workDir, "live.db");
    makeSeed(seed, 5);

    expect(seedDatabaseFile(seed, target)).toBe(true);
    expect(existsSync(target)).toBe(true);
    const db = openDb(target);
    expect(totalReports(db)).toBe(5);
    db.close();
  });

  it("does NOT overwrite a target that already has reports", () => {
    const seed = join(workDir, "seed.db");
    const target = join(workDir, "live.db");
    makeSeed(seed, 5);
    makeSeed(target, 3); // existing live data

    expect(seedDatabaseFile(seed, target)).toBe(false);
    const db = openDb(target);
    expect(totalReports(db)).toBe(3); // untouched
    db.close();
  });

  it("reseeds when the target exists but is empty", () => {
    const seed = join(workDir, "seed.db");
    const target = join(workDir, "live.db");
    makeSeed(seed, 7);
    makeSeed(target, 0); // empty schema, no rows

    expect(seedDatabaseFile(seed, target)).toBe(true);
    const db = openDb(target);
    expect(totalReports(db)).toBe(7);
    db.close();
  });

  it("no-ops when the seed file does not exist", () => {
    expect(seedDatabaseFile(join(workDir, "nope.db"), join(workDir, "live.db"))).toBe(false);
  });

  it("no-ops when seed and target are the same path", () => {
    const p = join(workDir, "same.db");
    makeSeed(p, 2);
    expect(seedDatabaseFile(p, p)).toBe(false);
  });
});
