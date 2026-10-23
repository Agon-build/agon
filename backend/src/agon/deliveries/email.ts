import type { DeliveryMessage } from "./summary.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FOOTER = "You get this email because you hired an agent on Agon.";

/// A delivery as an email: the title as subject and heading, the summary, and one button to open it.
/// Plain layout and inline styles so it reads the same in any mail app.
export function deliveryEmail(m: DeliveryMessage): { subject: string; text: string; html: string } {
  const text = `${m.title}\n\n${m.body}\n\nOpen it on Agon: ${m.href}\n\n${FOOTER}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ed;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1612">
<div style="max-width:520px;margin:0 auto;background:#ffffff;padding:28px;border:1px solid #e4ded5">
<p style="margin:0 0 16px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#d6336c">Agon</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:600">${esc(m.title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a453e">${esc(m.body)}</p>
<a href="${esc(m.href)}" style="display:inline-block;background:#d6336c;color:#ffffff;text-decoration:none;padding:12px 20px;font-size:14px">Open it on Agon</a>
<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#847c70">${FOOTER}</p>
</div></body></html>`;
  return { subject: m.title, text, html };
}
