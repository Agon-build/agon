import type pg from "pg";
import type { Address } from "viem";

import type { ChannelAccount, ChannelStore, ChatChannel, LinkResult } from "./types.ts";

type AccountRow = {
  channel: ChatChannel; user_hash: string; operator_address: Address | null; terms_version: string | null; terms_at: Date | null; created_at: Date; last_inbound_at: Date | null;
};
const toAccount = (r: AccountRow): ChannelAccount => ({
  channel: r.channel, userHash: r.user_hash, operatorAddress: r.operator_address, termsVersion: r.terms_version, termsAt: r.terms_at,
  createdAt: r.created_at, lastInboundAt: r.last_inbound_at,
});

export class PostgresChannelStore implements ChannelStore {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async claimUpdate(channel: ChatChannel, updateId: string, now: Date): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "insert into agon_channel_updates (channel, update_id, received_at) values ($1, $2, $3) on conflict do nothing",
      [channel, updateId, now],
    );
    return rowCount === 1;
  }

  async getAccount(channel: ChatChannel, userHash: string): Promise<ChannelAccount | null> {
    const { rows } = await this.pool.query<AccountRow>("select * from agon_channel_accounts where channel = $1 and user_hash = $2", [channel, userHash]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async ensureAccount(channel: ChatChannel, userHash: string, now: Date): Promise<ChannelAccount> {
    await this.pool.query(
      "insert into agon_channel_accounts (channel, user_hash, created_at) values ($1, $2, $3) on conflict do nothing",
      [channel, userHash, now],
    );
    return (await this.getAccount(channel, userHash))!;
  }

  async acceptTerms(channel: ChatChannel, userHash: string, version: string, now: Date): Promise<ChannelAccount | null> {
    const { rows } = await this.pool.query<AccountRow>(
      "update agon_channel_accounts set terms_version = $3, terms_at = $4 where channel = $1 and user_hash = $2 returning *",
      [channel, userHash, version, now],
    );
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async touch(channel: ChatChannel, userHash: string, now: Date): Promise<void> {
    await this.pool.query("update agon_channel_accounts set last_inbound_at = $3 where channel = $1 and user_hash = $2", [channel, userHash, now]);
  }

  async linkOperator(channel: ChatChannel, userHash: string, operator: Address): Promise<LinkResult> {
    const address = operator.toLowerCase() as Address;
    const { rowCount } = await this.pool.query(
      "update agon_channel_accounts set operator_address = $3 where channel = $1 and user_hash = $2 and operator_address is null",
      [channel, userHash, address],
    );
    if (rowCount === 1) return "linked";
    const account = await this.getAccount(channel, userHash);
    if (!account) return "no_account";
    return account.operatorAddress === address ? "already_same" : "other_operator";
  }

  async operatorTelegramId(operator: Address): Promise<string | null> {
    const { rows } = await this.pool.query<{ telegram_id: string | null }>("select telegram_id from operators where address = $1", [operator.toLowerCase()]);
    const id = rows[0]?.telegram_id ?? null;
    return id && /^\d{1,20}$/.test(String(id)) ? String(id) : null;
  }
}
