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
| `admin-ui` | Vite/React | Web UI for managing escrow instances, operators, mints, balances, and withdrawals |

Services **not** deployed to Railway:
- **PostgreSQL** -- use a Railway-managed Postgres instance instead
- **Solana Validator** -- connect to mainnet/devnet RPC
- **Activity Generator** -- load testing tool, not for production
- **Prometheus/Grafana/cAdvisor** -- monitoring stack, add later if needed

## Prerequisites

- [Railway CLI](https://docs.railway.com/guides/cli) installed and authenticated (`railway login`)
- A Railway project linked to this repo (`railway link`)
- A Railway PostgreSQL instance in the project
- `shank-cli` installed (`cargo install shank-cli@0.4.5`) -- ensure `~/.cargo/bin` is in your PATH for non-interactive shells (add `export PATH="$HOME/.cargo/bin:$PATH"` to `~/.zshenv` on macOS if `make generate-clients` fails with `shank: command not found`)
- Generated clients and built programs:
  ```bash
  make install              # Install pnpm dependencies for both programs
  make generate-clients     # Generate IDL + Rust/JS clients from Shank annotations
  make -C contra-escrow-program build
  make -C contra-withdraw-program build
  ```
  The repo contains symlinks (`core/precompiles/contra_withdraw_program.so`, `test_utils/programs/*.so`) that point to `target/deploy/`. These must resolve or `railway up` will fail during upload.
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
railway add --service admin-ui
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

The `admin-ui` service uses a separate Dockerfile (`admin-ui/Dockerfile`) and must be configured in the Railway dashboard:
- **Settings > Build > Dockerfile Path**: `admin-ui/Dockerfile`
- **Settings > Build > Docker Build Context**: `/` (repo root, needed so the generated TypeScript clients can be copied)
- No custom start command needed -- the Dockerfile handles it.

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

### admin-ui

The admin UI is a static React/Vite app. It connects to Solana RPC directly (via wallet) and to the Contra gateway for L2 operations.

| Variable | Value |
|---|---|
| `CONTRA_RPC_URL` | Gateway public URL (e.g., `https://gateway-production-xxxx.up.railway.app`) |
| `PORT` | `3000` |

`CONTRA_RPC_URL` is baked into the static build at build time via `vite.config.ts`. You must set it **before** deploying so it's embedded in the JS bundle. If you change the gateway URL later, redeploy the admin-ui.

The admin-ui also needs a public domain (**Settings > Networking > Generate Domain**).

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
railway service admin-ui && railway up
```

All services build from the same Dockerfile. After the first build, Railway caches Docker layers so subsequent deploys are faster.

## Networking

Services communicate over Railway's private network using `<service-name>.railway.internal`. Use Railway's `${{service.RAILWAY_PRIVATE_DOMAIN}}` variable references in the dashboard.

The **gateway** and **admin-ui** need public domains. Add them via **Settings > Networking > Generate Domain** in the Railway dashboard. All other services stay internal-only.

## Post-Deploy: On-Chain Setup

After all services are deployed and running, the escrow system needs to be initialized on-chain before it can process deposits and withdrawals. These commands run **locally** against Solana devnet (not inside Railway). All scripts are in `scripts/devnet/`.

### Step 1: Create an Escrow Instance

This creates the on-chain escrow instance account that the system operates against.

```bash
cargo run --manifest-path scripts/devnet/Cargo.toml --bin create_instance -- \
  https://api.devnet.solana.com \
  ./keypairs/admin.json
```

This outputs an `escrow_instance_id` (a pubkey) and a transaction signature. **Save the instance ID** -- you'll need it for every subsequent step.

### Step 2: Add Operator

Authorize the admin keypair as an operator on the instance. This allows the operator services to process deposits and withdrawals.

```bash
cargo run --manifest-path scripts/devnet/Cargo.toml --bin add_operator -- \
  https://api.devnet.solana.com \
  ./keypairs/admin.json \
  <INSTANCE_ID> \
  <OPERATOR_PUBKEY>
```

`<OPERATOR_PUBKEY>` is the public key of the admin keypair:

```bash
solana-keygen pubkey ./keypairs/admin.json
```

### Step 3: Allow Mint

Whitelist the SPL token mint(s) the system will accept for deposits.

```bash
cargo run --manifest-path scripts/devnet/Cargo.toml --bin allow_mint -- \
  https://api.devnet.solana.com \
  ./keypairs/admin.json \
  <INSTANCE_ID> \
  <MINT_ADDRESS>
```

### Step 4: Update Railway Environment Variables

Now that you have the instance ID, set it on the services that need it. In the Railway dashboard or via CLI:

```bash
railway variable set COMMON_ESCROW_INSTANCE_ID=<INSTANCE_ID> --service indexer-solana
railway variable set COMMON_ESCROW_INSTANCE_ID=<INSTANCE_ID> --service operator-solana
```

Also set `CONTRA_ADMIN_KEYS` on the core nodes to the operator pubkey:

```bash
railway variable set CONTRA_ADMIN_KEYS=<OPERATOR_PUBKEY> --service write-node
railway variable set CONTRA_ADMIN_KEYS=<OPERATOR_PUBKEY> --service read-node
```

Setting variables triggers a redeploy automatically (unless `--skip-deploys` is used).

### Step 5: Generate a Gateway Domain

In the Railway dashboard, go to the **gateway** service > **Settings > Networking > Generate Domain**. This gives you a public URL like `gateway-production-xxxx.up.railway.app`.

This is your Contra RPC endpoint. Use it in place of `http://localhost:8899` for withdrawals and any client interactions.

### Step 6: Verify

Test a deposit (runs on Solana devnet, depositing tokens into the escrow):

```bash
cargo run --manifest-path scripts/devnet/Cargo.toml --bin deposit -- \
  https://api.devnet.solana.com \
  ./keypairs/user.json \
  <INSTANCE_ID> \
  <MINT_ADDRESS> \
  <AMOUNT>
```

Test a withdrawal (runs against your Railway gateway, withdrawing from Contra back to Solana):

```bash
cargo run --manifest-path scripts/devnet/Cargo.toml --bin withdraw -- \
  https://gateway-production-xxxx.up.railway.app \
  ./keypairs/user.json \
  <MINT_ADDRESS> \
  <AMOUNT>
```

Monitor processing via Railway logs:

```bash
railway logs --service operator-solana
railway logs --service operator-contra
```

### Setup Summary

| Step | What | Where |
|---|---|---|
| 1. Create instance | `create_instance` binary | Local, against Solana devnet |
| 2. Add operator | `add_operator` binary | Local, against Solana devnet |
| 3. Allow mint | `allow_mint` binary | Local, against Solana devnet |
| 4. Set instance ID | `COMMON_ESCROW_INSTANCE_ID` env var | Railway dashboard/CLI |
| 5. Set admin keys | `CONTRA_ADMIN_KEYS` env var | Railway dashboard/CLI |
| 6. Generate domain | Gateway public URL | Railway dashboard |
| 7. Test deposit | `deposit` binary | Local, against Solana devnet |
| 8. Test withdrawal | `withdraw` binary | Local, against Railway gateway |

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
| `admin-ui/Dockerfile` | Separate Dockerfile for the React/Vite admin UI |

## Dockerfile Changes for Railway

- **Removed** `VOLUME` directive (Railway bans it; use Railway volumes instead)
- **Added** `COPY indexer/config /etc/contra/config` to include config files in the runtime image
- **Added** `RUN cp -f target/deploy/contra_withdraw_program.so core/precompiles/contra_withdraw_program.so` to resolve the symlink during Docker build (the source `core/precompiles/contra_withdraw_program.so` is a symlink to `../../target/deploy/` which only exists after the program is built in the builder stage)
