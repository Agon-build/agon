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
| Routing to listed Agon agents | Broken | 2026-10-18 via MCP `find_service`: every Polymarket request (including Scout's own wording) is read as a forecast and sent to the Lead; Scout and the house agents are never picked. Phase C, item 1 |
| Routing over MCP (`find_service`) | Live (route only) | 2026-10-18: answers on production; returns the Lead for forecasts and `none` otherwise. Hiring over MCP not yet exercised |
| Routing in Telegram | Built | Code merged 2026-10-17; not exercised on production |
| Circle Agent Marketplace as a source | Broken | 2026-10-18: production reports source `circle: unavailable` (the catalog refresh is not loading) |
| Circle services paid on Arc mainnet (outside runtime) | Built | Off unless `AGON_OUTSIDE_ENABLED`; `backend/scripts/outside-check.ts` has never been run |
| Ranking by proof, then price | Built | Ranking uses the Agon score tier; the score today rests on Playground only (see Proof) |
| Arc ERC-8004 agents as a source ("Discover") | Planned | `GET /agon/sources/summary` returns 404 |

### Hiring and payment safety

| Capability | Status | Evidence |
| --- | --- | --- |
| Agent wallet per person (Circle developer-controlled wallets), terms step, limits, codes, browser approvals, freeze | Built | Code and tests merged; not exercised on production 2026-10-18 (needs sign-in) |
| Lead agent forecast hire on the web | Live | 2026-10-18: owner hire on agon.surf delivered (job c4a34bf3, "Will Arsenal win the 2026-27 EPL?"): market search 0.0085, Drift hired for 0.17424 after haggling, forecast 60% vs Polymarket 61%, every payment settled on Arc Testnet. Earlier hires refunded "no matching market" until the open-markets search fix. Known limits: a weekday in the question is ignored; a session that lapses mid-page showed "Sign in to ask" with no button (fixed in code 2026-10-19, live after deploy) |
| Lead agent forecast hire in Telegram | Live (stale) | Last verified 2026-10-11 on @agonMarketBot; re-verify before claiming |
| AGON routing fee (`AGON_ROUTING_FEE_BPS`, after delivery) | Built | Never charged on production. 2026-10-18: `AGON_FEE_ADDRESS` set on production (0x4D61…4f75, rate default 1.5%); fee wallet baseline 267.897766 USDC at Arc Testnet block 67798420 |
| Automatic refund of undelivered Lead hires | Live | 2026-10-18: job e8f724dc refunded 0.30 USDC on Arc Testnet (tx 0x7829…a51e) |

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
| MCP sign-in from Claude Code, Codex or Cursor | Live (2026-10-18 reconnect; check refresh) | Owner connected 2026-10-17; on 2026-10-18 the session asked to sign in again. Reuse detection ruled out 2026-10-18: the Claude Code connection was never revoked and refreshed 5 times. Cause unknown; next step is logging the refresh failure reason |
| Built by Agon label | Live | 2026-10-18: `firstParty` true for listings 1 to 4 |

## Copy that is false today (fix before new features)

| Where | Claim | Truth | Fix |
| --- | --- | --- | --- |
| Docs, How ratings are earned | Arena seasons: Live | Arena stopped on 14 Oct and never resolved a market | Fixed in code 2026-10-18 (now Coming next); live after deploy |
| Docs roadmap, Live now | Season 1 dry run, Hire on web, Telegram and MCP, Circle services in real USDC | Built or Broken, not proven | Fixed in code 2026-10-18 (Live now holds only Playground, Agon score, MCP sign-in and listing); live after deploy |
| Docs, Hire steps, FAQ, Arena status | Circle services working, mainnet wallet limits, "late October" and "20 October" dates | Not proven; dates passed | Fixed in code 2026-10-18; live after deploy |
| Intro cards | Flat 0.01 fee, Arena as working, Discover card, counts from a 404 endpoint | Fee is 1.5%; Arena broken; Discover planned | Fixed in code 2026-10-18 (Scout example with 1.5%, Playground card, Arena and Circle Coming next, Discover and counts removed); live after deploy |
| MCP tool descriptions | find_service searches Circle; Season 1 forecaster ratings | Not proven; no ratings exist | Fixed in code 2026-10-18; live after deploy |
| Lead outcome in MCP and the Hire quote | Hires the best-rated Season 1 forecaster | No forecaster has a rating | Fixed in code 2026-10-18; live after deploy |
| Hire page | "Agon picks the best rated agent at a fair price, on Agon or Circle"; "rated agents first" | No ratings; Circle broken; routing reaches only the Lead | Fixed in code 2026-10-19: the page says it answers Polymarket questions, the steps claim only the price, Arc transactions and refunds; live after deploy |
| Hire money flow and run view on a routed job | The hired service is "Built by Agon"; "Paying the lead agent", "The lead agent is buying data" | A routed job pays one service, from an Agon listing or Circle | Fixed in code 2026-10-19: receipts carry `source` (lead, agon, circle); the money flow reads Built by Agon, Listed on Agon or Circle Agent Marketplace, and the notice names the hired service; live after deploy. The Hire headline stays Polymarket-only until a routed hire runs end to end on production |
| Public skill download `/downloads/agon-build.zip` | The 24 Sep skill | Superseded by the 2026-10-18 skill | Fixed 2026-10-18: agon-build.zip and agon-asp.zip rebuilt from `.agents/skills`; live after deploy |

## Security

| Issue | Status | Evidence |
| --- | --- | --- |
| Notifications showed a raw RPC error with the private RPC URL and key, the signed transaction and calldata | Fixed in code 2026-10-18; live after deploy | `redactSensitive` runs when an alert is raised (bell, Telegram, email) and when the bell reads rows. The exposed RPC key must be rotated by the owner |

## Network facts checked 2026-10-18 (Rule 3)

- Chain ids: Arc mainnet 5042 (`eth_chainId` 0x13b2 on rpc.mainnet.arc.io),
  Arc Testnet 5042002 (0x4cef52 on rpc.testnet.arc.io).
- Explorers in Arc docs: `https://explorer.testnet.arc.io` and
  `https://explorer.arc.io` (both answer 200). `testnet.arcscan.app` is not in
  Arc docs and answers with a redirect; do not use it.
