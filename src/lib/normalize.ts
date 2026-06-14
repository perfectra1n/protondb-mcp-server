import type { Report } from "./types.js";

/** Minimal structural typing for the raw records we ingest/capture. */
interface RawNotes {
  verdict?: unknown;
  extra?: unknown;
  launcher?: unknown;
}
interface RawResponses {
  answerToWhatGame?: unknown;
  verdict?: unknown;
  protonVersion?: unknown;
  customProtonVersion?: unknown;
  launcher?: unknown;
  notes?: RawNotes;
}
interface RawRecord {
  app?: { steam?: { appId?: unknown }; title?: unknown };
  responses?: RawResponses;
  timestamp?: unknown;
  systemInfo?: Record<string, unknown>;
  contributor?: { steam?: { playtime?: unknown } };
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number") return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/** Join the human-meaningful note fields into one free-text blob. */
function combineNotes(notes: RawNotes | undefined): string | null {
  if (!notes) return null;
  const parts = [str(notes.verdict), str(notes.extra)].filter(
    (p): p is string => p !== null,
  );
  return parts.length > 0 ? parts.join(" — ") : null;
}

/**
 * Map a single raw ProtonDB record (bulk dump OR live capture) into the common
 * {@link Report} shape. Returns null if the record has no usable appId.
 */
export function normalizeReport(raw: RawRecord, source: "dump" | "live"): Report | null {
  const responses = raw.responses ?? {};
  const appId =
    str(raw.app?.steam?.appId) ?? str(responses.answerToWhatGame) ?? null;
  if (!appId) return null;

  const verdict = str(responses.verdict);
  const sys = raw.systemInfo ?? {};

  return {
    appId,
    title: str(raw.app?.title),
    verdict,
    works: verdict === "yes" ? true : verdict === "no" ? false : null,
    notes: combineNotes(responses.notes),
    protonVersion: str(responses.customProtonVersion) ?? str(responses.protonVersion),
    launcher: str(responses.notes?.launcher) ?? str(responses.launcher),
    timestamp: num(raw.timestamp),
    cpu: str(sys.cpu),
    gpu: str(sys.gpu),
    gpuDriver: str(sys.gpuDriver),
    kernel: str(sys.kernel),
    os: str(sys.os),
    ram: str(sys.ram),
    playtimeMinutes: num(raw.contributor?.steam?.playtime),
    source,
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
