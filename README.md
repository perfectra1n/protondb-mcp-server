# protondb-mcp

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that lets an
LLM fetch and **analyze ProtonDB Linux/Proton game-compatibility reports** — not just
the headline tier, but the _individual_ community reports (Proton version, hardware,
free-text notes) so a model can mine them for patterns and answer "what config works
best for _my_ machine?".

It is environment-aware: it ships an MCP "system prompt" that tells the assistant to
first detect the user's actual Linux setup (distro, GPU/driver, kernel, Wayland/X11,
how Steam/Proton are installed), then filter and interpret reports accordingly, and it
includes common Linux/Proton **troubleshooting** commands.

- [Why](#why) · [Features](#features) · [How it works](#how-it-works)
- [Tools](#tools) · [Server instructions](#server-instructions-the-models-system-prompt)
- [Install & run (local)](#install--run-local) · [MCP client config](#mcp-client-config)
- [Docker](#docker) · [Configuration](#configuration-environment-variables)
- [Ingestion CLI](#ingestion-cli) · [Auto-update](#auto-update)
- [CI/CD & versioning](#cicd-versioning--releases) · [Development](#development)
- [Troubleshooting](#troubleshooting-the-server) · [Data & attribution](#data--attribution)

## Why

ProtonDB's public summary API only exposes a tier (gold/silver/…) and a score. The
_useful_ signal for "will this run on my box, and how do I make it run" lives in the
individual reports: the exact Proton/GE version, the GPU + driver, the distro/kernel,
and the reporter's free-text notes ("works after disabling anti-cheat", "needs
`PROTON_USE_WINED3D=1`", "fine on NixOS + Hyprland"). This server makes that corpus
queryable and analyzable by an LLM.

## Features

- **Bulk reports in SQLite** — ingests the [bdefore/protondb-data][bdefore] ODbL export
  into a local, FTS5-indexed SQLite DB. Dump records are _richer than the live API_ —
  they include `systemInfo` (CPU/GPU/driver/kernel/OS/RAM), which the live API omits.
- **Daily auto-refresh** — checks the export repo on startup and on an interval, and
  re-ingests when a newer monthly dump exists and local data is stale (past the 1st of
  the month). Builds into a temp DB and **atomically swaps** it in.
- **Live capture** — for the freshest reports on a single game, drives a headless
  browser to capture protondb.com's own reports feed (whose file id is an obfuscated
  client-side hash, so we let the site's JS compute it). Best-effort and non-blocking.
- **Search + details** — resolves a game name → Steam appId via ProtonDB's Algolia
  index (Steam storefront search as fallback) and enriches with Steam store details.
- **General keyword search** across all report text (notes, title, Proton version, GPU,
  OS) with a result limit.
- **Two transports** — stdio (for desktop/CLI MCP clients) and Streamable HTTP (for a
  long-running/container deployment).
- **Fully env-configurable** and **Docker-first**, with CalVer releases and Renovate.

## How it works

```
                    ┌─────────────── protondb-mcp ───────────────┐
  game name ──►  search_games ──► appId
                    │                 │
                    │            get_game_details ──► Steam store API
                    │                 │
  appId/name ──► analyze_compatibility ─┐
                    │  get_reports       ├─ SQLite (bulk dump, FTS5)  ◄─ ingest ◄─ bdefore/protondb-data
                    │  search_reports    │        ▲                                  (auto-update, daily)
                    │                    └─ live capture (Playwright) ◄─ protondb.com
                    └─────────────────────────────────────────────┘
```

Data sources:

| Source                           | Used for                           | Notes                                         |
| -------------------------------- | ---------------------------------- | --------------------------------------------- |
| [bdefore/protondb-data][bdefore] | Bulk individual reports → SQLite   | ODbL, monthly, includes hardware/`systemInfo` |
| protondb.com `/data/reports/...` | Live freshest reports              | Captured via headless browser (obfuscated id) |
| protondb.com summaries API       | Current tier/score                 | `…/api/v1/reports/summaries/{appid}.json`     |
| ProtonDB Algolia `steamdb` index | name → appId search                | Public search key; Steam storesearch fallback |
| Steam store API                  | Game details, name search fallback | `appdetails`, `storesearch`                   |

## Tools

All tools return a concise human summary **and** validated `structuredContent`.

### `search_games`

Resolve a game name to candidate Steam appIds + metadata.

- `query` (string, required) — e.g. `"Cyberpunk 2077"`
- `limit` (int, default 10, max 50)
- → `{ count, games: [{ appId, name, oslist?, tags?, userScore?, releaseYear?, nativeLinux?, source }] }`

### `get_game_details`

Steam store details + current ProtonDB tier.

- `appId` (string, required)
- → `{ appId, name, genres?, releaseDate?, nativeLinux?, metacritic?, protonTier, … }`

### `get_reports`

Individual community reports for a game, with server-side filters. **Compact by default** —
each report carries only the flat fields, so responses stay small.

- `appId` (string) **or** `name` (string)
- `source` (`auto` | `db` | `live`, default `auto`) — `db` = local bulk-dump DB, `live` =
  freshest scraped reports, `auto` = db then live fallback when the DB has none
- `limit` (int, default 50, max 500)
- `verdict` (`yes` | `no`), `protonVersionContains` (string), `gpuContains` (string),
  `since` (unix epoch seconds)
- `detail` (`compact` | `full`, default `compact`) — `full` adds the nested `responses` /
  `systemInfo` / `device` / `contributor` blobs
- `fields` (string[]) — exact projection; return ONLY these keys (`appId` always included),
  e.g. `["verdict","launchOptions","protonVersion","gpu","notes"]`. Overrides `detail`
- `includeRaw` (bool, default false) — also attach the complete verbatim original record
- `systemProfile` (object) — `{ gpuVendor?, gpu?, distro?, kernel?, session?, protonVersion? }`;
  ranks reports by similarity to the user's rig (best match first, each gets `profileScore`)
- → `{ appId, name, source, count, truncated, dropped, note?, reports: [...] }`

Large result sets are projected then trimmed to a byte budget
(`PROTONDB_MCP_MAX_RESPONSE_CHARS`); `dropped`/`note` report what was cut so the response
never overflows the host's token limit. The flat fields cover the common cases; reach for
`detail:'full'` or a `fields` projection naming `responses`/`systemInfo`/`raw` only when you
need the per-category faults or full hardware info.

### `analyze_compatibility` — start here

Aggregate a game's reports into patterns, optionally scoped to a slice of the population.

- `appId` (string) **or** `name` (string)
- `includeLive` (bool, default false) — also merge the freshest live reports
- `sampleSize` (int, default 2000, max 5000) — how many DB reports to aggregate
- `gpuVendor` (`nvidia` | `amd` | `intel`), `gpuContains` (string),
  `protonVersionContains` (string), `since` (unix epoch seconds) — scope the population
  before aggregating (e.g. "what works for NVIDIA users in the last year")
- → verdict breakdown, working rate, **best Proton versions** (among working reports),
  **bestLaunchOptions**, **bestEnvVars** (individual `PROTON_*`/`DXVK_*`/… assignments ranked
  by frequency), GPU-vendor and distro breakdowns, representative notes, and the live tier summary.

### `search_reports`

General keyword/full-text search across all reports (notes, title, Proton version, GPU,
OS, launch options). Global, or scoped to one game. **Matches any keyword by default**,
relevance-ranked — so a descriptive multi-word query returns the best matches instead of 0.

- `query` (string, required) — e.g. `"nixos flatpak"`, `"anti-cheat"`, `"GE-Proton9"`, `"vulkan dx11 stutter"`
- `match` (`any` | `all`, default `any`) — `any` = OR (BM25-ranked); `all` = require every term
- `sort` (`relevance` | `recent`, default `relevance`)
- `appId` / `name` (optional scope), `limit` (int, default 25, max 200)
- `detail` / `fields` / `includeRaw` / `systemProfile` — same compact-by-default projection,
  byte budget, and rig-similarity ranking as `get_reports`
- → `{ query, appId, count, truncated, dropped, note?, reports: [...] }`

## Server instructions (the model's "system prompt")

The server sends MCP `instructions` that clients surface to the model. They tell the
assistant to:

1. **Detect the user's Linux environment first** with best-effort commands —
   `cat /etc/os-release`, NixOS (`/etc/NIXOS`, `nixos-version`), atomic distros
   (`rpm-ostree status`, `steamos-readonly status`), package manager probe, `uname -r`,
   `lscpu`, `free -h`, GPU/driver (`lspci -nnk`, `glxinfo -B`, `nvidia-smi`), session
   (`XDG_SESSION_TYPE`), and how Steam/Proton are installed.
2. **Map findings to the tools** — filter `get_reports` by GPU/Proton, use
   `search_reports` for distro-specific gotchas, prefer `analyze_compatibility` first.
3. **Troubleshoot** — common launch options (`PROTON_LOG=1`, `gamemoderun`, `mangohud`,
   `PROTON_USE_WINED3D`), forcing Proton/GE builds, resetting a prefix
   (`rm -rf …/compatdata/<appid>`), `protontricks`, Vulkan/driver checks (`vulkaninfo`,
   `vkcube`, `glxinfo`, 32-bit libs), anti-cheat, Flatpak `flatpak override`, NixOS
   `steam-run`, and log inspection (`journalctl --user -b -e`, `dmesg`, `ldd`).

## Install & run (local)

**Prerequisites:** Node ≥ 20 (tested on 24), [pnpm](https://pnpm.io) (via `corepack
enable`), and a C/C++ toolchain for the `better-sqlite3` native addon (`python3`,
`make`, `g++` — usually preinstalled on Linux; on Debian/Ubuntu `apt install build-essential python3`).

```bash
pnpm install
pnpm build

# Get data: either let auto-update fetch the newest dump on first run, or ingest now:
pnpm ingest                                    # newest dump from the repo
# pnpm ingest --dump reports_sep5_2020.tar.gz  # a small dump for a quick start

# Run (stdio — for Claude Desktop / Code / MCP Inspector):
node dist/index.js

# Run (Streamable HTTP — for a long-running service):
node dist/http-server.js     # http://127.0.0.1:3000/mcp  (+ GET /health)
```

Inspect interactively with the official inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Enable live capture (optional):

```bash
pnpm exec playwright install chromium
```

## MCP client config

**stdio** (e.g. Claude Desktop / Code `mcpServers`):

```json
{
  "mcpServers": {
    "protondb": {
      "command": "node",
      "args": ["/abs/path/to/protondb-mcp/dist/index.js"],
      "env": { "PROTONDB_MCP_DB": "/abs/path/to/protondb-mcp/data/protondb.db" }
    }
  }
}
```

**Streamable HTTP** (point your client at the URL):

```
http://127.0.0.1:3000/mcp
```

### Authentication (HTTP transport)

The stdio transport is local and needs no auth. The HTTP transport is unauthenticated
by default; set `PROTONDB_MCP_AUTH_TOKEN` (one token, or several comma-separated) to
require a shared secret. Clients then send it as a bearer token:

```bash
curl -H "Authorization: Bearer $TOKEN" http://host:3000/mcp ...
```

In an MCP client config that supports custom headers:

```json
{
  "mcpServers": {
    "protondb": {
      "url": "https://host:3000/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

`/health` is always reachable without a token (for container healthchecks). Always pair
a token with TLS (terminate HTTPS at a reverse proxy) so the secret isn't sent in clear.

## Docker

The repo ships two images:

- **Default** (`Dockerfile`) — slim, DB-only, **fast**. Live capture is disabled
  (`PROTONDB_MCP_ENABLE_LIVE=false`) since there's no browser.
- **Full** (`Dockerfile.playwright`) — bundles Chromium for live capture. Larger.

```bash
# Default image via compose (recommended): builds, runs, persists the DB on a volume.
docker compose up --build
# Liveness:     curl http://localhost:3000/health   (always 200 while running)
# Readiness:    curl http://localhost:3000/ready    (200 only once the DB has data)
# MCP endpoint: http://localhost:3000/mcp
```

On first boot the container **auto-ingests the newest dump** into the mounted volume
(`/app/data`); restarts reuse it (no re-download). With an empty volume this fetches and
ingests ~370k+ reports (tens of seconds). Wire `/ready` as the pod **readiness probe** and
`/health` as the **liveness probe**, so a fresh (empty) deployment isn't routed traffic
until that first ingest finishes — no empty-DB window, and the image stays slim (the DB
lives on the volume, not baked in).

Full image with live capture:

```bash
docker build -f Dockerfile.playwright -t protondb-mcp:playwright .
docker run -p 3000:3000 -v protondb-data:/app/data \
  -e PROTONDB_MCP_ENABLE_LIVE=true protondb-mcp:playwright
```

Published images (from CI) are tagged `:latest`, `:<version>`, `:playwright`, and
`:<version>-playwright` under `ghcr.io/<owner>/protondb-mcp`.

> The image runs as a non-root user; the `/app/data` volume must be writable by it
> (named volumes handle this automatically; for bind mounts, `chown` the host dir).

## Configuration (environment variables)

Everything is configurable via env. Defaults in parentheses.

### Storage

| Variable                          | Default              | Description                                                                                                                                          |
| --------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROTONDB_MCP_DB`                 | `./data/protondb.db` | SQLite database path.                                                                                                                                |
| `PROTONDB_MCP_MAX_RESPONSE_CHARS` | `30000`              | Soft byte budget for `get_reports`/`search_reports`. Reports are projected then trimmed to this many chars; the response says how many were dropped. |

### HTTP transport (`http-server.js`)

| Variable                          | Default     | Description                                                                                                                                                                                                                  |
| --------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROTONDB_MCP_HTTP_HOST`          | `127.0.0.1` | Bind host (`0.0.0.0` in containers).                                                                                                                                                                                         |
| `PROTONDB_MCP_HTTP_PORT`          | `3000`      | Bind port.                                                                                                                                                                                                                   |
| `PROTONDB_MCP_HTTP_PATH`          | `/mcp`      | MCP endpoint path.                                                                                                                                                                                                           |
| `PROTONDB_MCP_HTTP_ALLOWED_HOSTS` | _(auto)_    | Comma-separated `host[:port]` allowlist for DNS-rebinding protection. When unset, loopback binds get a localhost allowlist and non-loopback binds disable the check.                                                         |
| `PROTONDB_MCP_AUTH_TOKEN`         | _(unset)_   | Shared-secret auth for the HTTP endpoint. One or more comma-separated tokens. When unset, the endpoint is **unauthenticated**. Clients send `Authorization: Bearer <token>` (or `X-API-Key: <token>`); `/health` stays open. |

### Bulk data & auto-update

| Variable                                                  | Default                 | Description                                                                    |
| --------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `PROTONDB_MCP_AUTO_UPDATE`                                | `true`                  | Auto-refresh the bulk dump.                                                    |
| `PROTONDB_MCP_UPDATE_INTERVAL_HOURS`                      | `24`                    | Hours between update checks.                                                   |
| `PROTONDB_MCP_DUMP_REPO`                                  | `bdefore/protondb-data` | GitHub repo of the bulk export.                                                |
| `PROTONDB_MCP_DUMP_BRANCH`                                | `master`                | Branch used for raw download URLs.                                             |
| `PROTONDB_MCP_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN` | _(unset)_               | GitHub token to raise the API rate limit when listing dumps. First match wins. |

### Live capture

| Variable                       | Default | Description                                   |
| ------------------------------ | ------- | --------------------------------------------- |
| `PROTONDB_MCP_ENABLE_LIVE`     | `true`  | Allow headless live capture (needs Chromium). |
| `PROTONDB_MCP_LIVE_TIMEOUT_MS` | `25000` | Navigation/response timeout for capture.      |

### Outbound HTTP

| Variable                       | Default          | Description                                              |
| ------------------------------ | ---------------- | -------------------------------------------------------- |
| `PROTONDB_MCP_USER_AGENT`      | `protondb-mcp/…` | User-Agent for outbound requests.                        |
| `PROTONDB_MCP_HTTP_TIMEOUT_MS` | `15000`          | Per-request timeout.                                     |
| `PROTONDB_MCP_HTTP_RETRIES`    | `2`              | Retries on 429/5xx/network errors.                       |
| `PROTONDB_MCP_CACHE_TTL_MS`    | _(per-call)_     | Override every response cache TTL; `0` disables caching. |

### Search

| Variable          | Default         | Description              |
| ----------------- | --------------- | ------------------------ |
| `ALGOLIA_APP_ID`  | ProtonDB public | Algolia application id.  |
| `ALGOLIA_API_KEY` | ProtonDB public | Algolia search-only key. |
| `ALGOLIA_INDEX`   | `steamdb`       | Algolia index name.      |

## Ingestion CLI

```bash
pnpm ingest                                   # newest dump from the repo
pnpm ingest --dump reports_oct5_2024.tar.gz   # a specific dump by filename
pnpm ingest --url https://.../reports.tar.gz  # an arbitrary tarball
pnpm ingest --file ./local.tar.gz             # a local tarball or .json
```

Ingestion streams the (large) JSON array, normalizes each record, bulk-inserts in a
transaction, builds the FTS index, and records provenance (`dump_file`, `dump_date`,
`record_count`, `ingested_at`) in the `meta` table.

## Auto-update

On startup (non-blocking) and every `PROTONDB_MCP_UPDATE_INTERVAL_HOURS`, the server:

1. Bootstraps if the DB is empty (ingests the newest dump immediately).
2. Otherwise refreshes **only when** a newer dump exists upstream, local data predates
   the current month, **and** it's on/after the 1st (the monthly upload has landed).
3. Builds the new DB on the same filesystem as the live DB and **atomically renames** it
   in, so in-flight reads are unaffected.

## Schema & migrations

The database is **disposable** — it's rebuilt from the upstream dump, never hand-edited —
so migrations are simple:

- **Structure** is versioned with SQLite's native `PRAGMA user_version` via a tiny ordered
  migration runner (`src/db/migrate.ts`). A fresh DB is created at the current version and
  stamped; append a migration to evolve it.
- **Field extraction** is versioned separately as `EXTRACTION_VERSION` (stored in meta as
  `data_version`). When we change _which_ fields are captured, we bump it; on the next
  start the auto-updater sees the DB's `data_version` is behind and **re-ingests** to
  backfill the new fields. So **deploying a new version auto-migrates running deployments**
  on their own — no manual migration step. (To force it immediately, delete the volume's
  `protondb.db` or run `pnpm ingest`.) Reads of an older DB during the brief rebuild window
  are defensive (missing columns read as null).

## CI/CD, versioning & releases

CalVer (`YYYY.M.MICRO`, e.g. `2026.6.0`) via two complementary GitHub Actions:

- **`release-calendar.yaml`** — scheduled job that _always_ cuts a release + containers
  on the **2nd of every month** (`YYYY.M.0`), aligned with the monthly data dump.
- **`release-please.yaml`** — conventional-commit releases between the monthly cuts,
  bumping only the MICRO (`always-bump-patch`).

Both build via the reusable **`build-container.yaml`** (pushes to GHCR). **`ci.yaml`**
runs build + tests + a Docker build on every push/PR.

**Renovate** (`renovate.yaml`) runs self-hosted **daily in the morning**, extending the
[home-operations renovate config](https://github.com/home-operations/renovate-config).
It uses a GitHub App — set repo secrets `BOT_CLIENT_ID` and `BOT_APP_PRIVATE_KEY` (App
installed with Contents/Pull requests/Issues/Workflows read-write), or swap the token
step for a `RENOVATE_TOKEN` PAT.

## Development

```bash
pnpm test          # vitest unit + integration tests
pnpm build         # tsc -> dist/
pnpm watch         # tsc --watch
```

Manual smoke tests (after `pnpm build`):

```bash
node test/smoke-client.mjs                       # stdio: lists tools, exercises each
MCP_URL=http://localhost:3000/mcp node test/http-smoke.mjs   # against a running HTTP server
```

Project layout:

```
src/
  index.ts            stdio entry (package bin)
  http-server.ts      Streamable HTTP entry
  server.ts           buildServer(): McpServer + instructions + tool registration
  tools/              the 5 MCP tools + name->appId resolver
  sources/            algolia, steam, summary, dump-registry, protondb-live (headless)
  db/                 schema (FTS5), queries, connection store (atomic swap)
  lib/                config, http (fetch + cache), normalize, analyze, tiers, auto-update, types
  scripts/ingest.ts   bulk dump -> SQLite (also used by auto-update)
```

## Troubleshooting (the server)

- **`better-sqlite3` build / "Could not locate the bindings file"** — the native addon
  didn't compile. Ensure a toolchain is present (`build-essential`, `python3`) and that
  pnpm is allowed to run build scripts (`pnpm-workspace.yaml` lists it under
  `onlyBuiltDependencies`). Re-run `pnpm install` / `pnpm rebuild better-sqlite3`.
- **Live capture errors** — install the browser (`pnpm exec playwright install chromium`)
  or use the `Dockerfile.playwright` image; or set `PROTONDB_MCP_ENABLE_LIVE=false`.
  Live failures are logged and non-blocking — tools still return DB results.
- **GitHub rate limits on auto-update** — set `PROTONDB_MCP_GITHUB_TOKEN` (or
  `GITHUB_TOKEN`). Unauthenticated GitHub API allows ~60 requests/hour.
- **`EXDEV` / cross-device rename** — already handled: the new DB is built on the same
  filesystem as the live DB before the atomic swap.
- **stdio: nothing but JSON appears** — that's correct; all logs go to stderr so stdout
  stays a clean JSON-RPC channel.

## Data & attribution

Bulk report data comes from [bdefore/protondb-data][bdefore], published under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). Live data
and tier summaries come from [protondb.com](https://www.protondb.com); game metadata
from Steam. The server caches, throttles, retries politely, and sends a descriptive
User-Agent. **This project is not affiliated with ProtonDB, Valve, or Steam.**

Licensed under MIT (code). Respect ODbL attribution when redistributing the data.

[bdefore]: https://github.com/bdefore/protondb-data
