import { config } from "./config.js";

/**
 * Tiny leveled logger. Everything goes to **stderr** — stdout is reserved for
 * MCP JSON-RPC when running over the stdio transport, so writing logs there
 * would corrupt the protocol stream.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function resolveLevel(value: string): LogLevel {
  const v = value.trim().toLowerCase();
  return v === "error" || v === "warn" || v === "info" || v === "debug" ? v : "info";
}

const threshold = ORDER[resolveLevel(config.logLevel)];
const PREFIX = "[protondb-mcp]";

function emit(level: LogLevel, args: unknown[]): void {
  if (ORDER[level] > threshold) return;
  console.error(PREFIX, `[${level}]`, ...args);
}

export const logger = {
  error: (...args: unknown[]): void => emit("error", args),
  warn: (...args: unknown[]): void => emit("warn", args),
  info: (...args: unknown[]): void => emit("info", args),
  debug: (...args: unknown[]): void => emit("debug", args),
};

/**
 * Backwards-compatible alias for the previous untyped `log()` helper. New code
 * should prefer the leveled `logger.*` methods.
 */
export function log(...args: unknown[]): void {
  logger.info(...args);
}
