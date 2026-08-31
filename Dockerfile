# syntax=docker/dockerfile:1

# Multi-stage build per SPEC.md §10.1. Three published targets:
#   runner   — the app image (Next standalone output, no dev deps)
#   migrator — runs Drizzle migrations, then exits. Not the app.
#
# Build the app image explicitly:  docker build --target runner -t kfless-games .

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: full dependency tree (dev deps are needed to build and to migrate)
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile Next in standalone mode
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- migrator: applies ./drizzle migrations against DATABASE_URL, then exits
FROM base AS migrator
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
COPY lib ./lib
COPY scripts ./scripts
COPY drizzle ./drizzle
CMD ["npm", "run", "db:migrate"]

# ---- runner: the shipped app image
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# standalone output carries its own minimal node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
ENV PORT=3000 \
    HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
