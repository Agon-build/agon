import type { Polymarket } from "./index.ts";
import type { Market } from "./types.ts";

/// The check that tells Agon, before a buyer finds out, that Polymarket changed or retired
/// something Agon reads. It reads the busiest open market through every call of the data
/// module and expects each to come back with something in it. On the busiest market an empty
/// order book or no trades means a shape Agon no longer reads, not a quiet market.
export type ContractCheckLine = { name: string; ok: boolean; detail: string };
export type ContractCheckResult = { ok: boolean; checkedAt: string; market: string | null; lines: ContractCheckLine[] };
/// The same shape the stage monitor raises and resolves.
export type ContractAlert = { fingerprint: string; severity: "critical"; title: string; body: string };

export const CONTRACT_ALERT_FINGERPRINT = "polymarket-contract";
/// Four times a day: a retired endpoint is known within hours, for about thirty requests a day.
export const CONTRACT_CHECK_INTERVAL_MS = 6 * 3_600_000;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

export async function runContractCheck(deps: { polymarket: Polymarket; now?: () => Date }): Promise<ContractCheckResult> {
  const pm = deps.polymarket;
  const lines: ContractCheckLine[] = [];
  const line = async (name: string, read: () => Promise<{ ok: boolean; detail: string }>) => {
    try { lines.push({ name, ...(await read()) }); } catch (error) { lines.push({ name, ok: false, detail: reason(error) }); }
  };
  const done = (market: string | null): ContractCheckResult => ({ ok: lines.every((l) => l.ok), checkedAt: (deps.now ?? (() => new Date()))().toISOString(), market, lines });

  const listed = await pm.topMarkets(10).then((r) => ({ top: r.value, failed: null as string | null })).catch((error: unknown) => ({ top: [] as Market[], failed: reason(error) }));
  const m = listed.top.find((x) => x.outcomes[0].tokenId && x.outcomes[1].tokenId && x.acceptingOrders);
  lines.push({
    name: "market list", ok: Boolean(m),
    detail: listed.failed ?? (m ? `${listed.top.length} open markets; checking "${m.question.slice(0, 80)}"` : `${listed.top.length} markets read, none open for trading with its tokens`),
  });
  if (!m) return done(null);
  const token = m.outcomes[0].tokenId;

  await line("market lookup", async () => {
    const found = await pm.resolve(m.conditionId);
    return found.ok ? { ok: found.market.conditionId === m.conditionId, detail: `${found.market.outcomes[0].label} ${Math.round(found.market.outcomes[0].price * 100)}%` } : { ok: false, detail: found.code };
  });
  await line("order book", async () => {
    const book = (await pm.book(token)).value;
    return { ok: book.bids.length + book.asks.length > 0, detail: `${book.bids.length} bids, ${book.asks.length} asks` };
  });
  await line("price history", async () => {
    const points = (await pm.history(token, "1d")).value;
    return { ok: points.length > 0, detail: `${points.length} points` };
  });
  await line("trades", async () => {
    const trades = (await pm.trades(m.conditionId, 20)).value;
    return { ok: trades.length > 0, detail: `${trades.length} trades` };
  });
  await line("holders", async () => {
    const groups = (await pm.holders(m.conditionId, 5)).value;
    const holders = groups.reduce((n, g) => n + g.holders.length, 0);
    return { ok: holders > 0, detail: `${holders} holders in ${groups.length} outcomes` };
  });
  await line("open interest", async () => {
    const value = (await pm.openInterest(m.conditionId)).value;
    return { ok: Number.isFinite(value) && value >= 0, detail: `${Math.round(value)}` };
  });
  return done(m.slug);
}

/// One alert while any read fails, naming each one; none when all pass.
export function contractAlerts(result: ContractCheckResult): ContractAlert[] {
  if (result.ok) return [];
  const failed = result.lines.filter((l) => !l.ok);
  return [{
    fingerprint: CONTRACT_ALERT_FINGERPRINT,
    severity: "critical",
    title: "Polymarket data check failed",
    body: `Agon could not read ${failed.map((l) => `${l.name} (${l.detail})`).join("; ")}. Market agents may refuse or answer from a kept copy until this is fixed.`.slice(0, 900),
  }];
}
