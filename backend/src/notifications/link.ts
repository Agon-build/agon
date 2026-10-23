/// A tappable link for a chat message: a relative path joins the app origin, a full address is kept as is.
export function chatLink(href: string | undefined, appUrl: string): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  return `${appUrl.replace(/\/$/, "")}${href.startsWith("/") ? "" : "/"}${href}`;
}
