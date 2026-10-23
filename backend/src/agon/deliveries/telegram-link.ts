import { randomBytes } from "node:crypto";
import type pg from "pg";

/// One-time codes link an Agon account to its chat with the AGON bot: Account opens
/// t.me/<bot>?start=dl_<code>, and the bot's /start claims the code for that chat.
export interface TelegramLinks {
  createCode(operator: string, now: Date): Promise<string>;
  /** The account the code belonged to, once; null when unknown, used or expired. */
  claimCode(code: string, chatId: string, now: Date): Promise<string | null>;
  chatOf(operator: string): Promise<string | null>;
  unlink(operator: string): Promise<void>;
}

export const LINK_CODE_TTL_MS = 15 * 60_000;
export const LINK_START = /^\/start(?:@\w+)?\s+dl_([0-9a-f]{24})$/i;

export class PostgresTelegramLinks implements TelegramLinks {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async createCode(operator: string, now: Date): Promise<string> {
    const code = randomBytes(12).toString("hex");
    await this.pool.query("insert into agon_telegram_link_codes (code, operator, expires_at) values ($1, $2, $3)", [code, operator.toLowerCase(), new Date(now.getTime() + LINK_CODE_TTL_MS)]);
    return code;
  }

  async claimCode(code: string, chatId: string, now: Date): Promise<string | null> {
    const { rows } = await this.pool.query<{ operator: string }>(
      "update agon_telegram_link_codes set used_at = $2 where code = $1 and used_at is null and expires_at > $2 returning operator",
      [code.toLowerCase(), now],
    );
    const operator = rows[0]?.operator ?? null;
    if (!operator) return null;
    await this.pool.query(
      `insert into agon_telegram_links (operator, chat_id, linked_at) values ($1, $2, $3)
       on conflict (operator) do update set chat_id = excluded.chat_id, linked_at = excluded.linked_at`,
      [operator, chatId, now],
    );
    return operator;
  }

  async chatOf(operator: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ chat_id: string }>("select chat_id from agon_telegram_links where operator = $1", [operator.toLowerCase()]);
    return rows[0]?.chat_id ?? null;
  }

  async unlink(operator: string): Promise<void> {
    await this.pool.query("delete from agon_telegram_links where operator = $1", [operator.toLowerCase()]);
  }
}
