import { config } from "./config.js";

/** Log to stderr only — stdout is reserved for MCP JSON-RPC over stdio. */
export function log(...args: unknown[]): void {
  console.error("[protondb-mcp]", ...args);
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Request timeout in milliseconds (default 15s). */
  timeoutMs?: number;
  /** Number of retry attempts on network error / 5xx / 429 (default 2). */
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch wrapper with a User-Agent, AbortController timeout (native fetch has no
 * `timeout` option), and exponential backoff retries on transient failures.
 */
export async function httpFetch(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { method = "GET", headers = {}, body, timeoutMs = 15_000, retries = 2 } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: controller.signal,
        headers: { "User-Agent": config.userAgent, ...headers },
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(2 ** attempt * 500);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Request failed: ${url}`);
}

interface CacheEntry {
  value: unknown;
  expires: number;
}
const cache = new Map<string, CacheEntry>();

/** Fetch JSON with a small in-memory TTL cache keyed by url + options. */
export async function fetchJson<T>(
  url: string,
  opts: FetchOptions & { cacheTtlMs?: number } = {},
): Promise<T> {
  const { cacheTtlMs = 0, ...fetchOpts } = opts;
  const key = `${fetchOpts.method ?? "GET"} ${url} ${fetchOpts.body ?? ""}`;
  const now = Date.now();
  if (cacheTtlMs > 0) {
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value as T;
  }
  const res = await httpFetch(url, fetchOpts);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const value = (await res.json()) as T;
  if (cacheTtlMs > 0) cache.set(key, { value, expires: now + cacheTtlMs });
  return value;
}

/** Clear the in-memory cache (used by tests). */
export function clearHttpCache(): void {
  cache.clear();
}
