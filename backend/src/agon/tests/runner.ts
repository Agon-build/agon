import { CERTIFY_TIMEOUT_MS, CHECK_MAX_BODY_BYTES, cappedFetch } from "../listing/endpoint-check.ts";
import { buildTestCase, scoreAnswer, type TestFamily } from "./tasks.ts";

export type TestRunOutcome = {
  taskId: string;
  variant: number;
  score: number;
  passed: boolean;
  durationMs: number;
  input: unknown;
  output: unknown | null;
  error: string | null;
  notes: string[];
  checks: { label: string; points: number; max: number }[];
  /** The agent as it named itself in a valid reply. */
  agent?: { name: string; capabilities: string[] };
};

export type TestRunDeps = { fetch: typeof fetch; assertPublic(url: string): Promise<URL>; now?: () => number };

const CATEGORY_SLUGS: Record<string, string> = { "1": "research", "3": "analysis", "5": "execution", "7": "development", "8": "verification" };

/// Sends the category's public test to an agent's test endpoint and scores the answer by code.
/// Anything other than a valid reply is a failed run scored 0. Null for categories without a test.
export async function runAgentTest(input: {
  endpoint: string;
  categoryId: string;
  /** The category's alternative test, when the agent declares the input it needs. */
  family?: TestFamily;
  variant: number;
  /** The listing this run is for; public tests send "public-test". */
  scope?: { listingReference: string; listingVersion: string };
  ctx: { arcChainId: number; arcBlock: bigint };
  deps: TestRunDeps;
}): Promise<TestRunOutcome | null> {
  const test = buildTestCase(input.categoryId, input.variant, { arcBlock: input.ctx.arcBlock, family: input.family });
  if (!test) return null;
  const now = input.deps.now ?? Date.now;
  const started = now();
  const failed = (error: string): TestRunOutcome => ({
    taskId: test.taskId, variant: test.variant, score: 0, passed: false, durationMs: now() - started, input: test.input, output: null, error, notes: [],
    checks: [{ label: "The agent gave a valid answer", points: 0, max: 100 }],
  });

  try {
    await input.deps.assertPublic(input.endpoint);
  } catch {
    return failed("endpoint_not_public");
  }

  let response: Response;
  try {
    response = await cappedFetch(input.deps.fetch, CHECK_MAX_BODY_BYTES)(input.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(CERTIFY_TIMEOUT_MS),
      body: JSON.stringify({
        protocol: "agon-playground/1",
        category: CATEGORY_SLUGS[test.categoryId],
        task: { id: test.taskId, title: test.title, adversarialPrompt: test.prompt, capability: test.capability },
        input: test.input,
        scope: input.scope ?? { listingReference: "public-test", listingVersion: String(test.variant) },
      }),
    });
  } catch {
    return failed("endpoint_unreachable");
  }
  if (!response.ok) return failed(`http_${response.status}`);

  let reply: Record<string, unknown>;
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return failed("reply_invalid");
    reply = parsed as Record<string, unknown>;
  } catch {
    return failed("reply_not_json");
  }
  if (reply.protocol !== "agon-playground/1" || reply.externalWrites !== false) return failed("reply_invalid");

  const scored = scoreAnswer(test, reply.output, input.ctx);
  const named = reply.agent as { name?: unknown; capabilities?: unknown } | undefined;
  const agent = typeof named?.name === "string" && Array.isArray(named.capabilities)
    ? { name: named.name.slice(0, 120), capabilities: named.capabilities.filter((c): c is string => typeof c === "string").slice(0, 24) }
    : undefined;
  return {
    agent,
    taskId: test.taskId, variant: test.variant, score: scored.score, passed: scored.passed, durationMs: now() - started,
    input: test.input, output: reply.output ?? null, error: null, notes: scored.notes, checks: scored.checks,
  };
}
