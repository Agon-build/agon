/// Agon transactional email. Email clients are hostile to modern CSS, so the
/// shell uses table layout, inline styles and fallback font stacks (Geist where
/// the client loads it). It carries the Agon look: the dark canvas, cream ink,
/// one pink accent, the product mark, and Geist Mono for codes and labels.
///
/// Pure functions: no config import, so callers pass any dynamic URLs.

const C = {
  canvas: "#0E0C0A",
  card: "#181410",
  hairline: "#2A2622",
  ink: "#F4F1ED",
  ink2: "#B8AC9C",
  ink3: "#9A8F80",
  accent: "#FF4D8A",
  accentInk: "#0E0C0A",
  sans: "'Geist', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

/// The product mark (notched pink square, cut A) as a PNG: mail apps do not show SVG.
export const MARK_URL = "https://agon.surf/email/agon-mark.png";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/// Shared shell: the mark and wordmark, a card with the eyebrow, the heading and
/// the caller's body html, then the footer. `heading` and `footer` are plain text.
export function shell(opts: { preheader: string; eyebrow: string; heading: string; bodyHtml: string; footer?: string }): string {
  const footer = opts.footer ? `${esc(opts.footer)}<br>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>:root { color-scheme: dark; } body { margin:0; padding:0; }</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.canvas};">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.canvas}" style="background:${C.canvas};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr><td style="padding:0 0 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;"><img src="${MARK_URL}" width="32" height="32" alt="Agon" style="display:block;border:0;width:32px;height:32px;"></td>
      <td style="vertical-align:middle;padding-left:12px;font-family:${C.sans};font-size:18px;font-weight:600;letter-spacing:3px;color:${C.ink};">AGON</td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.hairline};padding:32px 28px;">
    <div style="font-family:${C.mono};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.accent};">${esc(opts.eyebrow)}</div>
    <div style="font-family:${C.sans};font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.4px;color:${C.ink};padding-top:12px;">${esc(opts.heading)}</div>
    ${opts.bodyHtml}
  </td></tr>
  <tr><td style="padding:24px 0 0;font-family:${C.mono};font-size:11px;line-height:1.7;color:${C.ink3};">
    ${footer}Agon &middot; hire an agent that has proven it can do the job<br>
    <a href="https://agon.surf" style="color:${C.ink3};text-decoration:none;">agon.surf</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/// A body paragraph in the secondary ink.
export function para(text: string, top = 14): string {
  return `<div style="font-family:${C.sans};font-size:15px;line-height:1.6;color:${C.ink2};padding-top:${top}px;">${esc(text)}</div>`;
}

/// The pink primary action: a sharp rectangle with dark ink (email cannot draw the notch).
export function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
    <td bgcolor="${C.accent}" style="background:${C.accent};">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 22px;font-family:${C.sans};font-size:14px;font-weight:600;color:${C.accentInk};text-decoration:none;">${esc(label)}</a>
    </td>
  </tr></table>`;
}

/// The sign-in code. The code, in Geist Mono, is the hero of the message.
export function otpEmailTemplate(code: string): BuiltEmail {
  const bodyHtml = `
    ${para("Enter this code on Agon to finish signing in.")}
    <div style="font-family:${C.mono};font-size:34px;font-weight:500;letter-spacing:10px;color:${C.ink};text-align:center;padding:22px 0;margin-top:20px;background:${C.canvas};border:1px solid ${C.hairline};">${esc(code)}</div>
    <div style="font-family:${C.sans};font-size:13px;line-height:1.6;color:${C.ink3};padding-top:16px;">It expires in 10 minutes. If you did not ask for it, you can ignore this email.</div>`;
  return {
    subject: "Your Agon sign-in code",
    html: shell({
      preheader: `Your Agon code is ${code}. It expires in 10 minutes.`,
      eyebrow: "Sign in",
      heading: "Your sign-in code",
      bodyHtml,
    }),
    text:
      `Your Agon sign-in code is ${code}.\n\n` +
      `It expires in 10 minutes. If you did not ask for it, you can ignore this email.\n\n` +
      `Agon · hire an agent that has proven it can do the job · agon.surf`,
  };
}
