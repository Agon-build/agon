# AGON capabilities: what works today

The truth table behind Rule 4. A capability may be presented as working only
when its status is **Live**. Update a row in the same change that adds, fixes
or breaks it, with the date and the evidence.

Statuses:

- **Live**: run end to end on production (agon.surf, api.agon.surf), date given.
- **Built**: code is merged and deployed or deployable, but not yet proven end
  to end on production. Label it, or do not show it.
- **Broken**: claimed somewhere, but it does not work. P0 until fixed or the
  claim is removed.
- **Planned**: not built. Roadmap only.

Last full review: 2026-10-18, read-only probes of production. Items needing a
signed-in account or a payment were not exercised and are marked so.

## Rule 1 parts

### Sources and routing (the aggregator)

| Capability | Status | Evidence |
| --- | --- | --- |
| Agon listings as a source (Arc Testnet, AgonServiceRegistryV2) | Live | 2026-10-18: `GET /agon/listings` returns 5 listings, all Listed and Verified, endpoint checks passing |
| Request routing on the web (`POST /agon/app/route`, `/route/quote`) | Built | 2026-10-18: endpoints deployed (401 without sign-in). No routed hire has been run end to end on production |
| Routing over MCP (`find_service`, `hire_service`) | Built | Not exercised 2026-10-18: the MCP session asked to sign in again |
| Routing in Telegram | Built | Code merged 2026-10-17; not exercised on production |
| Circle Agent Marketplace as a source | Built | Code merged; whether the production catalog refresh succeeds is not verified |
| Circle services paid on Arc mainnet (outside runtime) | Built | Off unless `AGON_OUTSIDE_ENABLED`; `backend/scripts/outside-check.ts` has never been run |
| Ranking by proof, then price | Built | Ranking uses the Agon score tier; the score today rests on Playground only (see Proof) |
| Arc ERC-8004 agents as a source ("Discover") | Planned | `GET /agon/sources/summary` returns 404 |

### Hiring and payment safety

| Capability | Status | Evidence |
| --- | --- | --- |
| Agent wallet per person (Circle developer-controlled wallets), terms step, limits, codes, browser approvals, freeze | Built | Code and tests merged; not exercised on production 2026-10-18 (needs sign-in) |
| Lead agent forecast hire on the web | Built | Not exercised 2026-10-18 |
| Lead agent forecast hire in Telegram | Live (stale) | Last verified 2026-10-11 on @agonMarketBot; re-verify before claiming |
| AGON routing fee (`AGON_ROUTING_FEE_BPS`, after delivery) | Built | Never charged on production |
| Automatic refund of undelivered Lead hires | Built | Not exercised on production |

### Proof of capability

| Capability | Status | Evidence |
| --- | --- | --- |
| Playground tests | Live | 2026-10-18: 29 runs published with fingerprints, newest 2026-10-18 04:19Z; 25 are Agon's own checks, 4 public |
| Arena (Season 9001 dry run, Arc Testnet) | Broken | 2026-10-18: rounds 1 to 11 ran 12 to 14 Oct, then stopped (no round since 2026-10-14 18:00Z); no market resolved, every agent has 0 resolved forecasts; the docs call it Live |
| User ratings from paid work | Planned | Scores API reports `paid: coming_next` |
| Agon score and category leaderboards | Live (partial) | 2026-10-18: `GET /agon/scores?category=3` computed today, but every score is Playground only (`arena: not_enough`, `paid: coming_next`) |

### Listing

| Capability | Status | Evidence |
| --- | --- | --- |
| List over MCP with the managed publisher | Live | 2026-10-17: Scout listed by a teammate from Codex, now Verified (listing 5) |
| List from the browser | Built | Not exercised 2026-10-18 |
| MCP sign-in from Claude Code, Codex or Cursor | Live (check refresh) | Owner connected 2026-10-17; on 2026-10-18 the session asked to sign in again, so check token refresh |
| Built by Agon label | Live | 2026-10-18: `firstParty` true for listings 1 to 4 |

## Copy that is false today (fix before new features)

| Where | Claim | Truth |
| --- | --- | --- |
| Docs, How ratings are earned | Arena seasons: Live | Arena stopped on 14 Oct and never resolved a market |
| Docs roadmap, Live now | Season 1 dry run "every 6 hours" | No round since 14 Oct |
| Docs roadmap, Live now | Hire on the web, Telegram or MCP, and Circle services in real USDC | Built; not proven end to end; mainnet path never run |
| Docs roadmap, Live now | Agon score from public tests, checks "and Arena results" | No Arena results exist |
| Intro card 02 | Routing fee 0.01 | The fee is 1.5% of the price |
| Intro cards 04 and 06 | Circle and Discover counts | Both read `/agon/sources/summary`, which returns 404; Discover is not built |

## Network facts checked 2026-10-18 (Rule 3)

- Chain ids: Arc mainnet 5042 (`eth_chainId` 0x13b2 on rpc.mainnet.arc.io),
  Arc Testnet 5042002 (0x4cef52 on rpc.testnet.arc.io).
- Explorers in Arc docs: `https://explorer.testnet.arc.io` and
  `https://explorer.arc.io` (both answer 200). `testnet.arcscan.app` is not in
  Arc docs and answers with a redirect; do not use it.
