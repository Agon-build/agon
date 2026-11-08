# Agon UI source of truth

This brief records the approved AGON product UI rules. The full design system
(tokens, type, components, motion) is the `agon-design` skill; load both. It is not a generic AI design
system. It is derived from the current AGON frontend, the user's approved
landing and intro references, the Veil Arena restraint, and the scan-friendly
marketplace pattern the product needs.

## Product feeling

AGON should feel like a measured service desk for work that can be checked.
The first screen tells a new visitor what Agon is, what chain is active, and
where to begin. The first action is discovery, not wallet connection.

## Fixed visual rules

- Keep the AGON mark and wordmark. Do not substitute an Arc, Circle, or other partner logo.
- Keep the existing AGON intro animation exactly: dark navy field, pink and
  cyan atmospheric color, centered AGON mark, restrained service previews,
  skip control, enter control, reduced-motion path, and no raw first-paint
  flash.
- The deployed site is dark (`ThemeScript forceDark` on AGON deployments); the
  light token set still exists for local and non-AGON use. Design and check in
  dark first, then light.
- Use AGON pink for the primary interaction signal and failure red only for
  failure. Source and network badges are small, neutral context labels, never a
  second competing brand accent.
- Display and body are Geist Sans (the `stencil` and `display` Tailwind names
  both map to Geist); Geist Mono for identifiers, state labels, prices, chain
  ids, addresses, hashes and receipts.
- Prefer flat surfaces, hairlines, editorial grids, clear grouping, and firm
  controls. No glass, decorative gradients, floating particles, emoji, or fake
  metrics.
- Motion must be tied to product meaning, be short, and honor
  `prefers-reduced-motion`.

## Hire hierarchy (the home page)

Reviewed 2026-11-07. The page communicates in this order:

1. The question "What do you need done?" in one box, with the category
   dropdown under it (seven categories; choosing one with nothing typed lists
   the whole category).
2. The wallet strip when signed in: agent wallet, balance, what is left today,
   Manage.
3. Choices in three groups: Ranked on Agon, New on Agon, not yet proven, and
   Outside market. Each card shows name, source, network, price, fee and total,
   and the reason it fits.
4. The chosen service's inputs, then the quote, the pay step, the live run, the
   answer and the rating step.
5. Your recent hires, five a page, with a link to all of them on Account.

Do not lead with ERC-8004, ERC-8183, x402, authority, or sponsor names, and do
not lead with Polymarket. Those are inspection details or one category.

## Agents page and agent cards

Use a dense but calm comparison surface. Each service row or card should make
the following scannable without opening a protocol document:

- the outcome and service name;
- provider identity and service version;
- price and unit;
- network context;
- availability and freshness;
- evidence or test status with its scope;
- authority requirements;
- the next action.

The service's immutable manifest supplies its name, short outcome, search tags,
and public HTTPS logo. Desktop uses a compact two-column comparison grid; mobile
uses one column. The agent's name opens its page; Hire sits on the card as
its own action, so links never nest. A failed image
may fall back to deterministic initials and colour, but the UI must never
present that fallback as the provider's logo. Metadata loading, unavailable,
and anchor-mismatch states must settle visibly instead of leaving a permanent
generic `Agent #...` loading card.

People see three trust words: Listed, Verified and Paused. Unavailable, stale,
mismatched, fixture and live are separate states. Never collapse them into one
green trust badge.

## Arena

The Arena is the current season, read from the season API: round and total,
next round in UTC, end date, and the most forecasts scored by one agent. The
standings use the category tabs, a skill bar either side of zero (the market
price), Brier and forecast counts; the market copy is the benchmark row. The
note under the table says who beats the market or who is closest. Entering an
outside agent is labelled Coming next until it is Live.

## Docs

Docs read one part at a time: a grouped map on the left (a part picker at
390px), "Part N of 11", one lead line, Previous and Next, and a right rail with
the part's headings, the last review date and, where a part has one thing to
do, a Try it box with the page's one pink action.

## Long pages

Show one part at a time or page the list: Docs shows one part with Previous and
Next, Account uses tabs, hire history is paged. No endless scrolling.

## Source and network labels

Every result shows its source (AGON, Circle, Arc agent) and network (Arc
Testnet or Arc mainnet). A mainnet price is real money and must say so before
any hire action. When a network context changes, the data source, explorer,
and write guards change together, and stale prepared payments are cleared. If a
source or network is unavailable, show that with the reason and keep the other
results usable.

## Accessibility and mobile

- Keep interactive targets at least 44px high and wide enough to use.
- Preserve keyboard focus and visible focus styles.
- Use one h1 per route and a meaningful heading hierarchy.
- Keep long addresses and hashes breakable without widening the document.
- At 390px, landing content and footer must use normal document flow. Do not
  trap the footer in a fixed-height internal scroller.
- Test the intro, Hire, Agents, agent detail, Arena, Playground, Docs and
  Account at 1440 and 390 widths.
