import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { resolveAppId, type ResolvedGame } from "./resolve.js";
import { errMessage } from "../lib/coerce.js";

/**
 * Shared helpers so every tool builds the same MCP result shape. (The MCP SDK
 * already converts a thrown handler error into an `isError` result, so these
 * focus on the common success/error shapes and the repeated appId-resolution
 * flow rather than re-wrapping every handler.)
 */

/** A successful text result, optionally carrying structured content. */
export function textResult(text: string, structured?: Record<string, unknown>): CallToolResult {
  return structured
    ? { content: [{ type: "text", text }], structuredContent: structured }
    : { content: [{ type: "text", text }] };
}

/** An error result the model can act on. */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Resolve a tool's {appId?, name?} input to a concrete game, then run `fn`. A
 * resolution failure (no appId, name not found) becomes a clean error result
 * instead of a thrown exception — replacing the try/catch copy-pasted across
 * get_reports / analyze_compatibility / search_reports.
 */
export async function withResolvedAppId(
  input: { appId?: string; name?: string },
  fn: (resolved: ResolvedGame) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  let resolved: ResolvedGame;
  try {
    resolved = await resolveAppId(input);
  } catch (err) {
    return errorResult(errMessage(err));
  }
  return fn(resolved);
}
