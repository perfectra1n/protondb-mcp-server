import { gpuVendor } from "./normalize.js";
import type { Report, Summary } from "./types.js";

export interface Count {
  key: string;
  count: number;
  workingCount: number;
}
export interface NoteSample {
  works: boolean | null;
  protonVersion: string | null;
  gpu: string | null;
  os: string | null;
  timestamp: number | null;
  notes: string;
}

export interface Analysis {
  appId: string;
  title: string | null;
  totalReports: number;
  summary: Summary | null;
  verdictBreakdown: { yes: number; no: number; unknown: number };
  /** Fraction of yes/no reports that said "yes" (0..1), or null if no data. */
  workingRate: number | null;
  /** Proton versions ranked by usage, with how many reported working. */
  topProtonVersions: Count[];
  /** Proton versions ranked by working-report count (what tends to work). */
  bestProtonVersions: Count[];
  /** Launch options/flags ranked by usage among *working* reports. */
  bestLaunchOptions: Count[];
  /**
   * Individual environment-variable assignments (e.g. PROTON_USE_WINED3D=1,
   * DXVK_HUD=fps, RADV_PERFTEST=...) extracted from working reports' launch
   * options, ranked by frequency. The single most actionable "what do I set" list.
   */
  bestEnvVars: Count[];
  /** How many reports flagged the game as impacted by anti-cheat. */
  antiCheatReports: number;
  /** GPU vendor split. */
  gpuVendors: Count[];
  /** Most common distros/OSes among reports. */
  topDistros: Count[];
  /** A handful of representative recent notes for the model to read. */
  noteSamples: NoteSample[];
}

function tally(
  reports: Report[],
  keyFn: (r: Report) => string | null | undefined,
  topN: number,
): Count[] {
  const map = new Map<string, Count>();
  for (const r of reports) {
    const key = keyFn(r);
    if (!key) continue;
    const entry = map.get(key) ?? { key, count: 0, workingCount: 0 };
    entry.count++;
    if (r.works === true) entry.workingCount++;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, topN);
}

// KEY=value style assignments (e.g. PROTON_USE_WINED3D=1, DXVK_HUD=fps). Keys are
// SCREAMING_SNAKE so we don't mistake a path or a `%command%` token for an env var.
const ENV_VAR_RE = /\b[A-Z][A-Z0-9_]{2,}=\S+/g;

/** Pull distinct environment-variable assignments out of a launch-options string. */
export function extractEnvVars(launchOptions: string | null | undefined): string[] {
  if (!launchOptions) return [];
  const matches = launchOptions.match(ENV_VAR_RE);
  return matches ? [...new Set(matches)] : [];
}

/** Frequency tally of env-var assignments across a set of reports. */
function tallyEnvVars(reports: Report[], topN: number): Count[] {
  const map = new Map<string, Count>();
  for (const r of reports) {
    for (const ev of extractEnvVars(r.launchOptions)) {
      const entry = map.get(ev) ?? { key: ev, count: 0, workingCount: 0 };
      entry.count++;
      if (r.works === true) entry.workingCount++;
      map.set(ev, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, topN);
}

/**
 * Aggregate a set of individual reports into compatibility patterns. Pure and
 * deterministic — the analyze tool returns this directly so the model reasons
 * over pre-computed signal rather than raw rows.
 */
export function analyzeReports(
  appId: string,
  reports: Report[],
  summary: Summary | null,
): Analysis {
  const yes = reports.filter((r) => r.works === true).length;
  const no = reports.filter((r) => r.works === false).length;
  const unknown = reports.length - yes - no;

  const working = reports.filter((r) => r.works === true);
  const bestProtonVersions = tally(working, (r) => r.protonVersion, 8);
  const bestLaunchOptions = tally(working, (r) => r.launchOptions, 8);
  const bestEnvVars = tallyEnvVars(working, 12);
  const antiCheatReports = reports.filter((r) => r.antiCheat === true).length;

  const noteSamples: NoteSample[] = reports
    .filter((r) => r.notes && r.notes.trim().length > 0)
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, 10)
    .map((r) => ({
      works: r.works ?? null,
      protonVersion: r.protonVersion ?? null,
      gpu: r.gpu ?? null,
      os: r.os ?? null,
      timestamp: r.timestamp ?? null,
      notes: r.notes!.slice(0, 500),
    }));

  const title = reports.find((r) => r.title)?.title ?? null;

  return {
    appId,
    title,
    totalReports: reports.length,
    summary,
    verdictBreakdown: { yes, no, unknown },
    workingRate: yes + no > 0 ? yes / (yes + no) : null,
    topProtonVersions: tally(reports, (r) => r.protonVersion, 8),
    bestProtonVersions,
    bestLaunchOptions,
    bestEnvVars,
    antiCheatReports,
    gpuVendors: tally(reports, (r) => gpuVendor(r.gpu), 5),
    topDistros: tally(reports, (r) => r.os, 6),
    noteSamples,
  };
}
