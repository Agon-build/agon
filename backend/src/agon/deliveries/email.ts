import { ctaButton, para, shell } from "../../email/templates.ts";
import { ratableJobOf } from "../channels/telegram/rate-tap.ts";
import type { DeliveryMessage } from "./summary.ts";

const FOOTER = "You get this email because you hired an agent on Agon.";
const RATE = "You can rate this job on its page.";

/// A delivery as an email: the title as subject and heading, the summary, and one button to open it,
/// in the shared Agon email shell. A delivered job also asks for a rating.
export function deliveryEmail(m: DeliveryMessage & { eventKey?: string }): { subject: string; text: string; html: string } {
  const rate = Boolean(m.eventKey && ratableJobOf(m.eventKey));
  const text = `${m.title}\n\n${m.body}\n\n${rate ? `${RATE}\n` : ""}Open it on Agon: ${m.href}\n\n${FOOTER}`;
  const html = shell({
    preheader: m.body.slice(0, 140),
    eyebrow: "Delivery",
    heading: m.title,
    bodyHtml: `${para(m.body)}${rate ? para(RATE) : ""}${ctaButton(rate ? "Open and rate it" : "Open it on Agon", m.href)}`,
    footer: FOOTER,
  });
  return { subject: m.title, text, html };
}
