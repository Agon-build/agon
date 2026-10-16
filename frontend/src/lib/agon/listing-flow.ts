import { AGON_CATEGORIES } from "./catalog.ts";

/// The /list web flow: form rules, the draft the server expects, and which step to show.
export type DraftForm = {
  name: string; logoUrl: string; outcome: string; category: string; priceUSDC: string; endpoint: string;
  inputs: string; outputs: string; privacy: string; failurePolicy: string; expectedLatencySeconds: string;
};
export type DraftInput = {
  name: string; logoUrl: string; outcome: string; category: string; inputs: string[]; outputs: string[];
  priceUSDC: string; expectedLatencyMs: number; privacy: string; failurePolicy: string; endpoint: string;
};
export type FlowStep = "describe" | "check" | "approve" | "live";
export type Publishing = { status: string; agentId?: string | null; reference: string | null; txHash?: string | null; fundingAddress?: string | null; termsDigest?: string; nextAction?: string };

export const EMPTY_FORM: DraftForm = {
  name: "", logoUrl: "", outcome: "", category: "3", priceUSDC: "", endpoint: "",
  inputs: "", outputs: "", privacy: "", failurePolicy: "", expectedLatencySeconds: "60",
};

/// The network fee sent to the publishing wallet: 0.50 USDC.
export const FEE_ATOMIC = 500_000n;

const isHttps = (v: string) => { try { return new URL(v).protocol === "https:"; } catch { return false; } };
const lines = (v: string) => v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export function validateForm(f: DraftForm): Partial<Record<keyof DraftForm, string>> {
  const e: Partial<Record<keyof DraftForm, string>> = {};
  if (!f.name.trim() || f.name.trim().length > 80) e.name = "Give it a name of up to 80 characters.";
  if (!isHttps(f.logoUrl.trim())) e.logoUrl = "Use a public https:// link to the logo.";
  if (!f.outcome.trim() || f.outcome.trim().length > 500) e.outcome = "Say what it does in up to 500 characters.";
  if (!AGON_CATEGORIES.some((c) => c.id === f.category)) e.category = "Choose a category.";
  if (!/^\d+(\.\d{1,6})?$/.test(f.priceUSDC.trim())) e.priceUSDC = "Use a price above 0 with at most six decimals.";
  else if (Number(f.priceUSDC) <= 0) e.priceUSDC = "Use a price above 0 with at most six decimals.";
  if (!isHttps(f.endpoint.trim())) e.endpoint = "Use the public https:// address that takes paid requests.";
  if (lines(f.outputs).length === 0) e.outputs = "List at least one thing it returns.";
  if (!f.privacy.trim() || f.privacy.length > 2000) e.privacy = "Say what happens to the data it receives.";
  if (!f.failurePolicy.trim() || f.failurePolicy.length > 2000) e.failurePolicy = "Say what happens when it fails.";
  const seconds = Number(f.expectedLatencySeconds);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) e.expectedLatencySeconds = "Use 1 to 300 seconds.";
  return e;
}

export function draftFromForm(f: DraftForm): DraftInput {
  return {
    name: f.name.trim(), logoUrl: f.logoUrl.trim(), outcome: f.outcome.trim(), category: f.category,
    inputs: lines(f.inputs), outputs: lines(f.outputs), priceUSDC: f.priceUSDC.trim(),
    expectedLatencyMs: Number(f.expectedLatencySeconds) * 1000, privacy: f.privacy.trim(), failurePolicy: f.failurePolicy.trim(), endpoint: f.endpoint.trim(),
  };
}

export function formFromDraft(d: DraftInput): DraftForm {
  return {
    name: d.name, logoUrl: d.logoUrl, outcome: d.outcome, category: d.category, priceUSDC: d.priceUSDC, endpoint: d.endpoint,
    inputs: d.inputs.join("\n"), outputs: d.outputs.join("\n"), privacy: d.privacy, failurePolicy: d.failurePolicy,
    expectedLatencySeconds: String(Math.round(d.expectedLatencyMs / 1000)),
  };
}

/// Where a saved draft resumes: publishing in progress shows Live; otherwise the
/// builder approves only after a passing check.
export function stepFor(publishing: Pick<Publishing, "status" | "reference"> | null, checksPassed: boolean): FlowStep {
  if (publishing?.reference || publishing?.status === "pending" || publishing?.status === "ready" || publishing?.status === "published") return "live";
  return checksPassed ? "approve" : "check";
}

export function timeline(publishing: Pick<Publishing, "status" | "agentId" | "reference"> | null, verification: string | null): { label: "Identity registered" | "Listed" | "Checking" | "Verified"; done: boolean }[] {
  const listed = Boolean(publishing?.reference);
  return [
    { label: "Identity registered", done: Boolean(publishing?.agentId) },
    { label: "Listed", done: listed },
    { label: "Checking", done: listed },
    { label: "Verified", done: verification === "Verified" },
  ];
}

/// The extra gas a short publishing wallet needs, read from the publisher's message (rounded up), else 0.10 USDC.
export function missingFee(nextAction: string): bigint {
  const m = /Fund ([\d.]+) more/.exec(nextAction);
  if (!m) return 100_000n;
  const [whole, frac = ""] = m[1]!.split(".");
  const six = BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  return frac.length > 6 && /[1-9]/.test(frac.slice(6)) ? six + 1n : six;
}

/// How long Live waits for a paid fee to reach the publishing wallet before offering to send more.
export const FEE_LANDING_MS = 3 * 60_000;

/// After paying, advance only once the publishing wallet holds the fee; never ask for more while it lands.
export function feeLanding(input: { balanceUSDC: string | null; paidAt: number | null; now: number }): "advance" | "wait" | "ask_again" {
  if (input.balanceUSDC !== null && Number(input.balanceUSDC) > 0) return "advance";
  if (input.paidAt !== null && input.now - input.paidAt < FEE_LANDING_MS) return "wait";
  return "ask_again";
}

/// A publish that needs attention stops Live and shows the publisher's reason.
export function liveOutcome(p: { status: string; reference: string | null; nextAction: string }): { stop: boolean; message: string | null } {
  return p.status === "needs_attention" ? { stop: true, message: p.nextAction } : { stop: false, message: null };
}

/// Errors that mean the builder should run the checks again.
export function stepAfterError(message: string): FlowStep | null {
  return /^Run the listing checks/.test(message) ? "check" : null;
}

/// How many publishing failures in a row before the page stops retrying and asks.
export const LIVE_MAX_FAILURES = 3;

export function afterLiveAttempt(state: { failures: number; stalled: boolean }, ok: boolean): { failures: number; stalled: boolean } {
  if (ok) return { failures: 0, stalled: false };
  const failures = state.failures + 1;
  return { failures, stalled: failures >= LIVE_MAX_FAILURES };
}
