import type { Address } from "viem";

export type ChatChannel = "telegram" | "whatsapp";
export type ChannelAccount = {
  channel: ChatChannel;
  userHash: string;
  operatorAddress: Address | null;
  termsVersion: string | null;
  termsAt: Date | null;
  createdAt: Date;
  lastInboundAt: Date | null;
};
export type LinkResult = "linked" | "already_same" | "other_operator" | "no_account";

export interface ChannelStore {
  /** True only the first time this update id is seen on this channel. */
  claimUpdate(channel: ChatChannel, updateId: string, now: Date): Promise<boolean>;
  getAccount(channel: ChatChannel, userHash: string): Promise<ChannelAccount | null>;
  /** Creates the account on first contact; later calls return it unchanged. */
  ensureAccount(channel: ChatChannel, userHash: string, now: Date): Promise<ChannelAccount>;
  acceptTerms(channel: ChatChannel, userHash: string, version: string, now: Date): Promise<ChannelAccount | null>;
  touch(channel: ChatChannel, userHash: string, now: Date): Promise<void>;
  /** Links a website account once. A different account later is refused. */
  linkOperator(channel: ChatChannel, userHash: string, operator: Address): Promise<LinkResult>;
  /** The Telegram user id an operator linked through the website login widget. */
  operatorTelegramId(operator: Address): Promise<string | null>;
}
