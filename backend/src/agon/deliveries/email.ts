import { ctaButton, para, shell } from "../../email/templates.ts";
import type { DeliveryMessage } from "./summary.ts";

const FOOTER = "You get this email because you hired an agent on Agon.";

/// A delivery as an email: the title as subject and heading, the summary, and one button to open it,
/// in the shared Agon email shell.
export function deliveryEmail(m: DeliveryMessage): { subject: string; text: string; html: string } {
  const text = `${m.title}\n\n${m.body}\n\nOpen it on Agon: ${m.href}\n\n${FOOTER}`;
  const html = shell({
    preheader: m.body.slice(0, 140),
    eyebrow: "Delivery",
    heading: m.title,
    bodyHtml: `${para(m.body)}${ctaButton("Open it on Agon", m.href)}`,
    footer: FOOTER,
  });
  return { subject: m.title, text, html };
}
