import { randomBytes } from "node:crypto";
import { encodeAbiParameters, keccak256, verifyTypedData, type Address, type Hex } from "viem";

import { merkleProof, merkleRoot } from "../../../coordinator/merkle.ts";

export const FORECAST_DEADLINE_MS = 3_600_000;

export type ForecastDomain = { name: "AgonSeason"; version: "1"; chainId: number; verifyingContract: Address };

export type Forecast = {
  seasonId: bigint;
  round: bigint;
  marketId: Hex;
  probabilityBps: number;
  salt: Hex;
  agent: Address;
};

export const FORECAST_TYPES = {
  Forecast: [
    { name: "seasonId", type: "uint256" },
    { name: "round", type: "uint64" },
    { name: "marketId", type: "bytes32" },
    { name: "probabilityBps", type: "uint16" },
    { name: "salt", type: "bytes32" },
    { name: "agent", type: "address" },
  ],
} as const;

export function forecastDomain(chainId: number, commitsAddress: Address): ForecastDomain {
  return { name: "AgonSeason", version: "1", chainId, verifyingContract: commitsAddress };
}

export function isProbabilityBps(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000;
}

export function forecastLeaf(f: Forecast): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }, { type: "uint16" }, { type: "bytes32" }],
      [f.agent, f.seasonId, f.round, f.marketId, f.probabilityBps, f.salt],
    ),
  );
}

function message(f: Forecast) {
  return {
    seasonId: f.seasonId,
    round: f.round,
    marketId: f.marketId,
    probabilityBps: f.probabilityBps,
    salt: f.salt,
    agent: f.agent,
  };
}

/// The EIP-712 document in the JSON form Circle's signTypedData expects.
/// Integers wider than JavaScript numbers travel as decimal strings.
export function forecastTypedDataJson(domain: ForecastDomain, f: Forecast): string {
  return JSON.stringify({
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Forecast: FORECAST_TYPES.Forecast,
    },
    domain,
    primaryType: "Forecast",
    message: {
      seasonId: f.seasonId.toString(),
      round: f.round.toString(),
      marketId: f.marketId,
      probabilityBps: f.probabilityBps,
      salt: f.salt,
      agent: f.agent,
    },
  });
}

export type TypedDataVerifier = {
  verifyTypedData(args: {
    address: Address;
    domain: ForecastDomain;
    types: typeof FORECAST_TYPES;
    primaryType: "Forecast";
    message: Record<string, unknown>;
    signature: Hex;
  }): Promise<boolean>;
};

/// Without a client this verifies EOA signatures locally. With a viem public
/// client it also accepts smart-account (EIP-1271) signatures.
export function createForecastVerifier(
  domain: ForecastDomain,
  client?: TypedDataVerifier,
): (f: Forecast, signature: Hex) => Promise<boolean> {
  return async (f, signature) => {
    const args = {
      address: f.agent,
      domain,
      types: FORECAST_TYPES,
      primaryType: "Forecast" as const,
      message: message(f),
      signature,
    };
    try {
      return client ? await client.verifyTypedData(args) : await verifyTypedData(args);
    } catch {
      return false;
    }
  };
}

/// The slate leaf commits a round's markets, baselines and end times inside
/// the same root as its forecasts, so the public check also catches a
/// baseline or end time changed after the commit. End times are whole
/// seconds; markets are sorted by id so order never changes the leaf.
export function slateLeaf(seasonId: bigint, round: bigint, markets: { marketId: Hex; baselineBps: number; endAt: Date }[]): Hex {
  const sorted = [...markets].sort((a, b) => (a.marketId.toLowerCase() < b.marketId.toLowerCase() ? -1 : 1));
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32[]" }, { type: "uint16[]" }, { type: "uint64[]" }],
      [
        "AGON_SEASON_SLATE",
        seasonId,
        round,
        sorted.map((m) => m.marketId.toLowerCase() as Hex),
        sorted.map((m) => m.baselineBps),
        sorted.map((m) => BigInt(Math.floor(m.endAt.getTime() / 1000))),
      ],
    ),
  );
}

/// Every leaf's proof in one pass over the tree levels (the same pairing as
/// coordinator/merkle.ts), instead of rebuilding the tree once per leaf.
export function allProofs(sortedLeaves: Hex[]): Map<Hex, Hex[]> {
  const proofs = new Map<Hex, Hex[]>(sortedLeaves.map((l) => [l, []]));
  let owners: Hex[][] = sortedLeaves.map((l) => [l]);
  let level = sortedLeaves;
  while (level.length > 1) {
    const nextLevel: Hex[] = [];
    const nextOwners: Hex[][] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1];
      if (b === undefined) {
        nextLevel.push(a);
        nextOwners.push(owners[i]!);
        continue;
      }
      for (const leaf of owners[i]!) proofs.get(leaf)!.push(b);
      for (const leaf of owners[i + 1]!) proofs.get(leaf)!.push(a);
      const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
      nextLevel.push(keccak256(`0x${x.slice(2)}${y.slice(2)}` as Hex));
      nextOwners.push([...owners[i]!, ...owners[i + 1]!]);
    }
    level = nextLevel;
    owners = nextOwners;
  }
  return proofs;
}

export function buildRoundTree(leaves: Hex[]): { root: Hex; leaves: Hex[] } {
  if (leaves.length === 0) throw new Error("buildRoundTree: no leaves");
  const sorted = [...new Set(leaves.map((l) => l.toLowerCase() as Hex))].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  return { root: merkleRoot(sorted), leaves: sorted };
}

export function proofFor(sortedLeaves: Hex[], leaf: Hex): Hex[] {
  const index = sortedLeaves.indexOf(leaf.toLowerCase() as Hex);
  if (index < 0) throw new Error("proofFor: leaf not in tree");
  return merkleProof(sortedLeaves, index);
}

export function verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let node = leaf.toLowerCase() as Hex;
  for (const sibling of proof) {
    const [a, b] = BigInt(node) < BigInt(sibling) ? [node, sibling] : [sibling, node];
    node = keccak256(`0x${a.slice(2)}${b.slice(2)}` as Hex);
  }
  return node === root.toLowerCase();
}

export function committedInTime(commitBlockTime: Date, marketEnd: Date): boolean {
  return commitBlockTime.getTime() <= marketEnd.getTime() - FORECAST_DEADLINE_MS;
}

export function newSalt(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}
