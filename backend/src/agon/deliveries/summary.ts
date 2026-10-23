/// What a person is told when their hire finishes: a title and one short paragraph in plain words,
/// written by code from the stored result (no model), and the page to open.

export type DeliveryMessage = { title: string; body: string; href: string };
export type DeliverableJob = {
  jobId: string;
  depth: number;
  providerLabel: string;
  priceAtomic: bigint;
  state: string;
  request: unknown;
  result: unknown;
};

const REASONS: Readonly<Record<string, string>> = {
  no_market: "Polymarket has no open market that matches this question.",
  market_started: "The market for this already started, so it can no longer be forecast.",
  no_forecaster: "No forecaster could deliver within the budget.",
  lead_error: "Something went wrong while the agents worked.",
  market_closed: "That market has already closed, so there was nothing left to do on it.",
  market_not_found: "That market was not found on Polymarket.",
  not_yes_no: "Only Yes or No markets are supported.",
  not_a_football_market: "This agent only works on football markets.",
  market_unavailable: "Polymarket did not answer at the time.",
  payment_expired_unused: "The payment was never collected.",
};

const usdc = (atomic: bigint) => (Number(atomic) / 1_000_000).toFixed(2);
const pct = (bps: number) => `${Math.round(bps / 100)}%`;
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const sentence = (s: string) => (s && !/[.?!]$/.test(s) ? `${s}.` : s);

function question(result: Record<string, unknown>): string {
  return str(rec(result.market).question);
}

/// The answer in one or two sentences, or null when Agon cannot read this agent's answer.
function answerText(name: string, r: Record<string, unknown>): string | null {
  const q = question(r);
  const lead = q ? `${q} ` : "";
  const chance = typeof r.probabilityBps === "number" ? r.probabilityBps : null;
  const market = typeof r.crowdBps === "number" ? r.crowdBps : typeof r.marketPriceBps === "number" ? r.marketPriceBps : null;
  if (chance !== null) {
    const reason = Array.isArray(r.reasons) ? str(r.reasons[0]) : "";
    return `${lead}${name} gives Yes a ${pct(chance)} chance${market !== null ? `; the market says ${pct(market)}` : ""}. ${sentence(reason)}`.trim();
  }
  if (typeof r.risk === "string" && Array.isArray(r.traps)) {
    const risk = { low: "Low dispute risk.", medium: "Some dispute risk.", high: "High dispute risk." }[r.risk] ?? "";
    return `${lead}${risk} ${sentence(str(rec(r.traps[0]).explain))}`.trim();
  }
  if (typeof r.verdict === "string" && Array.isArray(r.flags)) {
    const verdict = { tradeable: "looks fine to trade", watch: "suggests watching it before trading", avoid: "says avoid trading it" }[r.verdict] ?? r.verdict;
    return `${lead}${name} ${verdict}. ${sentence(str(rec(r.flags[0]).detail))}`.trim();
  }
  return null;
}

export function deliveryForJob(job: DeliverableJob, siteUrl: string): DeliveryMessage | null {
  // Only the job the person paid for; the agents it hired report through it.
  if (job.depth !== 0) return null;
  const site = siteUrl.replace(/\/+$/, "");
  const receipt = `${site}/r/${job.jobId}`;
  const name = job.providerLabel;
  const r = rec(job.result);
  const paid = `You paid ${usdc(job.priceAtomic)} USDC.`;

  if (job.state === "delivered") {
    if (typeof r.watchId === "string" && Array.isArray(r.markets)) {
      const n = r.markets.length;
      return {
        title: `${name} is watching ${n} ${n === 1 ? "market" : "markets"}`,
        body: `You will get an alert when a result is proposed, challenged or final. ${paid}`,
        href: `${site}/watch/${encodeURIComponent(r.watchId)}`,
      };
    }
    // A Lead job can end "delivered" with a refund inside its answer.
    if (r.ok === false && r.refunded === true) return refunded(name, r, receipt);
    const text = answerText(name, r);
    return { title: `Your answer from ${name}`, body: `${text ?? "It is ready on Agon."} ${paid}`, href: receipt };
  }
  if (job.state === "refunded") return refunded(name, r, receipt);
  if (job.state === "failed") {
    const code = str(r.error) || str(r.code);
    if (code === "delivery_failed") {
      return { title: `${name} was paid but did not deliver`, body: "The receipt shows the payment. Agon is checking what happened.", href: receipt };
    }
    return { title: `${name} did not run, and nothing was charged`, body: `${REASONS[code] ?? "It could not start."} You can try again on Agon.`, href: receipt };
  }
  return null;
}

function refunded(name: string, r: Record<string, unknown>, href: string): DeliveryMessage {
  const code = str(r.code) || str(r.error);
  return { title: `${name} could not finish, and you were refunded`, body: `${REASONS[code] ?? "It could not finish this job."} Your payment came back to your agent wallet.`, href };
}
