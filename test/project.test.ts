import { describe, it, expect } from "vitest";
import {
  FLAT_FIELDS,
  NESTED_FIELDS,
  resolveFields,
  projectReport,
  fitToBudget,
  projectAndFit,
} from "../src/lib/project.js";
import { ReportSchema, type Report } from "../src/lib/types.js";

function rep(p: Partial<Report>): Report {
  return {
    appId: "570",
    title: "Dota 2",
    works: true,
    verdict: "yes",
    notes: "runs fine",
    protonVersion: "GE-Proton9-1",
    launcher: null,
    launchOptions: "gamemoderun %command%",
    antiCheat: null,
    timestamp: 100,
    cpu: null,
    gpu: "NVIDIA RTX 4080",
    gpuDriver: null,
    kernel: null,
    os: "Arch",
    ram: null,
    playtimeMinutes: null,
    source: "dump",
    responses: { faults: { audio: true }, big: "x".repeat(2000) },
    systemInfo: { gpu: "NVIDIA RTX 4080", xWindowManager: "kwin_wayland" },
    device: null,
    contributor: null,
    raw: { everything: "x".repeat(3000) },
    ...p,
  };
}

describe("projectReport", () => {
  it("compact default omits nested blobs and raw", () => {
    const keep = resolveFields({ detail: "compact" });
    const out = projectReport(rep({}), keep);
    for (const f of NESTED_FIELDS) expect(out[f]).toBeUndefined();
    expect(out.raw).toBeUndefined();
    expect(out.verdict).toBe("yes");
    expect(out.launchOptions).toBe("gamemoderun %command%");
    expect(out.appId).toBe("570");
  });

  it("detail:'full' includes nested blobs but still not raw", () => {
    const keep = resolveFields({ detail: "full" });
    const out = projectReport(rep({}), keep);
    expect(out.responses).toBeDefined();
    expect(out.systemInfo).toBeDefined();
    expect(out.raw).toBeUndefined();
  });

  it("includeRaw adds the raw record", () => {
    const keep = resolveFields({ detail: "compact", includeRaw: true });
    const out = projectReport(rep({}), keep);
    expect(out.raw).toBeDefined();
  });

  it("fields projection returns exactly the named keys (plus appId)", () => {
    const keep = resolveFields({ fields: ["verdict", "launchOptions"] });
    const out = projectReport(rep({}), keep);
    expect(Object.keys(out).sort()).toEqual(["appId", "launchOptions", "verdict"]);
  });

  it("ignores unknown field names", () => {
    const keep = resolveFields({ fields: ["verdict", "not_a_field"] });
    expect(keep.has("verdict")).toBe(true);
    expect([...keep]).not.toContain("not_a_field");
  });

  it("always keeps profileScore when present", () => {
    const keep = resolveFields({ detail: "compact" });
    const out = projectReport(rep({ profileScore: 7 }), keep);
    expect(out.profileScore).toBe(7);
  });

  it("FLAT_FIELDS excludes every nested blob and raw", () => {
    for (const f of NESTED_FIELDS) expect(FLAT_FIELDS).not.toContain(f);
    expect(FLAT_FIELDS).not.toContain("raw");
  });

  it("a projected report still validates against ReportSchema", () => {
    const keep = resolveFields({ fields: ["verdict", "gpu"] });
    const out = projectReport(rep({}), keep);
    expect(() => ReportSchema.parse(out)).not.toThrow();
  });
});

describe("fitToBudget", () => {
  it("drops the tail to fit the byte budget and reports the count", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ i, pad: "x".repeat(100) }));
    const { kept, dropped } = fitToBudget(items, 300);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(10);
    expect(dropped).toBe(10 - kept.length);
  });

  it("always keeps at least the first item even if oversized", () => {
    const items = [{ big: "x".repeat(1000) }, { big: "x".repeat(1000) }];
    const { kept, dropped } = fitToBudget(items, 10);
    expect(kept.length).toBe(1);
    expect(dropped).toBe(1);
  });

  it("keeps everything when under budget", () => {
    const items = [{ a: 1 }, { a: 2 }];
    const { kept, dropped } = fitToBudget(items, 100_000);
    expect(kept.length).toBe(2);
    expect(dropped).toBe(0);
  });
});

describe("projectAndFit", () => {
  it("compact projection fits far more reports than full", () => {
    const reports = Array.from({ length: 40 }, () => rep({}));
    const compact = projectAndFit(reports, { detail: "compact" }, 30_000);
    const full = projectAndFit(reports, { detail: "full" }, 30_000);
    expect(compact.reports.length).toBeGreaterThan(full.reports.length);
    expect(compact.dropped).toBeLessThan(full.dropped);
  });
});
