/// Lists Agon's own agents through the managed publisher, step by step.
/// You sign in once in the browser (the token stays in memory, never printed),
/// fund each publisher wallet with a little Arc Testnet USDC for gas, approve
/// each listing by typing APPROVE, and get the AGON_FIRST_PARTY_AGENTS value.
/// Usage (repo root): node --no-warnings --experimental-strip-types frontend/scripts/agon-list-agents.ts [--only atlas,vesper]
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const API = "https://api.agon.surf";
const SITE = "https://agon.surf";
const SCOPES = ["agon:read", "listing:prepare", "listing:write"];

type Draft = {
  name: string; logoUrl: string; outcome: string; category: string; inputs: string[]; outputs: string[];
  priceUSDC: string; expectedLatencyMs: number; privacy: string; failurePolicy: string; endpoint: string;
};

const house = (key: string, name: string): Draft => ({
  name,
  logoUrl: `${SITE}/agents/${key}.svg`,
  outcome: "Forecasts one Polymarket market: the chance it resolves Yes, with its reasons.",
  category: "analysis",
  inputs: ["Polymarket market id", "market question", "end date", "crowd price (optional)", "notes (optional)"],
  outputs: ["probability of Yes", "reasons"],
  priceUSDC: "0.22",
  expectedLatencyMs: 60_000,
  privacy: "The request is used only to produce this forecast. Nothing is shared with third parties.",
  failurePolicy: "No forecast, no charge: payment settles only when the forecast is returned.",
  endpoint: `${API}/agon/agents/house/${key}/forecast`,
});

const AGENTS: Record<string, Draft> = {
  lead: {
    name: "Agon Lead Agent",
    logoUrl: `${SITE}/agents/lead.svg`,
    outcome: "Answers a Polymarket question: finds the market, buys live data, hires the best-rated forecaster and returns the forecast with receipts.",
    category: "analysis",
    inputs: ["question about a Polymarket market"],
    outputs: ["forecast with reasons", "matching market", "receipts for every payment"],
    priceUSDC: "0.30",
    expectedLatencyMs: 120_000,
    privacy: "The question is used only to answer it. Data sellers and forecasters see only what they need.",
    failurePolicy: "If no market matches or no forecaster delivers, the full price is refunded on Arc.",
    endpoint: `${API}/agon/agents/lead/forecast`,
  },
  atlas: house("atlas", "Atlas"),
  vesper: house("vesper", "Vesper"),
  kestrel: house("kestrel", "Kestrel"),
  drift: house("drift", "Drift"),
};

type Managed = { status: string; nextAction: string; draftId: string; fundingAddress: string | null; balanceUSDC: string | null; termsDigest: string; agentId: string | null; reference: string | null; txHash: string | null };

const rl = createInterface({ input: stdin, output: stdout });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(): Promise<string> {
  const res = await fetch(`${API}/auth/cli/device`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientName: "agon-list-agents", scopes: SCOPES }) });
  const start = await res.json() as { deviceCode: string; userCode: string; verificationUri: string; expiresAt: string; pollInterval: number };
  if (!res.ok || !start.deviceCode) throw new Error("Could not start sign-in");
  console.log(`\n1. Open ${start.verificationUri}\n2. Sign in with the Agon account that should own these listings\n3. Enter code ${start.userCode} and approve: ${SCOPES.join(", ")}\n\nWaiting for approval...`);
  const deadline = new Date(start.expiresAt).getTime();
  while (Date.now() < deadline) {
    await sleep(Math.max(1, start.pollInterval) * 1000);
    const t = await fetch(`${API}/auth/cli/device/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceCode: start.deviceCode }) });
    if (t.status === 428) continue;
    const body = await t.json().catch(() => null) as { accessToken?: string } | null;
    if (t.ok && body?.accessToken) { console.log("Signed in.\n"); return body.accessToken; }
    throw new Error(`Sign-in failed (HTTP ${t.status})`);
  }
  throw new Error("Sign-in expired; run the command again");
}

let rpcId = 0;
async function tool<T>(token: string, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/agon/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (body.error) throw new Error(`${name}: ${body.error.message}`);
  const parsed = JSON.parse(body.result?.content?.[0]?.text ?? "null");
  if (body.result?.isError) throw new Error(`${name}: ${parsed?.error?.message ?? "failed"}`);
  return parsed as T;
}

async function listOne(token: string, key: string, draft: Draft): Promise<{ agentId: string; owner: string } | null> {
  console.log(`\n=== ${draft.name} (${key}) ===`);
  const { draftId } = await tool<{ draftId: string }>(token, "start_listing", draft);
  let m = await tool<Managed>(token, "setup_managed_publisher", { draftId });
  for (let rounds = 0; rounds < 200; rounds += 1) {
    if (m.reference && m.agentId && m.fundingAddress) {
      console.log(`Published: agent #${m.agentId}, listing ${m.reference}${m.txHash ? `, tx ${m.txHash}` : ""}`);
      console.log("Agon's checker now verifies it automatically within a few minutes.");
      return { agentId: m.agentId, owner: m.fundingAddress };
    }
    if (m.status === "fund_wallet") {
      console.log(`\nFund the publisher wallet for gas: send 1 USDC on Arc Testnet to\n  ${m.fundingAddress}\n(current balance ${m.balanceUSDC ?? "unknown"}). ${m.nextAction}`);
      await rl.question("Press Enter once it has arrived... ");
      m = await tool<Managed>(token, "get_managed_listing", { draftId });
      if (m.status === "fund_wallet") continue;
    }
    if (m.status === "review_terms" || m.nextAction === "approve_managed_listing" || /approve its exact terms/.test(m.nextAction)) {
      console.log(`\nAbout to register an ERC-8004 identity and publish this listing on Arc Testnet:\n  name      ${draft.name}\n  price     ${draft.priceUSDC} USDC per call\n  endpoint  ${draft.endpoint}\n  wallet    ${m.fundingAddress} (Agon-managed)\n  digest    ${m.termsDigest}`);
      const answer = (await rl.question("Type APPROVE to publish, anything else to skip: ")).trim();
      if (answer !== "APPROVE") { console.log("Skipped."); return null; }
      m = await tool<Managed>(token, "approve_managed_listing", { draftId, termsDigest: m.termsDigest, approval: "approve" });
    }
    if (m.status === "needs_attention") {
      console.log(`Needs attention: ${m.nextAction}`);
      const again = (await rl.question("Press Enter to retry, or type SKIP: ")).trim();
      if (again === "SKIP") return null;
    }
    m = await tool<Managed>(token, "continue_managed_listing", { draftId });
    if (m.status === "pending") { process.stdout.write("."); await sleep(4000); }
  }
  console.log("Stopped after many retries. Run the command again with --only " + key + "; it picks up where it left off.");
  return null;
}

const onlyArg = process.argv.indexOf("--only");
const keys = onlyArg > 0 ? process.argv[onlyArg + 1]!.split(",").map((k) => k.trim()) : Object.keys(AGENTS);
for (const k of keys) if (!AGENTS[k]) throw new Error(`unknown agent ${k}; use ${Object.keys(AGENTS).join(", ")}`);

try {
  const token = await signIn();
  const done: Record<string, { agentId: string; owner: string }> = {};
  for (const key of keys) {
    const out = await listOne(token, key, AGENTS[key]!);
    if (out) done[key] = out;
  }
  const value = JSON.stringify(done);
  console.log(`\nListed: ${Object.keys(done).join(", ") || "none"}`);
  if (Object.keys(done).length > 0) {
    console.log(`\nAGON_FIRST_PARTY_AGENTS=${value}`);
    console.log("\nOn the server, set it (backs up .env, keeps one line):\n");
    console.log(`F=/opt/arcrun/deploy/.env; V='${value}'; sudo cp "$F" "$F.bak.$(date +%s)" && sudo sed -i '/^AGON_FIRST_PARTY_AGENTS=/d' "$F" && printf "AGON_FIRST_PARTY_AGENTS='%s'\\n" "$V" | sudo tee -a "$F" >/dev/null && echo "AGON_FIRST_PARTY_AGENTS lines: $(grep -c '^AGON_FIRST_PARTY_AGENTS=' "$F")"`);
    if (keys.length < Object.keys(AGENTS).length) console.log("\nYou listed only some agents: merge this with the others before setting it, so no agent is left out.");
  }
} finally {
  rl.close();
}
