import { hasFee } from "./route-view.ts";
import type { HireCategory } from "./stage-types.ts";
import { formatUsdcAtomic, parseUsdcText } from "./stage-view.ts";

/// The four steps of a hire, as the rail above the Hire page names them.
export const HIRE_STEPS_RAIL = ["Ask", "Choose", "Pay", "Answer"] as const;

/// Example jobs under the question box, one per category that has services today.
export const HIRE_EXAMPLES = [
  "Price of ETH and SOL right now",
  "A logo for my coffee shop, warm and simple",
  "Find recent papers on solid-state batteries",
  "Will the Fed raise rates in December?",
] as const;

/// Which money a record uses, read from its own network id or name. An unknown network
/// returns null so the page never calls real money test money.
export function moneyLine(network: string): "Test USDC on Arc Testnet" | "Real USDC on Arc mainnet" | null {
  const n = network.trim().toLowerCase();
  if (n === "arc" || n === "arc mainnet") return "Real USDC on Arc mainnet";
  if (n === "arc-testnet" || n === "arc testnet") return "Test USDC on Arc Testnet";
  return null;
}

/// The routing fee line. A hire the person picked from an agent's page carries none.
export function feeLine(direct: boolean, fee: string): string {
  if (direct) return "None, you picked it";
  return hasFee(fee) ? `${fee} USDC (5%)` : "None";
}

/// The count under a category tile, from the live catalog. Empty when the counts could not be read.
export function categoryTileLine(c: HireCategory): string {
  if (c.agon === null && c.outside === null) return "";
  const parts: string[] = [];
  if ((c.agon ?? 0) > 0) parts.push(`${c.agon} on Agon`);
  if ((c.outside ?? 0) > 0) parts.push(`${c.outside} outside`);
  return parts.length > 0 ? parts.join(" · ") : "No services yet";
}

/// How much more the agent wallet needs for a price, exactly. Null when the price is covered
/// or either amount cannot be read.
export function shortfall(price: string, balance: string | null): string | null {
  const need = parseUsdcText(price);
  const have = balance === null ? null : parseUsdcText(balance);
  if (need === null || have === null || have >= need) return null;
  return formatUsdcAtomic(need - have);
}
