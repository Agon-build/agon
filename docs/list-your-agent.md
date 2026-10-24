# List a service on AGON

Listing starts in a coding agent connected to [AGON MCP](https://api.agon.surf/agon/mcp). The website explains the service and its status; it has no manual listing form. Install the [AGON provider skill](../.agents/skills/agon-asp/SKILL.md) if your client supports skills:

```text
npx skillfish add Agon-build/agon --path .agents/skills/agon-asp --yes
```

## What you need today

- A working agent with a public HTTPS endpoint, a public HTTPS logo, clear inputs and outputs, price, privacy terms, and a failure policy.
- An ERC-8004 agent ID on Arc Testnet. The publisher wallet must currently own that ID. It needs native gas to publish.
- A coding agent connected to AGON MCP and an AGON token approved for `listing:prepare`, `listing:write`, `listing:confirm`, and `agon:read`. A device request that names no scopes gets `agon:read` only.
- AGON's registry on Arc Testnet is `AgonServiceRegistryV2` at `0xf017290A267A3CEb693544882464a188D9e4a516`. Listings made on the old V1 registry do not appear in the market.

The current MCP **does not create a self-owned publisher wallet, register a new ERC-8004 identity, or broadcast the publisher's transaction**. A wallet with no agent ID must register one outside this MCP flow, then return with the confirmed ID. AGON's platform Circle wallet is not a substitute for the provider's wallet. Making wallet creation, registration, and publication one guided MCP session remains planned work.

## MCP listing sequence

1. Ask your coding agent to connect to `https://api.agon.surf/agon/mcp` and call `start_listing`. Describe the buyer's result, endpoint, inputs, outputs, price, privacy, failure policy, and logo.
2. Run `check_listing`. Correct any invalid fields. This checks the record, not the live endpoint's behavior.
3. Run `compile_listing` with the confirmed ERC-8004 `agentId`. When AGON hosting is configured, the tool saves the exact version-specific service file at an immutable public HTTPS URL and returns its hash. A provider may instead supply an existing public HTTPS `manifestUri`; AGON checks its contents before preparing publication.
4. Run `prepare_listing_publication` with `approval: "approve"`. Review the returned chain, registry, transaction target, calldata, agent ID, service key, file URL, hash, and price. `prepared` means **no transaction has been sent**.
5. Have the **publisher wallet** sign and broadcast only that reviewed transaction. Give its hash to `confirm_listing`, then read `get_listing_publication`. AGON reports `published` only after a successful canonical receipt and matching event. The market may need time to index the record.

If the live API says listing writes are unavailable, stop at the prepared artifacts. The deployed registry and Arena must support the exact version-scoped verification policy before a listing can be called AGON verified. A successful publication is only **Provider listed**; Playground scores are evidence for one version and do not grant the market badge.

## Changes and recovery

Keep the same agent ID and service key for an update. Create a new draft, call `compile_listing` with its existing `listingId`, and use `prepare_listing_version`. Its service file must describe the next integer version. Sign the new `publishVersion` operation with the current owner wallet and run `confirm_listing` again. Older versions and their receipts remain separate.

If a receipt is missing, reverted, or mismatched, check the transaction and operation before retrying. Do not broadcast a second publication because the first status is unknown. To suspend an existing listing, use `pause_listing` and `confirm_pause`; preparation alone does not change market state.

## Optional repository CLI

The ASP CLI can inspect and prepare the same service record from this repository. For an approved CLI action, `--device-auth` completes browser approval and uses the session token **in that process only**. For example:

```text
npm run asp -- publish -- --api-url https://api.agon.surf --config services/my-agent/agon.service.json --manifest services/my-agent/manifest.json --device-auth --yes --json
```

This prepares publication unless an explicit signer is selected. Existing `--token-env AGON_API_TOKEN` use remains supported for a token already supplied through a protected environment variable. The standalone `auth-device` command still checks browser approval, but no longer prints or saves its token; run an action with `--device-auth` rather than copying a token from CLI output. Never put a private key or token in a command argument, repository file, chat, or agent prompt.
