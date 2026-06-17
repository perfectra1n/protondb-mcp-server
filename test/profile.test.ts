import { describe, it, expect } from "vitest";
import { scoreProfileMatch, rankByProfile } from "../src/lib/profile.js";
import type { Report } from "../src/lib/types.js";

function rep(p: Partial<Report>): Report {
  return {
    appId: "570",
    title: "Dota 2",
    works: true,
    verdict: "yes",
    notes: null,
    protonVersion: null,
    launcher: null,
    launchOptions: null,
    antiCheat: null,
    timestamp: 100,
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

describe("scoreProfileMatch", () => {
  it("scores a matching rig higher than a non-matching one", () => {
    const profile = {
      gpuVendor: "nvidia" as const,
      gpu: "RTX 5090",
      distro: "cachyos",
      session: "wayland" as const,
    };
    const match = rep({
      gpu: "NVIDIA GeForce RTX 5090",
      os: "CachyOS",
      systemInfo: { xWindowManager: "kwin_wayland" },
    });
    const mismatch = rep({
      gpu: "AMD Radeon RX 6800",
      os: "Ubuntu 24.04",
      systemInfo: { xWindowManager: "X11" },
    });
    expect(scoreProfileMatch(match, profile)).toBeGreaterThan(
      scoreProfileMatch(mismatch, profile),
    );
  });

  it("an empty profile scores zero", () => {
    expect(scoreProfileMatch(rep({ gpu: "NVIDIA RTX 4080" }), {})).toBe(0);
  });

  it("matches the x11/xorg synonym for session", () => {
    const xorg = rep({ notes: "running on Xorg session", os: "Arch" });
    expect(scoreProfileMatch(xorg, { session: "x11" })).toBeGreaterThan(0);
  });
});

describe("rankByProfile", () => {
  it("sorts best match first and attaches profileScore", () => {
    const reports = [
      rep({ gpu: "AMD RX 6800", os: "Ubuntu" }),
      rep({ gpu: "NVIDIA RTX 5090", os: "CachyOS" }),
    ];
    const ranked = rankByProfile(reports, { gpuVendor: "nvidia", distro: "cachyos" });
    expect(ranked[0]!.gpu).toBe("NVIDIA RTX 5090");
    expect(ranked[0]!.profileScore).toBeGreaterThan(ranked[1]!.profileScore!);
  });

  it("breaks ties by recency", () => {
    const reports = [
      rep({ gpu: "NVIDIA RTX 4080", timestamp: 100 }),
      rep({ gpu: "NVIDIA RTX 4080", timestamp: 300 }),
    ];
    const ranked = rankByProfile(reports, { gpuVendor: "nvidia" });
    expect(ranked[0]!.timestamp).toBe(300);
  });
});
