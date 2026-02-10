# Dockerfile for the Contra Admin UI (React/Vite)
#
# Railway config:
#   Set RAILWAY_DOCKERFILE_PATH=admin-ui/Dockerfile as a service variable.
#   Build context is the repo root, so parent directory paths work.
#   Generated TypeScript clients must be committed to the repo.

FROM node:24-alpine AS builder

RUN npm install -g pnpm@latest

WORKDIR /app

# Copy generated TypeScript clients (committed to repo)
COPY contra-escrow-program/clients/typescript /app/contra-escrow-program/clients/typescript
COPY contra-withdraw-program/clients/typescript /app/contra-withdraw-program/clients/typescript

# Copy admin-ui source
COPY admin-ui /app/admin-ui

WORKDIR /app/admin-ui

RUN pnpm install --frozen-lockfile

# The generated TS clients import @solana/kit etc. but have no node_modules.
# Symlink admin-ui's node_modules so tsc can resolve deps from the client paths.
RUN ln -s /app/admin-ui/node_modules /app/contra-escrow-program/clients/typescript/node_modules && \
    ln -s /app/admin-ui/node_modules /app/contra-withdraw-program/clients/typescript/node_modules

# Client code uses /contra-read and /contra-write (relative paths).
# The production server.mjs proxies these to the real RPC URLs at runtime.
# CONTRA_WS_URL must be baked in at build time because the browser connects
# directly to the streamer WebSocket (not proxied through server.mjs).
ARG CONTRA_WS_URL=""
ENV CONTRA_WS_URL=${CONTRA_WS_URL}
RUN pnpm build

# Production: lightweight server that serves static files + proxies RPC
FROM node:24-alpine

COPY --from=builder /app/admin-ui/dist /app/dist
COPY --from=builder /app/admin-ui/server.mjs /app/server.mjs

WORKDIR /app

EXPOSE 3000

# Runtime env vars (set via Railway service variables):
#   CONTRA_READ_URL=https://read-node-production.up.railway.app
#   CONTRA_WRITE_URL=https://write-node-production.up.railway.app
#
# Build-time arg (set via Railway service variables -- requires RAILWAY_DOCKER_BUILD_ARGS):
#   CONTRA_WS_URL=wss://streamer-production-xxxx.up.railway.app/ws
CMD ["node", "server.mjs"]
