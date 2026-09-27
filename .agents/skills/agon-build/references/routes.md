# Agon route boundary

Verified from the current `frontend/src/app` tree on 2026-09-24. Re-check this
inventory when a route is added or moved.

## Public Agon discovery

These routes should remain readable without a wallet or SIWE session:

| Route | Purpose |
| --- | --- |
| `/` | Agon landing and first action |
| `/market` | Search and compare services |
| `/market/[id]` | Service detail, evidence, authority, and action entry |
| `/market/compare` | Side-by-side comparison of chosen services |
| `/market/new` | The MCP listing guide (explains listing; publishing happens in MCP) |
| `/agon/playground` | Public Playground entry and safe testing context |
| `/docs` and `/docs/*` | Product, protocol, and build documentation |
| `/.well-known/agon/*` | Machine-readable public discovery documents |
| `/operators/[address]` | Public operator and provider record |
| `/login` | Explicit sign-in entry, not a discovery requirement |
| `/support` | Customer support chat |

`AgonAccessGate` currently treats landing, public market, docs, Playground,
operators, protocol documents, and admin entry as public. Preserve that intent.
Admin has its own token gate and is not normal buyer discovery.

## Protected Agon actions

These surfaces can require authentication or an owner wallet because they
change state or prepare a state-changing operation:

- `/market/version` for listing version publication and confirmation;
- `/market/activity` and `/market/provider` for a signed-in buyer's or
  provider's own records;
- protected actions embedded in service detail and Playground;
- `/cli/authorize` when approving a coding-agent device;
- protocol inspection writes or administrative actions, if enabled later.

The exact gate belongs at the action. A signed-out buyer must not be bounced
away from the service record just because the page contains a hire button.

## ArcRun legacy surfaces

The following routes are legacy ArcRun arena or account surfaces and currently
use Arc-only modules, copy, contracts, or auth assumptions:

`/app`, `/workshop`, `/wallet`, `/dashboard`, `/start`, `/onboarding/[step]`,
`/contests`, `/contests/[id]`, `/challenges`, `/challenges/[id]`, `/missions`,
`/missions/[id]`, `/live`, `/live/[source]/[id]`, `/leaderboard`, `/syndicates`,
`/syndicates/[id]`, `/bridge`, and `/admin`.

Do not fold these routes into AGON discovery by swapping a label or importing
the AGON network descriptor. Either keep them behind the legacy boundary,
migrate one route with a written product decision and a complete adapter, or
remove the route.

## Route implementation rules

- A route's data client must match its active network context.
- A route that shows records from several sources must read network details
  from the record's source and network, not from `frontend/src/lib/arc.ts`.
- Explorer links, chain labels, contract addresses, payment assets, and error
  copy must come from the same context object.
- Network changes must use durable URL state or another explicit source of
  truth and clear stale prepared state.
- Every route needs loading, empty, error, unavailable, and degraded states.
- Route tests must assert that a mainnet record is never shown or paid as a
  testnet record, and that AGON contract addresses match the deployment
  receipt.
