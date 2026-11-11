import type { OutsideOutcome } from "../payments/types.ts";

/// What Agon has seen an outside service do with paid hires routed through it. It is a count of
/// deliveries, never an Agon score: Agon does not test outside services or judge their answers.
export type DeliveryRecord = {
  paid: number;
  delivered: number;
  /** Paid hires in a row, counting back from the newest, that were not delivered. */
  failedInARow: number;
  /** Until when the service is left out of the choices; null when it is offered. */
  restingUntil: Date | null;
  /** The middle time from payment to answer, in seconds, over delivered hires; null with none. */
  typicalSeconds: number | null;
};

/// How far back the record looks.
export const RECORD_WINDOW_MS = 30 * 24 * 60 * 60_000;
/// A service is ordered by its delivery rate only once it has this many paid hires.
export const RECORD_MIN_HIRES = 3;
/// This many failures in a row rest a service.
export const REST_AFTER_FAILURES = 2;
export const REST_MS = 24 * 60 * 60_000;

/// One record per outside service from its paid hires (any order in, newest counted first).
export function deliveryRecords(outcomes: OutsideOutcome[], now: Date): Map<string, DeliveryRecord> {
  const by = new Map<string, OutsideOutcome[]>();
  for (const o of outcomes) by.set(o.providerRef, [...(by.get(o.providerRef) ?? []), o]);
  const out = new Map<string, DeliveryRecord>();
  for (const [ref, list] of by) {
    const newest = [...list].sort((a, b) => b.at.getTime() - a.at.getTime());
    let failedInARow = 0;
    for (const o of newest) { if (o.delivered) break; failedInARow += 1; }
    const until = failedInARow >= REST_AFTER_FAILURES ? new Date(newest[0]!.at.getTime() + REST_MS) : null;
    const times = newest.filter((o) => o.delivered && o.seconds !== null).map((o) => o.seconds!).sort((a, b) => a - b);
    out.set(ref, {
      paid: newest.length,
      delivered: newest.filter((o) => o.delivered).length,
      failedInARow,
      restingUntil: until && until.getTime() > now.getTime() ? until : null,
      typicalSeconds: times.length === 0 ? null : Math.round(times[Math.floor((times.length - 1) / 2)]! * 10) / 10,
    });
  }
  return out;
}

/// The delivery rate once there are enough hires to state one; null before that.
export const deliveryRate = (r: DeliveryRecord | undefined): number | null => (r && r.paid >= RECORD_MIN_HIRES ? r.delivered / r.paid : null);

/// Outside services by what Agon has seen: a service that delivered at least half its hires comes
/// before one with no record yet, and one that delivered fewer comes after. Equal standing is left
/// to the caller (price). Negative when `a` goes first.
export function byDelivery(a: DeliveryRecord | undefined, b: DeliveryRecord | undefined): number {
  const standing = (r: DeliveryRecord | undefined) => { const rate = deliveryRate(r); return rate === null ? 1 : rate >= 0.5 ? 0 : 2; };
  const tier = standing(a) - standing(b);
  if (tier !== 0) return tier;
  const ra = deliveryRate(a);
  const rb = deliveryRate(b);
  return ra !== null && rb !== null && ra !== rb ? rb - ra : 0;
}

/// Reads the records through a store, keeping them for a minute so a busy Hire asks the database once.
export function createDeliveryRecords(opts: { load: (since: Date) => Promise<OutsideOutcome[]>; now?: () => Date; ttlMs?: number }): () => Promise<Map<string, DeliveryRecord>> {
  const now = opts.now ?? (() => new Date());
  const ttl = opts.ttlMs ?? 60_000;
  let kept: { at: number; records: Promise<Map<string, DeliveryRecord>> } | null = null;
  return () => {
    const t = now().getTime();
    if (kept && t - kept.at < ttl) return kept.records;
    const records = opts.load(new Date(t - RECORD_WINDOW_MS)).then((rows) => deliveryRecords(rows, now()));
    kept = { at: t, records };
    // A failed read is not kept, so the next request asks again.
    records.catch(() => { if (kept?.records === records) kept = null; });
    return records;
  };
}
