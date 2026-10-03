# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/server/Dockerfile -t hexmark-server .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Download all locked packages first; this layer only changes with the lockfile.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@hexmark/server..."
RUN pnpm --filter @hexmark/server build
# Self-contained copy of the server with production dependencies only.
# --legacy: the workspace does not inject workspace packages (keeps symlinks
# for local development); the server bundles @hexmark/shared anyway.
RUN pnpm --filter @hexmark/server deploy --legacy --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
# SQL migrations, applied by the server on every start (resolved as ../drizzle
# from dist/index.js).
COPY --from=build /repo/apps/server/drizzle ./drizzle
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
CMD ["node", "dist/index.js"]
