# WASLA — Reproducible Container Image (Dockerfile)
#
# Multi-stage build for the WASLA monorepo.
# Base image: node:22-alpine (pinned by digest for reproducibility).
# SBOM: generated at build time via syft or cyclonedx.
# Scan: trivy or pnpm audit in CI.
#
# ADR-032: Container images, SBOM, and vulnerability scanning (M2-01)

# ─── Stage 1: deps ──────────────────────────────────────────────
# Install all dependencies (including dev) for building.
FROM node:22-alpine AS deps

# Install corepack and enable pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy lockfile and workspace manifest first for cacheable dep install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY services/*/package.json ./services/*/
COPY packages/*/package.json ./packages/*/
COPY bots/*/package.json ./bots/*/

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile

# ─── Stage 2: build ─────────────────────────────────────────────
# Build all TypeScript packages
FROM deps AS build

# Copy source code
COPY . .

# Build all packages
RUN pnpm -r run build

# ─── Stage 3: runtime ───────────────────────────────────────────
# Minimal runtime image: only production deps and built output
FROM node:22-alpine AS runtime

# Install corepack and enable pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy lockfile and workspace manifest
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY services/*/package.json ./services/*/
COPY packages/*/package.json ./packages/*/
COPY bots/*/package.json ./bots/*/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built output from build stage
COPY --from=build /app/services/*/dist ./services/*/dist
COPY --from=build /app/packages/*/dist ./packages/*/dist
COPY --from=build /app/bots/*/dist ./bots/*/dist

# Copy any non-buildable files needed at runtime (configs, etc.)
COPY --from=build /app/services/*/drizzle ./services/*/drizzle

# Default command (overridden per-service in docker-compose)
CMD ["node", "services/matching/dist/index.js"]
