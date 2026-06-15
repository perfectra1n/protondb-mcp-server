import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { errMessage } from "../lib/coerce.js";
import { normalizeReport } from "../lib/normalize.js";
import type { Report } from "../lib/types.js";

/** Raised when live capture cannot run (browser missing or disabled). */
export class LiveUnavailableError extends Error {}

// Lazy singleton browser. Typed loosely to avoid a hard dependency on the
// optional `playwright` package at compile time.
let browserPromise: Promise<unknown> | null = null;

async function getBrowser(): Promise<{
  newPage: () => Promise<unknown>;
}> {
  if (!config.enableLive) {
    throw new LiveUnavailableError(
      "Live capture is disabled. Set PROTONDB_MCP_ENABLE_LIVE=true to enable it.",
    );
  }
  if (!browserPromise) {
    browserPromise = (async () => {
      let chromium: { launch: (o: unknown) => Promise<unknown> };
      try {
        ({ chromium } = (await import("playwright")) as unknown as {
          chromium: { launch: (o: unknown) => Promise<unknown> };
        });
      } catch {
        throw new LiveUnavailableError(
          "Playwright is not installed. Run `pnpm exec playwright install chromium` " +
            "(or use the full Docker image) to enable live report capture.",
        );
      }
      try {
        return await chromium.launch({ headless: true, args: ["--no-sandbox"] });
      } catch (err) {
        throw new LiveUnavailableError(
          `Failed to launch Chromium (${errMessage(err)}). Install browser ` +
            "binaries with `pnpm exec playwright install --with-deps chromium`.",
        );
      }
    })().catch((err) => {
      browserPromise = null; // allow retry on next call
      throw err;
    });
  }
  return browserPromise as Promise<{ newPage: () => Promise<unknown> }>;
}

interface LivePage {
  goto: (url: string, o?: unknown) => Promise<unknown>;
  waitForResponse: (pred: (r: LiveResponse) => boolean, o?: unknown) => Promise<LiveResponse>;
  close: () => Promise<void>;
}
interface LiveResponse {
  url: () => string;
  json: () => Promise<unknown>;
}

/**
 * Drive a headless browser to load a game's ProtonDB page and capture the live
 * individual-reports JSON (the file id is an obfuscated client-side hash, so we
 * let the site's own JS compute it rather than replicating the hash).
 */
export async function fetchLiveReports(appId: string, limit = 40): Promise<Report[]> {
  const browser = await getBrowser();
  const page = (await browser.newPage()) as LivePage;
  try {
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/data/reports/all-devices/app/") && r.url().endsWith(".json"),
      { timeout: config.liveTimeoutMs },
    );
    await page.goto(`https://www.protondb.com/app/${encodeURIComponent(appId)}`, {
      waitUntil: "commit",
      timeout: config.liveTimeoutMs,
    });
    const response = await responsePromise;
    const payload = (await response.json()) as { reports?: unknown[] };
    const raw = Array.isArray(payload.reports) ? payload.reports : [];
    const reports = raw
      .map((r) => normalizeReport(r as Record<string, unknown>, "live"))
      .filter((r): r is Report => r !== null)
      .slice(0, limit);
    return reports;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Non-throwing variant of {@link fetchLiveReports}. Any failure — browser
 * missing/disabled, launch failure, navigation/response timeout, or JSON parse
 * error — is logged and surfaced as an empty result with an `error` string, so
 * callers can log-and-continue rather than blocking the response.
 */
export async function tryFetchLiveReports(
  appId: string,
  limit = 40,
): Promise<{ reports: Report[]; error?: string }> {
  try {
    return { reports: await fetchLiveReports(appId, limit) };
  } catch (err) {
    const message = errMessage(err);
    logger.warn("live capture failed (continuing):", message);
    return { reports: [], error: message };
  }
}

/** Close the shared browser (called on server shutdown). */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = (await browserPromise) as { close?: () => Promise<void> };
    await browser.close?.();
  } catch (err) {
    logger.warn("error closing browser:", errMessage(err));
  } finally {
    browserPromise = null;
  }
}
