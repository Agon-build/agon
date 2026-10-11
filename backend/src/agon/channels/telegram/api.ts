import type { ChatReply } from "../chat/types.ts";

const API = "https://api.telegram.org";

export type TelegramApi = {
  call(method: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  send(chatId: number, reply: ChatReply): Promise<number | null>;
  edit(chatId: number, messageId: number, reply: ChatReply): Promise<boolean>;
  answerTap(callbackId: string): Promise<void>;
};

/// Plain text (no parse mode, so nothing needs escaping), link previews off,
/// buttons as one inline keyboard. Telegram caps text at 4096 characters and
/// callback data at 64 bytes.
export function telegramPayload(reply: ChatReply): Record<string, unknown> {
  return {
    text: reply.text.slice(0, 4096),
    link_preview_options: { is_disabled: true },
    ...(reply.buttons && reply.buttons.length > 0
      ? { reply_markup: { inline_keyboard: reply.buttons.map((row) => row.map((b) => (b.url ? { text: b.label.slice(0, 64), url: b.url } : { text: b.label.slice(0, 64), callback_data: (b.data ?? "").slice(0, 64) }))) } }
      : {}),
  };
}

export function createTelegramApi(deps: { token: string; fetchImpl?: typeof fetch; log?: (m: string) => void }): TelegramApi {
  const call = async (method: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    try {
      const res = await (deps.fetchImpl ?? fetch)(`${API}/bot${deps.token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: string } | null;
      if (!res.ok || !json?.ok) {
        // The URL carries the bot token, so only the method and Telegram's description are logged.
        deps.log?.(`telegram ${method} failed: ${res.status} ${json?.description ?? ""}`.trim());
        return null;
      }
      return (json.result && typeof json.result === "object" ? json.result : {}) as Record<string, unknown>;
    } catch (error) {
      deps.log?.(`telegram ${method} failed: ${(error as Error).name}`);
      return null;
    }
  };
  return {
    call,
    async send(chatId, reply) {
      const result = await call("sendMessage", { chat_id: chatId, ...telegramPayload(reply) });
      return typeof result?.message_id === "number" ? result.message_id : null;
    },
    async edit(chatId, messageId, reply) {
      return (await call("editMessageText", { chat_id: chatId, message_id: messageId, ...telegramPayload(reply) })) !== null;
    },
    async answerTap(callbackId) {
      await call("answerCallbackQuery", { callback_query_id: callbackId });
    },
  };
}
