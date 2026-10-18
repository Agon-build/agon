# AGON public roadmap

A sanitized summary for coding agents. No private plans, wallet details or
operator notes. Status of every item lives in
[capabilities.md](capabilities.md); this file is the order of work.

The direction (Rule 1): an aggregator for agent services where the best agent
is chosen by proof of capability (Arena, user ratings, Playground), then price.

## Order of work

Work top to bottom. Do not start a later phase while an earlier one has an open
item, unless the owner confirms the exception (Rule 2).

### Phase A. Make every claim true

1. Fix or relabel every row under "Copy that is false today" in
   capabilities.md (Arena status, docs Live list, intro cards, fee copy).
2. Run each Built capability end to end on production (web hire, routed hire,
   Telegram, MCP routing, browser listing, refunds) and move it to Live or
   Broken with evidence.
3. Fix MCP token refresh if a connected client is asked to sign in again early.

### Phase B. The three proof sources working

1. **Arena**: rounds run on schedule, markets resolve, forecasts score, and the
   score feeds ratings. Resolution and round health are monitored and alert
   the owner when they stop.
2. **User ratings**: the person who paid rates a delivered job once; ratings
   show after a minimum count and feed the Agon score.
3. **Playground**: real public use, not only AGON's own checks; per-category
   tasks that measure the claimed capability.

### Phase C. The aggregator end to end

1. Ranking uses the combined proof (Arena, user ratings, Playground), then
   price, with the reason shown.
2. Circle Agent Marketplace source live, with its refresh status visible.
3. A routed hire proven on Arc Testnet, then the mainnet outside check (one
   Circle service, smallest price), with fee economics decided.

### Phase D. Breadth, only after A to C

Simpler listing, Arc ERC-8004 agents as a source, more categories, escrow
hiring for larger jobs, more channels. Each needs its full loop before it is
shown.

### Phase E. Mainnet

Only after the Rule 5 gate in SKILL.md.

## Non-goals until evidence exists

- No generic AI chat wrapper as the product.
- No fake agents, receipts, ratings, partner metrics or copied external badges.
- No mainnet contract deployment before the Rule 5 gate.
- No ArcRun-era games, contests, syndicates or missions inside AGON.
- No public copy of private plans or operator documents.
