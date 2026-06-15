import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { httpFetch, fetchJson, clearHttpCache } from "../src/lib/http.js";

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

describe("httpFetch retries", () => {
  it("retries on 500 then returns the eventual success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await httpFetch("https://example.test/x", { retries: 1 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx (returns it immediately)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    const res = await httpFetch("https://example.test/missing", { retries: 3 });
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts after the timeout and throws", async () => {
    const fetchMock = vi.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      httpFetch("https://example.test/hang", { retries: 0, timeoutMs: 20 }),
    ).rejects.toThrow();
  });
});

describe("fetchJson", () => {
  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(fetchJson("https://example.test/down", { retries: 0 })).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it("caches within the TTL (second call does not hit the network)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const a = await fetchJson<{ n: number }>("https://example.test/c", { cacheTtlMs: 10_000 });
    const b = await fetchJson<{ n: number }>("https://example.test/c", { cacheTtlMs: 10_000 });
    expect(a).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates with a Zod schema and rejects a bad shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ tier: 123 })));
    const schema = z.object({ tier: z.string() });
    await expect(fetchJson("https://example.test/s", { schema })).rejects.toThrow();
  });
});

describe("cache eviction", () => {
  it("evicts the oldest entries past the configured cap", async () => {
    const ORIGINAL = process.env.PROTONDB_MCP_CACHE_MAX_ENTRIES;
    process.env.PROTONDB_MCP_CACHE_MAX_ENTRIES = "2";
    vi.resetModules();
    try {
      const http = await import("../src/lib/http.js");
      const fetchMock = vi.fn((url: string) => Promise.resolve(jsonResponse({ url })));
      vi.stubGlobal("fetch", fetchMock);

      // Three distinct URLs cached with a cap of 2 → the first is evicted.
      await http.fetchJson("https://example.test/1", { cacheTtlMs: 10_000 });
      await http.fetchJson("https://example.test/2", { cacheTtlMs: 10_000 });
      await http.fetchJson("https://example.test/3", { cacheTtlMs: 10_000 });
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // /1 was evicted → re-fetch (4th call); /3 is still cached → no new call.
      await http.fetchJson("https://example.test/1", { cacheTtlMs: 10_000 });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      await http.fetchJson("https://example.test/3", { cacheTtlMs: 10_000 });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      if (ORIGINAL === undefined) delete process.env.PROTONDB_MCP_CACHE_MAX_ENTRIES;
      else process.env.PROTONDB_MCP_CACHE_MAX_ENTRIES = ORIGINAL;
      vi.resetModules();
    }
  });
});
