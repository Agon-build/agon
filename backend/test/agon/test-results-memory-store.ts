import { randomUUID } from "node:crypto";

import { evidenceHashOf, type NewTestResult, type TestLimits, type TestResult, type TestResultsStore } from "../../src/agon/tests/results-store.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function createMemoryTestResultsStore(): TestResultsStore & { rows: TestResult[] } {
  const rows: TestResult[] = [];
  const add = (r: NewTestResult, now: Date) => {
    const checks = r.checks ?? [];
    const row: TestResult = { ...r, checks, notes: r.notes ?? [], runner: r.runner?.toLowerCase() ?? null, id: randomUUID(), createdAt: now, evidenceHash: evidenceHashOf({ ...r, checks }) };
    rows.push(row);
    return row;
  };
  const newest = (xs: TestResult[]) => [...xs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const publicSince = (pred: (r: TestResult) => boolean, since: number) => rows.filter((r) => r.source === "public" && pred(r) && r.createdAt.getTime() > since).length;
  return {
    rows,
    async insertPublicWithinLimits(r: NewTestResult, limits: TestLimits, now: Date) {
      const runner = (r.runner ?? "").toLowerCase();
      if (publicSince((x) => x.runner === runner, now.getTime() - HOUR_MS) >= limits.perUserHour) return { ok: false, code: "user_limit" } as const;
      if (publicSince((x) => x.agentId === r.agentId, now.getTime() - DAY_MS) >= limits.perAgentDay) return { ok: false, code: "agent_limit" } as const;
      return { ok: true, result: add({ ...r, source: "public", runner }, now) } as const;
    },
    async insert(r, now) { return add(r, now); },
    async get(id) { return rows.find((r) => r.id === id) ?? null; },
    async listByAgent(agentId, limit) { return newest(rows.filter((r) => r.agentId === agentId)).slice(0, limit); },
    async listRecent(limit) { return newest(rows).slice(0, limit); },
    async remainingToday(agentId, now, perAgentDay) { return Math.max(0, perAgentDay - publicSince((x) => x.agentId === agentId, now.getTime() - DAY_MS)); },
    async publicCounts(runner, agentId, now) {
      return { byRunnerHour: publicSince((x) => x.runner === runner.toLowerCase(), now.getTime() - HOUR_MS), byAgentDay: publicSince((x) => x.agentId === agentId, now.getTime() - DAY_MS) };
    },
    async aggregates(categoryId, since, until = null) {
      const out = new Map<string, { n: number; avg: number }>();
      for (const r of rows.filter((x) => x.categoryId === categoryId && (!since || x.createdAt >= since) && (!until || x.createdAt < until))) {
        const cur = out.get(r.agentId) ?? { n: 0, avg: 0 };
        out.set(r.agentId, { n: cur.n + 1, avg: (cur.avg * cur.n + r.score) / (cur.n + 1) });
      }
      return out;
    },
    async lastCheckAt(listingReference) {
      const hits = newest(rows.filter((r) => r.source === "agon_check" && r.listingReference === listingReference));
      return hits[0]?.createdAt ?? null;
    },
  };
}
