/// Client reads for the mission arena. Mission state lives in the backend DB
/// (not on chain), so this talks to the auth/API service. Contest meta still
/// comes from the chain via lib/contests.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

/// `action` is the SCOUT domain's on-chain DeFi leg (real swaps on the Scout
/// rails), executed rather than made or bought.
export type Choice = "make" | "buy" | "skip" | "action";

export interface MissionFragment {
  id: string;
  kind: string;
  ask: string;
}

export interface MissionSpecialist {
  agentId: number;
  fragmentId: string;
  price6: string;
  owner: "platform" | "operator";
  operator: string | null;
  /// Platform piece that a specialist has bought (off the shelf). Always false
  /// for operator listings and unclaimed platform pieces.
  claimed: boolean;
}

export interface MissionDecision {
  fragmentId: string;
  choice: Choice;
  reason: string;
  settled: boolean;
  txHash: string | null;
  spent6: string;
  specialistAgentId: number | null;
}

export interface MissionOperative {
  agentId: number;
  operator: string;
  score: number;
  quality: number | null;
  verdict: string;
  credited: number | null;
  total: number;
  deliverable: string;
  elapsedMs: number;
  decisions: MissionDecision[];
}

export interface TapeRow {
  kind: "a2a" | "x402" | "shelf";
  fromAgentId: number;
  toAgentId: number | null;
  toLabel: string;
  fragmentId: string | null;
  amount6: string;
  txHash: string | null;
  chain: string;
  ts: string;
}

export interface MissionMeta {
  contestId: number;
  domain: string;
  templateId: string;
  title: string;
  brief: string;
  deliverable: string;
  status: string;
  /// v2 economy. EXTERNAL missions source data via x402; INTERNAL run the intel
  /// market. weight 0..1; basePrice6 is the platform base price `b` (1e6).
  archetype?: "external" | "internal";
  weight?: number;
  basePrice6?: string;
  /// Display sequence ("MISSION 001"); the URL still uses contestId.
  seq?: number;
  /// SCOUT domain only: real on-chain DeFi volume moved (USDC 1e6). "0" for
  /// solver/analyst. Kept separate from any payment total — this is volume, not
  /// USDC spent.
  scoutVolume6?: string;
}

export interface MissionSeats {
  total: number;
  taken: number;
}

export interface MissionJoin {
  poolUsdc6: string;
  /// Operative join fee, 1e6-scaled (0 when no treasury / fee disabled).
  operativeFee6: string;
  feeBps: number;
  /// Treasury address the fee is paid to, or null when the fee is off.
  feeRecipient: string | null;
  feesPaid: number;
  specialistSeats: MissionSeats;
  operativeSeats: MissionSeats;
}

export interface MissionState {
  mission: MissionMeta | null;
  join?: MissionJoin;
  fragments: MissionFragment[];
  specialists: MissionSpecialist[];
  operatives: MissionOperative[];
  tape: TapeRow[];
}

/// Resolves a free-text reference (agent id, custom name, or the operator's
/// linked X / Discord / Telegram handle) to one of the signed-in operator's own
/// agents. Lets a specialist identify their agent however is convenient.
export async function resolveAgent(
  q: string,
): Promise<{ agentId: number; name: string | null } | { error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/resolve?q=${encodeURIComponent(q)}`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { agentId?: number; name?: string | null; error?: string };
    if (!res.ok || typeof data.agentId !== "number") return { error: data.error ?? "could not find that agent." };
    return { agentId: data.agentId, name: data.name ?? null };
  } catch {
    return { error: "network error. try again." };
  }
}

/// Specialist buys a scarce platform intel piece (after paying the base price on
/// chain). The backend claims it exclusively and stands up the resale listing.
export async function buyMissionIntel(
  missionId: number,
  input: { fragmentId: string; agentId: number; resalePriceUsdc: number; txHash: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/missions/${missionId}/buy-intel`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "could not buy the piece." };
    return { ok: true };
  } catch {
    return { ok: false, error: "network error. try again." };
  }
}

/// Which side the signed-in operator has already taken in this mission, if any,
/// plus whether they have withdrawn (operative only). Used to lock the opposite
/// role (one side per mission) and to show the terminal withdrawn state.
export async function missionMyRole(
  missionId: number,
): Promise<{ role: "operative" | "specialist" | null; withdrawn: boolean }> {
  try {
    const res = await fetch(`${AUTH_URL}/missions/${missionId}/my-role`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return { role: null, withdrawn: false };
    const data = (await res.json()) as { role?: string; withdrawn?: boolean };
    const role = data.role === "operative" ? "operative" : data.role === "specialist" ? "specialist" : null;
    return { role, withdrawn: Boolean(data.withdrawn) };
  } catch {
    return { role: null, withdrawn: false };
  }
}

/// Operative withdraws from a mission within the join window (changed their
/// mind). The backend refunds any join fee from the treasury and excludes them
/// from grading. Session-gated.
export async function withdrawMission(
  missionId: number,
): Promise<{ ok: true; feeRefunded: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/missions/${missionId}/withdraw`, {
      method: "POST",
      credentials: "include",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; feeRefunded?: boolean };
    if (!res.ok) return { ok: false, error: data.error ?? "could not withdraw." };
    return { ok: true, feeRefunded: Boolean(data.feeRefunded) };
  } catch {
    return { ok: false, error: "network error. try again." };
  }
}

/// Whether the signed-in operator already paid this mission's join fee (so entry
/// does not charge twice on a retry). Defaults to false on any error.
export async function missionFeeStatus(missionId: number): Promise<boolean> {
  try {
    const res = await fetch(`${AUTH_URL}/missions/${missionId}/fee-status`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return false;
    return Boolean(((await res.json()) as { paid?: boolean }).paid);
  } catch {
    return false;
  }
}

/// Records that the operative paid the join fee (after the on-chain transfer).
export async function recordMissionJoinFee(missionId: number, txHash: string, amount6: string): Promise<void> {
  try {
    await fetch(`${AUTH_URL}/missions/${missionId}/join-fee`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash, amount6 }),
    });
  } catch {
    /* best-effort; the transfer already happened on chain */
  }
}

/// One row in the mission index. Light aggregates only; the arena page carries
/// the full detail.
/// "MISSION 001"-style display label from a sequence number.
export function missionNo(seq?: number): string {
  return `MISSION ${String(seq && seq > 0 ? seq : 0).padStart(3, "0")}`;
}

export interface MissionListItem {
  contestId: number;
  domain: string;
  title: string;
  status: string;
  /// Display sequence; URL still uses contestId.
  seq?: number;
  /// True while the underlying contest is open or scoring — the source of truth
  /// for "live right now" (the missions.status text can lag a step).
  live?: boolean;
  createdAt: string;
  operatives: number;
  payments: number;
  spent6: string;
  /// SCOUT missions: real on-chain DeFi volume moved (USDC 1e6). "0" otherwise.
  volume6?: string;
}

/// Fetches the mission index (open first, then newest). Returns [] on any
/// network error so the page renders its empty state rather than throwing.
export async function fetchMissions(): Promise<MissionListItem[]> {
  try {
    const res = await fetch(`${AUTH_URL}/missions`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { missions?: MissionListItem[] };
    return data.missions ?? [];
  } catch {
    return [];
  }
}

/// Whether a contest id is actually a mission (used to label the win modal).
export async function isMissionContest(contestId: number): Promise<boolean> {
  try {
    const s = await fetchMission(contestId);
    return s?.mission != null;
  } catch {
    return false;
  }
}

/// Fetches the full mission state. Returns null on a network error and a state
/// with `mission: null` when the contest is not a mission.
export async function fetchMission(contestId: number): Promise<MissionState | null> {
  try {
    const res = await fetch(`${AUTH_URL}/missions/${contestId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as MissionState;
  } catch {
    return null;
  }
}

/// Operator joins a mission's SUPPLY side: registers an agent to sell intel for
/// a fragment at a price. Session-gated (sends the cookie). The A2A payment from
/// any operative who buys lands in the operator's wallet.
export async function registerSpecialist(
  missionId: number,
  input: { agentId: number; fragmentId: string; priceUsdc: number; intel: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/missions/${missionId}/specialist`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "could not register as a specialist." };
    return { ok: true };
  } catch {
    return { ok: false, error: "network error. try again." };
  }
}

export function formatUsdc6(amount6: string): string {
  return `${(Number(amount6 || "0") / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} USDC`;
}

/// Explorer link for a settlement tx, by the chain it settled on.
export function explorerTx(chain: string, txHash: string): string {
  const c = (chain || "arc").toLowerCase();
  if (c === "base") return `https://basescan.org/tx/${txHash}`;
  if (c === "base-sepolia") return `https://sepolia.basescan.org/tx/${txHash}`;
  if (c === "matic" || c === "polygon") return `https://polygonscan.com/tx/${txHash}`;
  return `https://explorer.testnet.arc.io/tx/${txHash}`;
}

export function shortAddr(addr: string): string {
  return addr && addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
