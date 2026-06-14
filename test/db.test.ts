import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, makeInserter, setMeta, getMeta, type DB } from "../src/db/schema.js";
import { getReports, searchNotes, countReports, totalReports } from "../src/db/queries.js";
import { ingestToDb } from "../src/scripts/ingest.js";
import { normalizeReport } from "../src/lib/normalize.js";
import type { Report } from "../src/lib/types.js";

let workDir: string;
let db: DB;

function rep(p: Partial<Report>): Report {
  return {
    appId: "570",
    title: "Dota 2",
    works: true,
    verdict: "yes",
    notes: null,
    protonVersion: "GE-Proton9-1",
    launcher: null,
    timestamp: 100,
    cpu: null,
    gpu: "NVIDIA RTX 4080",
    gpuDriver: null,
    kernel: null,
    os: "Arch",
    ram: null,
    playtimeMinutes: null,
    source: "dump",
    ...p,
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "protondb-test-"));
  db = openDb(join(workDir, "t.db"));
});
afterEach(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("db schema + queries", () => {
  it("inserts and filters reports", () => {
    const insert = makeInserter(db);
    insert(rep({ verdict: "yes", protonVersion: "GE-Proton9-1", timestamp: 100 }));
    insert(rep({ verdict: "no", protonVersion: "Default", timestamp: 200, gpu: "AMD RX 6800" }));
    insert(rep({ appId: "999", verdict: "yes", timestamp: 50 }));

    expect(countReports(db, "570")).toBe(2);
    expect(totalReports(db)).toBe(3);

    const all = getReports(db, { appId: "570" });
    expect(all.length).toBe(2);
    // ordered by timestamp DESC
    expect(all[0]!.timestamp).toBe(200);

    const yes = getReports(db, { appId: "570", verdict: "yes" });
    expect(yes.length).toBe(1);

    const ge = getReports(db, { appId: "570", protonVersionContains: "ge-proton" });
    expect(ge.length).toBe(1);

    const amd = getReports(db, { appId: "570", gpuContains: "amd" });
    expect(amd.length).toBe(1);

    const since = getReports(db, { appId: "570", since: 150 });
    expect(since.length).toBe(1);
  });

  it("full-text searches notes", () => {
    const insert = makeInserter(db);
    insert(rep({ notes: "Works after disabling anti-cheat in settings" }));
    insert(rep({ notes: "Crashes on launch with vulkan error" }));
    insert(rep({ appId: "42", title: "Other", notes: "anti-cheat blocks linux" }));

    const hits = searchNotes(db, "anti-cheat");
    expect(hits.length).toBe(2);

    const scoped = searchNotes(db, "anti-cheat", { appId: "42" });
    expect(scoped.length).toBe(1);
    expect(scoped[0]!.appId).toBe("42");
  });

  it("stores and reads meta", () => {
    setMeta(db, "dump_file", "reports_jun1_2026.tar.gz");
    expect(getMeta(db, "dump_file")).toBe("reports_jun1_2026.tar.gz");
    setMeta(db, "dump_file", "updated.tar.gz");
    expect(getMeta(db, "dump_file")).toBe("updated.tar.gz");
  });

  it("normalizes records consistently with what queries return", () => {
    const insert = makeInserter(db);
    const r = normalizeReport(
      {
        app: { steam: { appId: "570" }, title: "Dota 2" },
        responses: { verdict: "yes", protonVersion: "Experimental", notes: { verdict: "fine" } },
        timestamp: 5,
      },
      "dump",
    )!;
    insert(r);
    const back = getReports(db, { appId: "570" })[0]!;
    expect(back.works).toBe(true);
    expect(back.protonVersion).toBe("Experimental");
    expect(back.notes).toBe("fine");
  });
});

describe("ingestToDb (integration, local JSON fixture)", () => {
  it("loads a JSON array of records into a fresh DB", async () => {
    const fixture = [
      {
        app: { steam: { appId: "1091500" }, title: "Cyberpunk 2077" },
        responses: { verdict: "yes", protonVersion: "GE-Proton9-1", notes: { verdict: "OOTB" } },
        timestamp: 1700000000,
        systemInfo: { gpu: "NVIDIA RTX 4090", os: "Arch" },
      },
      {
        app: { steam: { appId: "1091500" }, title: "Cyberpunk 2077" },
        responses: { verdict: "no", protonVersion: "Default", notes: { verdict: "borked", extra: "black screen" } },
        timestamp: 1700000100,
        systemInfo: { gpu: "AMD RX 580", os: "Ubuntu" },
      },
      { responses: {} }, // unusable -> skipped
    ];
    const jsonPath = join(workDir, "reports.json");
    writeFileSync(jsonPath, JSON.stringify(fixture));
    const targetDb = join(workDir, "ingested.db");

    const stats = await ingestToDb({ file: jsonPath }, targetDb);
    expect(stats.recordCount).toBe(2);

    const ndb = openDb(targetDb);
    try {
      expect(totalReports(ndb)).toBe(2);
      expect(getMeta(ndb, "record_count")).toBe("2");
      const hits = searchNotes(ndb, "black screen");
      expect(hits.length).toBe(1);
    } finally {
      ndb.close();
    }
  });
});
