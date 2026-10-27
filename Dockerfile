# syntax=docker/dockerfile:1

# ----------------------------------------------------------------------
# Stage 1: Build stage
# ----------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build tools for native dependencies (argon2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json ./
# Match the lockfile toolchain validated by CI in both image stages.
RUN npm install --global npm@11.3.0 && npm ci

COPY src/ ./src/
COPY migrations/ ./migrations/

RUN npm run build && npm prune --omit=dev

# ----------------------------------------------------------------------
# Stage 2: Production runner
# ----------------------------------------------------------------------
# Preserve the exact serving runtime and its approved boundary asset.
FROM asia-south2-docker.pkg.dev/infurnus-5c47c/cloud-run-source-deploy/infurnus-api:github-db9cfb0-boundary-20261019 AS runner
USER root
WORKDIR /app
RUN rm -rf /app/node_modules
COPY --from=builder /app/dist ./dist
# Deploy the lockfile-verified runtime dependencies, not an older base snapshot.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY migrations/ ./migrations/
# Keep the serving container unprivileged after replacing dependencies.
COPY config/service-area/ ./config/service-area/
# Preserve the approved geometry while keeping the packaged JSON within its byte limit.
RUN node -e "const fs = require('fs'); const p = 'config/service-area/bihar.geojson'; fs.writeFileSync(p, JSON.stringify(JSON.parse(fs.readFileSync(p, 'utf8'))))"
USER node
