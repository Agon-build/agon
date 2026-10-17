/// Maps raw wallet, viem, and Circle errors to short, friendly messages.
/// Returns the friendly version only. Raw error strings (Connector not
/// connected, jsonrpc error -32603, viem stack traces, etc.) MUST NEVER
/// reach the UI. Surfaces that previously printed `details: <raw>`
/// have been removed; this function is the single contract.
///
/// When adding a new branch: prefer matching on the lowercase substring
/// of the raw message so wallet libraries' phrasing tweaks don't break
/// the mapping. Always end branches with the friendly message; never
/// fall through to the raw text.
export function friendlyError(e: unknown, fallback = "something went wrong. try again."): string {
  // viem's BaseError carries a clean `shortMessage` ("User rejected the request.")
  // alongside the verbose `.message` (the full request-arguments dump we must
  // never show). Fold both into the matched text so mapping is robust, and so a
  // wrapped error still resolves to friendly copy instead of the fallback.
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const short =
    e && typeof e === "object" && "shortMessage" in e && typeof (e as { shortMessage?: unknown }).shortMessage === "string"
      ? (e as { shortMessage: string }).shortMessage
      : "";
  const msg = `${short} ${raw}`.toLowerCase();

  if (msg.includes("user rejected") || msg.includes("user denied") || msg.includes("rejected the request")) {
    return "you cancelled the request.";
  }
  if (
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance") ||
    msg.includes("exceeds balance") ||
    msg.includes("insufficient gas") ||
    msg.includes("insufficient usdc") ||
    msg.includes("not enough usdc") ||
    msg.includes("balance too low") ||
    // Circle wraps gas-station failures with these phrases
    msg.includes("gas station") ||
    msg.includes("paymaster") ||
    msg.includes("rejected gas")
  ) {
    return "your wallet is out of usdc for gas. top it up from the arc faucet and try again.";
  }
  // Wagmi "Connector not connected" surfaces when a valid cookie session tries
  // to write through wagmi but the injected wallet hasn't reconnected (common
  // after a cold page load). The session is still good, so the user just needs
  // to reconnect the wallet, not sign in again. useArcWrite already opens the
  // picker for them in this case; this message tells them to retry after.
  if (
    msg.includes("connector not connected") ||
    msg.includes("not connected") ||
    msg.includes("no connector") ||
    msg.includes("disconnected")
  ) {
    return "your wallet got disconnected. reconnect it, then try again.";
  }
  if (msg.includes("chain mismatch") || msg.includes("does not match") || (msg.includes("chain") && msg.includes("switch"))) {
    return "wrong network. switch to arc and try again.";
  }
  if (
    msg.includes("notallowederror") ||
    msg.includes("invalidstateerror") ||
    msg.includes("passkey") ||
    msg.includes("webauthn") ||
    msg.includes("credential")
  ) {
    return "passkey sign-in failed. try again.";
  }
  if (msg.includes("entity config") || msg.includes("circle is not configured")) {
    return "email sign-in is not available right now.";
  }
  if (msg.includes("email begin failed") || msg.includes("relation") || msg.includes("does not exist")) {
    return "the server is briefly unavailable. try again in a moment.";
  }
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("still pending")) {
    return "the request timed out. it may still land; check the Arc explorer in a minute.";
  }
  // viem revert errors carry the on-chain revert reason inside the message
  if (msg.includes("execution reverted") || msg.includes("contractfunctionexecutionerror")) {
    const reason = extractRevertReason(e);
    return reason ? `transaction reverted: ${reason}.` : "the contract rejected this. check requirements and try again.";
  }
  if (msg.includes("nonce") || msg.includes("signature") || msg.includes("verify")) {
    return "could not verify your signature. try again.";
  }
  if (msg.includes("no injected") || msg.includes("provider") || msg.includes("no wallet")) {
    return "no wallet found. install a wallet, or use email instead.";
  }
  // 401-style auth failures from auth-required endpoints.
  if (msg.includes("unauthorized") || msg.includes("401") || msg.includes("not signed in")) {
    return "you're signed out. sign in and try again.";
  }
  // 4xx / 5xx wrappers without a specific match
  if (
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("network error") ||
    msg.includes("network request failed")
  ) {
    return "network hiccup. try again in a moment.";
  }
  return fallback;
}

/// Diagnostic-only: returns the raw error message trimmed to one line.
/// NEVER render this in the UI. Use only for `console.error` calls, event
/// logging, or admin diagnostic surfaces gated behind ADMIN_TOKEN. The
/// UI contract is `friendlyError` only.
export function rawErrorDetail(e: unknown, max = 180): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const flat = msg.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function extractRevertReason(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  const m = e.message.match(/reverted:?\s*"([^"]+)"/i) || e.message.match(/reason:?\s*"([^"]+)"/i);
  return m?.[1] ?? null;
}
