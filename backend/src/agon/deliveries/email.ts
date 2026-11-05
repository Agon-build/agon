import { ctaButton, para, shell, starLinks } from "../../email/templates.ts";
import { ratableJobOf } from "../channels/telegram/rate-tap.ts";
import { rateHref } from "./rate-links.ts";
import type { DeliveryMessage } from "./summary.ts";

const FOOTER = "You get this email because you hired an agent on Agon.";
const RATE = "Rate this job. Pick the stars, then save on the page.";

/// A delivery as an email: the title as subject and heading, the summary, and one button to open it,
/// in the shared Agon email shell. A delivered job also carries five star links to rate it.
export function deliveryEmail(m: DeliveryMessage & { eventKey?: string }): { subject: string; text: string; html: string } {
  const rate = Boolean(m.eventKey && ratableJobOf(m.eventKey));
  const text = `${m.title}\n\n${m.body}\n\n${rate ? `Rate this job: ${rateHref(m.href)}\n` : ""}Open it on Agon: ${m.href}\n\n${FOOTER}`;
  const html = shell({
    preheader: m.body.slice(0, 140),
    eyebrow: "Delivery",
    heading: m.title,
    bodyHtml: `${para(m.body)}${ctaButton("Open it on Agon", m.href)}${rate ? `${para(RATE, 28)}${starLinks((n) => rateHref(m.href, n))}` : ""}`,
    footer: FOOTER,
  });
  return { subject: m.title, text, html };
}
