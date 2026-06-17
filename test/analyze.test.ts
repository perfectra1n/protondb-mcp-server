import { describe, it, expect } from "vitest";
import { analyzeReports, aggregatePatterns } from "../src/lib/analyze.js";
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
    rep({
      works: true,
      verdict: "yes",
      protonVersion: "GE-Proton9-1",
      gpu: "NVIDIA RTX 4080",
      os: "Arch",
      notes: "Runs great",
      timestamp: 30,
    }),
    rep({
      works: true,
      verdict: "yes",
      protonVersion: "GE-Proton9-1",
      gpu: "AMD RX 6800",
      os: "Arch",
      notes: "Smooth",
      timestamp: 20,
    }),
    rep({
      works: false,
      verdict: "no",
      protonVersion: "Default",
      gpu: "NVIDIA GTX 1060",
      os: "Ubuntu",
      notes: "Crashes on launch",
      timestamp: 10,
    }),
    rep({
      works: true,
      verdict: "yes",
      protonVersion: "Experimental",
      gpu: "Intel Arc",
      os: "Fedora",
    }),
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

  it("extracts and ranks env-var assignments from working reports' launch options", () => {
    const withEnv: Report[] = [
      rep({ works: true, launchOptions: "PROTON_USE_WINED3D=1 DXVK_HUD=fps %command%" }),
      rep({ works: true, launchOptions: "PROTON_USE_WINED3D=1 gamemoderun %command%" }),
      rep({ works: false, launchOptions: "RADV_PERFTEST=gpl %command%" }),
    ];
    const a = analyzeReports("1", withEnv, null);
    const env = Object.fromEntries(a.bestEnvVars.map((c) => [c.key, c.workingCount]));
    // PROTON_USE_WINED3D=1 appears in two working reports.
    expect(env["PROTON_USE_WINED3D=1"]).toBe(2);
    expect(env["DXVK_HUD=fps"]).toBe(1);
    // `gamemoderun` is a command, not an env var — must not be captured.
    expect(a.bestEnvVars.some((c) => c.key.includes("gamemoderun"))).toBe(false);
  });
});

describe("aggregatePatterns (cross-game core)", () => {
  // Reports from DIFFERENT games — the env rollup aggregates regardless of appId.
  const reports: Report[] = [
    rep({
      appId: "10",
      title: "Game A",
      works: true,
      verdict: "yes",
      protonVersion: "GE-Proton9-1",
      launchOptions: "PROTON_USE_WINED3D=1 %command%",
      gpu: "NVIDIA RTX 4080",
      gpuDriver: "565.77",
      cpu: "Ryzen 7 7800X3D",
      kernel: "6.12.10-zen1",
      ram: "32 GB",
      os: "NixOS",
      notes: "needs steam-run",
      timestamp: 30,
    }),
    rep({
      appId: "20",
      title: "Game B",
      works: true,
      verdict: "yes",
      protonVersion: "GE-Proton9-1",
      launchOptions: "PROTON_USE_WINED3D=1 gamemoderun %command%",
      gpu: "AMD RX 6800",
      os: "NixOS",
      timestamp: 20,
    }),
    rep({
      appId: "30",
      title: "Game C",
      works: false,
      verdict: "no",
      protonVersion: "Default",
      gpu: "NVIDIA GTX 1060",
      os: "NixOS",
      timestamp: 10,
    }),
  ];

  it("aggregates patterns across games without appId/title fields", () => {
    const p = aggregatePatterns(reports);
    expect(p.totalReports).toBe(3);
    expect(p.verdictBreakdown).toEqual({ yes: 2, no: 1, unknown: 0 });
    expect(p.workingRate).toBeCloseTo(2 / 3, 5);
    expect(p).not.toHaveProperty("appId");
    expect(p).not.toHaveProperty("title");
  });

  it("ranks the most common env var across working reports of different games", () => {
    const p = aggregatePatterns(reports);
    expect(p.bestEnvVars[0]?.key).toBe("PROTON_USE_WINED3D=1");
    expect(p.bestEnvVars[0]?.workingCount).toBe(2);
  });

  it("computes out-of-the-box working rate from verdictOob", () => {
    const oobReports: Report[] = [
      rep({ works: true, responses: { verdictOob: "yes" } }),
      rep({ works: true, responses: { verdictOob: "no" } }), // works, but only after tinkering
      rep({ works: true, responses: { verdictOob: "yes" } }),
      rep({ works: true, responses: {} }), // no OOB answer — excluded from the rate
    ];
    const p = aggregatePatterns(oobReports);
    expect(p.oobReports).toBe(3);
    expect(p.oobWorkingCount).toBe(2);
    expect(p.oobWorkingRate).toBeCloseTo(2 / 3, 5);
  });

  it("breaks down fault categories and counts how many still worked", () => {
    const faultReports: Report[] = [
      rep({ works: true, responses: { performanceFaults: "yes", graphicalFaults: "no" } }),
      rep({ works: false, responses: { performanceFaults: "yes", stabilityFaults: "yes" } }),
      rep({ works: true, responses: { graphicalFaults: "no" } }),
    ];
    const p = aggregatePatterns(faultReports);
    const perf = p.faultBreakdown.find((f) => f.key === "performance");
    expect(perf?.count).toBe(2);
    expect(perf?.workingCount).toBe(1);
    // A category nobody flagged "yes" is omitted.
    expect(p.faultBreakdown.some((f) => f.key === "graphical")).toBe(false);
  });

  it("tallies launchers and window managers", () => {
    const wmReports: Report[] = [
      rep({ launcher: "Steam", systemInfo: { xWindowManager: "KWin" } }),
      rep({ launcher: "steam", systemInfo: { xWindowManager: "KWin" } }),
      rep({ launcher: "Heroic", systemInfo: { xWindowManager: "GNOME Shell" } }),
    ];
    const p = aggregatePatterns(wmReports);
    // launcher is lower-cased so "Steam"/"steam" merge.
    expect(p.topLaunchers.find((l) => l.key === "steam")?.count).toBe(2);
    expect(p.topLaunchers.find((l) => l.key === "heroic")?.count).toBe(1);
    expect(p.topWindowManagers.find((w) => w.key === "KWin")?.count).toBe(2);
  });

  it("note samples carry the reporter's tweaks and setup (launchOptions/kernel/driver)", () => {
    // Only Game A has notes, so it's the sole sample — assert it's enriched.
    const p = aggregatePatterns(reports);
    const sample = p.noteSamples.find((s) => s.notes === "needs steam-run");
    expect(sample).toBeDefined();
    expect(sample?.launchOptions).toBe("PROTON_USE_WINED3D=1 %command%");
    expect(sample?.kernel).toBe("6.12.10-zen1");
    expect(sample?.gpuDriver).toBe("565.77");
    expect(sample?.cpu).toBe("Ryzen 7 7800X3D");
    expect(sample?.ram).toBe("32 GB");
  });

  it("analyzeReports adds appId/title/summary on top of the shared core", () => {
    const a = analyzeReports("10", reports, null);
    expect(a.appId).toBe("10");
    expect(a.title).toBe("Game A");
    expect(a.summary).toBeNull();
    // Shared aggregate fields still present.
    expect(a.totalReports).toBe(aggregatePatterns(reports).totalReports);
  });
});
