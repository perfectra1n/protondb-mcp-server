import { describe, it, expect } from "vitest";
import { str, num, bool, toStringArray, errMessage } from "../src/lib/coerce.js";

describe("str", () => {
  it("trims and keeps non-empty strings", () => {
    expect(str("  hi ")).toBe("hi");
  });
  it("stringifies numbers", () => {
    expect(str(42)).toBe("42");
  });
  it("rejects empty / non-string / non-number", () => {
    expect(str("   ")).toBeNull();
    expect(str(null)).toBeNull();
    expect(str(undefined)).toBeNull();
    expect(str(true)).toBeNull();
  });
});

describe("num", () => {
  it("passes through finite numbers", () => {
    expect(num(94)).toBe(94);
    expect(num(85.46)).toBe(85.46);
  });
  it("parses numeric strings", () => {
    expect(num("2026")).toBe(2026);
  });
  it("rejects null / non-numeric strings / undefined / NaN", () => {
    expect(num(null)).toBeNull();
    expect(num("Soon")).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num("")).toBeNull();
    expect(num(Number.NaN)).toBeNull();
  });
});

describe("bool", () => {
  it("accepts booleans and yes/no/true/false", () => {
    expect(bool(true)).toBe(true);
    expect(bool("yes")).toBe(true);
    expect(bool("true")).toBe(true);
    expect(bool("no")).toBe(false);
    expect(bool("false")).toBe(false);
  });
  it("rejects anything else", () => {
    expect(bool("maybe")).toBeNull();
    expect(bool(1)).toBeNull();
    expect(bool(null)).toBeNull();
  });
});

describe("toStringArray", () => {
  it("keeps only string elements of a non-empty array", () => {
    expect(toStringArray(["a", 1, "b", null])).toEqual(["a", "b"]);
  });
  it("returns undefined for non-arrays or all-empty results", () => {
    expect(toStringArray("a")).toBeUndefined();
    expect(toStringArray([1, 2, 3])).toBeUndefined();
    expect(toStringArray([])).toBeUndefined();
  });
});

describe("errMessage", () => {
  it("uses Error.message", () => {
    expect(errMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error throwables", () => {
    expect(errMessage("oops")).toBe("oops");
    expect(errMessage(42)).toBe("42");
    expect(errMessage({ toString: () => "obj" })).toBe("obj");
  });
});
