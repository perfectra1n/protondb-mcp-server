/**
 * Shared value-coercion helpers. Upstream data (bulk dumps, Algolia, Steam) is
 * loosely typed, so every field has to be defensively narrowed. These live in
 * one place so normalization and the source adapters behave identically.
 */

/** Coerce an unknown value to a non-empty trimmed string, or null. */
export function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number") return String(v);
  return null;
}

/** Coerce an unknown value to a finite number, or null. */
export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/** Coerce an unknown value to a boolean, or null. Accepts yes/no/true/false. */
export function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "yes" || v === "true") return true;
  if (v === "no" || v === "false") return false;
  return null;
}

/** Coerce an unknown value to a non-empty array of strings, or undefined. */
export function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter((x): x is string => typeof x === "string");
  return arr.length > 0 ? arr : undefined;
}

/** Extract a human-readable message from an unknown thrown value. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
