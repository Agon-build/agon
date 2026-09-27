# AGON product boundary

Verified against the repository README, `frontend/src`, `backend/src/agon`,
the deployment receipt, and live read-only API responses on 2026-09-24.

## Product

AGON is an Arc-native marketplace that aggregates agent services. People and
agents use it to find a service for a job they need done once, compare the
providers that can do it, and pay only for that use.

The problem it solves: most AI services are sold as subscriptions, while many
needs are one-off. x402 makes per-call USDC payment practical, and ERC-8183
jobs make escrowed work practical on Arc. AGON is the place that knows which
services exist across marketplaces, which one fits a request, and how to pay it
safely.

AGON keeps these concepts separate:

| Concept | Meaning |
| --- | --- |
| Source | Where a catalog record came from: AGON registry, Circle Agent Marketplace, or an Arc ERC-8004 agent |
| Identity | External ERC-8004 agent identity and current owner |
| Listing | AGON service record: stable key, category, price, endpoint, version |
| Manifest | Canonical machine-readable description of one listing version |
| Intent | A buyer's request as structured terms: outcome, inputs, budget, speed, payment mode |
| Route | The ranked shortlist for an intent, with the reason for each rank |
| Authority | Who may act, with scope, expiry, allowlist, and spend cap |
| Evidence | Endpoint checks, Playground runs, Arena results, delivery receipts |
| Payment | x402 per call from the buyer's wallet, or a separately modelled escrow job |
| Trust state | Provider listed, verified, quarantined, stale, mismatched, or unavailable |

## Current implementation (2026-09-24)

- Public web market and service detail (Next.js App Router in `frontend/`).
- Arc Testnet registry and Arena: `AgonServiceRegistryV2` and `AgonArenaV2`
  with version-scoped verification. The market is empty until providers
  publish on V2.
- AGON MCP at `/agon/mcp` with public search and detail, hire preview and
  authorization, and a provider listing flow that stops at the provider's
  own wallet signature.
- Playground public sample, automatic certification of listed versions, and
  an Arena review path.
- The `agon-asp` CLI and skill for manifest and listing operations.
- Legacy ArcRun routes and contracts kept for history only.

Not built yet: aggregation of external sources, intent parsing and routing,
routed hiring of external services, escrow hiring, and sponsored Arena seasons.
Treat them as planned, never as live.

## Product principles

1. MCP is the primary interface; the web market is public discovery and the
   human fallback.
2. Discovery is public. Sign-in happens at the action that needs it.
3. Per-call payments are non-custodial: the buyer's wallet pays the provider.
4. Every result shows its source and network.
5. Listed, tested, verified, available, paid, and delivered are different
   states.

## Naming

Use `AGON`, `AGON Market`, `AGON MCP`, `AGON Playground`, and `AGON Arena`. Do
not use ArcRun in new AGON-facing names. Mention ArcRun only when documenting
the legacy boundary.

The public README is the product boundary. Internal plans, research, evidence,
and operator notes stay local; never copy them into a public skill, README,
package, or archive.
