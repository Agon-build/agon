# Arc Testnet marketplace verification migration

Status: **active in production.** The linked V2 contracts were deployed on Arc
Testnet on 23 September 2026 and independently source-verified with exact
creation and runtime matches on Sourcify. The receipt was pushed the same day.
On 24 September, `/agon/health` reported `listingVerifierReadiness` and
`arenaEvaluatorReadiness` both assigned and execution-enabled for the V2 pair,
and a hosted-file lookup returned 404 rather than 503, so the hosted-file store
is registered.

Still open after activation:

- No listing exists on RegistryV2 yet (`getListing(1)` reverts
  `ListingMissing()`), so the market is empty until providers publish fresh V2
  listings.
- Playground provider and endpoint QA configuration still names the old V1
  listing scopes. Update both when the V2 listings exist.
- The web app used the V1 addresses until the 24 September fix; its constants
  now match the receipt, and a test fails if they drift.

The rest of this page is the migration record as written before activation.

## Deployed pair checkpoint

Independent Arc RPC reads confirmed both deployment receipts succeeded in
block `63623534`, both addresses contain contract code, and the constructor
arguments in the transactions match the intended configuration:

The two receipts used `3,329,361` gas in total at an effective price of
`26,999,999,999` wei, costing `0.089892746996670639` native USDC.

| Contract | Address | Deployment transaction |
| --- | --- | --- |
| AgonServiceRegistryV2 | `0xf017290A267A3CEb693544882464a188D9e4a516` | `0x1c1b68923441789f4252dfed8466254eeb8aaf2b92e93c5167020fac7023fda1` |
| AgonArenaV2 | `0x05B81dF2F1615BBDEbd837991BAB199F65eCCB83` | `0xebff278695d7887661f6b14fb821f0c6fceb021d032dfa9ed228d3f187d4253b` |

`AgonArenaV2.services()` returns the V2 registry. Both contracts point to the
canonical `AgonProfileRegistry` at
`0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574`; Arena points to the
external `ValidationRegistry` at
`0x8004Cb1BF31DAf7788923b405b754f57acEB4272`. The intended signer
`0x294B30bf8051896097F4fcA081C21Baa569CE2bF` holds the registry
`VERIFIER_ROLE` and Arena `EVALUATOR_ROLE`. The recorded foundation admin
holds `DEFAULT_ADMIN_ROLE` on both.

At 17:07 UTC on 23 September, Arcscan's source API returned no verified source
for either new address. Sourcify then verified the registry at 17:21:30 UTC
and Arena at 17:22:48 UTC, with `exact_match` for both creation and runtime
bytecode. The public records are
[Registry V2](https://repo.sourcify.dev/5042002/0xf017290A267A3CEb693544882464a188D9e4a516)
and [Arena V2](https://repo.sourcify.dev/5042002/0x05B81dF2F1615BBDEbd837991BAB199F65eCCB83).
Sourcify's attempt to mirror those records to Arcscan returned HTTP 400, so
do not claim Arcscan has verified them. The local deployment receipt records
the actual pair and Sourcify evidence, pending the host preflight and user
commit/push that activate it.

At 17:37 UTC, a read-only request for a well-formed, nonexistent hosted-file
path on `https://api.agon.surf` returned `503 manifest_host_unavailable`.
The production API has not registered the hosted-file store. Set
`AGON_PUBLIC_API_URL=https://api.agon.surf` in the Arc service environment and
restart the API through the reviewed deployment path before providers publish
V2 listings. Check the database migration rather than assuming the 503 proves
anything about the tables; the route refuses the request before a database read.

The local deployment and verification proof is
`cd contracts && forge test --match-path test/AgonV2DeploymentFlow.t.sol -vv`.
It calls the deployment script with local contracts, runs an Arena review,
confirms marketplace verification for that version, and proves a new version
clears the badge. It does not contact Arc Testnet, host a service file, or
settle a payment.

## Why two contracts must move together

The deployed `AgonServiceRegistry` at
`0x2144C156B0a4581da2D046C2E41AC41C6C3938CB` has an unscoped
`setVerification` method. It cannot bind a Verified badge to the listing
version and manifest hash that Arena reviewed. The deployed `AgonArena` at
`0x2c6196dB6491A3D3837f53Ce72B84778bc5E9d8F` holds that V1 registry
address immutably. An Arc Testnet read of its `services()` getter on
23 September 2026 returned the V1 address. Pointing only the marketplace at
V2 would make Arena read the wrong listing when V1 and V2 listing IDs overlap.

`AgonServiceRegistryV2` and `AgonArenaV2` therefore deploy as a linked pair.
The V2 registry checks the exact current version and manifest hash on each
verification write and resets verification after a provider publishes a new
version. The V1 unscoped setter reverts on V2 for every state change, including
suspension and revocation. The V2 Arena uses that registry and grants the
configured evaluator role in its constructor. The V1 contracts and their
historical records remain unchanged.

## Preflight before any chain write

1. Confirm Arc Testnet chain ID `5042002`, the canonical ProfileRegistry
   `0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574`, and the external
   ValidationRegistry `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`
   from independent RPC reads. Confirm the foundation admin can approve the
   migration.
2. Check the evaluator wallet that will hold the new Arena `EVALUATOR_ROLE`
   and service-registry `VERIFIER_ROLE`. The intended testnet signer is
   `0x294B30bf8051896097F4fcA081C21Baa569CE2bF`; derive and compare it
   from the configured signer without printing its private key.
3. Finish or explicitly track pending V1 provider requests. In-flight V1
   evaluations can still be reconciled by their stored Arena address after
   cutover. New V1 listing writes must stop before activating V2.
4. Run `forge test` and a non-broadcast simulation of
   `script/DeployAgonServiceRegistryV2.s.sol:DeployAgonServiceRegistryV2`.
   Supply `PRIVATE_KEY`, `AGON_ADMIN_ADDRESS`, `AGON_VERIFIER_ADDRESS`,
   `AGON_PROFILE_REGISTRY_ADDRESS`, and
   `AGON_VALIDATION_REGISTRY_ADDRESS` through the operator's secret channel.
   Never put a key in the command line, deployment receipt, or logs.

## Activation sequence

1. The operator broadcasts the reviewed deployment script. Capture both
   addresses, transaction receipts, deployment block, and gas used. Confirm
   `AgonArenaV2.services()` equals the new `AgonServiceRegistryV2`, both
   contracts reference the canonical ProfileRegistry, and the intended signer
   holds both roles. A transaction hash alone is not a successful migration.
2. Require independent public source verification for both contracts. Add
   `contracts.AgonServiceRegistryV2`, `contracts.AgonArenaV2`, and
   `v2DeployBlock` to `contracts/deployments/agon-arc-testnet.json`. Add real
   `sourceVerification` records for both. The 23 September pair has exact
   Sourcify matches; Arcscan's external mirror returned HTTP 400. Keep the V1
   addresses and source records intact. The deployment parser rejects a
   one-sided V2 activation or a V2 record without its deployment block.
3. Set `AGON_PUBLIC_API_URL=https://api.agon.surf`, apply the hosted-manifest
   database migration, then deploy auth, indexer, and frontend from the same
   reviewed commit and deployment receipt. Runtime adapters select both V2
   addresses together. The indexer starts the new service stream at
   `v2DeployBlock`; the old service rows stay stored for exact historical
   references but do not appear as current-market V2 listings.
4. Read `/agon/health`. Require `writeReadiness.ready=true`,
   `protocolReadiness.ready=true`, `listingVerifierReadiness.assigned=true`,
   `listingVerifierReadiness.executionEnabled=true`,
   `arenaEvaluatorReadiness.assigned=true`, and
   `arenaEvaluatorReadiness.executionEnabled=true`. Confirm the reported
   registry and Arena addresses are the newly deployed pair. The Arena
   readiness check refuses an Arena linked to a different registry.
5. Providers publish fresh V2 listings under the ERC-8004 identities they
   own. They must use stable, version-specific manifest URLs whose bytes
   match the pinned hashes. Do not copy V1 Verified or Arena results to a
   different version or manifest. Run Playground and Arena for the V2 listing,
   then independently read the V2 registry and indexed catalog to confirm
   the same version is Verified. Run endpoint QA before a paid hire.

## Stop and recovery rules

- If either deployment or source verification fails, do not publish a V2
  receipt. A partly deployed pair has no active product effect.
- If health reports `service_registry_link_mismatch`,
  `scoped_verification_unsupported`, a missing role, or indexer lag, stop
  publication and paid hiring until the configuration is corrected.
- Before any V2 buyer transaction, removing the two V2 entries from the
  receipt and redeploying the prior build returns the public market to V1.
  V2 onchain records remain; do not delete or relabel them.
- After V2 buyer traffic begins, do not silently switch back to V1. Put the
  affected flow in maintenance and reconcile outstanding V2 work first.

Passing local tests proves the contract and application behavior under the
test fixtures. It does not prove deployment, indexing, role assignment,
marketplace verification, or a real x402 hire on Arc Testnet.
