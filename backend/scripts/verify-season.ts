/// Rebuild an AGON season leaderboard from public data and compare it with the
/// published one. Usage:
///   node --experimental-strip-types scripts/verify-season.ts \
///     --api https://api.agon.surf --season 1 --network arc --from-block <deploy block> --committer <AGON committer address>
import { createPublicClient, fallback, http, parseAbiItem, type Address, type Hex } from "viem";

import { agonNetwork } from "../src/agon/network.ts";
import { createForecastVerifier, forecastDomain } from "../src/agon/playground/seasons/forecast.ts";
import { createGammaClient } from "../src/agon/playground/seasons/polymarket.ts";
import { compareLeaderboards, rebuildLeaderboard, type ChainRoot, type PublishedRound } from "../src/agon/playground/seasons/verify.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
const api = args.get("api") ?? "https://api.agon.surf";
const seasonId = BigInt(args.get("season") ?? "1");
const network = agonNetwork(args.get("network") ?? "arc");
const fromBlock = BigInt(args.get("from-block") ?? "0");
const committer = (args.get("committer") ?? "") as Address;
if (!/^0x[0-9a-fA-F]{40}$/.test(committer)) throw new Error("--committer <AGON committer address> is required");

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${api}/agon/seasons/${seasonId}${path}`);
  if (!res.ok) throw new Error(`${path || "/"}: ${res.status}`);
  return (await res.json()) as T;
}

const season = await get<{ commitsAddress: Address }>("");
const client = createPublicClient({ transport: fallback(network.rpcHttp.map((u) => http(u))) });
// Arc public RPCs reject large log ranges, so read in windows and halve the
// window when a provider refuses it.
const rootEvent = parseAbiItem("event RootCommitted(uint256 indexed seasonId, uint64 indexed round, address indexed committer, bytes32 root, uint32 count)");
const head = await client.getBlockNumber();
const logs = [];
let window = 10_000n;
for (let start = fromBlock; start <= head; ) {
  const end = start + window - 1n > head ? head : start + window - 1n;
  try {
    logs.push(...(await client.getLogs({ address: season.commitsAddress, event: rootEvent, args: { seasonId }, fromBlock: start, toBlock: end })));
    start = end + 1n;
  } catch (error) {
    if (window <= 100n) throw error;
    window /= 2n;
  }
}
const chainRoots: ChainRoot[] = [];
for (const log of logs) {
  const block = await client.getBlock({ blockNumber: log.blockNumber! });
  chainRoots.push({
    round: log.args.round!,
    root: log.args.root!,
    count: log.args.count!,
    blockTime: new Date(Number(block.timestamp) * 1000),
    committer: log.args.committer!,
  });
}

const roundList = await get<{ rounds: { round: string }[] }>("/rounds?limit=1000");
const rounds: PublishedRound[] = [];
for (const r of roundList.rounds) {
  const d = await get<{ markets: { marketId: Hex; endAt: string; baselineBps: number }[]; forecasts: PublishedRound["forecasts"] }>(`/rounds/${r.round}`);
  rounds.push({ round: BigInt(r.round), markets: d.markets.map((m) => ({ ...m, endAt: new Date(m.endAt) })), forecasts: d.forecasts });
}
type PublishedEntry = { agentAddress: Address; erc8004AgentId: string | null; displayName: string; house: boolean; forecastEndpoint: string | null; enteredRound: string };
const entries = (await get<{ entries: PublishedEntry[] }>("/entries")).entries.map((e) => ({
  seasonId,
  agentAddress: e.agentAddress,
  erc8004AgentId: e.erc8004AgentId ? BigInt(e.erc8004AgentId) : null,
  displayName: e.displayName,
  house: e.house,
  forecastEndpoint: e.forecastEndpoint,
  enteredRound: BigInt(e.enteredRound),
}));

// Same gate as the server: results are read only for markets whose end time
// has passed, so an early resolution cannot make the two sides disagree.
const nowMs = Date.now();
const marketIds = [...new Set(rounds.flatMap((r) => r.markets.filter((m) => m.endAt.getTime() <= nowMs).map((m) => m.marketId)))];
const results = (await createGammaClient().getMarkets(marketIds)).map((m) => ({
  marketId: m.conditionId,
  status: (m.resolution === "yes" || m.resolution === "no" ? "resolved" : m.resolution === "void" ? "void" : "pending") as "resolved" | "void" | "pending",
  outcome: (m.resolution === "yes" ? 1 : m.resolution === "no" ? 0 : null) as 0 | 1 | null,
  checkedAt: new Date(),
}));

const domain = forecastDomain(network.chainId, season.commitsAddress);
const rebuilt = await rebuildLeaderboard({
  seasonId,
  agonCommitter: committer,
  chainRoots,
  rounds,
  entries,
  results,
  // EOA signatures only, matching the server (contract-wallet checks can change after a commit).
  verify: createForecastVerifier(domain),
});
const published = await get<{ rows: { agentAddress: string; rank: number | null; rating: number; forecastsResolved: number }[] }>("/leaderboard");
const diffs = compareLeaderboards(rebuilt.rows, published.rows);

for (const p of rebuilt.problems) console.log(`PROBLEM ${p}`);
for (const d of diffs) console.log(`DIFF ${d}`);
const pass = rebuilt.problems.length === 0 && diffs.length === 0;
console.log(pass ? "PASS: leaderboard matches public data" : "FAIL");
process.exit(pass ? 0 : 1);
