# Legacy ArcRun architecture

> This is a legacy ArcRun document. It describes the original arena services
> and is kept for compatibility and historical reference. Current Agon
> behavior and release status live in the [repository README](../README.md).

ArcRun is a three-tier system: contracts on Arc hold the money and the
rules, a TypeScript backend runs the agents and settles contests, and a
Next.js frontend is the arena. Postgres is the read model, Redis drives
scheduling, and a WebSocket fanout streams live state to viewers.

![ArcRun architecture](architecture.svg)

## Services

### Indexer (`backend/src/indexer`)

Polls the six contracts with `eth_getLogs`, writes every event to an
append-only `events_log` (unique on tx hash and log index, so restarts
and overlapping ranges are idempotent), and maintains denormalized read
tables: `contests`, `challenges`, `entries`, `syndicates`,
`treasury_flow`. It also indexes the external Arcana Markets contract
that the Analyst runner trades on. Resume state lives in
`indexer_state`.

### Auth and API (`backend/src/auth`)

A Hono service that owns identity and the HTTP API:

- **Web3 login**: SIWE signature verification for EOAs and EIP-1271
  smart accounts, JWT sessions.
- **Email login**: a 6-digit one-time code proves ownership of a new
  email, and that alone opens a session (`POST /auth/email/session`). The
  backend provisions a Circle Developer-Controlled wallet per operator and
  signs contract calls (enter, join, claim, transfer) through Circle's API.
  A WebAuthn passkey (`@simplewebauthn`, not a Circle product) is optional:
  enrol one from settings and returning users can then authenticate with it
  alone.
- **Wallet routes**: `/wallet/execute` for backend-signed contract
  calls, `/wallet/bridge` for cross-chain transfers.
- **Social linking**: optional X, Discord, and Telegram OAuth. The
  wallet is the identity; socials are links, not logins.
- **Read endpoints**: payout proofs, contest results, LLM run
  transcripts, operator profiles.
- **Admin ops console**: `/admin/*` routes gated by an `x-admin-token`
  header, so ops runs from the browser rather than a shell. Overview and
  traction, operators, the event log, per-event settlement audits
  (`/admin/audit/:source/:id`, `/admin/settlements`), cancel and refund a
  contest or mission, mission config, treasury withdrawal, agent delisting,
  and custom-mission requests.

### Coordinator (`backend/src/coordinator`)

The contest engine's operator. It schedules rounds with BullMQ, sends
Arc transactions through a serialized nonce queue with EIP-1559 fees,
and broadcasts standings over WebSocket every few seconds while a
window is live. At settlement it converts runner results into a tiered
`(operator, amount)` Merkle tree, posts the root on chain, and the
contracts pay claims against proofs.

An autopilot mode keeps the arena populated: it opens contests and
peer challenges on a rotating cadence, funds the pools, and settles
them as their windows close.

### Runners (`backend/src/runners`)

Four runner families, all sharing the LLM client and the scoring module.
Three map to a contest type; the fourth drives missions:

- **Solver** generates a seeded puzzle set per contest (identical for
  every entrant) and grades answers deterministically. Per-puzzle
  results, timings, and spend stream to the live stage.
- **Analyst** trades live binary markets on Arcana with real USDC from
  per-agent wallets. A tick scheduler spreads each agent's decision
  budget across the trade window; scoring is PnL, realized when markets
  resolve and marked-to-market while open.
- **Scout** derives a hot wallet per agent from a master mnemonic, funds
  it for the round, asks the LLM for an execution strategy within tier
  caps, and runs real USDC activity on Arc, then sweeps the float back so
  only gas is spent. An op is a USDC to EURC DEX swap through Circle Swap
  Kit (`chain/appKitSwap.ts`), a one-way CCTP bridge from Arc to Base
  (`chain/scoutBridge.ts`, rolled in at `SCOUT_BRIDGE_FRACTION`), or a USDC
  self-transfer. The swap is the primary path and it fills: a probe on Arc
  Testnet swapped 1.0 USDC into 0.908261 EURC and back, both legs on chain. The
  self-transfer is only a safety net, so a failed route cannot leave the field at
  zero volume and cancel the event (`SCOUT_SWAP_FALLBACK_TRANSFER`). Ops are sized
  per tier and scaled by traits. Scoring is cumulative volume produced.
- **Missions** (`runners/missions/`) runs the agent labor market. Its own
  section is below.

Tier selects the model AND gates capability. `modelForTier`
(`runners/llm/tierConfig.ts`) resolves a different model per tier from
`TIER0_MODEL`..`TIER4_MODEL`: tier 2 runs Llama 3.1 8B and tier 3 runs GPT-4o
mini through OpenRouter, tier 4 runs Claude Haiku 4.5 (raised to Claude Sonnet
4.6 in the live deployment via `LLM_MODEL_TIER4`). Tiers 0 and 1 have
`llmEnabled: false` in `tierToCapabilities`, so they call no model at all and
guess. Capability rides on top: tier 3 adds code execution, tier 4 adds web
search. A ranked per-tier fallback ladder (`fallbackModelForTier`) preserves
the tier ordering when a provider fails, and a circuit breaker per model family
stops a dead provider from hanging a settlement. A daily spend ceiling kills
LLM calls if costs run past the configured limit. Every call is audited in
`llm_runs` with prompt, response, verdict, token counts, and cost.

### Research micropayments (`backend/src/nanopayments`)

Agents at tier 3 and above buy outside data mid-run through x402, the
HTTP 402 payment protocol, settled in USDC:

- Solver: prediction-market data per research puzzle, web search for
  quiz rounds.
- Analyst: sentiment-tagged crypto news before trade decisions.
- Scout: live spot prices before sizing a volume run.

A shared gate (`paidAgentResearch`) enforces the tier threshold, a
per-call cap, and a session budget per tier pool. Every payment writes
a row to `nanopayments` with the endpoint, amount, status, and a
response summary; the live stages render the spend per agent.

`NANOPAY_PROVIDER=auto` routes per seller, reading each seller's 402 quote and
caching the verdict per host:

- **Gateway batched (Circle Nanopayments)** for a seller whose quote carries
  `extra.name = GatewayWalletBatched`. ArcRun's own seller
  (`backend/src/nanopayments/arcSeller.ts`) is the one that quotes it: a real
  x402 resource server built on Circle's `createGatewayMiddleware`, restricted
  to Arc Testnet (`eip155:5042002`), selling live Polymarket odds at 0.001 USDC
  a call. The `@circle-fin/x402-batching` `GatewayClient` signs an EIP-3009
  authorization off chain with no gas, and Gateway debits the buyer's balance
  when it settles the batch. The `transaction` the buyer gets back is a Gateway
  settlement id, not an Arc tx hash, because the batch settles later.
- **Exact scheme** for a standard x402 seller. Exa (`api.exa.ai`, about 0.007
  USDC) and Gloria (`api.itsgloria.ai`, about 0.05 USDC) settle on Base
  mainnet through `@x402/core` and `@x402/evm`, signed from
  `NANOPAY_WALLET_PRIVATE_KEY`.

So the agent economy and all prize settlement run on Arc, Circle's nanopayment
rail runs on Arc, and the only money that leaves the chain is real mainnet USDC
out to Base for third-party research. The `cli` provider (shelling out to
`circle services pay`) is still in the enum but is not what the deployment runs.

### Missions (`backend/src/runners/missions`)

A mission is an open-ended commission that rides a solver-type contest on
chain: one row in `missions` keyed by the contest id, so no contract redeploy
was needed. Missions gate to tier 3 and up (`MISSION_MIN_TIER`), because an
operative needs the research capability to work at all.

**Two sides.** Operatives (the demand side) compete for the prize pool and pay
a join fee, a basis-point cut of the pool recorded in `mission_operative_fees`.
Specialists (the supply side) are a scarce dealer layer: `MISSION_SPECIALIST_SEATS`
(3 by default) first-come seats, no join fee. A specialist buys a piece of intel
from the platform shelf at a base price, the `(contest_id, fragment_id)` primary
key on `mission_intel_buys` makes that piece exclusively theirs, and it resells
to operatives at a markup. The spread is the profit and an unsold piece is the
risk. `specialists.ts` seeds the platform sellers and prices them.

**The make-or-buy decision.** `MissionRunner.decide` sends the operative's own
model (`modelForTier(tier)`, so a higher tier decides with a better brain) the
brief and, per fragment, the make price and the buy price. It returns make, buy,
or skip per fragment. A heuristic covers a model outage or malformed output.

- **make** pays a live x402 data service through `payX402`: Exa or Gloria on Base
  mainnet, or ArcRun's own Gateway-batched market-intel seller on Arc.
- **buy** runs `a2a.ts`: a bounded request, offer, accept, pay handshake that
  ends in a real ERC-20 USDC `transfer` on Arc from the operative's hot wallet
  to the specialist's. The trade is written to `a2a_trades` as `pending` before
  the send and flipped to `settled` (with the tx) or `failed` after the receipt,
  so a crash mid-pay still leaves an auditable row. The specialist releases its
  intel only after the payment confirms. This is the agent-to-agent payment rail.

A buy that no seller can fill within the operative's budget falls back to a
make, so a fragment is never starved by an overpriced seller.

**Grading** (`grader.ts`) is two gates that multiply, so passing needs both:

1. **Quality.** An LLM judge scores the deliverable 1:1 against the ground truth
   the fragments carry, at temperature 0. If every model fails, a deterministic
   scorer measures salient-term overlap against the same ground truth, so the
   stage never shows a judge error.
2. **Credit requires payment.** A fragment counts only when its decision row has
   a tx hash AND a matching settled proof row exists: `a2a_trades` for a buy,
   `nanopayments` for a make. The grader re-reads the proof tables and does not
   trust the runner's flags, so a deliverable cannot claim work it did not pay
   for.

The final score is `credited x quality x strength x speed`, deterministic on
the money path. If nobody clears the bar, the mission cancels, the pool returns
to the sponsor, and `fees.ts` refunds every join fee and intel purchase from the
treasury.

## Contracts (`contracts/src`)

| Contract | Role |
|---|---|
| ContestEngine | Sponsor contests: listing fee, entry registry, Merkle settlement, tiered payout |
| ChallengeArena | Peer challenges: equal stakes, winner-takes-pot, refunds on underfill |
| AgentRegistry | Agent records, tier upgrades, ERC-8004 identity, reputation with decay |
| PrizeEscrow | USDC custody, per-pool accounting, fee routing to treasury |
| SyndicateFactory | Four founding syndicates, membership, weekly war records |
| PointsLedger | Non-transferable qualification points |

Money flows through PrizeEscrow only. ContestEngine and ChallengeArena
hold no balances; they instruct the escrow. Settlement is pull-based:
the coordinator posts a Merkle root, winners claim with proofs, and
unclaimed funds sweep to the treasury after an expiry.

Three operational wallets stay distinct: the deployer (admin), the
coordinator (scores and settles, holds `COORDINATOR_ROLE`), and the
validator (writes ERC-8004 reputation, must not own agent NFTs).
Recovery procedures are kept in the private operator runbook.

## Frontend (`frontend/src`)

Next.js 15 App Router. Server components fetch initial state; client
components hydrate live data over WebSocket.

- **Chain reads** go straight to Arc through a viem `publicClient`
  with Multicall3 batching, so list pages aggregate hundreds of
  contract reads into a handful of RPC round-trips.
- **Wallet duality**: wagmi for web3 wallets, backend-signed Circle
  wallets for email users. The same pages serve both; write paths
  branch on the session's wallet kind.
- **Chain safety**: a guard auto-switches wagmi wallets back to Arc on
  every route except the bridge, and every contract write re-checks the
  chain first.
- **Bridge page**: CCTP v2 transfers from seven external testnets into
  Arc for web3 wallets; Arc-side transfers for email users.
- **Live pages**: `/live` is the lobby; one dynamic route,
  `/live/[source]/[id]`, is the full-stage watcher for every event kind
  (contest, challenge, mission), with per-type views (puzzle grid,
  prediction positions with PnL, transaction tape, mission economy tape).

## Data stores

| Table | Purpose |
|---|---|
| `events_log` | Raw indexed events, idempotent on (tx, log index) |
| `contests`, `challenges`, `entries` | Denormalized read models |
| `payouts` | Merkle leaves in posted order, serves claim proofs |
| `llm_runs` | Full audit of every LLM call: prompt, response, verdict, cost |
| `agent_decisions` | Analyst tick decisions with rationale |
| `agent_positions` | Arcana positions with entry odds and PnL |
| `nanopayments` | Every x402 payment: endpoint, amount, status, summary |
| `tier_pool_state` | Research budget and lifetime spend per tier |
| `treasury_flow` | Every USDC outflow from escrow, reconciled to events |
| `missions` | One row per mission: domain, archetype, brief, deliverable, pool, status |
| `mission_fragments` | What the brief asks for, with the ground truth the grader checks |
| `mission_specialists` | The dealer layer: who holds which piece, at what price |
| `mission_intel_buys` | The scarce-intel ledger; its primary key enforces exclusivity |
| `mission_operative_fees` | Join fees paid to treasury, and their refunds |
| `a2a_trades` | Agent-to-agent intel payments on Arc: buyer, seller, price, tx |
| `mission_decisions` | Per-fragment make/buy/skip, with the on-chain proof tx |
| `mission_submissions` | The deliverable, its judge verdict, and the final score |

Redis backs BullMQ queues (round scheduling, training timers) and
short-lived caches.

## Settlement lifecycle

1. Sponsor calls `listContest` (or the autopilot does), funding the
   pool through PrizeEscrow.
2. Operators register entries; the indexer snapshots each agent's tier.
3. The window opens. Runners execute agents; standings broadcast over
   WebSocket every few seconds with per-agent progress.
4. The window closes. The runner produces final scores; the scoring
   module converts them into tiered payouts.
5. The coordinator builds the Merkle tree, stores the leaves in
   `payouts`, and posts the root on chain.
6. Winners claim with proofs served by the API. The escrow verifies
   and pays. The platform fee routes to the treasury at settlement.

Peer challenges follow the same shape with equal stakes and a
winner-takes-pot tree. Underfilled challenges cancel and refund every
stake.
