import { describe, it, expect } from "vitest";
import { toNumber } from "../src/sources/algolia.js";
import { GameHitSchema } from "../src/tools/search-games.js";

describe("toNumber (Algolia field coercion)", () => {
  it("passes through finite numbers", () => {
    expect(toNumber(94)).toBe(94);
    expect(toNumber(85.46)).toBe(85.46);
  });
  it("parses numeric strings", () => {
    expect(toNumber("2026")).toBe(2026);
  });
  it("drops null / non-numeric strings / undefined", () => {
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber("Soon")).toBeUndefined();
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber("")).toBeUndefined();
  });
});

describe("GameHitSchema tolerance", () => {
  it("accepts the well-formed case", () => {
    const r = GameHitSchema.safeParse({
      appId: "3124540",
      name: "Far Far West",
      userScore: 94,
      releaseYear: 2026,
      oslist: ["Linux"],
      nativeLinux: true,
      source: "algolia",
    });
    expect(r.success).toBe(true);
  });

  it("accepts null userScore / null releaseYear (the bug that broke search_games)", () => {
    const r = GameHitSchema.safeParse({
      appId: "3408160",
      name: "Cactus Flats",
      userScore: null,
      releaseYear: null,
      source: "algolia",
    });
    expect(r.success).toBe(true);
  });

  it("accepts missing optional fields", () => {
    const r = GameHitSchema.safeParse({ appId: "1", name: "X", source: "steam" });
    expect(r.success).toBe(true);
  });
});
