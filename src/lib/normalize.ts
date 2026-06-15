import type { Report } from "./types.js";

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

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "yes" || v === "true") return true;
  if (v === "no" || v === "false") return false;
  return null;
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
