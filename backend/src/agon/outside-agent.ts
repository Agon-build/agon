/// A small agent that stands outside Agon and uses only what any agent can reach: the public
/// directory, the public MCP endpoint, and the signed-in MCP endpoint with a budget token.
/// It proves the path "find an agent, pay it, get the answer" with no person in the loop, and
/// that a budget token is refused once its daily cap is spent. It holds no key and signs
/// nothing: the token's owner set the caps, and Agon pays from their wallet inside them.

export type OutsideAgentInput = {
  /** The API origin, for example https://api.agon.surf. */
  api: string;
  /** A budget token (agon_pat_...). Without one only discovery runs. */
  token?: string;
  /** How many hires to attempt; the last is expected to be refused over the daily cap. */
  hires?: number;
  question?: string;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
};
export type OutsideHire = { ok: boolean; code: string | null; total: string | null; jobId: string | null; hasAnswer: boolean };
export type OutsideAgentReport = {
  discovery: { directoryAgents: number; publicTools: string[]; directoryOverMcp: boolean };
  hires: OutsideHire[];
  passed: boolean;
  reason: string;
};

const DEFAULT_QUESTION = "Will Bitcoin close above $120,000 on October 30?";

/// The JSON-RPC answer of an MCP call, sent as plain JSON or as one server-sent event.
export function rpcAnswer(text: string): { result?: { tools?: { name: string }[]; content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } } | null {
  const data = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
  try { return JSON.parse(data ? data.slice(5) : text); } catch { return null; }
}

export async function runOutsideAgent(input: OutsideAgentInput): Promise<OutsideAgentReport> {
  const doFetch = input.fetchImpl ?? fetch;
  const log = input.log ?? (() => {});
  const api = input.api.replace(/\/+$/, "");
  const attempts = Math.max(1, Math.min(input.hires ?? 4, 10));
  let id = 0;
  const mcp = async (path: string, method: string, params: unknown, token?: string) => {
    const res = await doFetch(`${api}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: (id += 1), method, params }),
    });
    return { status: res.status, body: rpcAnswer(await res.text()) };
  };
  const toolValue = (body: ReturnType<typeof rpcAnswer>): Record<string, unknown> | null => {
    const text = body?.result?.content?.[0]?.text;
    if (typeof text !== "string") return null;
    try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
  };
  const report: OutsideAgentReport = { discovery: { directoryAgents: 0, publicTools: [], directoryOverMcp: false }, hires: [], passed: false, reason: "" };
  const fail = (reason: string): OutsideAgentReport => { log(`FAIL  ${reason}`); return { ...report, passed: false, reason }; };

  // 1. Discovery with no account and no token.
  const directory = await doFetch(`${api}/agon/directory`).then(async (r) => (r.ok ? (await r.json()) as { agents?: unknown[] } : null)).catch(() => null);
  if (!directory || !Array.isArray(directory.agents)) return fail("the public directory did not answer");
  report.discovery.directoryAgents = directory.agents.length;
  log(`directory: ${directory.agents.length} agents, no sign-in`);
  const tools = await mcp("/agon/mcp/public", "tools/list", {});
  report.discovery.publicTools = (tools.body?.result?.tools ?? []).map((t) => t.name).sort();
  if (!report.discovery.publicTools.includes("get_directory")) return fail("the public MCP endpoint did not list its tools");
  const viaMcp = toolValue((await mcp("/agon/mcp/public", "tools/call", { name: "get_directory", arguments: {} })).body);
  report.discovery.directoryOverMcp = Array.isArray(viaMcp?.agents);
  if (!report.discovery.directoryOverMcp) return fail("get_directory on the public MCP endpoint gave no agents");
  log(`public MCP: ${report.discovery.publicTools.join(", ")}`);
  // The public endpoint must not be able to hire.
  const publicHire = await mcp("/agon/mcp/public", "tools/call", { name: "hire_service", arguments: { ref: "agent:lead", question: input.question ?? DEFAULT_QUESTION } });
  if (toolValue(publicHire.body)?.ok === true) return fail("the public MCP endpoint paid for a hire");
  if (!input.token) { log("no token given: discovery only"); return { ...report, passed: true, reason: "discovery only" }; }

  // 2. Hires with the budget token: each is one call that pays and returns the answer.
  for (let n = 1; n <= attempts; n += 1) {
    const out = await mcp("/agon/mcp", "tools/call", { name: "hire_service", arguments: { ref: "agent:lead", question: input.question ?? DEFAULT_QUESTION } }, input.token);
    if (out.status === 401 || out.status === 403) return fail(`the token was refused at the door (HTTP ${out.status})`);
    const value = toolValue(out.body) ?? {};
    const error = value.error as { code?: unknown } | undefined;
    const hire: OutsideHire = {
      ok: value.ok === true && value.paidFromBudget === true,
      code: typeof value.code === "string" ? value.code : typeof error?.code === "string" ? error.code : null,
      total: typeof value.total === "string" ? value.total : null,
      jobId: typeof value.jobId === "string" ? value.jobId : null,
      hasAnswer: value.answer !== null && value.answer !== undefined || (value.result !== null && value.result !== undefined),
    };
    report.hires.push(hire);
    log(`hire ${n}: ${hire.ok ? `paid ${hire.total} USDC, answer ${hire.hasAnswer ? "received" : "missing"}` : `refused (${hire.code ?? "no reason given"})`}`);
  }

  // 3. The verdict: every hire but the last is paid with an answer; the last is refused over the daily cap.
  const paid = report.hires.slice(0, -1);
  const last = report.hires[report.hires.length - 1]!;
  const firstBad = paid.findIndex((h) => !h.ok || !h.hasAnswer);
  if (firstBad >= 0) return fail(`hire ${firstBad + 1} was not paid and answered (${paid[firstBad]!.code ?? "no answer"})`);
  if (last.ok) return fail(`hire ${attempts} was paid; the token's daily cap should have refused it`);
  if (last.code !== "over_token_daily") return fail(`hire ${attempts} was refused as ${last.code ?? "unknown"}, not over_token_daily`);
  log(`PASS  ${paid.length} hires paid inside the budget, hire ${attempts} refused over the daily cap`);
  return { ...report, passed: true, reason: `${paid.length} paid, the last refused over the daily cap` };
}
