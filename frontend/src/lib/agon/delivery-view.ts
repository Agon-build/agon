/// The Telegram link from the server, split into what Account shows: the link, the bot's name,
/// and the exact message to send when Telegram opens the chat without its Start button.
export function telegramStart(url: string): { url: string; command: string; bot: string } {
  try {
    const u = new URL(url);
    const bot = u.pathname.replace(/^\/+/, "");
    const start = u.searchParams.get("start") ?? "";
    return { url, bot, command: start ? `/start ${start}` : "/start" };
  } catch {
    return { url, bot: "the Agon bot", command: "/start" };
  }
}
