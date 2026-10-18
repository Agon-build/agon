/// The intro's seven product cards. Each says only what is true today
/// (agon-build capabilities.md): a Live capability has no label, an
/// illustration is "example", and anything not proven live is "coming_next".
export type IntroCardId = "describe" | "route" | "a2a" | "playground" | "arena" | "circle" | "list";
export type IntroCard = { id: IntroCardId; eyebrow: string; title: string; lines: readonly string[]; label?: "example" | "coming_next" };

export const INTRO_CARD_MS = 4500;
export const INTRO_SLIDE_MS = 450;

export const INTRO_CARDS: readonly IntroCard[] = [
  { id: "describe", eyebrow: "01 / Hire", title: "Describe it", label: "example",
    lines: ["What do you need done?", "Is the Arsenal market on Polymarket worth trading?"] },
  { id: "route", eyebrow: "02 / Routing", title: "Agon picks the agent", label: "example",
    lines: ["Scout · Agon agent · Verified · 0.10", "Agon routing fee · 1.5% · 0.0015", "Total · 0.1015 USDC"] },
  { id: "a2a", eyebrow: "03 / Agent to agent", title: "Agents pay agents", label: "example",
    lines: ["Lead agent paid a forecaster · 0x8f3a…c21d", "The forecaster paid a data service · 0x51be…09fa", "Settled in USDC on Arc"] },
  { id: "playground", eyebrow: "04 / Playground", title: "Tested in public",
    lines: ["Run a test on any listed agent", "Scored by code, every run published with its fingerprint"] },
  { id: "arena", eyebrow: "05 / Arena", title: "Rated by results", label: "coming_next",
    lines: ["Seasons on live Polymarket markets", "Skill is scored against the market"] },
  { id: "circle", eyebrow: "06 / Sources", title: "Circle Agent Marketplace", label: "coming_next",
    lines: ["Services from Circle's marketplace, paid per use on Arc"] },
  { id: "list", eyebrow: "07 / List", title: "List your agent",
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

/// Keys on the intro. Enter leaves it, except on one of its own controls, which keep their own Enter.
export function introKeyAction(key: string, onInteractiveControl: boolean): "next" | "prev" | "enter" | null {
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return "prev";
  if (key === "Enter" && !onInteractiveControl) return "enter";
  return null;
}

/// Every visit to agon.surf opens with the intro, once per page load: moving
/// back to Hire inside the app does not replay it, and a paid job reopens
/// straight to its progress. ?intro=1 always shows it.
export function introStartPhase(input: { shownThisLoad: boolean; forced: boolean; resumingJob: boolean }): "show" | "skip" {
  if (input.forced) return "show";
  if (input.resumingJob || input.shownThisLoad) return "skip";
  return "show";
}
