import { testEndpointFromManifest } from "../manifest-derived-provider.ts";
import type { TestRunDeps, TestRunOutcome, runAgentTest } from "./runner.ts";
import type { NewTestResult, TestLimits, TestResult, TestResultsStore } from "./results-store.ts";
import { buildTestCase, pickVariant, type TestFamily } from "./tasks.ts";

export const DEFAULT_TEST_LIMITS: TestLimits = { perUserHour: 5, perAgentDay: 20 };

/// What the test service needs to know about a listing.
export type TestableListing = { agentId: string; categoryId: string; listed: boolean; listingReference: string; manifestBody: unknown | null };

/// A run as anyone may see it in lists: no input, no answer, runner shortened.
/// A Verification agent whose service file takes a `market` reads market rules, and one that takes `markets`
/// watches settlement; the test follows the declared input.
export function testFamilyFor(listing: Pick<TestableListing, "categoryId" | "manifestBody">): TestFamily | undefined {
  if (listing.categoryId !== "8") return undefined;
  const props = (listing.manifestBody as { invocation?: { requestSchema?: { properties?: unknown } } } | null)?.invocation?.requestSchema?.properties;
  if (!props || typeof props !== "object") return undefined;
  if (Object.hasOwn(props, "markets")) return "settlement-alerts";
  return Object.hasOwn(props, "market") ? "market-rules" : undefined;
}

export type PublicTestView = {
  id: string;
  agentId: string;
  listingReference: string;
  categoryId: string;
  taskId: string;
  variant: number;
  source: "public" | "agon_check";
  runner: string | null;
  score: number;
  passed: boolean;
  durationMs: number;
  error: string | null;
  evidenceHash: string;
  createdAt: string;
};
export type PublicTestDetail = PublicTestView & { input: unknown; output: unknown | null; checks: TestResult["checks"]; notes: string[] };

export type RunRefusal = "not_found" | "not_listed" | "no_test_for_category" | "user_limit" | "agent_limit" | "in_progress" | "unavailable";
export type RunResult = { ok: true; result: PublicTestView } | { ok: false; code: RunRefusal };

export function shortAddress(address: string | null): string | null {
  if (!address) return null;
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function publicView(r: TestResult): PublicTestView {
  return {
    id: r.id, agentId: r.agentId, listingReference: r.listingReference, categoryId: r.categoryId, taskId: r.taskId, variant: r.variant,
    source: r.source, runner: shortAddress(r.runner), score: r.score, passed: r.passed, durationMs: r.durationMs, error: r.error,
    evidenceHash: r.evidenceHash, createdAt: r.createdAt.toISOString(),
  };
}

export function publicDetail(r: TestResult): PublicTestDetail {
  return { ...publicView(r), input: r.input, output: r.output, checks: r.checks, notes: r.notes };
}

export type TestService = {
  runPublic(runner: string, listingReference: string): Promise<RunResult>;
  runAgonCheck(listingReference: string): Promise<RunResult>;
  limits: TestLimits;
};

export function createTestService(deps: {
  store: TestResultsStore;
  getListing(reference: string): Promise<TestableListing | null>;
  run: typeof runAgentTest;
  chain: { chainId(): Promise<number>; blockNumber(): Promise<bigint> };
  fetchDeps: Omit<TestRunDeps, "now">;
  now?: () => Date;
  limits?: TestLimits;
}): TestService {
  const now = deps.now ?? (() => new Date());
  const limits = deps.limits ?? DEFAULT_TEST_LIMITS;
  // One public test at a time per person and per agent, so a burst never reaches the agent in parallel.
  const busy = new Set<string>();

  async function execute(listing: TestableListing, variant: number): Promise<TestRunOutcome | "unavailable"> {
    // Agon could not fetch or verify the service file: that is not the agent's fault, so nothing is recorded.
    if (listing.manifestBody === null || listing.manifestBody === undefined) return "unavailable";
    let endpoint: string;
    try {
      endpoint = testEndpointFromManifest(listing.manifestBody);
    } catch {
      const test = buildTestCase(listing.categoryId, variant, { family: testFamilyFor(listing) })!;
      return { taskId: test.taskId, variant: test.variant, score: 0, passed: false, durationMs: 0, input: test.input, output: null, error: "manifest_endpoint_missing", notes: [], checks: [{ label: "The service file declares a test endpoint", points: 0, max: 100 }] };
    }
    let ctx: { arcChainId: number; arcBlock: bigint };
    try {
      ctx = { arcChainId: await deps.chain.chainId(), arcBlock: await deps.chain.blockNumber() };
    } catch {
      // Without Agon's own reading the Research test cannot be scored fairly, so nothing is recorded.
      return "unavailable";
    }
    const outcome = await deps.run({ endpoint, categoryId: listing.categoryId, family: testFamilyFor(listing), variant, ctx, deps: deps.fetchDeps });
    return outcome ?? "unavailable";
  }

  async function prepare(listingReference: string): Promise<TestableListing | { code: RunRefusal }> {
    const listing = await deps.getListing(listingReference);
    if (!listing) return { code: "not_found" };
    if (!listing.listed) return { code: "not_listed" };
    if (!buildTestCase(listing.categoryId, 0)) return { code: "no_test_for_category" };
    return listing;
  }

  const toRow = (listing: TestableListing, outcome: TestRunOutcome, source: NewTestResult["source"], runner: string | null): NewTestResult => ({
    agentId: listing.agentId, listingReference: listing.listingReference, categoryId: listing.categoryId, taskId: outcome.taskId, variant: outcome.variant,
    source, runner, score: outcome.score, passed: outcome.passed, durationMs: outcome.durationMs, input: outcome.input, output: outcome.output, error: outcome.error,
    checks: outcome.checks ?? [], notes: outcome.notes ?? [],
  });

  return {
    limits,
    async runPublic(runner, listingReference) {
      const listing = await prepare(listingReference);
      if ("code" in listing) return { ok: false, code: listing.code };
      const who = runner.toLowerCase();
      const at = now();
      // A person gets the same variant on the same agent for the whole UTC day.
      const variant = pickVariant(`${who}|${listing.listingReference}|${at.toISOString().slice(0, 10)}`);
      const keys = [`runner:${who}`, `agent:${listing.agentId}`];
      if (keys.some((k) => busy.has(k))) return { ok: false, code: "in_progress" };
      keys.forEach((k) => busy.add(k));
      try {
        // Check both limits before calling the agent, so a refused run costs it nothing.
        const counts = await deps.store.publicCounts(who, listing.agentId, at);
        if (counts.byRunnerHour >= limits.perUserHour) return { ok: false, code: "user_limit" };
        if (counts.byAgentDay >= limits.perAgentDay) return { ok: false, code: "agent_limit" };
        const outcome = await execute(listing, variant);
        if (outcome === "unavailable") return { ok: false, code: "unavailable" };
        // The insert re-checks the limits atomically, in case another server took the last slot.
        const saved = await deps.store.insertPublicWithinLimits(toRow(listing, outcome, "public", who), limits, now());
        return saved.ok ? { ok: true, result: publicView(saved.result) } : { ok: false, code: saved.code };
      } finally {
        keys.forEach((k) => busy.delete(k));
      }
    },
    async runAgonCheck(listingReference) {
      const listing = await prepare(listingReference);
      if ("code" in listing) return { ok: false, code: listing.code };
      const outcome = await execute(listing, pickVariant(`agon-check|${listing.listingReference}|${now().toISOString().slice(0, 13)}`));
      if (outcome === "unavailable") return { ok: false, code: "unavailable" };
      return { ok: true, result: publicView(await deps.store.insert(toRow(listing, outcome, "agon_check", null), now())) };
    },
  };
}
