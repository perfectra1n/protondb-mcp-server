# protondb-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an LLM fetch and
**analyze ProtonDB Linux/Proton game-compatibility reports** — not just the
headline tier, but the individual community reports (Proton version, hardware,
free-text notes) so a model can mine them for "what config works best".

## What it does

- **Bulk reports in SQLite** — ingests the [bdefore/protondb-data][bdefore]
  ODbL export (each record includes `systemInfo`: CPU/GPU/driver/kernel/OS/RAM,
  which the live API does *not* expose) into a local, FTS-indexed SQLite DB.
- **Auto-refresh** — on startup and daily, checks the export repo and re-ingests
  when a newer monthly dump exists and the local data is stale (past the 1st of
  the month). Builds into a temp DB and swaps it in atomically.
- **Live capture** — for the freshest reports on a single game, drives a headless
  browser to capture protondb.com's own (obfuscated-id) reports feed.
- **Search + details** — resolves a game name → Steam appId via ProtonDB's
  Algolia index (Steam storefront search as fallback) and enriches with Steam
  store details.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_games` | Resolve a game name to candidate Steam appIds + metadata. |
| `get_game_details` | Steam store details (genres, native-Linux, release) + current ProtonDB tier. |
| `get_reports` | Individual reports for a game with server-side filters (`source: db \| live \| auto`). |
| `analyze_compatibility` | Aggregate reports into patterns: verdict split, best Proton versions, GPU/distro breakdown, sample notes. **Start here.** |
| `search_report_notes` | Full-text search across report notes (e.g. `anti-cheat`, `crash`). |

All tools return a concise human summary plus validated `structuredContent`.

## Quick start (local)

```bash
pnpm install
pnpm build
# Ingest a small dump to get going fast (or let auto-update fetch the newest):
pnpm ingest --dump reports_sep5_2020.tar.gz
# stdio (for Claude Desktop / Code / MCP Inspector):
node dist/index.js
# or Streamable HTTP:
node dist/http-server.js   # http://127.0.0.1:3000/mcp
```

Inspect interactively:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

For live capture (`source: "live"` / `includeLive: true`):

```bash
pnpm exec playwright install chromium
```

## MCP client config (stdio)

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

## Docker (primary deployment)

Default image (DB-only, fast; live capture disabled):

```bash
docker compose up --build
# health:       curl http://localhost:3000/health
# MCP endpoint: http://localhost:3000/mcp
```

The SQLite DB lives on the `protondb-data` volume; first boot auto-ingests the
newest dump, and restarts reuse the volume (no re-download).

Full image with live headless capture (bundles Chromium, larger):

```bash
docker build -f Dockerfile.playwright -t protondb-mcp:full .
docker run -p 3000:3000 -v protondb-data:/app/data \
  -e PROTONDB_MCP_ENABLE_LIVE=true protondb-mcp:full
```

## Configuration (env)

| Variable | Default | Description |
| --- | --- | --- |
| `PROTONDB_MCP_DB` | `./data/protondb.db` | SQLite path. |
| `PROTONDB_MCP_HTTP_HOST` / `_PORT` | `127.0.0.1` / `3000` | HTTP transport bind. |
| `PROTONDB_MCP_AUTO_UPDATE` | `true` | Auto-refresh the bulk dump. |
| `PROTONDB_MCP_ENABLE_LIVE` | `true` | Allow headless live capture. |
| `PROTONDB_MCP_USER_AGENT` | _(set)_ | Outbound User-Agent. |
| `GITHUB_TOKEN` | _(unset)_ | Raises GitHub API rate limit for dump listing. |
| `ALGOLIA_APP_ID` / `ALGOLIA_API_KEY` | ProtonDB public values | Override search creds. |

## Ingestion CLI

```bash
pnpm ingest                                   # newest dump from the repo
pnpm ingest --dump reports_oct5_2024.tar.gz   # a specific dump
pnpm ingest --url https://.../reports.tar.gz  # an arbitrary tarball
pnpm ingest --file ./local.tar.gz             # a local tarball or .json
```

## Development

```bash
pnpm test          # vitest unit + integration tests
pnpm build         # tsc -> dist/
```

## CI/CD, versioning & releases

This repo uses **CalVer** (`YYYY.M.MICRO`, e.g. `2026.6.0`) via two complementary
GitHub Actions mechanisms:

- **`release-calendar.yaml`** — a scheduled job that *always* cuts a release and
  publishes containers on the **2nd of every month** (`YYYY.M.0`). The 2nd is
  chosen so the freshly published monthly ProtonDB data dump is available for the
  image's first auto-ingest.
- **`release-please.yaml`** — conventional-commit driven releases *between* the
  monthly cuts, bumping only the MICRO (`always-bump-patch`), e.g. `2026.6.1`.

Both build via the reusable **`build-container.yaml`**, pushing to GHCR:

- `ghcr.io/<owner>/protondb-mcp:<version>` and `:latest` — default (DB-only) image
- `ghcr.io/<owner>/protondb-mcp:<version>-playwright` and `:playwright` — full image with Chromium

**`ci.yaml`** runs build + tests + a Docker build on every push/PR (so Renovate
auto-merges only gate on green checks).

### Renovate

**`renovate.yaml`** runs self-hosted Renovate **daily in the morning**
(`0 11 * * *`, ~07:00 ET) and on manual dispatch. It extends the community
[home-operations renovate config](https://github.com/home-operations/renovate-config)
(`.github/renovate.json5`). It authenticates with a GitHub App, matching the
home-operations setup — set these repo secrets:

| Secret | Purpose |
| --- | --- |
| `BOT_CLIENT_ID` | GitHub App client id |
| `BOT_APP_PRIVATE_KEY` | GitHub App private key |

The App must be installed on this repo with Contents, Pull requests, Issues and
Workflows read/write. (Or swap the token step for a `RENOVATE_TOKEN` PAT.)

> The monthly job pushes a commit + tag to `main`; if you protect that branch,
> allow the actor (or use a bot token with bypass).

## Data & attribution

Bulk report data comes from [bdefore/protondb-data][bdefore], published under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).
Live data and tier summaries come from [protondb.com](https://www.protondb.com).
Please be a good citizen: the server caches responses, throttles, and sends a
descriptive User-Agent. This project is not affiliated with ProtonDB or Valve.

[bdefore]: https://github.com/bdefore/protondb-data
