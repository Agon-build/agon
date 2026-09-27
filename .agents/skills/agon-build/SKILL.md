---
name: agon-build
description: Build, extend, review, or explain AGON, the Arc-native marketplace that aggregates agent services and routes buyers to the best provider. Use when an agent works on AGON discovery, marketplace sources, intent routing, hiring, listing through MCP, Playground, Arena, trust evidence, route isolation, or the AGON coding-agent workflow. Read this before changing AGON code.
---

# Agon build

AGON is an Arc-native marketplace that aggregates agent services. It collects
services from several sources (its own registry first, then the Circle Agent
Marketplace and agents registered on Arc), turns a buyer's request into
structured terms, routes the buyer to the best provider, and lets people and
agents pay per use instead of subscribing. Providers list through AGON MCP and
keep ownership through their ERC-8004 identity. The product records evidence
separately from claims. Agon is not the old
ArcRun competition product. ArcRun remains a compatibility surface and must
not leak into new Agon product names, copy, routes, contracts, or network
selection.

This skill is the public build contract. It is deliberately safe to distribute.
Private hackathon plans, wallet details, credentials, operator runbooks,
unpublished addresses, and internal research do not belong here.

## Start here

Before writing or moving code, read these references in order:

1. [product.md](references/product.md) for the verified product boundary.
2. [network-matrix.md](references/network-matrix.md) for the chain model and
   what is verified versus planned.
3. [routes.md](references/routes.md) before touching routing or layout.
4. [ui.md](references/ui.md) before touching any user-facing surface.
5. [roadmap.md](references/roadmap.md) before adding a feature.
6. [commands.md](references/commands.md) for the repository checks.

Completion check: the agent can name the active product, the network
contexts in scope, the catalog sources and their status, the public discovery
routes, the protected action routes, and the current implementation boundary
without relying on memory.

## Non-negotiable build procedure

### 1. Establish the source of truth

Confirm the repository root and inspect the actual files before interpreting a
plan. Read the installed dependency versions and shipped type definitions for
any chain, wallet, payment, identity, or agent SDK. The repository source and
installed package outrank a marketing page, a remembered API, or this skill.

Do not invent an endpoint, contract address, token decimal count, event shape,
trust status, agent identity, price, or transaction result. If source evidence
is missing, represent the capability as unavailable or planned.

Completion check: every external fact used in the change has a source file,
installed package path, real payload, or current primary documentation URL.

### 2. Keep product and network concerns separate

The product is always AGON. The active network is a typed runtime context.
Never use an environment string as a substitute for a network adapter.

```text
AGON
  Arc Testnet   AGON's own contracts, listings, tests, and Arena (live)
  Arc mainnet   discovery and buyer-paid hiring of external services (planned)
  BNB           parked; code stays in bnb-market/ and is not advertised
```

Every catalog record carries its source and network. Testnet and mainnet
results are never mixed without a label, and a mainnet payment is never
prepared without an explicit mainnet choice and spending cap.

Network selection must change the catalog source, chain id, RPC, explorer,
contract inventory, identity registry, payment configuration, evidence scope,
wallet chain, and write guards together. It must clear prepared quotes,
signatures, and transactions from the previous network. A label-only switch is
not a network switch.

Completion check: the change selects one typed network context and every read,
write, link, status label, and receipt uses that same context.

### 3. Preserve public discovery and gate only actions

Landing, catalog, service detail, documentation, and Playground discovery are
public. Do not redirect those routes to login. Authentication belongs at the
action that needs an owner, signer, protected spend, listing publication, or
other state change.

When a write is added, use an explicit action gate with a human-readable reason,
an idempotency key, a durable pending state, receipt verification, and a retry
path. Do not make SIWE or a wallet connection the first action for a buyer who
is only browsing.

Completion check: a signed-out user can discover a service and understand its
status, while a protected action explains exactly why sign-in is required.

### 4. Use the AGON UI source of truth

Reuse the existing AGON mark, typography, token system, intro animation,
editorial spacing, hard borders, quiet surfaces, and mono evidence language.
Network and source badges are small context labels, never a second brand
color. Do not replace AGON with a generic
crypto dashboard, a copied protocol template, glass cards, purple-blue
gradients, particle backgrounds, decorative AI copy, or fake statistics.

Every important surface must design loading, empty, error, unavailable,
degraded, success, and recovery states. Motion must explain product state,
honor reduced motion, and stay out of the way of the first action.

Completion check: the UI brief or source-of-truth reference explains the user
intent for the changed surface and the implementation has no unsupported claim.

### 5. Build the proof loop before breadth

The primary buyer path is:

```text
land on AGON
  -> describe the outcome needed (or choose a category)
  -> review the parsed terms: outcome, inputs, budget, speed, payment mode
  -> compare ranked services across sources, with the reason for each rank
  -> inspect provider, version, price, authority, and evidence
  -> run a safe Playground test when available
  -> connect only for the protected action
  -> review and authorize
  -> observe delivery and receipt
  -> know how to stop, retry, or report a problem
```

Do not add a category, partner, payment rail, or chain until its end-to-end
state is honest. A visible fixture is acceptable only when clearly labelled as
fixture or preview and activation is disabled.

Completion check: the changed feature has one demonstrable, recoverable user
loop and a capability truth entry stating live, sandbox-verified,
fixture-backed, local-only, unsupported, or unmodelled.

### 6. Delegate provider-specific work to a seam

Use one typed adapter per external provider, marketplace source, or chain
family. The UI and AGON domain logic must not import vendor SDKs directly. A
marketplace source reads a documented public API, keeps its source reference
on every record, marks stale records, and never copies another marketplace's
badges as AGON evidence. Validate every external
payload at the boundary. Keep payment, identity, authority, evidence, and
execution as separate capabilities.

The existing `agon-asp` skill remains the specialized workflow for service
configuration, manifest verification, listing publication, Playground runs,
and verification requests. Load it when the task concerns an agent listing.

Completion check: swapping a provider, RPC, or chain changes one adapter and
its tests, not the marketplace UI or unrelated ArcRun routes.

### 7. Protect irreversible paths

No private key, seed phrase, session token, or secret enters source, skill
files, config committed to the repository, CLI arguments, logs, or chat.
Preparation is read-only. State-changing operations require explicit human
confirmation, bounded permissions, idempotency, receipt reconciliation, and a
safe unknown-outcome path. Never describe a prepared transaction as completed.

Completion check: the code can prove the final onchain state after a write and
the UI distinguishes prepared, submitted, confirming, confirmed, reverted,
expired, and unavailable.

## Public route rule

Use [routes.md](references/routes.md) as the current route inventory. In short,
new AGON work belongs to the AGON route family. Legacy ArcRun routes remain
isolated behind their existing data modules and must not be renamed or folded
into AGON discovery as a shortcut.

## Verification before handoff

Run the smallest relevant checks first, then the full checks for the touched
surface. At minimum:

- typecheck the affected package;
- run focused tests for the pure core and boundary;
- run the production build;
- smoke the signed-out discovery path;
- smoke the protected action refusal path;
- check desktop and 390px mobile layouts for horizontal overflow;
- check reduced motion when motion changed;
- inspect console errors and network failures;
- confirm no internal plan, research, credential, or generated artifact is in
  the public package.

The agent must report failures plainly. Do not claim a live chain, live agent,
payment, verification, or official adoption unless the source and runtime
evidence prove it.

Completion check: all applicable checks are recorded with their exact result,
known warnings are separated from failures, and the user receives only
user-owned Git commands for staging, committing, and pushing.
