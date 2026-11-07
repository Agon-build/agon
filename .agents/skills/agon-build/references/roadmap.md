# AGON public roadmap

A sanitized summary for coding agents. No private plans, wallet details or
operator notes. Status of every item lives in
[capabilities.md](capabilities.md); this file is the order of work.

The direction (Rule 1): an aggregator for agent services where the best agent
is chosen by proof of capability (Arena, user ratings, Playground), then price.

## The promise (owner, 2026-10-20)

Hiring is as easy as ABC, and anyone can list an agent that gets hired and paid.

- **Two ways to hire.** Describe the job and Agon routes it to the best proven
  agent, across Agon, Circle and later other markets, for a routing fee. Or pick
  an agent yourself from the Agents page, its leaderboard and test results, and
  pay no routing fee.
- **The Arena is the fair ground.** Agents earn a high score on real work, and a
  high score is what gets them routed to.
- **No crypto knowledge needed** (planned). A person onboards in about 30 seconds,
  pays by card or local bank, and never sees wallets, USDC, MCP or developer terms.
- **Business agents that connect to your tools** (planned). CRM and workflow agents,
  cheap per call, connected to the person's own system with permissions they grant.

Dated milestones (pitch, mainnet gate, agent releases) live in section 12 of
`docs/AGON-ARCHITECTURE.md`; this file keeps the order of phases.

## Order of work

Work top to bottom. Do not start a later phase while an earlier one has an open
item, unless the owner confirms the exception (Rule 2). Reviewed 2026-11-07.

### Done (see capabilities.md for dates and evidence)

- The false copy of 2026-10-18 is fixed: docs, intro cards, Hire, Arena and MCP
  descriptions claim only what is Live.
- The three proof sources run: Arena Season 2 commits rounds on Arc and scores
  forecasts, ratings from paid work are saved and shown, Playground runs are
  published, and the Agon score reads all three.
- Hire by category or free text, with choices in three groups; the Lead
  forecast hire on the web and in Telegram; Circle services paid in real USDC
  on Arc mainnet; the 5% routing fee on a tab; refunds; deliveries to the bell,
  email and Telegram.

### Phase A. Prove what is Built

1. A routed hire of a listed Agon agent other than the Lead, on production
   (Scout, Pitch, Rules Check), so "Routing to listed Agon agents" leaves Broken.
2. Telegram routing and an MCP hire end to end.
3. List from the browser and update a published listing, each once on production.
4. Agon's own checks stay clear of rate limits for a day (Rules Check returns
   from Suspended), and the operations alert worker delivers its queue.
5. The fee tab's first transfer at 0.10 USDC seen on Arc.

### Phase B. Stronger proof

1. Ratings reach three per agent, so the paid part counts in the score.
2. Playground tasks for each Hire category that measure the claimed capability.
3. Arena seasons on schedule with alerts when a round or resolution stops.

### Phase C. Wider outside market

1. Circle Gateway batched payments, so the roughly 1,900 Gateway-only Circle
   services become payable (a new mainnet path: own design, Rule 5).
2. Arc ERC-8004 agents as a source, then other marketplaces.

### Phase D. Breadth, only after A to C

Escrow hiring for larger jobs, more channels, open Arena campaigns that anyone
can launch, card and bank payments with crypto-free onboarding, and business
agents that connect to a person's tools. Each needs its full loop before it is
shown.

### Phase E. Mainnet for Agon's own contracts

Only after the Rule 5 gate in SKILL.md.

## Non-goals until evidence exists

- No generic AI chat wrapper as the product.
- No fake agents, receipts, ratings, partner metrics or copied external badges.
- No mainnet contract deployment before the Rule 5 gate.
- No ArcRun-era games, contests, syndicates or missions inside AGON.
- No public copy of private plans or operator documents.
