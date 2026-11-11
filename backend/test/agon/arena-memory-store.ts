import type { ArenaStore, Claim, CommitRecord, StoredTask } from "../../src/agon/arena/store.ts";
import type { ArenaAnswer, ArenaRaw, ArenaRound, ArenaSeason, ArenaTask, Entrant, RoundState, SendKey } from "../../src/agon/arena/types.ts";

/// Behaviour-compatible stand-in for PostgresArenaStore, for unit tests of rounds,
/// the leaderboard and routes. Keep it in step with arena-store.test.ts, which runs against both.
export class MemoryArenaStore implements ArenaStore {
  seasons = new Map<string, ArenaSeason>();
  rounds = new Map<string, ArenaRound>();
  tasks = new Map<string, (StoredTask & { round: bigint })[]>();
  entrants = new Map<string, Entrant[]>();
  sends = new Map<string, Date>();
  answers = new Map<string, { answer: ArenaAnswer; at: Date }>();

  private rk(seasonId: bigint, round: bigint): string {
    return `${seasonId}:${round}`;
  }
  private ak(k: SendKey): string {
    return `${k.seasonId}:${k.round}:${k.taskId}\n${k.agentId}`;
  }

  async ensureSeason(season: ArenaSeason): Promise<ArenaSeason> {
    const key = season.seasonId.toString();
    if (!this.seasons.has(key)) this.seasons.set(key, { ...season, commitsAddress: season.commitsAddress.toLowerCase() as ArenaSeason["commitsAddress"] });
    return { ...this.seasons.get(key)! };
  }

  async openRound(round: { seasonId: bigint; round: bigint; opensAt: Date }, tasks: ArenaTask[], entrants: Entrant[]): Promise<boolean> {
    const key = this.rk(round.seasonId, round.round);
    if (this.rounds.has(key)) return false;
    const used = await this.usedTaskIds(round.seasonId);
    if (tasks.some((t) => used.has(t.taskId)) || new Set(tasks.map((t) => t.taskId)).size !== tasks.length) throw new Error("duplicate task in season");
    this.rounds.set(key, { seasonId: round.seasonId, round: round.round, opensAt: round.opensAt, state: "open", root: null, count: null, tx: null, blockTime: null });
    this.tasks.set(key, tasks.map((t) => ({ ...t, round: round.round, void: false })));
    this.entrants.set(key, entrants.map((e) => ({ ...e })).sort((a, b) => (a.agentId < b.agentId ? -1 : 1)));
    return true;
  }

  async getRound(seasonId: bigint, round: bigint): Promise<ArenaRound | null> {
    const r = this.rounds.get(this.rk(seasonId, round));
    return r ? { ...r } : null;
  }

  async roundTasks(seasonId: bigint, round: bigint): Promise<StoredTask[]> {
    return (this.tasks.get(this.rk(seasonId, round)) ?? []).map(({ round: _round, ...t }) => ({ ...t }));
  }

  async roundEntrants(seasonId: bigint, round: bigint): Promise<Entrant[]> {
    return (this.entrants.get(this.rk(seasonId, round)) ?? []).map((e) => ({ ...e }));
  }

  async roundAnswers(seasonId: bigint, round: bigint): Promise<ArenaAnswer[]> {
    return [...this.answers.values()].map((v) => v.answer).filter((a) => a.seasonId === seasonId && a.round === round)
      .sort((a, b) => (a.taskId === b.taskId ? (a.agentId < b.agentId ? -1 : 1) : a.taskId < b.taskId ? -1 : 1)).map((a) => ({ ...a }));
  }

  async usedTaskIds(seasonId: bigint): Promise<Set<string>> {
    const out = new Set<string>();
    for (const [key, tasks] of this.tasks) if (key.startsWith(`${seasonId}:`)) for (const t of tasks) out.add(t.taskId);
    return out;
  }

  async claimSend(key: SendKey, now: Date, staleMs: number): Promise<Claim> {
    const k = this.ak(key);
    const at = this.sends.get(k);
    if (!at) {
      this.sends.set(k, now);
      return "claimed";
    }
    return now.getTime() - at.getTime() >= staleMs ? "stale" : "busy";
  }

  async saveAnswer(answer: ArenaAnswer, at: Date): Promise<void> {
    const k = this.ak(answer);
    if (!this.answers.has(k)) this.answers.set(k, { answer: { ...answer }, at });
  }

  async setEntrantStatus(seasonId: bigint, round: bigint, agentId: string, status: Entrant["status"]): Promise<void> {
    const e = (this.entrants.get(this.rk(seasonId, round)) ?? []).find((x) => x.agentId === agentId);
    if (e) e.status = status;
  }

  async voidTask(seasonId: bigint, round: bigint, taskId: string): Promise<void> {
    const t = (this.tasks.get(this.rk(seasonId, round)) ?? []).find((x) => x.taskId === taskId);
    if (t) t.void = true;
    for (const v of this.answers.values()) {
      if (v.answer.seasonId === seasonId && v.answer.round === round && v.answer.taskId === taskId) v.answer = { ...v.answer, outcome: "void", score: null };
    }
  }

  async setRoundState(seasonId: bigint, round: bigint, state: RoundState): Promise<void> {
    const r = this.rounds.get(this.rk(seasonId, round));
    if (r && r.state !== "committed") r.state = state;
  }

  async recordCommit(seasonId: bigint, round: bigint, c: CommitRecord): Promise<void> {
    const r = this.rounds.get(this.rk(seasonId, round));
    if (r) Object.assign(r, { state: "committed", root: c.root.toLowerCase(), count: c.count, tx: c.tx.toLowerCase(), blockTime: c.blockTime });
  }

  async roundsIn(seasonId: bigint, states: RoundState[]): Promise<ArenaRound[]> {
    return [...this.rounds.values()].filter((r) => r.seasonId === seasonId && states.includes(r.state)).sort((a, b) => (a.round < b.round ? -1 : 1)).map((r) => ({ ...r }));
  }

  async spentOn(day: Date): Promise<bigint> {
    const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    let total = 0n;
    for (const v of this.answers.values()) if (v.at.getTime() >= start && v.at.getTime() < start + 86_400_000) total += v.answer.amount;
    return total;
  }

  async raw(seasonId: bigint): Promise<ArenaRaw | null> {
    const season = this.seasons.get(seasonId.toString());
    if (!season) return null;
    const rounds = await this.roundsIn(seasonId, ["open", "sent", "committing", "committed", "skipped"]);
    const tasks: ArenaRaw["tasks"] = [];
    const entrants: ArenaRaw["entrants"] = [];
    const answers: ArenaAnswer[] = [];
    for (const r of rounds) {
      tasks.push(...(this.tasks.get(this.rk(seasonId, r.round)) ?? []).map((t) => ({ ...t })));
      entrants.push(...(await this.roundEntrants(seasonId, r.round)).map((e) => ({ ...e, round: r.round })));
      answers.push(...(await this.roundAnswers(seasonId, r.round)));
    }
    return { season: { ...season }, rounds, tasks, entrants, answers };
  }
}
