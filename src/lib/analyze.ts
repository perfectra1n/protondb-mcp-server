import { z } from "zod";
import { gpuVendor } from "./normalize.js";
import { str } from "./coerce.js";
import type { Report, Summary } from "./types.js";

export interface Count {
  key: string;
  count: number;
  workingCount: number;
}

/**
 * A representative report shown to the model. Carries enough of the reporter's
 * setup AND the exact tweaks they used (`launchOptions`) that a note like
 * "swapped to Dx11" is actionable — you can see the flag, the kernel/driver, and
 * the rig it ran on, not just the prose.
 */
export interface NoteSample {
  works: boolean | null;
  protonVersion: string | null;
  /** The exact Steam launch options/flags this reporter used (the tweak). */
  launchOptions: string | null;
  gpu: string | null;
  gpuDriver: string | null;
  cpu: string | null;
  kernel: string | null;
  ram: string | null;
  os: string | null;
  timestamp: number | null;
  notes: string;
}

/** Shared Zod schemas so each analyze tool's outputSchema stays in sync with the types. */
export const CountSchema = z.object({
  key: z.string(),
  count: z.number(),
  workingCount: z.number(),
});

export const NoteSampleSchema = z.object({
  works: z.boolean().nullable(),
  protonVersion: z.string().nullable(),
  launchOptions: z.string().nullable(),
  gpu: z.string().nullable(),
  gpuDriver: z.string().nullable(),
  cpu: z.string().nullable(),
  kernel: z.string().nullable(),
  ram: z.string().nullable(),
  os: z.string().nullable(),
  timestamp: z.number().nullable(),
  notes: z.string(),
});

/**
 * Game-agnostic aggregate signal computed from a set of reports. Shared by the
 * per-game {@link Analysis} and the cross-game environment rollup so both reason
 * over the same pre-computed patterns.
 */
export interface Patterns {
  totalReports: number;
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
  /**
   * Out-of-the-box working rate among reports that tried OOB: fraction whose
   * `verdictOob` was "yes" (0..1), or null if none reported it. Distinguishes
   * "just works" from "platinum, but only after launch flags". `oobReports` is
   * the denominator, `oobWorkingCount` the numerator.
   */
  oobWorkingRate: number | null;
  oobReports: number;
  oobWorkingCount: number;
  /**
   * Per-category fault prevalence (graphical/audio/performance/stability/input/
   * windowing/saveGame + significantBugs): `count` = reports flagging that fault,
   * `workingCount` = how many of those still rated the game working.
   */
  faultBreakdown: Count[];
  /** Launcher split (steam/heroic/lutris/…) — advice differs by launcher. */
  topLaunchers: Count[];
  /** Window manager / compositor split (KWin, GNOME Shell, xwayland-satellite, …). */
  topWindowManagers: Count[];
  /** GPU vendor split. */
  gpuVendors: Count[];
  /** Most common distros/OSes among reports. */
  topDistros: Count[];
  /** A handful of representative recent notes for the model to read. */
  noteSamples: NoteSample[];
}

export interface Analysis extends Patterns {
  appId: string;
  title: string | null;
  summary: Summary | null;
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

/** Read a "yes"/"no" answer from a report's structured `responses` object. */
function responseYesNo(r: Report, key: string): "yes" | "no" | null {
  const v = str((r.responses as Record<string, unknown> | null)?.[key])?.toLowerCase();
  return v === "yes" || v === "no" ? v : null;
}

// Structured fault categories in `responses` (each a "yes"/"no"). Friendly key -> field.
const FAULT_FIELDS: [string, string][] = [
  ["graphical", "graphicalFaults"],
  ["performance", "performanceFaults"],
  ["stability", "stabilityFaults"],
  ["audio", "audioFaults"],
  ["input", "inputFaults"],
  ["windowing", "windowingFaults"],
  ["saveGame", "saveGameFaults"],
  ["significantBugs", "significantBugs"],
];

/** How many reports flagged each fault category, and how many of those still worked. */
function faultBreakdown(reports: Report[]): Count[] {
  const out: Count[] = [];
  for (const [key, field] of FAULT_FIELDS) {
    let count = 0;
    let workingCount = 0;
    for (const r of reports) {
      if (responseYesNo(r, field) === "yes") {
        count++;
        if (r.works === true) workingCount++;
      }
    }
    if (count > 0) out.push({ key, count, workingCount });
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * Out-of-the-box outcome: among reports with a `verdictOob`, how many worked
 * without tinkering. Returns the rate plus its numerator/denominator.
 */
function oobOutcome(reports: Report[]): {
  oobWorkingRate: number | null;
  oobReports: number;
  oobWorkingCount: number;
} {
  let oobReports = 0;
  let oobWorkingCount = 0;
  for (const r of reports) {
    const v = responseYesNo(r, "verdictOob");
    if (v === null) continue;
    oobReports++;
    if (v === "yes") oobWorkingCount++;
  }
  return {
    oobReports,
    oobWorkingCount,
    oobWorkingRate: oobReports > 0 ? oobWorkingCount / oobReports : null,
  };
}

/**
 * Aggregate a set of reports into game-agnostic compatibility patterns. Pure and
 * deterministic. Shared by {@link analyzeReports} (one game) and the cross-game
 * environment rollup (all reports matching an environment keyword).
 */
export function aggregatePatterns(reports: Report[]): Patterns {
  const yes = reports.filter((r) => r.works === true).length;
  const no = reports.filter((r) => r.works === false).length;
  const unknown = reports.length - yes - no;

  const working = reports.filter((r) => r.works === true);
  const bestProtonVersions = tally(working, (r) => r.protonVersion, 8);
  const bestLaunchOptions = tally(working, (r) => r.launchOptions, 8);
  const bestEnvVars = tallyEnvVars(working, 12);
  const antiCheatReports = reports.filter((r) => r.antiCheat === true).length;
  const oob = oobOutcome(reports);

  const noteSamples: NoteSample[] = reports
    .filter((r) => r.notes && r.notes.trim().length > 0)
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, 10)
    .map((r) => ({
      works: r.works ?? null,
      protonVersion: r.protonVersion ?? null,
      launchOptions: r.launchOptions ?? null,
      gpu: r.gpu ?? null,
      gpuDriver: r.gpuDriver ?? null,
      cpu: r.cpu ?? null,
      kernel: r.kernel ?? null,
      ram: r.ram ?? null,
      os: r.os ?? null,
      timestamp: r.timestamp ?? null,
      notes: r.notes!.slice(0, 500),
    }));

  return {
    totalReports: reports.length,
    verdictBreakdown: { yes, no, unknown },
    workingRate: yes + no > 0 ? yes / (yes + no) : null,
    topProtonVersions: tally(reports, (r) => r.protonVersion, 8),
    bestProtonVersions,
    bestLaunchOptions,
    bestEnvVars,
    antiCheatReports,
    oobWorkingRate: oob.oobWorkingRate,
    oobReports: oob.oobReports,
    oobWorkingCount: oob.oobWorkingCount,
    faultBreakdown: faultBreakdown(reports),
    topLaunchers: tally(reports, (r) => r.launcher?.toLowerCase() ?? null, 6),
    topWindowManagers: tally(
      reports,
      (r) => str((r.systemInfo as Record<string, unknown> | null)?.xWindowManager) ?? null,
      6,
    ),
    gpuVendors: tally(reports, (r) => gpuVendor(r.gpu), 5),
    topDistros: tally(reports, (r) => r.os, 6),
    noteSamples,
  };
}

/**
 * Aggregate one game's reports into compatibility patterns, adding the
 * game-specific appId/title/summary. The analyze tool returns this directly so
 * the model reasons over pre-computed signal rather than raw rows.
 */
export function analyzeReports(
  appId: string,
  reports: Report[],
  summary: Summary | null,
): Analysis {
  const title = reports.find((r) => r.title)?.title ?? null;
  return {
    appId,
    title,
    summary,
    ...aggregatePatterns(reports),
  };
}
