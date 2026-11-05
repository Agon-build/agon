import { ratableJobOf } from "../channels/telegram/rate-tap.ts";
import type { DeliveryMessage } from "./summary.ts";

/// The job page opened at its rating step, with the stars already picked when given.
/// Opening a link never saves a rating: the person still presses Save, so a mail
/// scanner that follows links cannot rate a job.
export function rateHref(href: string, stars?: number): string {
  const base = href.split("#")[0]!;
  const query = stars ? `${base.includes("?") ? "&" : "?"}rate=${stars}` : "";
  return `${base}${query}#rate`;
}

/// The bell notice for a delivery. A delivered job asks for a rating and opens the rating step.
export function bellDelivery(m: DeliveryMessage & { eventKey?: string }): DeliveryMessage {
  const ratable = m.eventKey ? ratableJobOf(m.eventKey) : null;
  if (!ratable) return { title: m.title, body: m.body, href: m.href };
  return { title: m.title, body: `${m.body} Rate it on Agon.`, href: rateHref(m.href) };
}
