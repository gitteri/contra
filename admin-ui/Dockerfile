# Dockerfile for the Contra Admin UI (React/Vite)
# Root directory in Railway should be set to "admin-ui"
# Build context is admin-ui/, so we cannot reference parent dirs directly.
# Instead, we generate TS clients from committed IDLs at build time.

FROM node:24-alpine AS client-gen

RUN npm install -g pnpm@latest

WORKDIR /gen

# Copy the program packages needed to generate TypeScript clients.
# These are passed in via the build context (see note below).
# We copy them from the Docker build context which is admin-ui/,
# so we need to include them via a build step that fetches from the repo.

# Clone the repo to get IDLs and generation scripts
# Alternative: use build args to pass them in
# For Railway, we use a multi-stage approach with git sparse checkout
RUN apk add --no-cache git

ARG REPO_URL
ARG REPO_BRANCH=main

RUN git clone --depth 1 --branch ${REPO_BRANCH} --filter=blob:none --sparse ${REPO_URL} /repo && \
    cd /repo && \
    git sparse-checkout set \
      contra-escrow-program/idl \
      contra-escrow-program/scripts \
      contra-escrow-program/clients/typescript \
      contra-escrow-program/package.json \
      contra-escrow-program/pnpm-lock.yaml \
      contra-withdraw-program/idl \
      contra-withdraw-program/scripts \
      contra-withdraw-program/clients/typescript \
      contra-withdraw-program/package.json \
      contra-withdraw-program/pnpm-lock.yaml

RUN cd /repo/contra-escrow-program && pnpm install && pnpm run generate-clients
RUN cd /repo/contra-withdraw-program && pnpm install && pnpm run generate-clients

FROM node:24-alpine AS builder

RUN npm install -g pnpm@latest

WORKDIR /app

# Copy generated TypeScript clients from previous stage
COPY --from=client-gen /repo/contra-escrow-program/clients/typescript /app/contra-escrow-program/clients/typescript
COPY --from=client-gen /repo/contra-withdraw-program/clients/typescript /app/contra-withdraw-program/clients/typescript

# Copy admin-ui source (build context IS admin-ui/)
COPY . /app/admin-ui

WORKDIR /app/admin-ui

RUN pnpm install --frozen-lockfile

ARG CONTRA_RPC_URL
ENV CONTRA_RPC_URL=${CONTRA_RPC_URL}
RUN pnpm build

# Serve with a lightweight static server
FROM node:24-alpine

RUN npm install -g serve@latest

COPY --from=builder /app/admin-ui/dist /app/dist

WORKDIR /app

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
