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
RUN npm ci

COPY src/ ./src/
COPY migrations/ ./migrations/

RUN npm run build

# ----------------------------------------------------------------------
# Stage 2: Production runner
# ----------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild argon2

COPY --from=builder /app/dist ./dist
COPY migrations/ ./migrations/

EXPOSE 3000

USER node

CMD ["node", "dist/server.js"]
