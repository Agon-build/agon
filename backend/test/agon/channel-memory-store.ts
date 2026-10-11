import type { Address } from "viem";

import type { ChannelAccount, ChannelStore, ChatChannel, LinkResult } from "../../src/agon/channels/types.ts";

/// Behaviour-compatible stand-in for PostgresChannelStore. Keep it in step
/// with channel-store.test.ts.
export class MemoryChannelStore implements ChannelStore {
  updates = new Set<string>();
  accounts = new Map<string, ChannelAccount>();
  telegramIds = new Map<string, string>();

  async claimUpdate(channel: ChatChannel, updateId: string) {
    const k = `${channel}|${updateId}`;
    if (this.updates.has(k)) return false;
    this.updates.add(k);
    return true;
  }
  async getAccount(channel: ChatChannel, userHash: string) {
    return this.accounts.get(`${channel}|${userHash}`) ?? null;
  }
  async ensureAccount(channel: ChatChannel, userHash: string, now: Date) {
    const k = `${channel}|${userHash}`;
    if (!this.accounts.has(k)) this.accounts.set(k, { channel, userHash, operatorAddress: null, termsVersion: null, termsAt: null, createdAt: now, lastInboundAt: null });
    return this.accounts.get(k)!;
  }
  async acceptTerms(channel: ChatChannel, userHash: string, version: string, now: Date) {
    const a = this.accounts.get(`${channel}|${userHash}`);
    if (!a) return null;
    a.termsVersion = version;
    a.termsAt = now;
    return a;
  }
  async touch(channel: ChatChannel, userHash: string, now: Date) {
    const a = this.accounts.get(`${channel}|${userHash}`);
    if (a) a.lastInboundAt = now;
  }
  async linkOperator(channel: ChatChannel, userHash: string, operator: Address): Promise<LinkResult> {
    const a = this.accounts.get(`${channel}|${userHash}`);
    if (!a) return "no_account";
    const address = operator.toLowerCase() as Address;
    if (a.operatorAddress === null) {
      a.operatorAddress = address;
      return "linked";
    }
    return a.operatorAddress === address ? "already_same" : "other_operator";
  }
  async operatorTelegramId(operator: Address) {
    return this.telegramIds.get(operator.toLowerCase()) ?? null;
  }
}
