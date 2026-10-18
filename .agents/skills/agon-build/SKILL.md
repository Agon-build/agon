---
name: agon-build
description: Build, extend, review, or explain AGON, the Arc-native aggregator of agent services that routes a request to the best agent by proven capability (Arena results, user ratings, Playground tests) and then price. Use before any AGON work: hiring, routing, sources, Circle Agent Marketplace, payments and wallets, Arena, Playground, ratings, listing over MCP, docs, UI, deployment. It carries the standing rules: the build direction, the diversion alert, verify-before-implement against Arc and Circle docs, claims only for working software, and the mainnet gate.
---

# Agon build

AGON is an aggregator of agent services on Arc. A person or an agent says what
they need; AGON finds the best agent service for it across sources (its own
listings first, then outside marketplaces, starting with Circle's Agent
Marketplace), shows why it chose it, and pays per use in USDC on Arc inside
spending limits the person controls. Providers list through AGON MCP or the web
and keep ownership through their ERC-8004 identity. AGON is not the old ArcRun
competition product; ArcRun names, routes and copy do not enter AGON work.

This skill is public and safe to distribute. Private plans, wallet details,
credentials, operator runbooks and internal research never go in it.

## Standing rules (every task, before anything else)

These five rules outrank speed, deadlines and any plan. If a plan conflicts
with them, the rules win and the conflict is reported.

### Rule 1. The direction

Everything built moves AGON toward one product: **an aggregator for agent
services, where the best agent is chosen by proof of capability, then price.**

Proof comes from three sources, and only these:

1. **Arena**: competitive seasons scored against real outcomes, each round
   committed on chain.
2. **User ratings**: the person who paid for a delivered job rates it, once
   per job.
3. **Playground**: public tests scored by code, every run published with its
   evidence fingerprint.

The parts that serve this direction are: sources, routing, hiring and payment
safety, the three proof sources, listing, and the honesty and reliability of
what already exists. A task is on direction only if it builds or fixes one of
them.

### Rule 2. Diversion alert

Before planning or writing code, classify the request:

- **On direction**: builds or fixes a part named in Rule 1.
- **Support**: security, reliability, operations, tests or docs truth that a
  Rule 1 part needs.
- **Diversion**: anything else. For example a new chain, a new product line,
  ArcRun-era games, contests, syndicates or missions, a partner or category
  added without its proof loop, mainnet work before the mainnet gate (Rule 5),
  a decorative redesign while a live claim is false, or a new feature while an
  existing claim is false.

For a diversion, or when unsure, stop and output exactly this, then wait:

```text
DIVERSION ALERT
Request: <one line>
Why it is off direction: <one line naming the rule>
On-direction alternative: <one line>
Waiting for the owner to confirm before any work.
```

Only the owner's confirmation in chat releases the work, and it covers that
request only. Record a confirmed diversion with its date in the plan.

### Rule 3. Never assume: verify against Arc and Circle before implementing

Before any change that touches Arc or Circle (chain config, contracts, RPC,
explorers, gas and fees, USDC, x402, EIP-3009, developer-controlled wallets,
Gateway, CCTP, App Kit, the Agent Marketplace discovery API, ERC-8004,
ERC-8183):

1. Read the current Arc docs (arc-docs MCP or docs.arc.io) and Circle docs
   (Circle MCP and the live developers.circle.com page; the MCP index can be
   stale, so confirm on the live page).
2. Read the installed SDK version and its shipped type definitions. The
   installed package outranks memory, blog posts and examples.
3. Where behaviour matters, probe read-only (an RPC call, a GET, a dry run)
   and keep the result.
4. Write each fact with its source URL or file path and the date into the plan
   or ledger, before writing code.

If the docs, the SDK and observed behaviour disagree, stop and report the
disagreement; never pick one silently. Never call a vendor product broken
until it was run and failed; suspect AGON's own code first. "I think I
remember" is the moment to look it up. Never invent an endpoint, address,
decimal count, event shape, price, status or transaction result; if the
evidence is missing, the capability is unavailable.

### Rule 4. Claims follow working software

AGON claims only what works today on the deployed app, exercised end to end.
This covers the UI, the docs page, the README, MCP tool descriptions, skills,
posts and submissions.

- Every user-facing capability has a status in
  [capabilities.md](references/capabilities.md): **Live** (run end to end on
  production, with the date), **Built** (merged, not yet proven live),
  **Broken**, or **Planned**.
- Only Live may be presented as working. Built and Planned are labelled as such
  or not shown. Broken is fixed or removed from the copy.
- Passing tests is not Live. Live means a real run on agon.surf or
  api.agon.surf, recorded with its date.
- A claim found false is a P0 bug: fix the software or the copy before any new
  feature.
- Every change that adds, fixes or breaks a capability updates capabilities.md
  in the same change.

### Rule 5. Professional pace and the mainnet gate

One change at a time: spec, plan, failing test, code, review, deploy, live
check, then update capabilities.md. Do not skip steps for a deadline; if the
deadline cannot be met honestly, ship less and label it.

No Arc mainnet contract deployment, mainnet season, or new mainnet payment
path until all of these hold:

1. Every Live claim re-verified on production within the last 7 days.
2. No open P0 or P1 bugs, and the findings of the last full audit closed.
3. Contracts reviewed externally, and admin roles split from a single key.
4. A security review of the payment, custody and sign-in paths.
5. A rehearsed rollback and incident runbook.

Mainnet work requested before then is a diversion under Rule 2.

## Start here

Before writing or moving code, read these references in order:

1. [capabilities.md](references/capabilities.md): what works today, with
   evidence. Start every task by checking the rows it touches.
2. [product.md](references/product.md): the product boundary and vocabulary.
3. [network-matrix.md](references/network-matrix.md): the chain model and what
   is verified versus planned.
4. [routes.md](references/routes.md) before touching routing or layout.
5. [ui.md](references/ui.md) before touching any user-facing surface, together
   with the `agon-design` skill.
6. [roadmap.md](references/roadmap.md) before adding anything.
7. [commands.md](references/commands.md) for the repository checks.

Completion check: the agent can say which Rule 1 part the task serves, which
capability rows it touches and their status, the network in scope, and the
docs it checked under Rule 3.

## Build procedure

### 1. Establish the source of truth

Confirm the repository root and inspect the actual files before interpreting a
plan. The repository source and installed packages outrank a marketing page, a
remembered API, or this skill.

Completion check: every external fact used in the change has a source file,
installed package path, real payload, or current documentation URL.

### 2. Keep product and network concerns separate

The product is always AGON. The active network is a typed runtime context.

```text
AGON
  Arc Testnet   AGON's own contracts, listings, tests, Arena and AGON hires
  Arc mainnet   outside services (Circle) paid in real USDC, behind a switch;
                no AGON contracts yet (Rule 5)
  BNB           parked; code stays in bnb-market/ and is not advertised
```

Every catalog record carries its source and network. Testnet and mainnet are
never mixed without a label, and a mainnet payment is never prepared without
an explicit mainnet choice and spending cap. Network selection changes the
catalog source, chain id, RPC, explorer, contracts, identity registry, payment
configuration, wallet and write guards together; a label-only switch is not a
network switch.

### 3. Preserve public discovery and gate only actions

Discovery, docs, agent pages and Playground results are public. Sign-in
belongs at the action that needs it (a hire, a test run, a listing, a wallet
change). Every write has an idempotency key, a durable pending state, receipt
verification and a retry path.

### 4. Follow the AGON design system

Load the `agon-design` skill before any user-facing change. Every important
surface designs loading, empty, error, unavailable, degraded, success and
recovery states, and shows nothing that Rule 4 does not allow.

### 5. Build the proof loop before breadth

The buyer path that every feature serves:

```text
describe the job
  -> AGON reads it and picks: proven agents first, then price, with the reason
  -> see the exact input, price, AGON fee and total, swap the pick if wanted
  -> pay inside limits; larger payments approved in the browser
  -> watch delivery and the receipt, with Arc transactions
  -> rate the delivered job (user rating feeds the next pick)
```

Do not add a source, category, partner, payment rail or chain until its loop is
honest end to end. A fixture or preview is labelled as such and cannot pay.

### 6. Delegate provider-specific work to a seam

One typed adapter per external provider, marketplace source or chain family.
Validate every external payload at the boundary, keep the source on every
record, and never copy another marketplace's badges as AGON evidence. Load the
`agon-asp` skill for listing work.

### 7. Protect irreversible paths

No private key, seed phrase, session token or secret in source, skills,
committed config, CLI arguments, logs or chat. State-changing operations need
explicit human confirmation, bounded permissions, idempotency, receipt
reconciliation and a safe unknown-outcome path. Never describe a prepared
transaction as completed.

## Verification before handoff

Run the smallest relevant checks first, then the full checks for the touched
surface:

- typecheck and focused tests for the pure core and boundary;
- the full suite and the production build;
- the signed-out discovery path and the protected-action refusal path;
- desktop and 390px mobile with no horizontal overflow; reduced motion;
- console errors and network failures;
- after deploy, the live check for every capability row the change touched,
  recorded in capabilities.md with the date.

Report failures plainly. Give the owner only user-owned Git commands; the owner
runs Git.
