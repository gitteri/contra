# Dockerfile for the Contra User Simulator UI (React/Vite)
#
# Railway config:
#   Set RAILWAY_DOCKERFILE_PATH=user-ui/Dockerfile as a service variable.
#   Build context is the repo root.

FROM node:24-alpine AS builder

RUN npm install -g pnpm@latest

WORKDIR /app

# Copy generated TypeScript clients (needed for @contra-escrow / @contra-withdraw aliases)
COPY contra-escrow-program/clients/typescript /app/contra-escrow-program/clients/typescript
COPY contra-withdraw-program/clients/typescript /app/contra-withdraw-program/clients/typescript

# Copy user-ui source
COPY user-ui /app/user-ui

WORKDIR /app/user-ui

RUN pnpm install --frozen-lockfile

# The generated TS clients import @solana/kit etc. but have no node_modules.
# Symlink user-ui's node_modules so tsc can resolve deps from the client paths.
RUN ln -s /app/user-ui/node_modules /app/contra-escrow-program/clients/typescript/node_modules && \
    ln -s /app/user-ui/node_modules /app/contra-withdraw-program/clients/typescript/node_modules

# VITE_* vars are baked into the JS bundle at build time by Vite.
# Set these as Railway service variables -- Railway passes them as Docker build args.
ARG CONTRA_WS_URL=""
ARG VITE_ADMIN_WALLET=""
ARG VITE_MINT_ADDRESS=""
ARG VITE_INSTANCE_ADDRESS=""
ARG VITE_ADMIN_PRIVATE_KEY=""

ENV CONTRA_WS_URL=${CONTRA_WS_URL}
ENV VITE_ADMIN_WALLET=${VITE_ADMIN_WALLET}
ENV VITE_MINT_ADDRESS=${VITE_MINT_ADDRESS}
ENV VITE_INSTANCE_ADDRESS=${VITE_INSTANCE_ADDRESS}
ENV VITE_ADMIN_PRIVATE_KEY=${VITE_ADMIN_PRIVATE_KEY}

RUN pnpm build

# Production: lightweight server that serves static files + proxies RPC
FROM node:24-alpine

COPY --from=builder /app/user-ui/dist /app/dist
COPY --from=builder /app/user-ui/server.mjs /app/server.mjs

WORKDIR /app

EXPOSE 3001

# Runtime env vars (set via Railway service variables):
#   CONTRA_READ_URL=https://read-node-production.up.railway.app
#   CONTRA_WRITE_URL=https://write-node-production.up.railway.app
CMD ["node", "server.mjs"]
