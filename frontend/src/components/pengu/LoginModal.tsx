"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAccount, useChainId, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { arcTestnet } from "@/lib/arc";
import {
  enrollPasskey,
  EmailOtpUnavailableError,
  loginWithSigner,
  OtpRequiredError,
  sessionFromEmail,
  signInWithEmail,
  startEmailOtp,
  verifyEmailOtp,
} from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { ModalClose } from "@/components/redesign";
import { ProductMark } from "@/components/redesign/ProductMark";
import { IS_AGON_DEPLOYMENT, PRODUCT_NAME } from "@/lib/product";
import { isAgonRoute } from "@/lib/agon/routes";
import { friendlyError } from "@/lib/errors";
import { logRawError, reportEvent } from "@/lib/report";

/// Login popout. Bracketed surface on a warm
/// canvas, stencil heading, mono body, flat notched pink tag CTAs. Three
/// views: signed-out (choose between email passkey or wallet), email form,
/// and signed-in (account info plus a single SIGN OUT button that also
/// disconnects the wagmi wallet so the next click starts a fresh wallet
/// pick and a fresh SIWE signature). No rounded bubbles, no purple backdrop.

// Notched CTA shape, same clipPath the rest of the redesign uses.
const NOTCH = "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)";

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="0" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="0" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/// Click-to-copy address chip. Shows the short form, flips to "COPIED" for
/// a beat after a successful navigator.clipboard write.
function CopyAddress({ address, short }: { address: string; short: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard write can fail in insecure contexts; ignore silently
    }
  }
  return (
    <button
      onClick={copy}
      title={copied ? "copied" : `copy ${address}`}
      className="inline-flex items-center gap-1.5 border border-[color:var(--hairline-strong)] bg-canvas-2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink transition-colors hover:bg-canvas-3"
    >
      <span>{copied ? "COPIED" : short}</span>
    </button>
  );
}

function PrimaryTag({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-between gap-2 bg-accent px-4 py-3 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
      style={{ clipPath: NOTCH }}
    >
      <span className="flex items-center gap-2">{children}</span>
      <span aria-hidden>→</span>
    </button>
  );
}

function GhostTag({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-between gap-2 border border-ink bg-canvas px-4 py-3 font-mono text-[12px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-canvas-3 disabled:opacity-60"
    >
      <span className="flex items-center gap-2">{children}</span>
      <span aria-hidden>→</span>
    </button>
  );
}

function Bracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base = {
    position: "absolute" as const,
    width: 14,
    height: 14,
    pointerEvents: "none" as const,
  };
  const ink = "var(--ink)";
  const styles: Record<typeof pos, React.CSSProperties> = {
    tl: { ...base, top: -1, left: -1, borderTop: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    tr: { ...base, top: -1, right: -1, borderTop: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
    bl: { ...base, bottom: -1, left: -1, borderBottom: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    br: { ...base, bottom: -1, right: -1, borderBottom: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
  };
  return <span aria-hidden style={styles[pos]} />;
}

export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { me, refresh, signOut } = useAuth();
  const pathname = usePathname() ?? "/";
  const { network, networkKey } = useAgonNetwork();
  const agonExperience = IS_AGON_DEPLOYMENT || isAgonRoute(pathname);
  const emailAuthAvailable = !agonExperience || networkKey === "arc-testnet";
  const targetChain = agonExperience ? network.chainId : arcTestnet.id;

  const [view, setView] = useState<"choose" | "email" | "otp">("choose");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [circleBusy, setCircleBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setView("choose");
      setError(null);
      setOtp("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Auto-SIWE now lives globally in AuthProvider: the moment a wallet connects
  // on Arc with no session, the signature is requested there, whether or not
  // this modal is open. That is what makes "connect wallet -> signed in"
  // reliable instead of only firing when the modal happened to be open. This
  // component keeps the MANUAL "SIGN IN WITH WALLET" button below as the retry
  // path (e.g. after a rejection).
  async function signInWeb3() {
    if (chainId !== targetChain) {
      setError(`Switch your wallet to ${network.name} before signing in.`);
      return;
    }
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await loginWithSigner(address, (m) => signMessageAsync({ message: m }));
      await refresh();
      reportEvent("login", { context: { method: "wallet" } });
    } catch (e) {
      // Map known wallet and network conditions to actionable copy. Never use
      // the raw browser/network message as UI fallback. In particular,
      // browsers report a vague "Failed to fetch" when auth is unavailable;
      // consumers need a calm, recoverable message.
      setError(friendlyError(e, "sign-in is temporarily unavailable. try again in a moment."));
      logRawError("login_error", e, { context: { method: "wallet" } });
    } finally {
      setBusy(false);
    }
  }

  /// Email sign-in. Prefer a verified email code whenever the server offers
  /// it. That keeps the flow reliable across devices and lets users recover
  /// accounts whose old passkey was registered on a previous AGON domain.
  /// Servers without OTP enabled fall back to the passkey ceremony.
  async function handleEmailSignIn() {
    if (!emailAuthAvailable) {
      setError(`${network.name} protected actions are not connected yet. Browse freely, or switch to Arc Testnet for the current provider flow.`);
      return;
    }
    const trimmed = email.trim();
    if (!trimmed) {
      setError("enter an email first");
      return;
    }
    setCircleBusy(true);
    setError(null);
    try {
      try {
        await startEmailOtp(trimmed);
        setView("otp");
        setOtp("");
        return;
      } catch (otpErr) {
        if (!(otpErr instanceof EmailOtpUnavailableError)) throw otpErr;
      }

      const result = await signInWithEmail(trimmed);
      await refresh();
      reportEvent("login", { context: { method: "email", isNew: result.isNew, seeded: result.seeded } });
    } catch (e) {
      // First-time signup on a server with EMAIL_OTP_ENABLED. Switch
      // to the OTP view and trigger the code-send right away so the
      // user lands on a populated screen, not an empty form.
      if (e instanceof OtpRequiredError) {
        setError(null);
        setView("otp");
        setOtp("");
        try {
          await startEmailOtp(trimmed);
        } catch (sendErr) {
          setError(friendlyError(sendErr, "could not send the code, try again."));
        }
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      const name = e instanceof Error ? e.name : "";
      const lower = msg.toLowerCase();
      let userMsg = friendlyError(e, "couldn't sign in with that email.");
      // Map the WebAuthn / backend error names to actionable copy. Most
      // of these mean "you've used this email before but the passkey
      // doesn't line up", which has a known fix.
      if (lower.includes("not configured")) {
        userMsg = "email login isn't enabled on this server. use a wallet below.";
      } else if (lower.includes("valid email")) {
        userMsg = "that doesn't look like a valid email.";
      } else if (name === "NotAllowedError" || lower.includes("not allowed")) {
        userMsg = "cancelled or timed out. try again, or use a different device.";
      } else if (name === "InvalidStateError" || lower.includes("invalid state")) {
        userMsg = "this device already has a passkey for this account but it doesn't match our records. clear the site's saved passkey in your password manager and try again, or use a wallet below.";
      } else if (lower.includes("no credentials") || lower.includes("unknown credential")) {
        userMsg = "no passkey on this device for this email. sign in on the device you originally registered, then add a passkey here from settings.";
      } else if (lower.includes("verification failed") || lower.includes("attestation")) {
        userMsg = "passkey verification failed. clear the saved passkey and try again, or use a wallet below.";
      }
      setError(userMsg);
      logRawError("login_error", e, { context: { method: "email", name } });
    } finally {
      setCircleBusy(false);
    }
  }

  /// Verify the 6-digit OTP and complete sign-in from the code alone — no
  /// passkey prompt. Signup is just email + code; a passkey can be added later
  /// from settings for faster returning logins. On any error we keep the OTP
  /// view active so the user can retry without re-typing their email.
  async function handleVerifyOtp() {
    const trimmed = email.trim();
    const codeTrimmed = otp.trim();
    if (!/^[0-9]{6}$/.test(codeTrimmed)) {
      setError("enter the 6-digit code from your email");
      return;
    }
    setOtpBusy(true);
    setError(null);
    try {
      await verifyEmailOtp(trimmed, codeTrimmed);
      // OTP verified -> create the session directly, no WebAuthn ceremony.
      const result = await sessionFromEmail(trimmed);
      await refresh();
      reportEvent("login", {
        context: { method: "email", isNew: result.isNew, seeded: result.seeded, otp: true },
      });
    } catch (e) {
      setError(friendlyError(e, "could not verify the code."));
      logRawError("otp_verify_error", e, { context: { method: "email" } });
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleResendOtp() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setOtpBusy(true);
    setError(null);
    try {
      await startEmailOtp(trimmed);
    } catch (e) {
      setError(friendlyError(e, "could not resend the code."));
    } finally {
      setOtpBusy(false);
    }
  }

  /// Attach a passkey to the live session so the next login requires it.
  /// Visible only for email accounts that haven't enrolled one yet. The
  /// hasPasskey flag on /auth/me drives the chip.
  async function handleEnrollPasskey() {
    setEnrolling(true);
    setError(null);
    try {
      await enrollPasskey();
      await refresh();
      setEnrolled(true);
      reportEvent("passkey_enroll", { context: { from: "settings" } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let userMsg = friendlyError(e, "could not enroll passkey.");
      if (e instanceof Error && e.name === "NotAllowedError") {
        userMsg = "cancelled or timed out. try again from this device.";
      } else if (msg.toLowerCase().includes("invalid")) {
        userMsg = "this device already has a passkey for this account.";
      }
      setError(userMsg);
      logRawError("passkey_enroll_error", e);
    } finally {
      setEnrolling(false);
    }
  }

  /// Full sign-out: clear the SIWE session AND disconnect the wagmi wallet.
  /// Without the disconnect, wagmi remembers the wallet and the next sign-in
  /// skips the wallet picker. The modal closes after so the next click hits
  /// a clean "choose" view.
  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      try { disconnect(); } catch { /* wagmi disconnect is non-throwing in practice */ }
      onClose();
    }
  }

  /// Same idea for "disconnect" when a wallet is connected but no SIWE
  /// session exists yet. Lets the user back out and pick a different wallet.
  function handleDisconnect() {
    try { disconnect(); } catch { /* ignore */ }
  }

  // The wallet branch opens RainbowKit's picker (openConnectModal) so the user
  // chooses a specific wallet, instead of silently grabbing the active injected
  // one. Once connected, the same tag advances to switch-chain, then SIWE.
  const wallet: { label: string; onClick?: () => void; disabled: boolean } = !mounted
    ? { label: "CONNECT A WALLET", disabled: true }
    : !isConnected
      ? { label: "CONNECT A WALLET", onClick: openConnectModal, disabled: !openConnectModal }
      : chainId !== targetChain
        ? { label: `SWITCH WALLET TO ${network.brand} ${network.environment}`, onClick: () => switchChain({ chainId: targetChain }), disabled: false }
        : { label: busy ? "SIGNING" : "SIGN IN WITH WALLET", onClick: signInWeb3, disabled: busy };

  const short = me ? `${me.address.slice(0, 6)}…${me.address.slice(-4)}` : "";
  const contentKey = me ? "account" : view;
  const dur = reduce ? 0 : 0.24;
  const stepDur = reduce ? 0 : 0.16;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-modal overflow-y-auto"
          style={{ backgroundColor: "rgba(26,22,18,0.55)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-center justify-center px-4 py-12 sm:py-16" onClick={onClose}>
            <motion.div
              className="relative my-auto w-full max-w-[440px] border border-ink bg-canvas p-8"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: dur, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />

              <ModalClose onClick={onClose} />

              <AnimatePresence mode="wait">
                <motion.div
                  key={contentKey}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: stepDur, ease: [0.16, 1, 0.3, 1] }}
                >
                  {me ? (
                    <>
                      <div className="flex items-center gap-4">
                        <ProductMark name={PRODUCT_NAME} />
                        <div>
                          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                            <span aria-hidden className="text-accent">■</span> SIGNED IN
                          </div>
                          <h2
                            className="mt-1 font-stencil uppercase text-ink"
                            style={{ fontSize: 26, lineHeight: 1, letterSpacing: "-0.01em" }}
                          >
                            YOU ARE IN
                          </h2>
                        </div>
                      </div>
                      <div className="mt-5 flex items-center gap-2 font-mono text-[12px] text-ink-2">
                        <span>SIGNED IN AS</span>
                        <CopyAddress address={me.address} short={short} />
                      </div>
                      {me.email ? (
                        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-4">
                          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-2">PASSKEY</span>
                          {me.hasPasskey || enrolled ? (
                            <span className="inline-flex items-center gap-1.5 border border-[color:var(--ok)] bg-canvas px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--ok)]">
                              ■ ENABLED
                            </span>
                          ) : (
                            <button
                              onClick={handleEnrollPasskey}
                              disabled={enrolling}
                              className="inline-flex items-center gap-2 bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
                            >
                              {enrolling ? "CHECK YOUR DEVICE" : "ADD A PASSKEY"}
                            </button>
                          )}
                        </div>
                      ) : null}
                      <div className="mt-7 flex flex-col gap-3">
                        <PrimaryTag onClick={onClose}>
                          <span>ENTER AGON</span>
                        </PrimaryTag>
                        <GhostTag onClick={handleSignOut}>
                          <span>SIGN OUT</span>
                        </GhostTag>
                      </div>
                    </>
                  ) : view === "choose" ? (
                    <>
                      <div className="flex items-center gap-4">
                        <ProductMark name={PRODUCT_NAME} />
                        <div>
                          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                            <span aria-hidden className="text-accent">■</span> SIGN IN
                          </div>
                          <h2
                            className="mt-1 font-stencil uppercase text-ink"
                            style={{ fontSize: 26, lineHeight: 1, letterSpacing: "-0.01em" }}
                          >
                            SIGN IN TO AGON
                          </h2>
                        </div>
                      </div>
                      <div className="mt-6 flex flex-col gap-3">
                        {emailAuthAvailable ? <><PrimaryTag onClick={() => setView("email")}>
                          <MailIcon /> CONTINUE WITH EMAIL
                        </PrimaryTag>
                        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                          <span className="h-px flex-1 bg-[color:var(--hairline-strong)]" />
                          OR
                          <span className="h-px flex-1 bg-[color:var(--hairline-strong)]" />
                        </div></> : null}
                        <GhostTag disabled={wallet.disabled} onClick={wallet.onClick}>
                          <WalletIcon /> {wallet.label}
                        </GhostTag>
                        {isConnected ? (
                          <button
                            onClick={handleDisconnect}
                            className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
                          >
                            DISCONNECT WALLET
                          </button>
                        ) : null}
                        {!emailAuthAvailable ? <p className="font-mono text-[11px] leading-relaxed text-ink-2">Sign in on {network.name} to continue. This signature does not approve tokens or send a transaction. Browsing needs no account.</p> : null}
                      </div>
                    </>
                  ) : view === "email" ? (
                    <>
                      <div className="flex items-center gap-4">
                        <ProductMark name={PRODUCT_NAME} />
                        <div>
                          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                            <span aria-hidden className="text-accent">■</span> EMAIL
                          </div>
                          <h2
                            className="mt-1 font-stencil uppercase text-ink"
                            style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" }}
                          >
                            CONTINUE WITH EMAIL
                          </h2>
                        </div>
                      </div>
                      <input
                        className="mt-5 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2.5 font-mono text-sm text-ink outline-none transition-colors focus:border-ink"
                        type="email"
                        placeholder="you@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !circleBusy) void handleEmailSignIn();
                        }}
                        disabled={circleBusy}
                      />
                      <div className="mt-4 flex flex-col gap-3">
                        <PrimaryTag disabled={circleBusy} onClick={handleEmailSignIn}>
                          <span>{circleBusy ? "CHECK YOUR DEVICE" : "CONTINUE"}</span>
                        </PrimaryTag>
                      </div>
                      <div className="mt-4 border-t border-[color:var(--hairline)] pt-4">
                        <button
                          onClick={() => setView("choose")}
                          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
                        >
                          ← USE A WALLET INSTEAD
                        </button>
                      </div>
                      <button
                        onClick={() => setView("choose")}
                        className="mt-5 hidden items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
                      >
                        ← BACK
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-4">
                        <ProductMark name={PRODUCT_NAME} />
                        <div>
                          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                            <span aria-hidden className="text-accent">■</span> VERIFY EMAIL
                          </div>
                          <h2
                            className="mt-1 font-stencil uppercase text-ink"
                            style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" }}
                          >
                            ENTER YOUR CODE
                          </h2>
                        </div>
                      </div>
                      <p className="mt-4 font-mono text-[12px] leading-[1.5] text-ink-2">
                        we sent a 6-digit code to{" "}
                        <span className="text-ink">{email}</span>. it expires in 10 minutes.
                      </p>
                      <input
                        className="mt-5 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2.5 text-center font-mono text-2xl tracking-[0.4em] text-ink outline-none transition-colors focus:border-ink"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !otpBusy) void handleVerifyOtp();
                        }}
                        disabled={otpBusy}
                      />
                      <div className="mt-4 flex flex-col gap-3">
                        <PrimaryTag disabled={otpBusy || otp.length !== 6} onClick={handleVerifyOtp}>
                          <span>{otpBusy ? "VERIFYING…" : "VERIFY AND CONTINUE"}</span>
                        </PrimaryTag>
                        <button
                          onClick={handleResendOtp}
                          disabled={otpBusy}
                          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
                        >
                          RESEND CODE
                        </button>
                      </div>
                      <div className="mt-4 border-t border-[color:var(--hairline)] pt-4">
                        <button
                          onClick={() => {
                            setView("email");
                            setOtp("");
                            setError(null);
                          }}
                          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
                        >
                          ← USE A DIFFERENT EMAIL
                        </button>
                      </div>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              {error ? (
                <p className="mt-4 font-mono text-[11px] text-[color:var(--err)]">{error}</p>
              ) : null}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
