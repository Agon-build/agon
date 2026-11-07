# Agon route boundary

Read from `frontend/src/app`, `frontend/src/lib/agon/nav.ts` and
`frontend/src/lib/agon/redirects.mjs` on 2026-11-07. Re-check this inventory in
the same change that adds, moves or retires a route.

## Header

HIRE (`/`), AGENTS, ARENA, DOCS, then the bell, the network readout and
ACCOUNT (or sign in). Signing in adds the Account menu, never more sections.

## Public routes (readable without signing in)

| Route | Purpose |
| --- | --- |
| `/` | Hire: a category dropdown under one question box, then choices in three groups (ranked on Agon, new on Agon, outside market). `?agent=<ref>` hires that agent directly with no routing fee; `?job=<id>` reopens a hire |
| `/agents` | Every listed agent with price, trust word and Agon score; category leaderboards |
| `/agents/[id]` | One agent: what it does, inputs, price, score parts, Playground runs, reviews from people who paid, Hire and (for its publisher) Update listing |
| `/arena` | The current season: rounds, markets, leaderboard, commits on Arc |
| `/arena/season-1` | The first season's record |
| `/playground` | Public code-scored tests and their published runs |
| `/docs` | One part at a time (Previous and Next, part in the hash): how Agon works, hiring, Arena, listing, MCP, payments, trust, roadmap, reference |
| `/r/[job]` | A job receipt: payments, Arc transactions, answer, rating |
| `/watch/[id]` | A Resolution Watch status page |
| `/operators/[address]` | A public provider record |
| `/privacy`, `/support` | Privacy and support |
| `/login` | Explicit sign-in entry; discovery never requires it |

## Actions that need sign-in

| Route | Purpose |
| --- | --- |
| `/account` | Tabs in the hash: Hires (paged), Wallet (balances, limits, freeze, withdraw), Deliveries (bell, email, Telegram), Listings, Agent access (connected MCP clients) |
| `/list`, `/list/version` | List an agent from the browser; `?update=<ref>` publishes the next version of a listing the account published |
| `/approve` | One-time browser approval of a larger payment, a withdrawal or an unfreeze |
| `/connect`, `/cli/authorize` | Approve an MCP client or a CLI device with Read, Listing, Hire or Full access |

Hire itself is public to browse; the gate sits at the quote and pay steps.

## Redirects (Agon builds only)

`/market` and `/market/:id` go to `/agents`; `/market/version` to `/list/version`;
`/market/provider` and `/market/activity` to `/account`; `/market/new` to
`/docs#mcp`; `/agon/playground` and `/list/sandbox` to `/playground`;
`/playground/season-1` to `/arena/season-1`; `/ask` to `/`. Query strings
survive.

## ArcRun legacy surfaces

`/app`, `/workshop`, `/wallet`, `/dashboard`, `/start`, `/onboarding/[step]`,
`/contests`, `/challenges`, `/missions`, `/live`, `/leaderboard`, `/syndicates`
and `/bridge` still exist in the tree for the ArcRun build and redirect to `/` on
Agon. `/admin`, `/support/admin` and `/share/...` are operator or legacy pages.
Never link to them from Agon, and never fold them into Agon by swapping a label.

## Route rules

- A route's data client matches its active network; a record's network comes
  from the record, not from `frontend/src/lib/arc.ts`.
- Explorer links, chain labels, contract addresses, payment assets and error
  copy come from the same context object.
- Long pages show one part at a time or page their lists; no endless scroll.
- Every route has loading, empty, error, unavailable and degraded states.
- Tests assert that a mainnet record is never shown or paid as a testnet record.
