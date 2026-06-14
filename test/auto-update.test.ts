import { describe, it, expect } from "vitest";
import { shouldUpdate, parseDumpDateMeta } from "../src/lib/auto-update.js";
import type { DumpInfo } from "../src/sources/dump-registry.js";

function dump(year: number, month: number, seq: number): DumpInfo {
  return {
    name: `reports_x${seq}_${year}.tar.gz`,
    url: "http://example/x",
    year,
    month,
    seq,
    sortKey: year * 10000 + month * 100 + seq,
  };
}

describe("parseDumpDateMeta", () => {
  it("parses stored dump date", () => {
    expect(parseDumpDateMeta("2025-10-2")).toEqual({ year: 2025, month: 10, sortKey: 20251002 });
  });
  it("returns null for junk", () => {
    expect(parseDumpDateMeta(null)).toBeNull();
    expect(parseDumpDateMeta("nope")).toBeNull();
  });
});

describe("shouldUpdate", () => {
  it("bootstraps an empty database", () => {
    const d = shouldUpdate({
      now: new Date("2026-06-14T00:00:00Z"),
      hasData: false,
      ingestedSortKey: null,
      ingestedYearMonth: null,
      latest: dump(2026, 6, 1),
    });
    expect(d.update).toBe(true);
  });

  it("does nothing when already on the newest dump", () => {
    const d = shouldUpdate({
      now: new Date("2026-06-14T00:00:00Z"),
      hasData: true,
      ingestedSortKey: 20260601,
      ingestedYearMonth: { year: 2026, month: 6 },
      latest: dump(2026, 6, 1),
    });
    expect(d.update).toBe(false);
  });

  it("updates when a newer dump exists and local data is from a prior month", () => {
    const d = shouldUpdate({
      now: new Date("2026-06-02T00:00:00Z"),
      hasData: true,
      ingestedSortKey: 20260501,
      ingestedYearMonth: { year: 2026, month: 5 },
      latest: dump(2026, 6, 1),
    });
    expect(d.update).toBe(true);
  });

  it("does not update when current-month data exists even if a newer seq appears", () => {
    const d = shouldUpdate({
      now: new Date("2026-06-20T00:00:00Z"),
      hasData: true,
      ingestedSortKey: 20260601,
      ingestedYearMonth: { year: 2026, month: 6 },
      latest: dump(2026, 6, 2),
    });
    expect(d.update).toBe(false);
  });

  it("does nothing when upstream listing failed", () => {
    const d = shouldUpdate({
      now: new Date("2026-06-20T00:00:00Z"),
      hasData: true,
      ingestedSortKey: 20260501,
      ingestedYearMonth: { year: 2026, month: 5 },
      latest: null,
    });
    expect(d.update).toBe(false);
  });
});
