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

ARG CONTRA_READ_URL
ARG CONTRA_WRITE_URL
ENV CONTRA_READ_URL=${CONTRA_READ_URL}
ENV CONTRA_WRITE_URL=${CONTRA_WRITE_URL}
RUN pnpm build

# Serve with a lightweight static server
FROM node:24-alpine

RUN npm install -g serve@latest

COPY --from=builder /app/admin-ui/dist /app/dist

WORKDIR /app

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
