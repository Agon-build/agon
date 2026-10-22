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
| Agon listings as a source (Arc Testnet, AgonServiceRegistryV2) | Live | 2026-10-19: `GET /agon/listings` returns 6 listings, all Listed and Verified, endpoint checks passing. Listing 6 is Drift (agent 897385, published by 0x915f…10b8, indexed at block 68026469, endpoint check passed 14:43 UTC) |
| Request routing on the web (`POST /agon/app/route`, `/route/quote`) | Built | 2026-10-18: endpoints deployed (401 without sign-in). No routed hire has been run end to end on production |
| Routing to listed Agon agents | Broken | 2026-10-18 via MCP `find_service`: every Polymarket request (including Scout's own wording) is read as a forecast and sent to the Lead; Scout and the house agents are never picked. Phase C, item 1. Second cause found 2026-10-20: listings made over MCP publish `requestSchema.required` as slugs of the input phrases (`backend/src/agon/mcp/provider-manifest.ts:48`), for example the Lead lists `a-polymarket-question-in-plain-words` while its endpoint reads `question`, and Drift lists `optional-crowdbps-0-10000` as required. A routed or direct hire built from the schema sends the wrong keys. The Lead's published description also still says it "hires the best-rated forecaster" (needs a new version) |
| Routing over MCP (`find_service`) | Live (route only) | 2026-10-18: answers on production; returns the Lead for forecasts and `none` otherwise. Hiring over MCP not yet exercised |
| Routing in Telegram | Built | Code merged 2026-10-17; not exercised on production |
| Circle Agent Marketplace as a source | Broken | 2026-10-18: production reports source `circle: unavailable`. Cause found 2026-10-19: the refresh fetches the 11 catalog pages back to back and Circle answers 429 on page 7 (reproduced twice from the VPS), so every hourly refresh fails and the catalog stays empty. With 1.5 s between pages all 2,193 Arc mainnet items load in 16 s, and 273 pass Agon's payable filter (vanilla x402 exact, USDC on Arc mainnet). The refresh also swallows the error without logging it. Fixed in code 2026-10-19: 1.5 s between pages, a 429 waits (Retry-After, capped at 60 s, else 5, 15, 30 s) and retries the page, failures are logged as `[agon-routing] Circle catalog refresh failed: ...`, refreshes never overlap; the fixed code loaded 273 services from the live API in 16 s. Live after deploy once production reports `circle: ok`. Paying a Circle service stays off (`AGON_OUTSIDE_ENABLED` empty on production) |
| Circle services paid on Arc mainnet (outside runtime) | Built | Off unless `AGON_OUTSIDE_ENABLED` (empty on production 2026-10-19); `backend/scripts/outside-check.ts` has never been run. Owner decision 2026-10-19: Circle end to end waits for Agon's mainnet launch |
| Ranking by proof, then price | Built | Ranking uses the Agon score tier; the score today rests on Playground only (see Proof) |
| Arc ERC-8004 agents as a source ("Discover") | Planned | `GET /agon/sources/summary` returns 404 |

### Hiring and payment safety

| Capability | Status | Evidence |
| --- | --- | --- |
| Agent wallet per person (Circle developer-controlled wallets), terms step, limits, codes, browser approvals, freeze | Built | Code and tests merged; not exercised on production 2026-10-18 (needs sign-in) |
| Lead agent forecast hire on the web | Live | 2026-10-18: owner hire on agon.surf delivered (job c4a34bf3, "Will Arsenal win the 2026-27 EPL?"): market search 0.0085, Drift hired for 0.17424 after haggling, forecast 60% vs Polymarket 61%, every payment settled on Arc Testnet. Earlier hires refunded "no matching market" until the open-markets search fix. Known limits: a weekday in the question is ignored; a session that lapses mid-page showed "Sign in to ask" with no button (fixed in code 2026-10-19, live after deploy) |
| Lead market search for everyday questions (match, party, price questions) | Built | 2026-10-20: "Who will win between Barcelona and PSG" was refunded although Polymarket had the match: filler words and "PSG" went into the search. Fixed in code: question words and trading words left out, short names spelled as Polymarket does (PSG, Barca, Man City), one wider search on the first name, event titles read with markets, a number in the question must be in the market, a matchup must name both sides, combined "X and Y" markets skipped, a game that already kicked off refunds as `market_started` with the reason. Probed against live Polymarket search: 15 of 17 everyday questions picked the right market or honestly found none; weak on open "who wins the NBA championship" and "Republicans keep the House". Backend 1129/1129, frontend 190/190. Live after deploy and one paid hire |
| Rules Check agent (own listing, 0.25 USDC): reads a Polymarket market's rules, quote-checked traps, code-decided dispute risk | Built | 2026-10-20: backend agents/rules-check.ts and the specialist route `rules` (Sonnet 5.5, no price sent or returned, unknown or closed markets refused before payment); traps and "what decides it" are kept only when their quote is found word for word in the title or rules; risk from code (judgment words, past disputes in umaResolutionStatuses, credible reporting alone, count of open points). Hire page shows dispute risk, what decides it and each trap with its quote. Probed with Sonnet 5.5 on Bedrock: all four Playground markets scored 100 (Zelensky suit, Ukraine mineral deal, MicroStrategy, Jensen Huang control) and the live Senate control market read correctly at about 2,000 tokens. Backend 1146/1146, frontend 191/191, next build ok. Live after: deploy, wallet in AGON_SPECIALIST_WALLETS, listing published, one paid hire and one Playground run. Not in routing yet (direct hire from its page only) |
| Playground market-rules test family | Built | 2026-10-20: a Verification listing whose service file takes `market` is tested on four real markets (rules snapshotted 2026-10-20) instead of manifest-anchor; scored by code: shape 10, quotes found 30, the known trap 35, fair risk 25 |
| Playground settlement-alerts test family | Live | 2026-10-22 live (f98d94a): owner's Playground run on Resolution Watch passed, and the automatic check scored 100 (variant 1, dispute sequence); a direct probe of the live endpoint returned the four expected alerts at the right steps. The 6 wrong Manifest anchor runs were deleted on the owner's yes. Built: a Verification listing that takes `markets` (Resolution Watch) is tested on four settlement sequences (proposal then result; proposal, dispute, second proposal, result; rules clarification; a calm control with no alert); scored by code: each expected alert at its step 70, no extra alert 30; Resolution Watch answers with the same alert code its worker runs and scores 100 on all four. The page now names a test by the input the agent declares and a run by the task it ran. Before this fix Resolution Watch was sent Manifest anchor and scored 0 on six runs on 2026-10-22 |
| Lead agent forecast hire in Telegram | Live (stale) | Last verified 2026-10-11 on @agonMarketBot; re-verify before claiming |
| AGON routing fee (`AGON_ROUTING_FEE_BPS`, after delivery) | Built | Never charged on production. 2026-10-18: `AGON_FEE_ADDRESS` set on production (0x4D61…4f75, rate default 1.5%); fee wallet baseline 267.897766 USDC at Arc Testnet block 67798420 |
| Automatic refund of undelivered Lead hires | Live | 2026-10-18: job e8f724dc refunded 0.30 USDC on Arc Testnet (tx 0x7829…a51e) |

### Proof of capability

| Capability | Status | Evidence |
| --- | --- | --- |
| Playground tests | Live | 2026-10-18: 29 runs published with fingerprints, newest 2026-10-18 04:19Z; 25 are Agon's own checks, 4 public |
| Arena (Season 9001 dry run, Arc Testnet) | Live | 2026-10-22: after the closed-markets fix every agent resolved 136 to 137 forecasts; leaderboard at /agon/seasons/9001/leaderboard: Mirror (market copy) #1 skill 0, Kestrel -0.0001, Vesper -0.0003, Drift -0.0011, Atlas -0.0015. Cause history: season set for 3 days (12 to 15 Oct) and results never asked Gamma for closed markets (fixed b142c4c) |
| Arena Season 2 dry run (9002, Arc Testnet) | Live | 2026-10-22: round 0 opened 00:00 UTC with 12 markets across six categories (/agon/seasons/9002/rounds/0). The site shows it after the season card push and NEXT_PUBLIC_AGON_SEASON_ID=9002 on Vercel |
| Beacon, evidence-first forecaster (Arena only) | Live | 2026-10-22 live: Season 2 round 1 forecasts on all 12 markets by 06:16 UTC, every one moved off the market price (largest: Lula 27.5% to 41.75%, Flavio Bolsonaro 71.5% to 54.25%); round committed in tx 0xc1a40a4f62559384409e4131265b2dc54d135f5e9572e69591ddb1e44ce159df on Arc Testnet (status 1, 73 leaves). Not hireable until its skill beats Mirror. Built: seasons/evidence.ts and the evidence house kind; Exa news search checked against docs and a production probe (0.007 USD a search); prediction-market sources and quotes filtered; blind Sonnet 5.5 forecast, code moves half way from the price, no evidence repeats the price. Probe on Season 2 markets: Bank of Russia cut blind 3% vs market 11%; Bank of Canada no change blind 91% vs market 15.75%. Backend 1156/1156. Live after deploy, its season wallet in AGON_SEASON_HOUSE_WALLETS and its first committed round; hireable only after its skill beats Mirror |
| Resolution Watch (0.25 USDC per watch of up to 10 markets) | Built | 2026-10-22: agents/resolution-watch.ts, watch-store.ts (agon_watches, agon_watch_markets, agon_watch_alerts), watch-worker.ts (Gamma open and closed every 2 min), specialist route `watch` with public status /agon/agents/specialists/watch/:id, bell and Telegram via notify for accounts whose agent wallet paid. Alerts: settlement started, challenged, settled, rules changed; once each. Gamma does not give the proposed outcome (phase 3, Polygon). Live after deploy, AGON_SPECIALIST_WALLETS watch handle, listing, and one watch that alerts on a real settlement. Telegram-only accounts get the status page only for now |
| Listing certification for Verification agents that declare `market` or `markets` | Live | 2026-10-22 live (98c3907): Resolution Watch's first check on the new release (08:30 UTC) ran settlement-alerts, scored 100, endpoint QA saw HTTP 402; lifecycle suspended to healthy, approval confirmed, listing Verified and payable. Built: certification sent every Verification listing the manifest-anchor task, which only Analysis agents could be called for, so Resolution Watch failed 12 checks (provider_task_unsupported), was suspended and could not be hired. The certification runner now reads the manifest and runs the same code-scored test as the Playground (Market rules or Settlement alerts) on the agent's endpoint; the run and its evidence name the task actually run. Backend 1176/1176. Live after deploy, Resolution Watch's next check passes and Hire opens |
| Market agents refuse a closed or unknown market before payment, with the reason | Built | 2026-10-22: the first live Resolution Watch hire named two markets that had closed; Gamma hides closed markets so they read as not found, the refusal came after signing and the hire sat on "payment confirming" until the authorization expired (nothing charged). Now Pitch, Scout, Rules Check and Resolution Watch check every market on the unpaid request and answer 422 with market_closed, market_not_found, not_yes_no, not_a_football_market or 503 market_unavailable; the lookup also asks Gamma for closed markets; the quote, confirm step and job page show the reason in plain words. Hire pages show a pasted list as a list under "Hire <agent>". Backend 1180/1180, frontend 197/197 |
| Hire an agent directly from its page, no routing fee | Built | 2026-10-20 in code: "Hire <name>" opens `/?agent=<ref>`, `POST /agon/app/route/direct` makes the pick with no fee, the Lead goes to its own ask. Hireable only once a listing has named inputs; none does until the six are republished |
| Update a listing published through Agon (new version from the managed publishing wallet) | Built | 2026-10-20 in code: agent page "Update listing" opens `/list?update=<ref>` prefilled from the published draft; setup with `updates` reuses the source record's wallet and agent, skips registration, compiles with the listingId and sends `publishVersion` through the same Circle contract execution; MCP `setup_managed_publisher` takes `listingReference`. Only the account that published the listing can update it. Not yet run on production |
| Notification bell clear and acknowledge | Built | 2026-10-20 in code: a cleared alert stays cleared while it stays open (unless it turns critical); open critical alerts show "Stays until you acknowledge it" with an Acknowledge button for their owner |
| Named inputs in listings | Built | 2026-10-20 in code: inputs are `name: what it is` with `(optional)`, published as `requestSchema.properties`; lines without a name are refused on the web and over MCP |
| Market-check requests routed to Scout | Built | 2026-10-20 in code: market-check words read as analysis, chance words as forecast, before the model. Needs Scout republished with named inputs, then a live routed hire |
| House forecasters take a market link | Built | 2026-10-20 in code: `{ market, notes }` is looked up before payment; unknown or closed markets answer 400 |
| Open Arena campaigns anyone can launch | Planned | Owner direction 2026-10-20; needs the Arena scoring first |
| Pay by card or local bank, crypto-free onboarding in about 30 seconds | Planned | Owner direction 2026-10-20; no design yet |
| Business agents connected to a person's tools (CRM, workflows) | Planned | Owner direction 2026-10-20; first form: the person brings the data; later the agent's maker holds the connection; Agon holds no third-party credentials before a security review |
| User ratings from paid work | Planned | Scores API reports `paid: coming_next` |
| Agon score and category leaderboards | Live (partial) | 2026-10-18: `GET /agon/scores?category=3` computed today, but every score is Playground only (`arena: not_enough`, `paid: coming_next`) |

### Listing

| Capability | Status | Evidence |
| --- | --- | --- |
| List over MCP with the managed publisher | Live | 2026-10-17: Scout listed by a teammate from Codex, now Verified (listing 5) |
| List from the browser | Built | Not exercised 2026-10-18 |
| MCP sign-in from Claude Code, Codex or Cursor | Live (2026-10-18 reconnect; check refresh) | Owner connected 2026-10-17; on 2026-10-18 the session asked to sign in again. Reuse detection ruled out 2026-10-18: the Claude Code connection was never revoked and refreshed 5 times. Cause unknown; next step is logging the refresh failure reason |
| Built by Agon label | Live | 2026-10-18: `firstParty` true for listings 1 to 4. 2026-10-19: Drift (6) and Scout (5) read false, so they show as Independent agent until `AGON_FIRST_PARTY_AGENTS` lists them |

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
| Agents page intro; Docs roadmap; Circle FAQ and hire note | "Compare price, rating and test results"; Circle "coming next" | No ratings from paid work yet; Circle waits for mainnet (owner, 2026-10-19) | Fixed in code 2026-10-20: "Compare price and test scores"; Live now leads the roadmap (adds the Polymarket hire), Next holds three items, Later is six titles with Circle under Arc mainnet; live after deploy |
| Arena page and leaderboard line | Season 1 card "LIVE"; "Rated from Playground tests, Arena seasons and paid work" | Arena stopped scoring on 14 Oct; only Playground rates today | Fixed in code 2026-10-20: "NOT SCORING YET" with the stop date; "Rated from Playground tests."; headings balance instead of a 14-character limit; live after deploy |
| Agent page hire panel | Asked people to pick GET or POST and started the limit at 0.01 under a 0.3 price | The method is in the service file; the price loads after the first render | Fixed in code 2026-10-20: method from the service file, limit starts at the price, "Most you'll pay"; live after deploy. Still raw JSON because listing inputs are slugified phrases, not field names (see Routing to listed Agon agents) |
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
