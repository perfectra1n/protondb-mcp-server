import type { Tier } from "./types.js";

/** Human-readable meaning of each ProtonDB tier, for tool output context. */
export const TIER_MEANINGS: Record<Tier, string> = {
  platinum: "Runs perfectly out of the box, no tweaks needed.",
  gold: "Runs perfectly after minor tweaks (e.g. a launch option or Proton-GE).",
  silver: "Runs with minor issues but is generally playable.",
  bronze: "Runs, but crashes often or has significant problems.",
  borked: "Does not start, or is effectively unplayable.",
  native: "Has a native Linux build (Proton not required).",
  pending: "Not enough reports yet to assign a tier.",
};

/** A compact glossary string suitable for embedding in a tool response. */
export function tierGlossary(): string {
  return (Object.keys(TIER_MEANINGS) as Tier[]).map((t) => `${t}: ${TIER_MEANINGS[t]}`).join("\n");
}
