/// Client for the operator notification feed served by the auth API. The
/// feed is polled (not pushed) so it works the same for wallet and email
/// operators without a per-operator socket.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type NotificationKind =
  | "contest_win"
  | "challenge_win"
  | "challenge_invite"
  | "challenge_refund"
  | "syndicate_payout"
  | "balance_credit"
  | "balance_debit"
  | "training_done"
  | "mystery_win"
  | "custom_request"
  | "arena_review_escalation"
  | "agon_service_lifecycle";

export interface AppNotification {
  id: number;
  kind: NotificationKind | string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  alertId?: string | null;
  severity?: "info" | "warning" | "critical" | null;
  alertStatus?: "open" | "acknowledged" | "resolved" | null;
  createdAt: string;
}

export interface NotificationFeed {
  unread: number;
  items: AppNotification[];
}

export async function fetchNotifications(): Promise<NotificationFeed> {
  try {
    const res = await fetch(`${AUTH_URL}/notifications`, { credentials: "include" });
    if (!res.ok) return { unread: 0, items: [] };
    return (await res.json()) as NotificationFeed;
  } catch {
    return { unread: 0, items: [] };
  }
}

export async function markNotificationsRead(ids?: number[]): Promise<void> {
  try {
    await fetch(`${AUTH_URL}/notifications/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      // keepalive lets the request finish even though clicking a notification
      // navigates the page away; without it the browser cancels the in-flight
      // fetch and the row comes back unread on the next poll.
      keepalive: true,
      body: JSON.stringify(ids ? { ids } : {}),
    });
  } catch {
    /* best-effort */
  }
}

/// Remove notifications from the feed. Pass ids to clear specific rows, or
/// omit to clear them all.
export async function clearNotifications(ids?: number[]): Promise<void> {
  try {
    await fetch(`${AUTH_URL}/notifications/clear`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(ids ? { ids } : {}),
    });
  } catch {
    /* best-effort */
  }
}

/// An open critical alert stays in the feed until its owner acknowledges it.
export function staysUntilAcknowledged(n: Pick<AppNotification, "severity" | "alertStatus">): boolean {
  return n.severity === "critical" && n.alertStatus === "open";
}

/// Acknowledge a critical alert from the bell; it then leaves the feed for good.
export async function acknowledgeNotification(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${AUTH_URL}/notifications/${id}/acknowledge`, { method: "POST", credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

/// A short two-tone chime synthesized with the Web Audio API, so there's no
/// audio asset to ship or fail to load. No-op when the tab has never had a
/// user gesture (browsers block audio until then).
export function playNotificationChime(): void {
  try {
    const Ctx =
      typeof window !== "undefined"
        ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const tones = [
      { freq: 880, start: 0, dur: 0.12 },
      { freq: 1320, start: 0.1, dur: 0.16 },
    ];
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      gain.gain.setValueAtTime(0.0001, now + t.start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.02);
    }
    setTimeout(() => void ctx.close().catch(() => {}), 600);
  } catch {
    /* audio not available */
  }
}
