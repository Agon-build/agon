---
name: agon-asp
description: Build, update, publish, inspect, and request verification for service listings in Agon Market through the repository CLI. Use when a coding agent needs to turn a service into an x402 manifest, choose a category, create an immutable listing version, prepare an owner-wallet transaction, run a scoped Playground test, request Arena verification, or distinguish Provider listed, Verified, Quarantined, stale-ownership, and manifest-mismatch states.
---

# Agon ASP

Use Agon's deterministic ASP CLI. Keep preparation and verification read-only. Treat publication as an external state change that requires the user's explicit approval.

The `agon-build` skill's five standing rules apply here too: listing serves the aggregator direction, every Arc and Circle fact is checked in the current docs before use, and nothing is called working unless it is Live in `agon-build/references/capabilities.md`.

## Install the skill

Install the public package into detected coding agents with:

```text
npx skillfish add Iziedking/agon --path .agents/skills/agon-asp --yes
```

The same package is downloadable from the Agon BUILD guide at `/downloads/agon-asp.zip`. Review the package before use. Never put private keys, seed phrases, or session tokens in the skill, a repository, a CLI argument, or a chat message. A Web3 private key may be supplied to the local CLI only through a protected environment variable when the user explicitly chooses CLI signing; it is never sent to Agon or logged.

## Load the command contract

Read [references/cli.md](references/cli.md) before preparing, publishing, or verifying a service. Use its config schema and exact commands.

## MCP-first operation

When an MCP-capable host is available, prefer task-level AGON operations over
asking the user to run protocol commands. The agent should:

1. Search services by the requested outcome, category, price, privacy, and
   availability.
2. Explain the provider, one-call price, inputs, outputs, delivery time, and
   failure policy in plain language.
3. Preview an immutable terms digest before any payment or escrow action.
4. Ask for approval only at the irreversible payment or publication boundary.
5. Execute through the configured wallet policy, preserving caps, recipient
   allowlists, expiry, and the kill switch.
6. Return delivery, payment, and reconciliation evidence as separate facts.

Never require a buyer to construct x402 headers, registry calldata, manifest
hashes, or facilitator requests manually. Keep those details in an advanced
diagnostic result. Pay-per-call is the default; use escrow only when the
service terms require milestones or acceptance.

### New publisher without a wallet or ERC-8004 identity

Discover the MCP tools first. If `setup_managed_publisher` is absent, explain
that this environment cannot complete the managed flow; do not ask the user to
fund an address. When available, use this sequence:

1. `start_listing` from inspected service facts. Show the user the name,
   endpoint, logo, price, privacy, and failure terms.
2. `setup_managed_publisher` for that draft. Explain that this dedicated Arc
   Testnet wallet is Circle Developer-Controlled and operated by AGON. Give the
   exact funding address and request native Arc Testnet USDC for gas. Never
   request a key or seed phrase.
3. `get_managed_listing` to check balance and the exact `termsDigest`. Funding
   alone does not authorize registration or publication.
4. Obtain the user's explicit approval of the exact draft and AGON custody,
   then call `approve_managed_listing` with its digest and `approval: "approve"`.
5. Call `continue_managed_listing`, repeating only while it reports `pending`.
   It registers the ERC-8004 identity and publishes the listing through the
   dedicated wallet. Use `get_managed_listing` after a restart.
6. Report the registered agent ID, confirmed listing reference, and later
   lifecycle verification as separate facts. `fund_wallet`, `pending`, and
   `needs_attention` never mean published or verified.

The managed tools are gated off by default and require a live Circle and Arc
rehearsal before production claims. Existing owner-wallet identities remain
on the owner-signed preparation and confirmation path below.

## Follow the workflow

1. Confirm the current directory is the Agon repository root and `frontend/package.json` exposes the `asp` script.
2. Run `npm run asp -- categories` and select by plain-language buyer intent. Never type or maintain a separate numeric category map.
3. Inspect the provider's actual service implementation. If it is a new service, create it with `init` and replace the sample implementation. If it already exists, preserve its ERC-8004 `agentId`, stable `serviceKey`, public listing reference, and trust history.
4. Create or update the ASP config from observed facts. Include the service's real name, concise buyer-facing outcome, and a durable public HTTPS square logo in `logoUrl`; the market and MCP discovery response use this identity. Do not invent endpoints, capabilities, prices, ownership, logos, or manifest URIs. For a new service, run `prepare`. For an existing service update, edit the implementation and manifest, increment the manifest's integer `version` to 2 or higher, then use `update`.
5. Run `verify-manifest` against the local artifact before publication. Leave `manifestUri` empty to let AGON host the exact file at an immutable version-specific HTTPS URL when `publish` or `update` runs. If the provider supplies its own public HTTPS URL, AGON checks that hosted file and its hash before preparing the transaction. Never overwrite a URL used by an earlier version.
6. Run `health`. If `listingWrites` is false, stop and report that publication is unavailable. Preserve the generated artifacts; do not imply a transaction.
7. Before `publish`, show the agent ID, service name, category, endpoint host, price, manifest hash, planned AGON hosting or supplied manifest URI, and initial trust state. Show the final AGON-hosted URI returned by the prepared transaction. Ask for explicit approval if the user has not already authorized this exact publication.
8. Use `--device-auth` on the ASP action to approve its required scopes in the browser and keep the token in that CLI process. A token already supplied through a protected environment variable remains supported with `--token-env NAME`. The standalone `auth-device` command reports approval but never prints or saves a token, so it cannot authenticate a later command. Never request or accept a token in a CLI argument, file, prompt, or chat response.
9. Run `publish` or `update` only with the reviewed config, matching local manifest, and `--yes`. Without `--signer`, it creates a durable `prepared` operation and exact transaction intent but does not broadcast.
10. For Circle-managed email users, use `--signer circle --yes`. The CLI submits only the exact prepared call through Circle and polls for the receipt. The human must approve the command with `--yes`; Circle credentials and key material stay on the server.
11. For Web3 users who intentionally choose terminal-only signing, use `--signer private-key --private-key-env AGON_PRIVATE_KEY --rpc-url https://... --yes`. The CLI reads the key only from that environment variable, checks that its address matches the authenticated Agon wallet and that the RPC chain matches the prepared operation, signs only the prepared calldata, waits for a successful receipt, and confirms it. Never print, paste, commit, or transmit the key.
12. Show the exact chain, contract, function, arguments, and operation ID before any signer runs. `--yes` is required for both Circle and Web3 signing and is the human approval boundary. After a successful transaction, report Provider listed only when AGON returns `confirmed` receipt proof. Never report it as Agon verified.
13. Run `inspect` with the confirmed listing reference and local manifest. Report hash evidence, scoped trust state, payment eligibility, quarantine reason, ownership freshness when supplied, and provenance separately.

## Update an existing agent

An update never replaces an old record and never needs a new ERC-8004 identity. Keep the same `agentId` and `serviceKey`, deploy the improved service, increment the manifest `version`, and publish a new immutable listing version:

```text
npm run asp -- verify-manifest -- --manifest services/my-agent/manifest-v2.json
npm run asp -- update -- --api-url https://api.agon.surf --listing-id 7 --config services/my-agent/agon.service.json --manifest services/my-agent/manifest-v2.json --token-env AGON_API_TOKEN --yes --json
```

The update command checks that the local manifest exactly matches the reviewed config and returns a `prepared` operation. The coding agent must show the chain, ServiceRegistry, `publishVersion` call, listing ID, new version, manifest URI, and canonical hash. Use `--signer circle --yes` for a Circle-managed wallet or `--signer private-key --private-key-env AGON_PRIVATE_KEY --rpc-url https://... --yes` for an explicitly approved Web3 terminal signer. Without a signer, the owner signs in the UI and the agent runs `confirm` afterward. The old version, scores, receipts, and evidence remain attached to their original version.

## Run a real test and understand automatic verification

After a confirmed listing version is live, Agon's lifecycle worker automatically runs the exact category challenge and x402 endpoint check for eligible manifests. The provider does not visit the admin page or manually request approval. Playground remains available for an immediate, user-visible test:

```text
npm run asp -- evaluate -- --api-url https://api.agon.surf --reference 5042002:0xServiceRegistry:7 --version 2 --category analysis --task evidence-under-pressure --token-env AGON_API_TOKEN --json
```

`evaluate` returns the real run ID, score, output, evidence root, provider host, and exact listing scope. It is one evidence run, not the market approval itself. The lifecycle worker records every scheduled check separately, approves the exact immutable version only after the complete policy passes, and repeats the check while that version remains active. The first failure raises a warning and operator alert. Repeated failures suspend the exact version; a later full pass can recover it. Unknown chain outcomes remain pending and are reconciled with the stored transaction hash before another write.

The older `request-verification` command remains an advanced Arena evidence path. It must never be presented as a requirement for providers or buyers, and it does not replace automatic lifecycle certification.

## Monitor a published agent

Keep the same `agentId`, service key, listing reference, manifest, category, and version when comparing an agent over time. Use the following read paths:

- Run `health` to check API reachability and whether listing or verification capabilities are available.
- Read `capabilities.certificationLifecycle` to confirm the recurring worker, interval, failure threshold, endpoint-QA requirement, and operator alert configuration.
- Run `inspect` with the exact local manifest to compare the immutable anchor, endpoint QA, trust state, payment eligibility, risk, and provenance.
- Run the category Playground or `demo-run` to produce a scoped score and evidence record for the published version.
- Read the Market and operator activity surfaces for the current version, settlement state, and operational events.

Treat a score as evidence for one exact version only. Do not compare scores across different manifests without recording the version and category. Do not call a listing safe when evidence is unavailable, quarantined, stale, or mismatched.

## Interpret trust correctly

People see three words: **Listed** (published, not verified), **Verified**, and **Paused** (a check failed or the terms changed). The API and CLI may still return the older values below; translate them when you speak to a person.

- `Provider listed` or `UNVERIFIED` (shown as Listed): the provider published the service. Direct x402 may be available. Agon has not verified it.
- `VERIFIED`: the listing's exact agent, listing, version, and category scope has current Agon verification.
- `QUARANTINED` (shown as Paused), `ANCHOR MISMATCH`, or `STALE OWNERSHIP`: treat the listing as unsafe. Do not recommend payment or escrow.
- `unavailable` manifest evidence: say local recomputation could not be completed. Do not infer a match from a URI or onchain hash alone.

Never claim escrow readiness unless the API reports it and the CLI returns coherent verified evidence. Never expand the acronym `ASP` until Agon locks the product terminology.
