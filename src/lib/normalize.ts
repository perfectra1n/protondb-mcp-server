import type { Report } from "./types.js";
import { str, num, bool } from "./coerce.js";

/** Loose structural typing — records carry far more than we type explicitly. */
interface RawResponses {
  answerToWhatGame?: unknown;
  verdict?: unknown;
  protonVersion?: unknown;
  customProtonVersion?: unknown;
  launcher?: unknown;
  secondaryLauncher?: unknown;
  launchOptions?: unknown;
  launchFlagsUsed?: unknown;
  isImpactedByAntiCheat?: unknown;
  concludingNotes?: unknown;
  extra?: unknown;
  notes?: Record<string, unknown>;
  [key: string]: unknown;
}
interface RawRecord {
  app?: { steam?: { appId?: unknown }; title?: unknown };
  responses?: RawResponses;
  timestamp?: unknown;
  systemInfo?: Record<string, unknown>;
  contributor?: { steam?: { playtime?: unknown } };
  [key: string]: unknown;
}

// Note keys that duplicate structured fields — kept in `raw`, excluded from the
// free-text blob to keep it readable (still fully searchable via the others).
const NOTE_KEYS_EXCLUDED = new Set(["launcher", "protonVersion", "variant"]);

/**
 * Gather free-text note content so full-text search covers every category.
 * Reports keep per-category notes (notes.performanceFaults, notes.verdict, …)
 * plus top-level concludingNotes/extra. The main verdict/extra notes come first;
 * every other note category follows. Nothing is lost — `raw` keeps the original.
 */
function combineNotes(responses: RawResponses): string | null {
  const parts: string[] = [];
  const push = (v: unknown) => {
    const s = str(v);
    if (s) parts.push(s);
  };
  const notes = responses.notes;
  if (notes && typeof notes === "object") {
    push(notes.verdict);
    push(notes.extra);
    for (const [k, v] of Object.entries(notes)) {
      if (k === "verdict" || k === "extra" || NOTE_KEYS_EXCLUDED.has(k)) continue;
      push(v);
    }
  }
  push(responses.concludingNotes);
  push(responses.extra);
  const seen = new Set<string>();
  const uniq = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return uniq.length > 0 ? uniq.join(" — ") : null;
}

function noteField(responses: RawResponses, key: string): unknown {
  const notes = responses.notes;
  return notes && typeof notes === "object" ? notes[key] : undefined;
}

/**
 * Map a single raw ProtonDB record (bulk dump OR live capture) into the common
 * {@link Report} shape. The full original record is preserved verbatim in `raw`
 * so NO field is ever lost; the flat fields are the high-value, indexable subset.
 * Returns null if the record has no usable appId.
 */
export function normalizeReport(raw: RawRecord, source: "dump" | "live"): Report | null {
  const responses: RawResponses = raw.responses ?? {};
  const appId = str(raw.app?.steam?.appId) ?? str(responses.answerToWhatGame) ?? null;
  if (!appId) return null;

  const verdict = str(responses.verdict);
  const sys = raw.systemInfo ?? {};

  return {
    appId,
    title: str(raw.app?.title),
    verdict,
    works: verdict === "yes" ? true : verdict === "no" ? false : null,
    notes: combineNotes(responses),
    protonVersion: str(responses.customProtonVersion) ?? str(responses.protonVersion),
    launcher: str(noteField(responses, "launcher")) ?? str(responses.launcher),
    launchOptions: str(responses.launchOptions) ?? str(responses.launchFlagsUsed),
    antiCheat: bool(responses.isImpactedByAntiCheat),
    timestamp: num(raw.timestamp),
    cpu: str(sys.cpu),
    gpu: str(sys.gpu),
    gpuDriver: str(sys.gpuDriver),
    kernel: str(sys.kernel),
    os: str(sys.os),
    ram: str(sys.ram),
    playtimeMinutes: num(raw.contributor?.steam?.playtime),
    source,
    // Full structured passthroughs — every field, not just the indexed subset.
    responses: (raw.responses as Record<string, unknown>) ?? null,
    systemInfo: (raw.systemInfo as Record<string, unknown>) ?? null,
    device: (raw.device as Record<string, unknown>) ?? null,
    contributor: (raw.contributor as Record<string, unknown>) ?? null,
    // Lossless: the entire original record, so every field is retrievable.
    raw: raw as Record<string, unknown>,
  };
}

/** Best-effort GPU vendor classification for aggregation. */
export function gpuVendor(gpu: string | null | undefined): string {
  if (!gpu) return "unknown";
  const g = gpu.toLowerCase();
  if (g.includes("nvidia") || g.includes("geforce") || g.includes("rtx") || g.includes("gtx"))
    return "NVIDIA";
  if (g.includes("amd") || g.includes("radeon") || g.includes("rx ") || g.includes("vega"))
    return "AMD";
  if (g.includes("intel") || g.includes("arc") || g.includes("iris")) return "Intel";
  return "other";
}

/**
 * Stable-ish identity for a report across the bulk-dump and live sources. Neither
 * source exposes a server-side id in the flat shape, so key on the fields that
 * co-vary per report (timestamp + Proton version + a notes prefix).
 */
export function reportKey(r: Report): string {
  return [r.timestamp ?? "", (r.protonVersion ?? "").toLowerCase(), (r.notes ?? "").slice(0, 120)].join(
    "|",
  );
}

/**
 * Drop duplicate reports, keeping the FIRST occurrence. Callers that merge live
 * and dump reports pass the live (fresher) copies first so those win.
 */
export function dedupeReports(reports: Report[]): Report[] {
  const seen = new Set<string>();
  return reports.filter((r) => {
    const k = reportKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
