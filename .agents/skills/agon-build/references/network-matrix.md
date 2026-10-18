# AGON network matrix

This is the public network contract. Facts below were read from the repository
deployment receipt and Arc documentation, and re-checked against Arc docs and
live RPC on 2026-10-18. Rule 3: re-verify before enabling any write.

## Contexts

| Context | Chain id | Role | Status |
| --- | ---: | --- | --- |
| Arc Testnet | 5042002 | AGON's registry, listings, tests, Arena, and AGON-listed hires | Live |
| Arc mainnet | 5042 | Hiring outside services (Circle Agent Marketplace) paid in real USDC, behind `AGON_OUTSIDE_ENABLED` | Built, never run live; no AGON contracts |
| BNB Smart Chain | 56 / 97 | Parked. Code lives in `bnb-market/` and is not part of the product | Out of scope |

A context with no AGON contracts cannot expose an AGON write action. Mainnet
payments need an explicit mainnet choice, a spending cap, and a clear label.

## Arc Testnet (from `contracts/deployments/agon-arc-testnet.json`)

| Contract | Address | Role |
| --- | --- | --- |
| AgonProfileRegistry | `0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574` | Active |
| AgonServiceRegistryV2 | `0xf017290A267A3CEb693544882464a188D9e4a516` | Active listing registry |
| AgonArenaV2 | `0x05B81dF2F1615BBDEbd837991BAB199F65eCCB83` | Active Arena, linked to RegistryV2 |
| AgonServiceRegistry (V1) | `0x2144C156B0a4581da2D046C2E41AC41C6C3938CB` | Historical only |
| AgonArena (V1) | `0x2c6196dB6491A3D3837f53Ce72B84778bc5E9d8F` | Historical only |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | External identity |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | External reputation |
| ERC-8004 ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | External validation |
| ERC-8183 AgenticCommerce | `0x0747EEf0706327138c69792bF28Cd525089e4583` | Standard escrow jobs (proxy); candidate escrow rail |
| USDC | `0x3600000000000000000000000000000000000000` | 6-decimal ERC-20 view of native USDC |

Explorer: `https://explorer.testnet.arc.io` (from Arc docs; `testnet.arcscan.app` is not in Arc docs and only redirects, so do not use it). The public RPC can rate-limit bursts;
the frontend uses an optional `NEXT_PUBLIC_ARC_RPC_HTTP` fallback and batching.

The frontend constants in `frontend/src/lib/arc.ts` must match the active pair
in the receipt. `frontend/src/lib/agon/deployment-alignment.test.ts` fails when
they drift.

## Arc mainnet

| Item | Value |
| --- | --- |
| RPC | `https://rpc.mainnet.arc.io` (public; partner RPCs also available) |
| Explorer | `https://explorer.arc.io` |
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Circle Gateway wallet | `0x77777777dcc4d5a8b6e418fd04d8997ef11000ee` |
| USDC | `0x3600000000000000000000000000000000000000` |

AGON has no contracts on Arc mainnet. Some Arc documentation pages still
describe mainnet as private; the RPC answered without credentials on
2026-09-24.

## Rules

- Chain id, RPC, explorer, contracts, payment asset, and write guards come from
  one typed context object, never from scattered constants.
- Never reuse a testnet address on mainnet or the reverse. Registry addresses
  differ between the two.
- Verify token decimals with `decimals()` before any amount math. Arc's native
  gas balance uses 18 decimals; the USDC ERC-20 view uses 6.
