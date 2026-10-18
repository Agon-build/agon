---
name: agon-design
description: The AGON design system and UI rules (it replaces the old arcrun-redesign, arcrun-ui-ux and arcrun-ui-upgrade skills). Use before writing, changing or reviewing any AGON user-facing surface in frontend/: Hire, agent pages, Arena, Playground, List, Docs, Account, the intro, copy, Tailwind, tokens, motion or layout. Facts are taken from the shipped code (tokens.css, tailwind.config.ts, components/redesign, components/stage, components/agon). If this file and the code disagree, check the code, fix whichever is wrong, and record it.
---

# AGON design

AGON should feel like a measured service desk for work that can be checked:
calm, flat, exact, and honest about what is real. Load `agon-build` first. Its
standing rules apply to every pixel. In particular Rule 4: a screen shows only
what works today (see `agon-build/references/capabilities.md`); a preview or
example is labelled "Example figures" and can never pay.

## 1. Theme and tokens

Tokens live in `frontend/src/styles/tokens.css` and are mirrored in
`tailwind.config.ts`. Use the Tailwind names (`bg-canvas`, `text-ink-2`,
`text-accent`, `border-[color:var(--hairline)]`), never raw hex in components.

The deployed AGON site is **dark only**: `ThemeScript forceDark` runs on AGON
deployments. Design and check in dark first; keep light working.

| Token | Dark (deployed) | Light |
| --- | --- | --- |
| `--canvas` | `#0E0C0A` | `#EEF0F4` |
| `--canvas-2` | `#181410` | `#EDE8E1` |
| `--canvas-3` | `#221C16` | `#E4DED5` |
| `--ink` | `#F4F1ED` | `#1A1612` |
| `--ink-2` | `#B8AC9C` | `#4A453E` |
| `--ink-3` | `#7A7064` | `#847C70` |
| `--hairline` / `--hairline-strong` | cream at 12% / 22% | ink at 12% / 22% |
| `--accent` / `--accent-press` | `#FF4D8A` / `#FF2D72` | `#D6336C` / `#B82A5C` |
| `--accent-ink` (text on pink) | `#0E0C0A` | `#FFFFFF` |
| `--ok` / `--warn` / `--err` | `#3DDDB0` / `#FFCC4D` / `#FF5C7B` | `#2BD4A3` / `#FFC93A` / `#E0345A` |

Rules:

- Pink is the one accent: the primary action, small square markers, eyebrows,
  and at most one highlighted figure per surface. Never body text, never a
  second brand colour.
- Red (`--err`) only for failure. Status uses a small square in the status
  colour next to an ink label, never a coloured pill.
- Source and network badges (AGON, Circle, Arc Testnet, Arc mainnet) are
  neutral hairline chips in mono caps.
- Real money is said in words: "Real USDC on Arc mainnet" versus "Test USDC
  on Arc Testnet", before any pay action.

## 2. Type

- **Geist Sans** for display and body. The `font-stencil` and `font-display`
  Tailwind names both map to Geist; there is no stencil face. Large headings
  are uppercase with tight tracking (`tracking-[-.03em]` to `-.04em`).
- **Geist Mono** for eyebrows, labels, prices, amounts, chain ids, addresses,
  hashes, codes, receipts and table figures, with `tabular-nums` on numbers.
- Eyebrows: mono, 10 to 11px, uppercase, `tracking-[0.14em]` to `0.16em`, in
  `text-accent` or `text-ink-3`.
- Headings sit hard left on desktop. One h1 per route.

## 3. Components to reuse

Do not invent a new primitive when one exists. Add a new one only with a
reason, in the right folder, and list it here.

- `components/redesign/`: `AgonMark` / `ProductMark` (the notched pink square
  with the cut A; never substitute a partner logo), `TagButton` (the CTA: a
  rectangle with a 12px notch at the top right, primary pink or ghost, never a
  rounded pill), `BracketedCell` (hairline box with four L corner brackets,
  sharp corners), `SectionHeader`, `StatusChip`, `StatBlock`, `ActivityRow`,
  `MicroLabel`, `SectionDivider`, `TopNav`, `Footer`, `AgonNetworkSelector`,
  `AgonNetworkReadout`.
- `components/stage/` (Hire): `StageShell`, `Composer`, `RouteCard` (the pick,
  reason, price, AGON fee and total, alternatives to swap, input question),
  `QuoteCard`, `TermsPanel`, `TopUpPanel`, `WalletStrip`, `PhaseRail`,
  `RunView`, `MoneyFlow`, `LedgerTape`, `HaggleTape`, `ProbabilityDuel`,
  `TxLink`.
- `components/agon/`: `AgonIntro` and `IntroGate` (the intro overlay, once per
  session), `ListingCard`, `VerificationBadge`, `UnverifiedWarning`,
  `CategoryLeaderboard`, `AgentRating`, `PublicTestPanel`, `TestRunList`,
  `MyListings`, `AgentAccess`.
- `components/ui/`: `how-it-works.tsx`, `faq-list.tsx` (shadcn-style, lucide
  icons), with `cn()` from `src/lib/utils.ts`.

## 4. Copy

- Plain words a non-crypto person understands. Lead with the action and the
  result; show protocol names (x402, ERC-8004, EIP-3009) only where they help a
  decision or as inspection detail.
- No em dashes. No "+" used as a word (write "and"). No design rationale in UI
  copy: show the action, skip the why.
- Vocabulary: Hire, Agents, Arena, Playground, List, Docs, Account; agent
  wallet; Listed, Verified, Paused; AGON routing fee; Built by Agon. Retired
  words (do not use): sandbox, quarantined (say Paused), Provider listed,
  Agon Market, find services, ArcRun.
- Every number on screen is real and current, or labelled "Example figures".
  No invented counts, users, volume or partners.
- Statuses in copy follow capabilities.md: Live things read as available;
  Built or Planned things say "coming next" or are not shown.

## 5. States

Every surface designs: loading, empty, error, unavailable (with the reason),
degraded (one source down, the rest still usable), success, and recovery
(what to do next). Payment surfaces also show: quoted, paying, working,
answered, refunded, failed, expired, and "not paid". A preview or fixture says
so on screen.

## 6. Motion

Short and meaningful (120 to 300ms), tied to a state change: a pick arriving,
a payment landing, a phase advancing. No bounce or spring overshoot, no
decorative loops. Every animation has a `motion-reduce` path.

## 7. Layout and accessibility

- Flat surfaces, hairlines, editorial grid, generous spacing. No glass, no
  gradients on cards, no shadows that glow, no particles, no emoji icons.
- Targets at least 44px. Visible focus. Long addresses and hashes break
  without widening the page.
- Check 1440px and 390px with zero horizontal overflow, in dark and light.

## 8. ArcRun leftovers: do not use in AGON

These exist in the repo for the legacy ArcRun product only: `Robot`,
`SyndicateTile`, `KineticArena`, `WorkshopScene`, `EntrantAvatars`,
`ArcRunMark`, `WinShareModal`, the `--pengu-*` and `--syn-*` tokens, the
`bubble` font name, contests, syndicates, missions and the robot mascot
family. `AgonOperatorProfile` still renders `Robot`; replace it when that
page is next touched. Black Ops One and JetBrains Mono are not AGON fonts.

## 9. Before handing off a UI change

- Type check, `npm run test:marketplace`, and `next build`.
- A visual pass at 1440 and 390 in dark (the deployed theme), plus light.
- No unsupported claim (Rule 4), every state from section 5 reachable, copy
  rules from section 4 met (search the diff for em dashes and " + ").
