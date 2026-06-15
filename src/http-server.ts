#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./server.js";
import { config } from "./lib/config.js";
import { startAutoUpdate, stopAutoUpdate } from "./lib/auto-update.js";
import { closeBrowser } from "./sources/protondb-live.js";
import { closeDb } from "./db/store.js";
import { log } from "./lib/http.js";

const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Validate the request against the configured shared-secret tokens. Returns true
 * when auth is disabled (no tokens configured) or a valid token is presented via
 * `Authorization: Bearer <token>` or `X-API-Key: <token>`. Constant-time compare.
 */
function isAuthorized(req: IncomingMessage): boolean {
  const tokens = config.authTokens;
  if (!tokens || tokens.length === 0) return true; // auth disabled
  const auth = req.headers["authorization"];
  const apiKey = req.headers["x-api-key"];
  let provided = "";
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    provided = auth.slice(7).trim();
  } else if (typeof apiKey === "string") {
    provided = apiKey.trim();
  }
  if (!provided) return false;
  const a = Buffer.from(provided);
  return tokens.some((t) => {
    const b = Buffer.from(t);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  const body = req.method === "POST" ? await readBody(req) : undefined;

  if (!transport) {
    if (req.method === "POST" && isInitializeRequest(body)) {
      // DNS-rebinding protection guards browser-based localhost attacks. Enable
      // it when bound to loopback; when bound to 0.0.0.0 (e.g. in a container
      // behind its own network controls) it would block legitimate access.
      // An explicit PROTONDB_MCP_HTTP_ALLOWED_HOSTS always takes precedence.
      const loopback = config.httpHost === "127.0.0.1" || config.httpHost === "localhost";
      const allowedHosts =
        config.httpAllowedHosts ??
        (loopback
          ? [
              "localhost",
              `localhost:${config.httpPort}`,
              "127.0.0.1",
              `127.0.0.1:${config.httpPort}`,
            ]
          : undefined);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
        onsessionclosed: (id) => {
          transports.delete(id);
        },
        enableDnsRebindingProtection: allowedHosts !== undefined,
        allowedHosts,
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      const server = buildServer();
      await server.connect(transport);
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid session. Send an initialize request first." },
          id: null,
        }),
      );
      return;
    }
  }

  await transport.handleRequest(req, res, body);
}

async function main(): Promise<void> {
  startAutoUpdate();

  const httpServer = createServer((req, res) => {
    if (!req.url) {
      res.writeHead(404).end();
      return;
    }
    const path = req.url.split("?")[0];
    if (path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (path === config.httpPath) {
      if (!isAuthorized(req)) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer",
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unauthorized: missing or invalid token." },
            id: null,
          }),
        );
        return;
      }
      handleMcp(req, res).catch((err) => {
        log("request error:", (err as Error).message);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  httpServer.listen(config.httpPort, config.httpHost, () => {
    const auth = config.authTokens && config.authTokens.length > 0 ? "ENABLED" : "disabled";
    log(
      `ProtonDB MCP HTTP server on http://${config.httpHost}:${config.httpPort}${config.httpPath} (auth: ${auth})`,
    );
  });

  const shutdown = async () => {
    stopAutoUpdate();
    for (const t of transports.values()) await t.close().catch(() => {});
    await closeBrowser();
    closeDb();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log("fatal:", (err as Error).message);
  process.exit(1);
});
