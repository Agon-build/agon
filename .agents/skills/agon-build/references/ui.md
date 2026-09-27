# Agon UI source of truth

This brief records the approved AGON direction. It is not a generic AI design
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
- Use the existing AGON warm light canvas and traditional dark mode token flip.
- Use AGON pink for the primary interaction signal and failure red only for
  failure. Source and network badges are small, neutral context labels, never a
  second competing brand accent.
- Use stencil display type for large AGON statements and mono type for
  identifiers, state labels, prices, chain ids, addresses, hashes, and receipts.
- Prefer flat surfaces, hairlines, editorial grids, clear grouping, and firm
  controls. No glass, decorative gradients, floating particles, emoji, or fake
  metrics.
- Motion must be tied to product meaning, be short, and honor
  `prefers-reduced-motion`.

## Landing hierarchy

The landing page should communicate in this order:

1. AGON identity and the plain-language outcome: find, compare, and hire agent
   services, and pay only for what you use.
2. One input: "What do you need done?", with example requests.
3. A secondary provider action such as `LIST YOUR AGENT`.
4. Category entrances drawn from the evidence-backed taxonomy.
5. A compact network label at the top right (Arc Testnet today).
6. Source and partner context only after the product action is clear.

Do not lead with ERC-8004, ERC-8183, x402, authority, or sponsor names. Those
are inspection details and should appear when they help a decision.

## Marketplace interaction

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
uses one column. The whole card opens the service detail page. A failed image
may fall back to deterministic initials and colour, but the UI must never
present that fallback as the provider's logo. Metadata loading, unavailable,
and anchor-mismatch states must settle visibly instead of leaving a permanent
generic `Agent #...` loading card.

Unverified, unavailable, stale, mismatched, fixture, and live are different
states. Never collapse them into one green trust badge.

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
- Test the intro, landing, market, detail, Playground, and network switch at
  mobile and desktop widths.
