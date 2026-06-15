import { describe, it, expect } from "vitest";
import { analyzeReports } from "../src/lib/analyze.js";
import type { Report } from "../src/lib/types.js";

function rep(p: Partial<Report>): Report {
  return {
    appId: "1",
    title: "Test Game",
    works: null,
    verdict: null,
    notes: null,
    protonVersion: null,
    launcher: null,
    launchOptions: null,
    antiCheat: null,
    timestamp: null,
    cpu: null,
    gpu: null,
    gpuDriver: null,
    kernel: null,
    os: null,
    ram: null,
    playtimeMinutes: null,
    source: "dump",
    ...p,
  };
}

describe("analyzeReports", () => {
  const reports: Report[] = [
    rep({ works: true, verdict: "yes", protonVersion: "GE-Proton9-1", gpu: "NVIDIA RTX 4080", os: "Arch", notes: "Runs great", timestamp: 30 }),
    rep({ works: true, verdict: "yes", protonVersion: "GE-Proton9-1", gpu: "AMD RX 6800", os: "Arch", notes: "Smooth", timestamp: 20 }),
    rep({ works: false, verdict: "no", protonVersion: "Default", gpu: "NVIDIA GTX 1060", os: "Ubuntu", notes: "Crashes on launch", timestamp: 10 }),
    rep({ works: true, verdict: "yes", protonVersion: "Experimental", gpu: "Intel Arc", os: "Fedora" }),
  ];

  it("computes verdict breakdown and working rate", () => {
    const a = analyzeReports("1", reports, null);
    expect(a.totalReports).toBe(4);
    expect(a.verdictBreakdown).toEqual({ yes: 3, no: 1, unknown: 0 });
    expect(a.workingRate).toBeCloseTo(0.75, 5);
  });

  it("ranks best proton versions among working reports", () => {
    const a = analyzeReports("1", reports, null);
    expect(a.bestProtonVersions[0]?.key).toBe("GE-Proton9-1");
    expect(a.bestProtonVersions[0]?.workingCount).toBe(2);
  });

  it("breaks down GPU vendors", () => {
    const a = analyzeReports("1", reports, null);
    const vendors = Object.fromEntries(a.gpuVendors.map((c) => [c.key, c.count]));
    expect(vendors.NVIDIA).toBe(2);
    expect(vendors.AMD).toBe(1);
    expect(vendors.Intel).toBe(1);
  });

  it("returns recent note samples ordered by timestamp", () => {
    const a = analyzeReports("1", reports, null);
    expect(a.noteSamples[0]?.notes).toBe("Runs great");
    expect(a.noteSamples.length).toBe(3);
  });

  it("handles empty input", () => {
    const a = analyzeReports("1", [], null);
    expect(a.totalReports).toBe(0);
    expect(a.workingRate).toBeNull();
  });
});
