import { describe, it, expect } from "vitest";
import { normalizeReport, gpuVendor } from "../src/lib/normalize.js";

const dumpRecord = {
  app: { steam: { appId: "352620" }, title: "Porcunipine" },
  responses: {
    answerToWhatGame: "352620",
    installs: "no",
    notes: { extra: "oh noes", verdict: "is le borked" },
    protonVersion: "Default",
    verdict: "no",
  },
  timestamp: 1572299227,
  systemInfo: {
    cpu: "Intel Core i5-6600K @ 3.50GHz",
    gpu: "NVIDIA GeForce GTX 980 Ti",
    gpuDriver: "NVIDIA 396.54",
    kernel: "4.15.0-33-generic",
    os: "Ubuntu 18.04.1 LTS",
    ram: "16 GB",
  },
};

const liveRecord = {
  contributor: { id: "365071193", steam: { playtime: 1751, nickname: "Maje" } },
  id: "B-_BPjOJ_v",
  responses: {
    answerToWhatGame: "1091500",
    customProtonVersion: "GE-Proton10-32",
    launcher: "notListed",
    notes: { launcher: "Heroic", verdict: "Working OOTB" },
    verdict: "yes",
    protonVersion: "10.0-3",
  },
  timestamp: 1781194410,
  device: { hardwareType: "pc" },
};

describe("normalizeReport", () => {
  it("maps a bulk-dump record", () => {
    const r = normalizeReport(dumpRecord, "dump")!;
    expect(r).not.toBeNull();
    expect(r.appId).toBe("352620");
    expect(r.title).toBe("Porcunipine");
    expect(r.verdict).toBe("no");
    expect(r.works).toBe(false);
    expect(r.notes).toBe("is le borked — oh noes");
    expect(r.protonVersion).toBe("Default");
    expect(r.gpu).toContain("980 Ti");
    expect(r.os).toContain("Ubuntu");
    expect(r.source).toBe("dump");
  });

  it("maps a live record, preferring custom proton + note launcher", () => {
    const r = normalizeReport(liveRecord, "live")!;
    expect(r.appId).toBe("1091500");
    expect(r.works).toBe(true);
    expect(r.protonVersion).toBe("GE-Proton10-32");
    expect(r.launcher).toBe("Heroic");
    expect(r.notes).toBe("Working OOTB");
    expect(r.playtimeMinutes).toBe(1751);
    expect(r.source).toBe("live");
  });

  it("returns null when there is no usable appId", () => {
    expect(normalizeReport({ responses: {} }, "dump")).toBeNull();
  });

  it("captures launch options, anti-cheat, all note categories, and the raw record", () => {
    const rec = {
      app: { steam: { appId: "12345" }, title: "Game" },
      responses: {
        verdict: "yes",
        protonVersion: "9.0-3",
        launchOptions: "gamemoderun %command%",
        isImpactedByAntiCheat: "no",
        concludingNotes: "great overall",
        notes: {
          verdict: "Works",
          performanceFaults: "slight stutter in town",
          launcher: "Heroic",
        },
      },
      timestamp: 5,
      systemInfo: { gpu: "AMD RX 6800", steamRuntimeVersion: "sniper", xWindowManager: "kwin" },
    };
    const r = normalizeReport(rec, "dump")!;
    expect(r.launchOptions).toBe("gamemoderun %command%");
    expect(r.antiCheat).toBe(false);
    // free-text blob includes per-category notes + concludingNotes, excludes launcher
    expect(r.notes).toContain("Works");
    expect(r.notes).toContain("slight stutter in town");
    expect(r.notes).toContain("great overall");
    expect(r.notes).not.toContain("Heroic");
    // nothing is lost — raw holds the complete record incl. systemInfo extras
    expect(r.raw).toBeTruthy();
    expect((r.raw as any).systemInfo.steamRuntimeVersion).toBe("sniper");
    expect((r.raw as any).systemInfo.xWindowManager).toBe("kwin");
    expect((r.raw as any).responses.notes.launcher).toBe("Heroic");
  });
});

describe("gpuVendor", () => {
  it("classifies vendors", () => {
    expect(gpuVendor("NVIDIA GeForce GTX 980 Ti")).toBe("NVIDIA");
    expect(gpuVendor("AMD Radeon RX 6800")).toBe("AMD");
    expect(gpuVendor("Intel Arc A770")).toBe("Intel");
    expect(gpuVendor(null)).toBe("unknown");
    expect(gpuVendor("Some Weird GPU")).toBe("other");
  });
});
