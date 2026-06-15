import type { ZodType } from "zod";
import { config } from "./config.js";

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
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = config.fetchTimeoutMs,
    retries = config.fetchRetries,
  } = opts;
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
// Insertion-ordered map: the oldest entry is always first, so we evict from the
// front once the cap is reached. Keeps a long-running server's memory bounded.
const cache = new Map<string, CacheEntry>();

function cacheSet(key: string, entry: CacheEntry): void {
  // Refresh recency: delete-then-set moves the key to the end of the map.
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > config.httpCacheMaxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export type FetchJsonOptions<T> = FetchOptions & {
  cacheTtlMs?: number;
  /** When provided, the response is validated/parsed instead of blindly cast. */
  schema?: ZodType<T>;
};

/**
 * Fetch JSON with a small bounded in-memory TTL cache keyed by url + options.
 * Pass a Zod `schema` to validate the response shape at runtime (recommended
 * for external APIs) rather than trusting an unchecked `as T` cast.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions<T> = {}): Promise<T> {
  const { cacheTtlMs: requestedTtl = 0, schema, ...fetchOpts } = opts;
  // A global override (PROTONDB_MCP_CACHE_TTL_MS) wins when set; 0 disables cache.
  const cacheTtlMs = config.cacheTtlOverrideMs !== null ? config.cacheTtlOverrideMs : requestedTtl;
  const key = `${fetchOpts.method ?? "GET"} ${url} ${fetchOpts.body ?? ""}`;
  const now = Date.now();
  if (cacheTtlMs > 0) {
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value as T;
    if (hit) cache.delete(key); // drop expired entry
  }
  const res = await httpFetch(url, fetchOpts);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const json = await res.json();
  const value = schema ? schema.parse(json) : (json as T);
  if (cacheTtlMs > 0) cacheSet(key, { value, expires: now + cacheTtlMs });
  return value;
}

/** Clear the in-memory cache (used by tests). */
export function clearHttpCache(): void {
  cache.clear();
}
