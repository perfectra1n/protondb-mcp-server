import { z } from "zod";
import type { Report } from "./types.js";
import { gpuVendor } from "./normalize.js";

/**
 * Environment-aware ranking. ProtonDB advice is only as good as the rig it came
 * from — what works on an RTX 5090 / CachyOS / Wayland box can differ from an
 * AMD / Ubuntu / X11 one. Callers detect the user's setup (the server
 * instructions tell them how) and pass it here; reports are then ranked by how
 * closely they match, turning "what the community says" into "what people on
 * your setup did".
 */
export const SystemProfileSchema = z
  .object({
    gpuVendor: z
      .enum(["nvidia", "amd", "intel"])
      .optional()
      .describe("GPU vendor of the user's machine"),
    gpu: z.string().optional().describe("GPU model, e.g. 'RTX 5090' or 'Radeon RX 7900 XTX'"),
    distro: z.string().optional().describe("Distro/OS id, e.g. 'cachyos', 'arch', 'bazzite'"),
    kernel: z.string().optional().describe("Kernel version string, e.g. '6.9.3'"),
    session: z.enum(["wayland", "x11"]).optional().describe("Display session type"),
    protonVersion: z.string().optional().describe("Preferred Proton build, e.g. 'GE-Proton9'"),
  })
  .describe(
    "The user's detected environment. When supplied, reports are scored for " +
      "hardware/distro/session similarity, sorted best-match first, and each carries a " +
      "`profileScore`. Pass as many fields as you know.",
  );

export type SystemProfile = z.infer<typeof SystemProfileSchema>;

/** Lowercase join of the present strings (a search haystack). */
function hay(...vals: (string | null | undefined)[]): string {
  return vals.filter(Boolean).join(" ").toLowerCase();
}

/** Fraction (0..1) of the query's alphanumeric tokens present in `target`. */
function tokenOverlap(query: string, target: string): number {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return 0;
  const t = target.toLowerCase();
  let hit = 0;
  for (const tok of tokens) if (t.includes(tok)) hit++;
  return hit / tokens.length;
}

/**
 * Similarity of a report to the user's profile (higher = closer). Pure: no
 * recency component — the caller breaks ties by timestamp. Weights favour the
 * signals that most change Proton behaviour: GPU vendor and distro.
 */
export function scoreProfileMatch(report: Report, profile: SystemProfile): number {
  let score = 0;
  const sys = report.systemInfo ?? {};
  const sysOs = typeof sys.os === "string" ? sys.os : "";
  const xwm = typeof sys.xWindowManager === "string" ? sys.xWindowManager : "";
  const osHay = hay(report.os, sysOs);

  if (profile.gpuVendor && gpuVendor(report.gpu).toLowerCase() === profile.gpuVendor) {
    score += 5;
  }
  if (profile.gpu && report.gpu) {
    score += 4 * tokenOverlap(profile.gpu, report.gpu);
  }
  if (profile.distro) {
    score += osHay.includes(profile.distro.toLowerCase())
      ? 4
      : 2 * tokenOverlap(profile.distro, osHay);
  }
  if (profile.kernel && report.kernel) {
    score += 2 * tokenOverlap(profile.kernel, report.kernel);
  }
  if (profile.session) {
    const sessionHay = hay(report.notes, osHay, xwm);
    const wants = profile.session === "x11" ? ["x11", "xorg"] : ["wayland"];
    if (wants.some((w) => sessionHay.includes(w))) score += 2;
  }
  if (profile.protonVersion && report.protonVersion) {
    score += 3 * tokenOverlap(profile.protonVersion, report.protonVersion);
  }
  return Math.round(score * 100) / 100;
}

/**
 * Attach a `profileScore` to each report and sort best-match first, breaking
 * ties by recency. Returns new report objects (does not mutate the input).
 */
export function rankByProfile(reports: Report[], profile: SystemProfile): Report[] {
  return reports
    .map((r) => ({ ...r, profileScore: scoreProfileMatch(r, profile) }))
    .sort((a, b) => b.profileScore - a.profileScore || (b.timestamp ?? 0) - (a.timestamp ?? 0));
}
