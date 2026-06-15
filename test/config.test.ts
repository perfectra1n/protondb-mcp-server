import { describe, it, expect, afterEach } from "vitest";
import { envStr, envInt, envBool, envList, envFirst } from "../src/lib/config.js";

const KEYS = ["T_STR", "T_INT", "T_BOOL", "T_LIST", "T_A", "T_B", "T_C"];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("envStr", () => {
  it("returns the value when set, else the fallback", () => {
    process.env.T_STR = "hello";
    expect(envStr("T_STR", "fb")).toBe("hello");
    expect(envStr("MISSING", "fb")).toBe("fb");
  });
  it("treats whitespace-only as unset", () => {
    process.env.T_STR = "   ";
    expect(envStr("T_STR", "fb")).toBe("fb");
  });
});

describe("envInt", () => {
  it("parses integers and falls back on garbage", () => {
    process.env.T_INT = "123";
    expect(envInt("T_INT", 7)).toBe(123);
    process.env.T_INT = "abc";
    expect(envInt("T_INT", 7)).toBe(7);
    expect(envInt("MISSING", 7)).toBe(7);
  });
});

describe("envBool", () => {
  it("is true unless false/0/no/off (case-insensitive)", () => {
    process.env.T_BOOL = "true";
    expect(envBool("T_BOOL", false)).toBe(true);
    for (const falsey of ["false", "0", "no", "off", "OFF"]) {
      process.env.T_BOOL = falsey;
      expect(envBool("T_BOOL", true)).toBe(false);
    }
  });
  it("uses the fallback when unset", () => {
    expect(envBool("MISSING", true)).toBe(true);
    expect(envBool("MISSING", false)).toBe(false);
  });
});

describe("envList", () => {
  it("splits, trims, and drops empties", () => {
    process.env.T_LIST = " a , b ,, c ";
    expect(envList("T_LIST")).toEqual(["a", "b", "c"]);
  });
  it("returns undefined when unset/empty", () => {
    expect(envList("MISSING")).toBeUndefined();
    process.env.T_LIST = "   ";
    expect(envList("T_LIST")).toBeUndefined();
  });
});

describe("envFirst", () => {
  it("returns the first non-empty value among the keys", () => {
    process.env.T_B = "second";
    process.env.T_C = "third";
    expect(envFirst("T_A", "T_B", "T_C")).toBe("second");
  });
  it("returns undefined when none are set", () => {
    expect(envFirst("T_A", "T_B", "T_C")).toBeUndefined();
  });
});
