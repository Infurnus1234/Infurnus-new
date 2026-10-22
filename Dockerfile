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

RUN npm run build

# ----------------------------------------------------------------------
# Stage 2: Production runner
# ----------------------------------------------------------------------
# Preserve the exact serving runtime and its approved boundary asset.
FROM asia-south2-docker.pkg.dev/infurnus-5c47c/cloud-run-source-deploy/infurnus-api:github-db9cfb0-boundary-20261019 AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY migrations/ ./migrations/
