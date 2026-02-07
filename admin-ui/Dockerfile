# Dockerfile for the Contra Admin UI (React/Vite)
# Must be built from the repo root so that path aliases to generated clients resolve.
#
# Build:  docker build -f admin-ui/Dockerfile .
# The build context is the repo root.

FROM node:24-alpine AS builder

RUN npm install -g pnpm@latest

WORKDIR /app

# Copy program packages (IDLs + scripts needed to generate TypeScript clients)
COPY contra-escrow-program/package.json contra-escrow-program/pnpm-lock.yaml ./contra-escrow-program/
COPY contra-escrow-program/idl ./contra-escrow-program/idl
COPY contra-escrow-program/scripts ./contra-escrow-program/scripts
COPY contra-escrow-program/clients/typescript ./contra-escrow-program/clients/typescript

COPY contra-withdraw-program/package.json contra-withdraw-program/pnpm-lock.yaml ./contra-withdraw-program/
COPY contra-withdraw-program/idl ./contra-withdraw-program/idl
COPY contra-withdraw-program/scripts ./contra-withdraw-program/scripts
COPY contra-withdraw-program/clients/typescript ./contra-withdraw-program/clients/typescript

# Install deps and generate TypeScript clients from committed IDLs
RUN cd contra-escrow-program && pnpm install && pnpm run generate-clients
RUN cd contra-withdraw-program && pnpm install && pnpm run generate-clients

# Copy admin-ui source
COPY admin-ui ./admin-ui

WORKDIR /app/admin-ui

# Install dependencies and build
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
