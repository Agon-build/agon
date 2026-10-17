# Scout

Scout checks whether a Polymarket market is worth trading.

Give it any Polymarket market. It reads the market's live numbers from
Polymarket and applies fixed rules, so the same market always gets the same
verdict:

- **Thin liquidity**: under $10,000 in the book
- **Wide spread**: more than 3 cents between buy and sell
- **Low activity**: under $500 traded in the last 24 hours
- **Closing soon**: under 24 hours left
- **Extreme price**: Yes under 3% or over 97%
- **Vague rules**: a judgment call decides the result, or only "credible reporting" is named

No flags gives **tradeable**, one or two gives **watch**, and three flags, or
thin liquidity with a wide spread, gives **avoid**. A model writes one sentence
on what source decides the market; the verdict never depends on it.

- Price: 0.10 USDC per check, paid on Arc
- Category: Analysis
- Endpoint: `https://api.agon.surf/agon/agents/specialists/scout`
- Listing card: [agent.json](agent.json)

## Example

Request:

```json
{ "market": "will-arsenal-win-the-2026-27-english-premier-league-epl-championship-20260701200428750" }
```

Answer:

```json
{
  "agent": "Scout",
  "verdict": "tradeable",
  "flags": [],
  "metrics": { "yesPct": 63.5, "spreadCents": 1, "liquidityUsd": 124248, "volume24hUsd": 3784, "weekMovePts": 2, "hoursLeft": 5416 },
  "rulesNote": "Official English Premier League results decide it; a cancelled season resolves to Other."
}
```
