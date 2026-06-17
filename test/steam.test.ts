import { describe, it, expect, vi, afterEach } from "vitest";
import { getSteamDetails, searchSteam } from "../src/sources/steam.js";
import { clearHttpCache } from "../src/lib/http.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  clearHttpCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getSteamDetails null tolerance", () => {
  // Regression: Steam returns `website: null` for many apps (e.g. Far Far West,
  // appId 3124540). The schema used `.partial()` (keys optional) but non-nullable
  // leaf values, so a single null failed the whole parse and broke get_game_details.
  it("parses a record with null website / short_description / platforms", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          "3124540": {
            success: true,
            data: {
              type: "game",
              name: "Far Far West",
              short_description: null,
              website: null,
              genres: [{ description: "Action" }, { description: null }],
              release_date: { date: null },
              platforms: null,
              metacritic: { score: null },
            },
          },
        }),
      ),
    );

    const d = await getSteamDetails("3124540");
    expect(d).not.toBeNull();
    expect(d?.name).toBe("Far Far West");
    expect(d?.website).toBeUndefined();
    expect(d?.shortDescription).toBeUndefined();
    expect(d?.genres).toEqual(["Action"]);
  });

  it("still maps a fully-populated record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          "620": {
            success: true,
            data: {
              type: "game",
              name: "Portal 2",
              short_description: "Co-op puzzler",
              website: "https://thinkwithportals.com",
              genres: [{ description: "Puzzle" }],
              release_date: { date: "2011" },
              platforms: { windows: true, mac: true, linux: true },
              metacritic: { score: 95 },
            },
          },
        }),
      ),
    );

    const d = await getSteamDetails("620");
    expect(d?.name).toBe("Portal 2");
    expect(d?.website).toBe("https://thinkwithportals.com");
    expect(d?.nativeLinux).toBe(true);
    expect(d?.metacritic).toBe(95);
  });

  it("returns null for an unsuccessful entry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ "999": { success: false } })));
    expect(await getSteamDetails("999")).toBeNull();
  });
});

describe("searchSteam null tolerance", () => {
  it("tolerates a null item name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            { id: 620, name: "Portal 2", platforms: { linux: true } },
            { id: 1, name: null, platforms: null },
          ],
        }),
      ),
    );
    const hits = await searchSteam("portal", 10);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.name).toBe("Portal 2");
    expect(hits[1]?.name).toBe("(unknown)");
  });
});
