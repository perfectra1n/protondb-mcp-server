# Default image: DB-only ProtonDB MCP (fast, small). Live headless capture is
# disabled here (no browser); use Dockerfile.playwright for the full image.
# ---- builder ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
# Toolchain for compiling the better-sqlite3 native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
# Bake a DB snapshot into the image so the server has data immediately on first
# start (no cold-start ingest). Defaults to the newest dump; override with
# --build-arg SEED_DUMP=reports_<mon><n>_<year>.tar.gz, or SEED_DUMP=none to skip.
ARG SEED_DUMP=
RUN mkdir -p /app/seed \
  && if [ "$SEED_DUMP" != "none" ]; then \
       PROTONDB_MCP_DB=/app/seed/protondb.db PROTONDB_MCP_AUTO_UPDATE=false \
       node dist/scripts/ingest.js ${SEED_DUMP:+--dump "$SEED_DUMP"}; \
     fi
RUN pnpm prune --prod

# ---- runtime ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PROTONDB_MCP_DB=/app/data/protondb.db \
    PROTONDB_MCP_HTTP_HOST=0.0.0.0 \
    PROTONDB_MCP_HTTP_PORT=3000 \
    PROTONDB_MCP_ENABLE_LIVE=false \
    PROTONDB_MCP_AUTO_UPDATE=true
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/seed ./seed
COPY package.json ./
ENV PROTONDB_MCP_SEED_DB=/app/seed/protondb.db
RUN mkdir -p /app/data \
  && useradd --create-home --uid 10001 app \
  && chown -R app:app /app
USER app
VOLUME ["/app/data"]
EXPOSE 3000
# HTTP transport is the natural fit for a long-running container.
CMD ["node", "dist/http-server.js"]
