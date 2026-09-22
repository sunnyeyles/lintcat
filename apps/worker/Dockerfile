# Builds apps/worker for Cloud Run. Build from the repo root:
#   docker build -f apps/worker/Dockerfile -t pr-review-worker .
#
# The build stage installs the whole workspace (esbuild bundles straight from
# every package's TypeScript source, so nothing else needs a build step) and
# bundles apps/worker into one self-contained dist/index.mjs. The runtime
# stage ships only that file: @neondatabase/serverless talks to Postgres over
# HTTP/WebSocket, so nothing native needs compiling or copying in.

FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@pr-review/worker

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/worker/dist/index.mjs ./index.mjs
USER node
# Cloud Run injects PORT; the app reads it and only then starts the HTTP server.
EXPOSE 8080
CMD ["node", "index.mjs"]
