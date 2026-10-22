import { config } from "../config/index.js";
import { query } from "../db/pool.js";

/// Operator-targeted notifications. Each call writes a row the frontend feed
/// reads, and relays the same line to Telegram when the operator has linked
/// it. The frontend polls the feed and plays a sound on new unread items, so
/// no per-operator WebSocket channel is needed. Global events (a new contest
/// opening) ride the existing live WebSocket instead of this path.

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
  | "agon_service_lifecycle"
  | "agon_resolution_watch";

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  context?: Record<string, unknown>;
}

/// Insert a notification for one operator and relay to Telegram if linked.
/// Best-effort: failures are logged, never thrown, so a notification can
/// never break the path that triggered it.
export async function notify(operator: string, input: NotifyInput): Promise<void> {
  const addr = operator.toLowerCase();
  try {
    await query(
      `insert into notifications (operator, kind, title, body, href, context)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        addr,
        input.kind,
        input.title,
        input.body ?? null,
        input.href ?? null,
        input.context ? JSON.stringify(input.context) : null,
      ],
    );
    // Keep at most the newest 20 per operator. Older rows auto-clear as new
    // ones arrive, so the feed never grows without bound and the bell stays
    // a short, current list rather than an archive.
    await query(
      `delete from notifications
        where operator = $1
          and id not in (
            select id from notifications
             where operator = $1
             order by created_at desc
             limit 20
          )`,
      [addr],
    );
  } catch (err) {
    console.warn(`[notify] insert failed: ${err instanceof Error ? err.message : err}`);
  }
  void relayTelegram(addr, input);
}

/// Send the notification to the operator's linked Telegram chat. No-op when
/// the bot isn't configured or the operator hasn't linked Telegram.
async function relayTelegram(operator: string, input: NotifyInput): Promise<void> {
  const token = config.auth.telegram.botToken;
  if (!token) return;
  try {
    const { rows } = await query<{ telegram_id: string | null }>(
      "select telegram_id from operators where address = $1",
      [operator],
    );
    const chatId = rows[0]?.telegram_id;
    if (!chatId) return;

    // Include a tappable deep link to the relevant page (claim, challenge,
    // training, etc.) so the user can act straight from Telegram. href is a
    // relative path; join it to the app origin.
    const link = input.href ? `${config.auth.appUrl.replace(/\/$/, "")}${input.href}` : null;
    const text = [input.title, input.body, link].filter(Boolean).join("\n");
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.warn(`[notify] telegram relay HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[notify] telegram relay failed: ${err instanceof Error ? err.message : err}`);
  }
}

/// Broadcasts a one-line alert to EVERY operator who has linked Telegram. Used
/// for global, opt-in events (a heavily-funded mission opening). It deliberately
/// does NOT write the in-app feed — the live WebSocket already carries the
/// in-arena alert, so this never spams the bell. Best-effort per chat; a single
/// failed send never blocks the rest.
export async function broadcastTelegram(input: { title: string; body?: string; href?: string }): Promise<void> {
  const token = config.auth.telegram.botToken;
  if (!token) return;
  try {
    const { rows } = await query<{ telegram_id: string }>(
      "select telegram_id from operators where telegram_id is not null",
    );
    if (rows.length === 0) return;
    const link = input.href ? `${config.auth.appUrl.replace(/\/$/, "")}${input.href}` : null;
    const text = [input.title, input.body, link].filter(Boolean).join("\n");
    let sent = 0;
    for (const r of rows) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: r.telegram_id, text, disable_web_page_preview: true }),
        });
        if (res.ok) sent += 1;
      } catch (err) {
        console.warn(`[notify] mission telegram -> ${r.telegram_id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log(`[notify] mission alert sent to ${sent}/${rows.length} telegram chat(s)`);
  } catch (err) {
    console.warn(`[notify] mission telegram broadcast failed: ${err instanceof Error ? err.message : err}`);
  }
}

/// Notify several operators at once (e.g. every winner of a settled contest).
export async function notifyMany(operators: string[], input: NotifyInput): Promise<void> {
  const seen = new Set<string>();
  for (const op of operators) {
    const addr = op.toLowerCase();
    if (seen.has(addr)) continue;
    seen.add(addr);
    await notify(addr, input);
  }
}
