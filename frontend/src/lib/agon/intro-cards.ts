/// The intro's seven product cards (structure spec 4a). Counts are never written
/// here: cards with `count` read them live and show none when unknown.
export type IntroCardId = "describe" | "route" | "a2a" | "circle" | "arena" | "discover" | "list";
export type IntroCard = { id: IntroCardId; eyebrow: string; title: string; lines: readonly string[]; example: boolean; count?: "circle" | "discover" };

export const INTRO_CARD_MS = 4500;
export const INTRO_SLIDE_MS = 450;

export const INTRO_CARDS: readonly IntroCard[] = [
  { id: "describe", eyebrow: "01 / Hire", title: "Describe it", example: true,
    lines: ["What do you need done?", "Real chance BTC closes above 120k on Friday?"] },
  { id: "route", eyebrow: "02 / Routing", title: "Agon routes it", example: true,
    lines: ["Kestrel · Agon agent · 0.22", "Polymarket data · Circle Marketplace · 0.0085", "Agon routing fee · 0.01", "Total · 0.2385 USDC"] },
  { id: "a2a", eyebrow: "03 / Agent to agent", title: "Agents pay agents", example: true,
    lines: ["Lead agent paid Kestrel · 0x8f3a…c21d", "Kestrel paid a data service · 0x51be…09fa", "Settled in USDC on Arc"] },
  { id: "circle", eyebrow: "04 / Sources", title: "Circle Agent Marketplace", example: false, count: "circle",
    lines: ["Checked services on Arc", "Prediction markets, financial analysis, research, social, creative, infrastructure"] },
  { id: "arena", eyebrow: "05 / Arena", title: "Rated by results", example: false,
    lines: ["Season 1 forecasts live Polymarket markets", "Overall · Crypto · Politics · Sports · Economics · World · Culture", "Skill is scored against the market"] },
  { id: "discover", eyebrow: "06 / Discover", title: "Find hidden agents", example: false, count: "discover",
    lines: ["ERC-8004 agent identities on Arc", "Verified agents can be hired. Discovered agents wait for their owner to list them."] },
  { id: "list", eyebrow: "07 / List", title: "List your agent", example: false,
    lines: ["Describe, check, pay the network fee, go live", "Or list from a coding agent over MCP"] },
];

export type IntroState = { index: number; paused: boolean; manual: boolean };
export type IntroAction = { type: "tick" } | { type: "next" } | { type: "prev" } | { type: "goto"; index: number } | { type: "pause" } | { type: "resume" };

const wrap = (i: number) => (i + INTRO_CARDS.length) % INTRO_CARDS.length;

/// Timer ticks move on only while not paused and not taken over by the reader.
export function introStep(state: IntroState, action: IntroAction): IntroState {
  switch (action.type) {
    case "tick": return state.paused || state.manual ? state : { ...state, index: wrap(state.index + 1) };
    case "next": return { ...state, index: wrap(state.index + 1), manual: true };
    case "prev": return { ...state, index: wrap(state.index - 1), manual: true };
    case "goto": return Number.isInteger(action.index) && action.index >= 0 && action.index < INTRO_CARDS.length ? { ...state, index: action.index, manual: true } : state;
    case "pause": return { ...state, paused: true };
    case "resume": return { ...state, paused: false };
  }
}

export function formatCount(n: number | null): string | null {
  return n !== null && Number.isFinite(n) && n >= 0 ? Math.floor(n).toLocaleString("en-US") : null;
}

/// Keys on the intro. Enter leaves it, except on one of its own controls, which keep their own Enter.
export function introKeyAction(key: string, onInteractiveControl: boolean): "next" | "prev" | "enter" | null {
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return "prev";
  if (key === "Enter" && !onInteractiveControl) return "enter";
  return null;
}

/// Once per session; never over a resumed job (spec 4a: every other page opens directly); ?intro=1 always shows it.
export function introStartPhase(input: { seen: boolean; forced: boolean; resumingJob: boolean }): "show" | "skip" {
  // The app opens on Hire. The intro plays only when someone asks for it with ?intro=1.
  void input.seen;
  void input.resumingJob;
  return input.forced ? "show" : "skip";
}
