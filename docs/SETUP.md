# Legacy ArcRun setup

> This is a legacy ArcRun document. It describes the original setup and is
> kept for compatibility and historical reference. See the [repository README](../README.md)
> for the current AGON product and release status.

How to build and run ArcRun. The six contracts are already deployed and
verified on Arc Testnet, so nothing here has to be deployed to inspect the
system. Addresses are in
[../contracts/deployments/arc-testnet.json](../contracts/deployments/arc-testnet.json).

## 1. What you need

| Thing | Version | Where it is pinned |
|-------|---------|--------------------|
| Node | 22 or newer | `backend/package.json` and `frontend/package.json` (`engines.node: ">=22"`), both Dockerfiles (`node:22-slim`) |
| Postgres | 16 | `deploy/docker-compose.yml`, `backend/docker-compose.local.yml` (`postgres:16-alpine`) |
| Redis | 7 | same two compose files (`redis:7-alpine`) |
| Foundry | any recent `forge` | `contracts/foundry.toml`, solc pinned to `0.8.24` |

Docker is optional for local work and is how production runs.

## 2. Repo layout

```
contracts/      Foundry. Six Solidity contracts, tests, one deploy script.
backend/        Three long-running Node services plus one-shot scripts.
  src/indexer/      Reads Arc logs into Postgres.
  src/auth/         Hono HTTP API (login, wallets, admin, x402 seller).
  src/coordinator/  Opens events, runs agents, scores, settles on chain.
frontend/       Next.js 15 app (App Router, wagmi, RainbowKit).
deploy/         Production docker-compose, Caddy, backup and restore scripts.
docs/           Architecture, missions spec, ops runbooks, this file.
```

The three backend services share one image and one codebase. They differ only
by the command they run.

## 3. Contracts

Six contracts: `ContestEngine`, `ChallengeArena`, `AgentRegistry`,
`PointsLedger`, `PrizeEscrow`, `SyndicateFactory`. Details in
[../contracts/README.md](../contracts/README.md).

```bash
cd contracts
git submodule update --init --recursive   # OpenZeppelin v5 and forge-std
forge build
forge test
```

Deploy is a single script,
[contracts/script/Deploy.s.sol](../contracts/script/Deploy.s.sol). It deploys
all six in dependency order and wires the roles. Only `PRIVATE_KEY` is
required; every other input falls back to an Arc Testnet default.

```bash
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.testnet.arc.network \
  --broadcast
```

You do not need to run it. The contracts are live on Arc Testnet
(chain 5042002), deployed 2026-06-11 at block 46548348, source verified on
[testnet.arcscan.app](https://testnet.arcscan.app):

| Contract | Address |
|----------|---------|
| PrizeEscrow | `0x9A81C86aA4E548EC322889cdE7E489fBEb0a215F` |
| AgentRegistry | `0x99306f3f4C1608915f07eDE24F5e6515F6eeE281` |
| ContestEngine | `0xCeFD67616fac0A4eeb244C7EDf6cc63E3962Afba` |
| ChallengeArena | `0xa3658A8001182bB0556B93193B00A1272F7D3322` |
| SyndicateFactory | `0x611E5b5ccECe86bB092Bd363F065abE0D3b739B3` |
| PointsLedger | `0xd1b822137391f40bc70c8BC1EF5690fD62Fe7AD5` |

External contracts the system reads and writes:

| Contract | Address |
|----------|---------|
| USDC (native gas token, ERC-20 interface) | `0x3600000000000000000000000000000000000000` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

The backend reads the deployments JSON at boot
(`backend/src/config/index.ts`, `loadDeployments`) and refuses to start if the
file's `chainId` does not match `CHAIN_ID` in the environment.

## 4. Backend

Copy the example env and fill it in.

```bash
cd backend
cp .env.example .env
npm install
```

`backend/.env.example` documents every variable, including which ones are
optional. The minimum to boot: `DATABASE_URL`, `REDIS_URL`, `ARC_RPC_HTTP`,
`ARC_RPC_WS`, `CHAIN_ID=5042002`, `START_BLOCK=46548348`.

Apply the schema. It is written with `if not exists`, so it is safe to run
repeatedly.

```bash
npm run migrate      # runs src/db/migrate.ts against src/db/schema.sql
```

Run the three services, each in its own shell:

```bash
npm run indexer      # src/indexer/index.ts
npm run auth         # src/auth/index.ts        (HTTP, AUTH_PORT, default 8082)
npm run coordinator  # src/coordinator/index.ts (WebSocket, WS_PORT, default 8788)
```

One-shot scripts that matter:

```bash
npm run circle:bootstrap   # once: registers the Circle entity secret, creates the wallet set
npm run swap:probe         # one real USDC -> EURC -> USDC swap on Arc via Circle Swap Kit
npm run nanopay:doctor     # checks the x402 payment path
npm run typecheck
```

Or bring the whole local stack up in Docker from the repo root. This starts
Postgres, Redis, the migration, the three services, and the frontend:

```bash
npm run stack:up      # docker compose -f backend/docker-compose.local.yml up --build -d
npm run release:check # verify safe defaults, Node 22 images, and port 3003 wiring
npm run stack:logs
npm run stack:down
```

The frontend is available at `http://localhost:3003`. The backend health
endpoint is `http://localhost:8082/health`; the local compose services wait for
the migration and expose health state for the auth and frontend containers.

## 5. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev     # http://localhost:3003 when using the Docker stack; direct Next dev defaults to 3000
```

Three variables, all public:

- `NEXT_PUBLIC_AUTH_URL`, the auth service (default `http://localhost:8082`)
- `NEXT_PUBLIC_WS_URL`, the coordinator's live feed (default `ws://localhost:8788`)
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, optional. Without it the injected and
  Coinbase wallet paths still work and only the WalletConnect QR option is
  disabled.

The frontend holds no Circle secrets. Circle Developer-Controlled credentials
remain on the backend. Circle User-Controlled sessions are browser-only and
are re-established after refresh; the backend receives only the short-lived
request needed to create and inspect an exact contract challenge.

Build and serve: `npm run build`, then `npm run start`. Production is on
Vercel (`frontend/vercel.json`).

## 6. Docker deploy

[deploy/docker-compose.yml](../deploy/docker-compose.yml) is the production
stack for a single VPS. The frontend is not in it; that is on Vercel.

Services:

- `postgres` (16-alpine) and `redis` (7-alpine), both on the internal Docker
  network with no host ports.
- `migrate`, a one-shot container that runs `npm run migrate` and exits. Every
  other service waits on `service_completed_successfully`.
- `indexer`, `auth`, `coordinator`, all three from the same `backend/Dockerfile`
  image, differing only by command.
- `caddy` (2-alpine), the only container with host ports (80, 443). It
  terminates TLS and reverse-proxies the api and ws subdomains. See
  `deploy/Caddyfile`.

The three backend services share a YAML anchor (`x-backend`), so they get the
same image, the same `env_file: .env`, and the same read-only mount of
`contracts/deployments` at `/app/contracts/deployments`. Memory and CPU limits
are set per service and are sized for a 2-core, 8GB host.

Secrets come from `deploy/.env`, which is gitignored. Copy
[deploy/.env.example](../deploy/.env.example), which is the fullest reference
for a production environment, including the Circle and x402 sections.

Deploy is one command over SSH, which is what the GitHub Actions job runs:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Backup and restore scripts are `deploy/backup.sh` and `deploy/restore.sh`.

## 7. What you need from Circle

Every Circle-backed feature is gated. If a key is missing, that feature turns
itself off and the rest of the system keeps running. The names below are the
real ones, read in `backend/src/config/index.ts` unless noted.

### Email login (Circle Developer-Controlled Wallets)

- `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID`
- `CIRCLE_BLOCKCHAIN` (defaults to `ARC-TESTNET`), `CIRCLE_AUTO_SEED_USDC`
  (defaults true, requests testnet USDC for each new wallet)

Get the API key from the Circle Console, then run `npm run circle:bootstrap`
once. It generates the entity secret, registers the ciphertext with Circle,
writes a recovery file into `backend/circle-recovery/`, and creates the wallet
set. Paste the entity secret and wallet set id back into `.env`.

Without these, `circleDevConfigured()` is false: `POST /wallet/execute` and
`POST /wallet/bridge` return 503, and email signup cannot provision a wallet.
Browser-wallet login (wagmi and RainbowKit) is unaffected, and every read path
still works.

### Scout real swaps (Circle Swap Kit)

- `SCOUT_REAL_SWAPS=1` and `CIRCLE_KIT_KEY` (format `KIT_KEY:<id>:<secret>`,
  from the Circle Console)
- Optional: `SCOUT_SWAP_TOKEN_IN`, `SCOUT_SWAP_TOKEN_OUT`,
  `SCOUT_SWAP_SLIPPAGE_BPS`

Without them, `swapEnabled()` in `backend/src/chain/appKitSwap.ts` returns
false, `executeSwap` returns null, and the Scout runner falls back to USDC
self-transfers (`SCOUT_SWAP_FALLBACK_TRANSFER`, on by default) so a race still
produces volume instead of cancelling. Verify a live route with
`npm run swap:probe`.

### Agent-to-service payments (Circle Gateway and x402)

- `NANOPAY_ENABLED=1`, `NANOPAY_PROVIDER=auto`, `NANOPAY_WALLET_PRIVATE_KEY`,
  `NANOPAY_GATEWAY_CHAIN=arcTestnet`
- Optional per-host keys for the no-payment fallback: `NANOPAY_API_KEYS`

The wallet needs two kinds of funding: a Circle Gateway deposit on Arc Testnet
(for the Gateway-batched seller), and plain USDC on Base mainnet (for the
exact-scheme sellers, Exa and Gloria). The Circle integration notes are kept
privately with the operators.

With `NANOPAY_ENABLED` unset or 0, `payX402` returns a `rejected` row with
`"nanopay disabled"` and no USDC moves. Missions still open, run, and settle;
the agents just cannot buy outside data on the MAKE path.

### ArcRun's own x402 seller

- `X402_SELLER_ENABLED=1`, `X402_SELLER_ADDRESS`, `X402_SELLER_PORT` (default
  8090), `X402_SELLER_PRICE` (default `$0.001`)

These are read straight from `process.env` in
`backend/src/nanopayments/arcSeller.ts`, not through the config module, and are
documented in `deploy/.env.example`. Left unset, `startArcX402Seller()` returns
silently and the auth service starts as normal.

### Bridging (CCTP v2 via Circle App Kit)

No Circle API key required. `@circle-fin/app-kit`'s `kit.bridge()` works with a
viem signer for browser wallets and Scout hot wallets. Only the backend bridge
for email users (`POST /wallet/bridge`) needs the Circle Wallets credentials
above, because it signs from a Circle custodial wallet.

### Not Circle, but required for the agents to think

- `OPENROUTER_API_KEY` drives the tier 0 to tier 3 reasoning models.
- `ANTHROPIC_API_KEY` drives tier 4 and the judge.

With neither set, the LLM runners no-op and the coordinator falls back to the
synthetic tier-curve simulation.
