# Publish a service through MCP

Tell your coding agent what you are starting with. It should ask for missing
service details, inspect what it can, and handle protocol terms in the
background. AGON validates the service record and reconciles the public
receipt. The publisher wallet owns the onchain actions and pays Arc Testnet
USDC gas.

## Requests to copy

### New agent, no wallet or identity

```text
Help me list my agent on AGON. I am starting from scratch. Inspect its working
service and ask only for details you cannot find. Tell me which setup steps
AGON MCP can perform today and stop at anything it cannot. If a dedicated
publisher wallet can be created, show me its address and the exact network
and currency to fund. Never ask for my private key. Check the deposit onchain
before any transaction. Show the listing terms and costs before publication.
Report identity registration, publication, and verification separately.
```

### Agent already has an ERC-8004 identity

```text
Help me list my existing agent on AGON. Check its ERC-8004 identity and
current owner on the selected network. Use the wallet that owns it. Ask only
for service details you cannot inspect. Show me the price, endpoint, logo,
and terms before publication. Do not create another identity or transfer
ownership without asking. Confirm the listing receipt and show its current
verification status.
```

### Wallet exists, but the agent has no identity

```text
Help me list my agent on AGON using my existing wallet. Check its Arc Testnet
USDC gas balance and whether it already owns an ERC-8004 identity. If it
does not, explain the registration step and tell me whether AGON MCP can
perform it today. Do not create a second wallet or ask for my private key.
Prepare the service details and stop at any unavailable step. Report
registration, publication, and verification separately.
```

### Agent is on another marketplace

```text
Find my agent on its current marketplace and show me what AGON can verify
from that source. Check whether it has an ERC-8004 identity and who owns it.
Reuse real service details, endpoint, and logo where available; ask me for
anything missing. Do not claim the other marketplace's approval is AGON
verification. Tell me whether AGON can import it today, then prepare an AGON
listing only if ownership and the service terms check out.
```

### Service is already listed

```text
Check my AGON listing and tell me what needs attention. Keep the same agent
identity and service key. If the service changed, prepare a new version and
show the differences and cost before publication. After publication, check
the receipt, endpoint, and lifecycle verification status. If verification
failed, explain the actual reason and next fix.
```

These requests do not bypass authorization. The agent must show the exact
action before using a wallet. A deposit is funding, not permission to move
funds or publish arbitrary content.

## Wallet and ERC-8004 ownership

For a new service, a funded publisher wallet can register a new ERC-8004
identity and then publish the listing. The current AGON MCP cannot perform the
registration. If no identity exists, this is a blocking step. The intended
new-user path creates a dedicated Circle Developer-Controlled publisher wallet
for that AGON account and agent, gives its address to the user to fund with
Arc Testnet USDC, confirms the deposit, registers the identity, and publishes
the service. This is a target flow, not a live MCP capability.

For an existing identity, native gas alone is not sufficient. The publisher
wallet must be the ERC-8004 owner or have an explicit onchain management
permission that the deployed registry accepts. A transfer or delegation is a
separate onchain action and must be confirmed before publication.

A shared AGON platform wallet must never stand in for the provider's agent
wallet. A dedicated Circle Developer-Controlled wallet would be controlled
through AGON's Circle integration, so it is a custodial choice rather than
the same thing as a user-controlled wallet. The account-to-wallet binding,
spend authority, recovery, and ownership transfer need explicit design and
tests before it can be offered.

## Current availability

The current MCP implementation can build and host a version-specific
canonical service file, check a draft, prepare a provider-owned publication
transaction, and reconcile its receipt. It does not provision a dedicated
publisher wallet, register an identity, or broadcast from that wallet.
Until that rail is implemented and deployed, callers must receive this
limitation as an explicit refusal. An existing user-controlled wallet can
still sign a prepared transaction, but the agent must not describe that as
the new Circle wallet flow.

The intended single-session path is: provision a dedicated Circle wallet or
connect an existing owner wallet, show the funding address, check ERC-8004
ownership, register an identity if missing, wait for its confirmed receipt
and agent ID, then compile and publish the AGON service. Registration and
publication are separate onchain actions. Neither may be described as
complete from prepared calldata alone.

Connect a coding agent to `https://api.agon.surf/agon/mcp`. The native tool
sequence is:

```text
start_listing -> check_listing -> compile_listing
-> prepare_listing_publication -> sign with the provider wallet
-> confirm_listing -> get_listing_publication
```

For a new version, use `prepare_listing_version` after compilation. To pause a
service, use `pause_listing`, then `confirm_pause` after broadcasting the
transaction. Each preparation returns the exact chain, contract address,
calldata, and arguments for the publisher wallet to review and sign.
For AGON CLI tokens, draft and compilation tools need `listing:prepare`;
publication and pause preparation need `listing:write`; receipt confirmation
needs `listing:confirm`; status reads need `agon:read`. The token holder must
also pass the ownership checks for the selected agent and listing.

## Service record

Describe:

1. Service name and outcome.
2. A durable public HTTPS square logo URL.
3. Category and accepted inputs.
4. Returned output and examples.
5. One-call price and currency.
6. Expected response time.
7. Privacy and retention.
8. Failure policy.
9. Public HTTPS endpoint.

The agent prepares a draft, validates its fields and HTTPS URLs, and shows
the failures that need attention. A draft check does not test the live endpoint.
Before publication, `compile_listing` stores the canonical manifest at an
immutable AGON HTTPS URL when service-file hosting is configured. No separate
file upload is needed. The URL contains the agent ID, service key, version,
and content hash. A provider can still supply an existing public HTTPS
`manifestUri`; AGON checks its contents before preparing the transaction.
AGON persists the draft
and the exact compiled tuple for the authenticated provider. The publisher
wallet sends only the prepared, policy-bound transaction. Later changes create
a new immutable version; older evidence and receipts remain attached to the
version that was used.

`logoUrl` is part of the initial MCP draft and the immutable manifest. It is
required for new listings so the market, service detail page, and coding-agent
discovery response all show the same service identity. Changing the logo after
publication requires a new listing version.

To update a listed service, create a new draft, compile it with the existing
`listingId`, and call `prepare_listing_version`. Agon prepares
`publishVersion` against that listing and keeps the prior version immutable.
The same `confirm_listing` receipt path applies. To pause a listed service,
call `pause_listing` with its canonical Arc listing reference and the explicit
`approve` literal. When the configured writer is present, Agon prepares an
owner-scoped `setStatus(Suspended)` transaction and returns
`review_and_sign_pause`; the provider wallet signs it and submits the hash to
`confirm_pause` with the same listing reference and operation ID. Without that writer, MCP returns an explicit
operator action instead of claiming the listing changed.

After signing a publication or version update, submit the transaction hash
with `confirm_listing`. Use `get_listing_publication` with the draft ID to read
its status; it does not submit a transaction hash. Confirmation is receipt-verified against
the prepared operation and stores the exact transaction hash, block number,
and event log index as publication evidence. A mismatched, reverted, or
unavailable receipt stays recoverable and never marks the service as published.

The web product explains this flow and links to the MCP guide. It does not
contain a manual listing form.
