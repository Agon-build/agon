import { deliveryForJob, type DeliverableJob, type DeliveryMessage } from "./summary.ts";

export type DeliveryChannel = "bell" | "email" | "telegram";
export type DeliveryRow = DeliveryMessage & { eventKey: string; channel: DeliveryChannel; operator: string; attempts: number };
export type FinishedJob = DeliverableJob & { buyerRef: string };
export type WatchAlertRow = { eventKey: string; operator: string; title: string; body: string; watchId: string };

export interface DeliveryStore {
  /** Paid-for jobs that reached a final state since `since` and have no delivery yet. */
  finishedJobs(since: Date, limit: number): Promise<FinishedJob[]>;
  /** Watch alerts since `since` with no delivery yet (the watch worker already rings the bell). */
  watchAlerts(since: Date, limit: number): Promise<WatchAlertRow[]>;
  /** Adds rows; a (event, channel) pair already there is left as it is. */
  enqueue(rows: (DeliveryMessage & { eventKey: string; channel: DeliveryChannel; operator: string })[], now: Date): Promise<number>;
  due(now: Date, limit: number): Promise<DeliveryRow[]>;
  markSent(eventKey: string, channel: DeliveryChannel, now: Date): Promise<void>;
  /** Records a failed attempt: tries again at `next`, or gives up when `next` is null. */
  markFailed(eventKey: string, channel: DeliveryChannel, error: string, next: Date | null, now: Date): Promise<void>;
  markSkipped(eventKey: string, channel: DeliveryChannel, reason: string, now: Date): Promise<void>;
  emailOf(operator: string): Promise<string | null>;
  telegramChatOf(operator: string): Promise<string | null>;
}

export type DeliveryDeps = {
  store: DeliveryStore;
  siteUrl: string;
  now: () => Date;
  bell: (operator: string, m: DeliveryMessage) => Promise<void>;
  /** Present only when a delivery sender address is set. */
  email?: (to: string, m: DeliveryMessage) => Promise<void>;
  /** Present only when the AGON bot is set up; rejects when Telegram did not take the message. */
  telegram?: (chatId: string, m: DeliveryMessage) => Promise<void>;
  log?: (m: string) => void;
};

/// Retries after 1, 5, 15 and 60 minutes, then gives up.
const BACKOFF_MIN = [1, 5, 15, 60];
/// Only events this recent are picked up, so a first start never sends old history.
export const DELIVERY_LOOKBACK_MS = 2 * 60 * 60_000;

/// An Agon account's address from a hire's buyer reference ("budget:op:0x…"); chat-only buyers get their answer in the chat.
export function operatorOf(buyerRef: string): string | null {
  const m = /^budget:op:(0x[0-9a-fA-F]{40})$/.exec(buyerRef);
  return m ? m[1]!.toLowerCase() : null;
}

export async function runDeliveryTick(deps: DeliveryDeps): Promise<{ queued: number; sent: number; failed: number }> {
  const now = deps.now();
  const since = new Date(now.getTime() - DELIVERY_LOOKBACK_MS);
  const rows: Parameters<DeliveryStore["enqueue"]>[0] = [];
  for (const job of await deps.store.finishedJobs(since, 100)) {
    const operator = operatorOf(job.buyerRef);
    const m = operator ? deliveryForJob(job, deps.siteUrl) : null;
    if (!operator || !m) continue;
    const eventKey = `job:${job.jobId}:${job.state}`;
    rows.push({ ...m, eventKey, channel: "bell", operator });
    if (deps.email) rows.push({ ...m, eventKey, channel: "email", operator });
    if (deps.telegram) rows.push({ ...m, eventKey, channel: "telegram", operator });
  }
  if (deps.email || deps.telegram) {
    const site = deps.siteUrl.replace(/\/+$/, "");
    for (const a of await deps.store.watchAlerts(since, 100)) {
      const m = { title: a.title, body: a.body, href: `${site}/watch/${encodeURIComponent(a.watchId)}` };
      if (deps.email) rows.push({ ...m, eventKey: a.eventKey, channel: "email", operator: a.operator });
      if (deps.telegram) rows.push({ ...m, eventKey: a.eventKey, channel: "telegram", operator: a.operator });
    }
  }
  const queued = rows.length ? await deps.store.enqueue(rows, now) : 0;

  let sent = 0;
  let failed = 0;
  for (const d of await deps.store.due(now, 50)) {
    try {
      if (d.channel === "bell") {
        await deps.bell(d.operator, d);
      } else if (d.channel === "email") {
        if (!deps.email) { await deps.store.markSkipped(d.eventKey, d.channel, "email_off", now); continue; }
        const to = await deps.store.emailOf(d.operator);
        if (!to) { await deps.store.markSkipped(d.eventKey, d.channel, "no_email", now); continue; }
        await deps.email(to, d);
      } else {
        if (!deps.telegram) { await deps.store.markSkipped(d.eventKey, d.channel, "telegram_off", now); continue; }
        const chat = await deps.store.telegramChatOf(d.operator);
        if (!chat) { await deps.store.markSkipped(d.eventKey, d.channel, "not_linked", now); continue; }
        await deps.telegram(chat, d);
      }
      await deps.store.markSent(d.eventKey, d.channel, now);
      sent += 1;
    } catch (error) {
      const wait = BACKOFF_MIN[d.attempts];
      const next = wait === undefined ? null : new Date(now.getTime() + wait * 60_000);
      const reason = ((error as Error)?.message ?? String(error)).slice(0, 200);
      await deps.store.markFailed(d.eventKey, d.channel, reason, next, now);
      // The channel and reason only: never the address or the message.
      deps.log?.(`delivery ${d.channel} ${next ? "will retry" : "gave up"}: ${reason}`);
      failed += 1;
    }
  }
  return { queued, sent, failed };
}

export function startDeliveryWorker(deps: DeliveryDeps & { intervalMs?: number }): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runDeliveryTick(deps);
      if (r.sent || r.failed) deps.log?.(`deliveries ${JSON.stringify(r)}`);
    } catch (error) {
      deps.log?.(`delivery tick failed: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), deps.intervalMs ?? 30_000);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
