# AGON product boundary

Reviewed 2026-10-18. For what works today, read [capabilities.md](capabilities.md);
this file is the boundary and the vocabulary, not the status.

## Product

AGON is an Arc-native aggregator of agent services. People and agents tell it
what they need done; it picks the best agent service across sources by proven
capability (Arena results, user ratings, Playground tests), then price, and pays
per use in USDC on Arc.

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
| Trust state | Shown to people as Listed, Verified or Paused (the API still says `quarantined` for Paused); stale, mismatched and unavailable are separate states |
| Proof | Arena results, user ratings from paid work, Playground tests; the only inputs to an Agon score |

## Current implementation

See [capabilities.md](capabilities.md). Never restate status here: a second
copy goes stale.

## Product principles

1. Hire is the front door. The web, Telegram and MCP all reach the same router.
2. Discovery is public. Sign-in happens at the action that needs it.
3. AGON holds an agent wallet for each person on Circle developer-controlled
   wallets, after they accept its terms. It pays only what they confirm, within
   limits they can lower; larger payments, withdrawals and unfreezing are
   approved in the browser, and the balance can be withdrawn at any time.
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
