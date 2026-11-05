/// The Telegram link from the server, split into what Account shows: the link, the bot's name,
/// and the exact message to send when Telegram opens the chat without its Start button.
/// What Account says when adding a delivery email fails, by the API's reason.
export function emailAddError(code: string): string {
  const text: Record<string, string> = {
    invalid_email: "That does not look like an email address.",
    too_soon: "A code was just sent. Wait a minute before asking for another.",
    send_failed: "Agon could not send the code. Try again in a moment.",
    account_email: "This account already gets results at its sign-in email.",
    wrong_code: "That code did not match. Check the email and try again.",
    expired: "That code expired. Ask for a new one.",
    too_many_attempts: "Too many tries. Ask for a new code.",
    no_code: "Ask for a code first.",
  };
  return text[code] ?? "Agon could not save this email right now. Try again.";
}

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
