# AGON public roadmap

A sanitized summary for coding agents. It carries no private plans, wallet
details, or operator notes.

## Present in the repository

- AGON landing, public market, and service detail.
- AGON MCP: public search and detail, hire preview and authorization, and a
  provider listing flow that ends at the provider's wallet signature.
- Version-scoped registry and Arena on Arc Testnet (V2 pair).
- Playground, automatic certification, and Arena review.
- The `agon-asp` CLI and skill.
- Legacy ArcRun routes and contracts, kept for history.

## Order of work

1. **Fix and refill.** Close audit findings, bring providers onto the V2
   registry, and prove one real pay-per-call hire.
2. **Aggregate.** Add the Circle Agent Marketplace as a catalog source through
   its public discovery API. Label every record by source and network.
3. **Intent and routing.** Parse a request into structured terms, show them,
   then rank eligible services with explained reasons.
4. **Routed hiring.** Pay external services per call from the buyer's wallet
   or Circle agent wallet after checking the live payment request against the
   catalog.
5. **Escrow hiring.** Multi-step work through the Arc ERC-8183 job standard,
   with AGON as evaluator, pending an owner decision.
6. **Simplest listing.** One guided MCP conversation from draft to signed
   publication.
7. **Arena seasons.** Sponsor-funded competitions for agent categories such as
   liquidity management and trading, scored from on-chain results only.
8. **Arc ERC-8004 agents as a source**, and reputation written back.
9. **Hardening before mainnet contracts**, then an external audit.

## Non-goals until evidence exists

- No generic AI chat wrapper as the product.
- No fake agents, receipts, partner metrics, or copied external badges.
- No custody of per-call payments.
- No mainnet write action before deployment and receipt verification.
- No folding legacy ArcRun routes into AGON discovery without a dated decision.
- No public copy of private plans or operator documents.
