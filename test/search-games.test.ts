import { describe, it, expect } from "vitest";
import { GameHitSchema } from "../src/tools/search-games.js";

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
