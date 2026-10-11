import { z } from "zod";

import type { ChatInbound } from "../chat/types.ts";

export type TelegramInbound = ChatInbound & { updateId: string; chatId: number; callbackId: string | null };

const user = z.object({ id: z.number().int(), is_bot: z.boolean().optional() }).passthrough();
const chat = z.object({ id: z.number().int(), type: z.string() }).passthrough();
const update = z.object({
  update_id: z.number().int(),
  message: z.object({ message_id: z.number().int(), from: user.optional(), chat, text: z.string().optional() }).passthrough().optional(),
  callback_query: z.object({ id: z.string(), from: user, data: z.string().optional(), message: z.object({ message_id: z.number().int(), chat }).passthrough().optional() }).passthrough().optional(),
}).passthrough();

/// Only one-to-one chats with people reach the agent. Never throws.
export function parseTelegramUpdate(body: unknown): TelegramInbound | null {
  const parsed = update.safeParse(body);
  if (!parsed.success) return null;
  const updateId = String(parsed.data.update_id);
  const tap = parsed.data.callback_query;
  if (tap) {
    if (!tap.message || tap.message.chat.type !== "private" || tap.from.is_bot || !tap.data) return null;
    return { updateId, chatId: tap.message.chat.id, userId: String(tap.from.id), callbackId: tap.id, kind: "tap", text: tap.data.slice(0, 64) };
  }
  const m = parsed.data.message;
  if (!m || m.chat.type !== "private" || !m.from || m.from.is_bot) return null;
  const base = { updateId, chatId: m.chat.id, userId: String(m.from.id), callbackId: null };
  if (typeof m.text !== "string") return { ...base, kind: "other", text: "" };
  const text = m.text.trim().slice(0, 1000);
  if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) return { ...base, kind: "start", text };
  return { ...base, kind: "text", text };
}
