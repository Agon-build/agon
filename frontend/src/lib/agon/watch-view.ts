/// A Resolution Watch, as a person reads it: each market's state in plain words and the alerts so far.

export type WatchApiMarket = { question: string; url: string; status: string; outcome: string | null; yesBps: number | null; updatedAt: string };
export type WatchApiAlert = { kind: string; title: string; body: string; at: string };
export type WatchApi = { watchId: string; status: string; endsAt: string; markets: WatchApiMarket[]; alerts: WatchApiAlert[] };

export type WatchMarketRow = { question: string; url: string; state: string; detail: string; tone: "open" | "busy" | "warn" | "done" };
export type WatchPageView = { title: string; summary: string; markets: WatchMarketRow[]; alerts: { title: string; body: string; when: string }[] };

const OUTCOME: Record<string, string> = { yes: "Yes", no: "No", split: "50-50" };

function chance(bps: number | null): string {
  return bps === null ? "" : `${Math.round(bps / 100)}% chance of Yes`;
}

export function marketRow(m: WatchApiMarket): WatchMarketRow {
  if (m.status === "settled") return { question: m.question, url: m.url, state: `Settled: ${OUTCOME[m.outcome ?? ""] ?? "final"}`, detail: "The result is final.", tone: "done" };
  if (m.status === "disputed") return { question: m.question, url: m.url, state: "Result challenged", detail: "Someone disputed the proposed result. A second proposal follows, and a vote if that is disputed too.", tone: "warn" };
  if (m.status === "proposed") return { question: m.question, url: m.url, state: "Result proposed", detail: "Anyone can challenge it for about 2 hours, then it settles.", tone: "busy" };
  return { question: m.question, url: m.url, state: "Open", detail: chance(m.yesBps) || "Still trading.", tone: "open" };
}

export function whenText(iso: string, now: Date): string {
  const at = new Date(iso);
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function watchPageView(w: WatchApi, now: Date): WatchPageView {
  const settled = w.markets.filter((m) => m.status === "settled").length;
  const until = new Date(w.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  const n = w.markets.length;
  const summary = w.status === "active"
    ? `Watching ${n} ${n === 1 ? "market" : "markets"}${settled ? `, ${settled} settled` : ""}. Alerts go to your bell, and to Telegram if it is linked. The watch ends when every market settles, or on ${until}.`
    : `This watch has ended. ${settled} of ${n} ${n === 1 ? "market" : "markets"} settled.`;
  return {
    title: "Resolution Watch",
    summary,
    markets: w.markets.map(marketRow),
    alerts: [...w.alerts].reverse().map((a) => ({ title: a.title, body: a.body, when: whenText(a.at, now) })),
  };
}
