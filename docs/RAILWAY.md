# Railway Deployment

This guide covers deploying Contra to [Railway](https://railway.com) as a multi-service project.

## Architecture

All services are built from a single Dockerfile that produces four binaries: `node`, `gateway`, `indexer`, and `activity`. Each Railway service runs the same Docker image with a different start command and environment variables.

| Railway Service | Binary | Role |
|---|---|---|
| `write-node` | `node` | Core write node (processes transactions) |
| `read-node` | `node` | Core read node (serves queries) |
| `gateway` | `gateway` | Routes requests between write and read nodes |
| `indexer-solana` | `indexer` | Indexes Solana transactions via Yellowstone gRPC |
| `indexer-contra` | `indexer` | Indexes Contra transactions via RPC polling |
| `operator-solana` | `indexer` | Processes escrow program operations |
| `operator-contra` | `indexer` | Processes withdrawal program operations |

Services **not** deployed to Railway:
- **PostgreSQL** -- use a Railway-managed Postgres instance instead
- **Solana Validator** -- connect to mainnet/devnet RPC
- **Activity Generator** -- load testing tool, not for production
- **Prometheus/Grafana/cAdvisor** -- monitoring stack, add later if needed

## Prerequisites

- [Railway CLI](https://docs.railway.com/guides/cli) installed and authenticated (`railway login`)
- A Railway project linked to this repo (`railway link`)
- A Railway PostgreSQL instance in the project
- Solana programs built locally (the repo contains symlinks to build artifacts that must resolve):
  ```bash
  make -C contra-escrow-program build
  make -C contra-withdraw-program build
  ```
- An admin keypair (e.g., `keypairs/admin.json`)

## Database Setup

The system uses two PostgreSQL databases. Connect to your Railway Postgres and create them:

```sql
CREATE DATABASE contra;
CREATE DATABASE indexer;
```

Schemas auto-initialize on first connection -- no migration files are needed.

## Creating Services

Use the Railway CLI to create all services:

```bash
railway add --service write-node
railway add --service read-node
railway add --service gateway
railway add --service indexer-solana
railway add --service indexer-contra
railway add --service operator-solana
railway add --service operator-contra
```

## Start Commands

Set the start command for each service in the Railway dashboard under **Settings > Deploy > Custom Start Command**:

| Service | Start Command |
|---|---|
| `write-node` | `/usr/local/bin/node` |
| `read-node` | `/usr/local/bin/node` |
| `gateway` | `/usr/local/bin/gateway` |
| `indexer-solana` | `/usr/local/bin/indexer --config /etc/contra/config/railway/indexer-solana.toml -v indexer` |
| `indexer-contra` | `/usr/local/bin/indexer --config /etc/contra/config/railway/indexer-contra.toml -v indexer` |
| `operator-solana` | `/usr/local/bin/indexer --config /etc/contra/config/railway/operator-solana.toml -v operator` |
| `operator-contra` | `/usr/local/bin/indexer --config /etc/contra/config/railway/operator-contra.toml -v operator` |

Config files are baked into the Docker image at `/etc/contra/config/` during build.

## Environment Variables

### write-node

| Variable | Value |
|---|---|
| `CONTRA_PORT` | `8900` |
| `CONTRA_ACCOUNTSDB_CONNECTION_URL` | `postgres://user:pass@host:port/contra` |
| `CONTRA_ENABLE_READ` | `false` |
| `CONTRA_MODE` | `write` |
| `CONTRA_SIGVERIFY_QUEUE_SIZE` | `10000000` |
| `CONTRA_SIGVERIFY_WORKERS` | `32` |
| `CONTRA_MAX_CONNECTIONS` | `1000000` |
| `CONTRA_MAX_TX_PER_BATCH` | `64` |
| `CONTRA_ADMIN_KEYS` | Admin pubkey(s), comma-separated |
| `CONTRA_LOG_LEVEL` | `info` |
| `CONTRA_JSON_LOGS` | `true` |
| `RUST_LOG` | `info` |

### read-node

| Variable | Value |
|---|---|
| `CONTRA_PORT` | `8901` |
| `CONTRA_ACCOUNTSDB_CONNECTION_URL` | `postgres://user:pass@host:port/contra` |
| `CONTRA_ENABLE_WRITE` | `false` |
| `CONTRA_ENABLE_READ` | `true` |
| `CONTRA_MODE` | `read` |
| `CONTRA_MAX_CONNECTIONS` | `100000` |
| `CONTRA_LOG_LEVEL` | `info` |
| `CONTRA_JSON_LOGS` | `true` |
| `RUST_LOG` | `info` |

> Both nodes share the same Postgres database. Without streaming replication (which a single Railway PG instance doesn't provide), the read node doesn't have replication-level isolation. This is fine for initial deployment.

### gateway

| Variable | Value |
|---|---|
| `GATEWAY_PORT` | `8899` |
| `GATEWAY_WRITE_URL` | `http://${{write-node.RAILWAY_PRIVATE_DOMAIN}}:8900` |
| `GATEWAY_READ_URL` | `http://${{read-node.RAILWAY_PRIVATE_DOMAIN}}:8901` |
| `RUST_LOG` | `info` |

### indexer-solana

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:port/indexer` |
| `COMMON_RPC_URL` | Solana RPC endpoint |
| `COMMON_ESCROW_INSTANCE_ID` | Escrow instance pubkey |
| `INDEXER_YELLOWSTONE_ENDPOINT` | Yellowstone gRPC endpoint |
| `INDEXER_YELLOWSTONE_TOKEN` | Yellowstone auth token |
| `RUST_LOG` | `info,contra_indexer=debug` |

### indexer-contra

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:port/indexer` |
| `COMMON_RPC_URL` | `http://${{gateway.RAILWAY_PRIVATE_DOMAIN}}:8899` |
| `RUST_LOG` | `info,contra_indexer=debug` |

### operator-solana

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:port/indexer` |
| `COMMON_RPC_URL` | Solana RPC endpoint |
| `COMMON_ESCROW_INSTANCE_ID` | Escrow instance pubkey |
| `ADMIN_SIGNER` | `memory` (or `vault` / `turnkey` / `privy`) |
| `ADMIN_PRIVATE_KEY` | Admin private key (base58) |
| `RUST_LOG` | `info,contra_indexer=debug` |

### operator-contra

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:port/indexer` |
| `COMMON_RPC_URL` | `http://${{gateway.RAILWAY_PRIVATE_DOMAIN}}:8899` |
| `ADMIN_SIGNER` | `memory` (or `vault` / `turnkey` / `privy`) |
| `ADMIN_PRIVATE_KEY` | Admin private key (base58) |
| `RUST_LOG` | `info,contra_indexer=debug` |

## Config Override System

The indexer/operator services use [Figment](https://github.com/SergioBenitez/Figment) for configuration. TOML config files provide structural defaults; environment variables override specific values:

| Env Prefix | Overrides |
|---|---|
| `COMMON_*` | `[common]` section (e.g., `COMMON_RPC_URL` overrides `common.rpc_url`) |
| `STORAGE_*` | `[storage]` section |
| `INDEXER_*` | `[indexer]` section (with nested handling for `YELLOWSTONE_*`, `RPC_POLLING_*`, `BACKFILL_*`) |
| `OPERATOR_*` | `[operator]` section |

`DATABASE_URL` and `INDEXER_YELLOWSTONE_TOKEN` are read directly from the environment, not through Figment.

## Deploying

Since the GitHub App integration may not see the repo, deploy each service with the CLI:

```bash
# Link to a service and push
railway service write-node && railway up
railway service read-node && railway up
railway service gateway && railway up
railway service indexer-solana && railway up
railway service indexer-contra && railway up
railway service operator-solana && railway up
railway service operator-contra && railway up
```

All services build from the same Dockerfile. After the first build, Railway caches Docker layers so subsequent deploys are faster.

## Networking

Services communicate over Railway's private network using `<service-name>.railway.internal`. Use Railway's `${{service.RAILWAY_PRIVATE_DOMAIN}}` variable references in the dashboard.

Only the **gateway** needs a public domain. Add one via **Settings > Networking > Generate Domain** in the Railway dashboard. All other services stay internal-only.

## Extracting a Private Key

To convert a Solana keypair JSON file to a base58-encoded private key for use as `ADMIN_PRIVATE_KEY`:

```bash
node -e "
const kp = require('./keypairs/admin.json');
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let bytes = Buffer.from(kp);
let n = BigInt('0x' + bytes.toString('hex'));
let result = '';
while (n > 0n) { const r = n % 58n; n = n / 58n; result = ALPHABET[Number(r)] + result; }
console.log(result);
"
```

## Files Added for Railway

| File | Purpose |
|---|---|
| `railway.toml` | Tells Railway to use the Dockerfile for builds |
| `indexer/config/railway/indexer-solana.toml` | Yellowstone indexer config (escrow program) |
| `indexer/config/railway/indexer-contra.toml` | RPC polling indexer config (withdraw program) |
| `indexer/config/railway/operator-solana.toml` | Operator config (escrow program) |
| `indexer/config/railway/operator-contra.toml` | Operator config (withdraw program) |

## Dockerfile Changes for Railway

- **Removed** `VOLUME` directive (Railway bans it; use Railway volumes instead)
- **Added** `COPY indexer/config /etc/contra/config` to include config files in the runtime image
- **Added** `RUN cp -f target/deploy/contra_withdraw_program.so core/precompiles/contra_withdraw_program.so` to resolve the symlink during Docker build (the source `core/precompiles/contra_withdraw_program.so` is a symlink to `../../target/deploy/` which only exists after the program is built in the builder stage)
