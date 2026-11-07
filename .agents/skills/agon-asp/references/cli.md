# ASP CLI contract

Run commands from the Agon repository root:

```text
npm run asp -- <command> -- [options]
```

Keep the second `--` before options so npm passes them to the ASP CLI. Commands without options, such as plain `categories` or `help`, do not need it.

## Service config

Create a JSON object with these exact fields:

```json
{
  "chainId": "5042002",
  "agentId": "42",
  "serviceKey": "protocol-security-review",
  "manifestUri": "",
  "name": "Protocol security review",
  "description": "Reviews smart contracts and returns prioritized findings with evidence.",
  "logoUrl": "https://agent.example.com/logo.png",
  "category": "verification",
  "endpoint": "https://agent.example.com/review",
  "tags": ["security", "solidity"],
  "amountUSDC": "0.01"
}
```

- Use decimal strings for chain ID, agent ID, and price.
- Use one of the slugs printed by `categories`; the CLI also accepts its label or protocol ID.
- Use a lowercase hyphenated stable service key.
- Use a public HTTPS service endpoint.
- Use a durable public HTTPS logo URL. The logo is required, is pinned into the immutable service manifest, and should be a square PNG, JPEG, WebP, or SVG that remains readable at 88px.
- Use no more than eight search tags.
- Use up to six USDC decimal places. The first CLI release prepares direct x402 only.
- Leave `manifestUri` empty to let AGON host the reviewed service file at a permanent, version-specific HTTPS URL during `publish` or `update`. You may supply your own public HTTPS URL; AGON reads it and checks its hash before preparing publication. Use a new URL for each version.

## Commands

List the canonical category registry:

```text
npm run asp -- categories
npm run asp -- categories -- --json
```

Prepare artifacts without publishing:

```text
npm run asp -- prepare -- --config asp.json --manifest-out manifest.json --payload-out listing.json
```

The command refuses to replace existing outputs. Add `--force` only after checking the targets.

Verify a local manifest semantically and recompute its canonical hash:

```text
npm run asp -- verify-manifest -- --manifest manifest.json
npm run asp -- verify-manifest -- --manifest manifest.json --expected-hash 0x...
```

Inspect effective API capabilities:

```text
npm run asp -- health -- --api-url https://api.example.com
```

Inspect a public listing. Supply the local manifest for complete anchor proof when the indexer does not expose its body:

```text
npm run asp -- inspect -- --api-url https://api.example.com --reference 5042002:0xRegistry:7 --manifest manifest.json
```

Add `--current-owner 0x...` only when the address came from a current ERC-8004 ownership read.

For an authenticated ASP action, add `--device-auth` to approve its required scopes in the browser. The token stays in that one CLI process and is not printed or saved. Existing `--token-env NAME` commands remain supported when a token is already available in a protected environment variable. Standalone `auth-device` reports browser approval but deliberately does not export a token for a later command. Do not copy a token through an agent prompt or shell history.

Prepare an exact publication operation after reviewing the service fields:

```text
npm run asp -- publish -- --api-url https://api.example.com --config asp.json --manifest manifest.json --device-auth --yes
```

The response state is `prepared` and includes the exact chain, contract, calldata,
function, and arguments. This command does not broadcast unless a signer mode is
selected. Review that intent before choosing an explicit signing mode.

For a Circle-managed email wallet, the CLI can submit the exact prepared call
after a human explicitly approves the command:

```text
npm run asp -- publish -- --api-url https://api.example.com --config asp.json --manifest manifest.json --token-env AGON_API_TOKEN --signer circle --yes --json
```

For a Web3 wallet, keep the private key in the process environment only. The
CLI checks that the key address matches the authenticated Agon wallet and that
the RPC chain matches the prepared operation. It signs only the prepared
calldata, never sends the key to Agon, and requires `--yes`:

```text
$env:AGON_PRIVATE_KEY = "<64-hex-character key>"
npm run asp -- publish -- --api-url https://api.example.com --config asp.json --manifest manifest.json --token-env AGON_API_TOKEN --signer private-key --private-key-env AGON_PRIVATE_KEY --rpc-url https://rpc.testnet.arc.io --yes --json
Remove-Item Env:AGON_PRIVATE_KEY
```

Use the same `--signer` options with `update`. Do not put a key in a config,
manifest, shell history, source file, CI log, or chat message. Without
`--signer`, the operation remains prepared for a browser wallet to sign.

After the wallet reports a successful transaction hash, ask Agon to verify its
canonical receipt and event:

```text
npm run asp -- confirm -- --api-url https://api.example.com --operation <operation-id> --tx-hash 0x...
Remove-Item Env:AGON_API_TOKEN
```

On Bash-compatible shells, use `export AGON_API_TOKEN=...` and `unset AGON_API_TOKEN`. Never put the token directly in the command or commit it to a file. Use `--token-env NAME` to select a different environment variable.

Only a `confirmed` response is Provider listed. It remains unverified until the
separate Agon Arena process verifies the exact listing scope.

## Update an existing listing

Keep the same `agentId` and `serviceKey`. Edit the real service, increment the
manifest `version` to 2 or higher, then run:

```text
npm run asp -- verify-manifest -- --manifest services/code-review/manifest-v2.json
npm run asp -- update -- --api-url https://api.example.com --listing-id 7 --config services/code-review/agon.service.json --manifest services/code-review/manifest-v2.json --token-env AGON_API_TOKEN --yes --json
```

`update` prepares `publishVersion` for the existing listing. It does not
broadcast. Review the returned chain, ServiceRegistry, listing ID, version,
manifest URI, hash, and calldata before the owner wallet signs. Confirm the
successful transaction with the existing `confirm` command. Older versions
and their evidence are immutable.

## Run and request verification from the CLI

Run a real category challenge for the exact listing version, then create the
scoped Arena verification request:

```text
npm run asp -- evaluate -- --api-url https://api.example.com --reference 5042002:0xRegistry:7 --version 2 --category analysis --task evidence-under-pressure --token-env AGON_API_TOKEN --json
npm run asp -- request-verification -- --api-url https://api.example.com --reference 5042002:0xRegistry:7 --playground-run <run-id> --token-env AGON_API_TOKEN --yes --json
```

The first command returns a real run ID, score, output, evidence root, and
provider provenance. The second prepares an official Arena request from that
run. It may return `arena_disabled` until the environment is configured. A
Playground score is not the same as official Arena verification.

Add `--json` to any command for machine-readable output. `verify-manifest` and `inspect` set a nonzero exit code for invalid, mismatched, unsafe, or incomplete proof.
