import { describe, it, expect } from "vitest";
import { parseDumpName } from "../src/sources/dump-registry.js";

describe("parseDumpName", () => {
  it("parses a standard dump filename", () => {
    const d = parseDumpName("reports_oct2_2025.tar.gz", "http://u")!;
    expect(d).not.toBeNull();
    expect(d.year).toBe(2025);
    expect(d.month).toBe(10);
    expect(d.seq).toBe(2);
    expect(d.sortKey).toBe(20251002);
  });

  it("orders newer dumps with a higher sortKey", () => {
    const a = parseDumpName("reports_sep1_2025.tar.gz", "u")!;
    const b = parseDumpName("reports_oct1_2025.tar.gz", "u")!;
    const c = parseDumpName("reports_jun1_2026.tar.gz", "u")!;
    expect(b.sortKey).toBeGreaterThan(a.sortKey);
    expect(c.sortKey).toBeGreaterThan(b.sortKey);
  });

  it("rejects non-dump filenames", () => {
    expect(parseDumpName("README.md", "u")).toBeNull();
    expect(parseDumpName("reports_xxx_2025.tar.gz", "u")).toBeNull();
  });
});
