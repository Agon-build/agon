import { createSiweMessage } from "viem/siwe";
import { arcTestnet } from "./arc";
import { PRODUCT_NAME } from "./product";

/// Client for the ArcRun auth service. Runs the SIWE flow (shared by the web3
/// wallet and the Circle Modular passkey login) and lets the backend persist
/// the session in an httpOnly cookie. The frontend never reads the token, so
/// XSS cannot lift it. The session must not live in localStorage.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";
const LEGACY_TOKEN_KEY = "arcrun_jwt"; // pre-cookie storage, cleaned up on first read

export async function fetchNonce(address: string): Promise<string> {
  const res = await fetch(`${AUTH_URL}/auth/wallet/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error("could not get a login nonce");
  return (await res.json()).nonce as string;
}

export function buildSiweMessage(address: `0x${string}`, nonce: string): string {
  return createSiweMessage({
    domain: window.location.host,
    address,
    statement: `Sign in to ${PRODUCT_NAME}`,
    uri: window.location.origin,
    version: "1",
    chainId: arcTestnet.id,
    nonce,
  });
}

/// Verify the SIWE signature with the auth service. On success the backend
/// sets the httpOnly session cookie; the response body is ignored.
export async function verifySiwe(message: string, signature: `0x${string}`): Promise<void> {
  const res = await fetch(`${AUTH_URL}/auth/wallet/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "signature verification failed");
  }
}

export interface Me {
  address: string;
  x_handle: string | null;
  current_syndicate_id: string | null;
  email?: string | null;
  /// "circle" for email-login users whose writes go through POST /wallet/execute,
  /// "wagmi" for users who connected an injected wallet and sign client-side.
  walletKind?: "circle" | "wagmi";
  wallet?: {
    address: string;
    mode: "external" | "circle_developer_controlled" | "circle_user_controlled" | "circle_agent_cli" | "circle_modular";
    custody: "user" | "agon";
    signingSurface: "browser_wallet" | "agon_backend" | "circle_cli" | "browser_circle" | "browser_passkey";
    label: string;
  };
  walletPrincipals?: Array<{
    address: string;
    mode: "external" | "circle_developer_controlled" | "circle_user_controlled" | "circle_agent_cli" | "circle_modular";
    custody: "user" | "agon";
    signingSurface: "browser_wallet" | "agon_backend" | "circle_cli" | "browser_circle" | "browser_passkey";
    label: string;
  }>;
  /// True when this operator has at least one WebAuthn credential enrolled.
  /// Drives the "ADD A PASSKEY" vs "PASSKEY ENABLED" affordance in settings.
  hasPasskey?: boolean;
  canEnterContests: boolean;
  /// Operator's current Cycles balance (from PointsLedger via the indexer).
  /// Used to surface "you need N more cycles" copy when canEnterContests
  /// is false.
  cycles?: number;
  /// Minimum Cycles required to enter contests, from QUALIFY_MIN_POINTS.
  /// Zero (the default) means qualification is open to everyone.
  cyclesRequired?: number;
}

export type CircleUserControlledConfig = { enabled: boolean; appId: string | null };
export type CircleUserControlledWallet = {
  id: string;
  address: string;
  blockchain: string;
  custodyType: string;
  userId?: string;
  state?: string;
};

const circleJson = async (path: string, body?: unknown): Promise<any> => {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Circle wallet request failed");
  return data;
};

export function fetchCircleUserControlledConfig(): Promise<CircleUserControlledConfig> {
  return circleJson("/auth/circle/user-controlled/config");
}

export function createCircleUserControlledDevice(body: { deviceId: string; email: string }): Promise<{
  deviceToken: string;
  deviceEncryptionKey: string;
  otpToken?: string;
}> {
  return circleJson("/auth/circle/user-controlled/device", body);
}

export function prepareCircleUserControlledWallet(userToken: string): Promise<{
  challengeId: string | null;
  userId: string | null;
  wallets: CircleUserControlledWallet[];
}> {
  return circleJson("/auth/circle/user-controlled/prepare", { userToken });
}

export async function listCircleUserControlledWallets(userToken: string): Promise<CircleUserControlledWallet[]> {
  const data = await circleJson("/auth/circle/user-controlled/wallets", { userToken });
  return data.wallets as CircleUserControlledWallet[];
}

export function linkCircleUserControlledWallet(body: {
  userToken: string;
  walletId: string;
  address: string;
}): Promise<{ address: string; mode: "circle_user_controlled"; label: string; linkedAt: string }> {
  return circleJson("/auth/circle/user-controlled/link", body);
}

export function createCircleUserControlledContractChallenge(body: {
  userToken: string;
  walletId: string;
  address: string;
  contractAddress: string;
  callData: string;
  idempotencyKey: string;
  amount?: string;
  refId?: string;
}): Promise<{ challengeId: string; chainId: number; contractAddress: string; callData: string }> {
  return circleJson("/auth/circle/user-controlled/contract-challenge", body);
}

export function getCircleUserControlledContractStatus(body: {
  userToken: string;
  walletId: string;
  address: string;
  challengeId: string;
}): Promise<{ state: string; txHash: string | null; errorReason: string | null }> {
  return circleJson("/auth/circle/user-controlled/contract-status", body);
}

export interface CliDeviceInfo {
  clientName: string;
  scopes: string[];
  status: "pending" | "approved" | "consumed" | "expired";
  expiresAt: string;
}

export async function fetchCliDeviceInfo(userCode: string): Promise<CliDeviceInfo> {
  const res = await fetch(`${AUTH_URL}/auth/cli/device?user_code=${encodeURIComponent(userCode)}`, {
    credentials: "include",
  });
  const data = (await res.json().catch(() => ({}))) as Partial<CliDeviceInfo> & { error?: string };
  if (!res.ok || !data.clientName || !Array.isArray(data.scopes) || !data.status || !data.expiresAt) {
    throw new Error(data.error ?? "device request not found");
  }
  return data as CliDeviceInfo;
}

export async function approveCliDevice(userCode: string): Promise<void> {
  const res = await fetch(`${AUTH_URL}/auth/cli/device/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ userCode }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "could not approve CLI access");
}

/// Reads the current session from the auth service via the httpOnly cookie.
/// Returns null when there is no valid session (logged out or expired).
export async function fetchMe(): Promise<Me | null> {
  try {
    const res = await fetch(`${AUTH_URL}/auth/me`, { credentials: "include" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/// Email + passkey sign-in. The backend decides whether the email needs a
/// fresh passkey ("register") or can authenticate with an existing one
/// ("login") and returns the matching WebAuthn challenge. The browser runs
/// the ceremony with the user's authenticator (Touch ID, Windows Hello,
/// security key, etc.) and POSTs the result back. On success the backend
/// either mints + seeds a fresh Circle Developer-Controlled wallet or
/// resumes the existing one, then sets the session cookie. No password,
/// no emailed code, no seed phrase. The wallet is custodial (Circle signs
/// every tx) but the auth is non-custodial (passkey can't be lifted from
/// the user's device).
export interface EmailLoginResult {
  address: `0x${string}`;
  walletId: string | null;
  seeded: boolean;
  isNew: boolean;
}

/// Thrown by signInWithEmail when the backend says this email needs an
/// OTP step before passkey registration can run. The LoginModal catches
/// this, switches to the OTP view, and retries signInWithEmail once
/// the code is verified.
export class OtpRequiredError extends Error {
  constructor() {
    super("otp_required");
    this.name = "OtpRequiredError";
  }
}

/// Signals that the server does not offer email-code login. The modal uses
/// this only to fall back to the passkey flow; delivery or rate-limit errors
/// must remain visible to the user instead of silently changing auth modes.
export class EmailOtpUnavailableError extends Error {
  constructor() {
    super("email otp unavailable");
    this.name = "EmailOtpUnavailableError";
  }
}

export async function startEmailOtp(email: string): Promise<void> {
  const res = await fetch(`${AUTH_URL}/auth/email/otp/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const message = body.error ?? "could not send the code";
    if (res.status === 503 && message.toLowerCase().includes("disabled")) {
      throw new EmailOtpUnavailableError();
    }
    throw new Error(message);
  }
}

/// Returns the one-time token the server gives only to the client that typed
/// the code. Sign-in sends it back; the email alone is not enough.
export async function verifyEmailOtp(email: string, code: string): Promise<string> {
  const res = await fetch(`${AUTH_URL}/auth/email/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, code }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; verificationToken?: unknown };
  if (!res.ok) throw new Error(body.error ?? "could not verify the code");
  if (typeof body.verificationToken !== "string") throw new Error("could not verify the code");
  return body.verificationToken;
}

export async function signInWithEmail(email: string, verificationToken?: string): Promise<EmailLoginResult> {
  const { startRegistration, startAuthentication } = await import("@simplewebauthn/browser");

  const beginRes = await fetch(`${AUTH_URL}/auth/email/begin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, verificationToken }),
  });
  const begin = (await beginRes.json().catch(() => ({}))) as {
    mode?: "register" | "login";
    options?: unknown;
    error?: string;
    otpRequired?: boolean;
    code?: string;
  };
  // First-time signup + EMAIL_OTP_ENABLED on the server: caller must
  // run /auth/email/otp/start + verify before this call can proceed.
  if (beginRes.status === 403 && (begin.otpRequired || begin.code === "otp_required")) {
    throw new OtpRequiredError();
  }
  if (!beginRes.ok || !begin.mode || !begin.options) {
    throw new Error(begin.error ?? "could not start sign-in");
  }

  let webauthnResponse: unknown;
  if (begin.mode === "register") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webauthnResponse = await startRegistration({ optionsJSON: begin.options as any });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webauthnResponse = await startAuthentication({ optionsJSON: begin.options as any });
  }

  const finishRes = await fetch(`${AUTH_URL}/auth/email/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, mode: begin.mode, response: webauthnResponse, verificationToken }),
  });
  const finish = (await finishRes.json().catch(() => ({}))) as Partial<EmailLoginResult> & {
    error?: string;
  };
  if (!finishRes.ok) {
    throw new Error(finish.error ?? "passkey verification failed");
  }
  if (!finish.address) throw new Error("server returned no address");
  return {
    address: finish.address as `0x${string}`,
    walletId: finish.walletId ?? null,
    seeded: Boolean(finish.seeded),
    isNew: Boolean(finish.isNew),
  };
}

/// OTP-only email sign-in: completes the session from a verified code, with no
/// passkey ceremony. Call after verifyEmailOtp succeeds. Passkeys stay optional
/// (added later from settings); returning users who have one are offered the
/// passkey login automatically by signInWithEmail.
export async function sessionFromEmail(email: string, verificationToken: string): Promise<EmailLoginResult> {
  const res = await fetch(`${AUTH_URL}/auth/email/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, verificationToken }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<EmailLoginResult> & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "could not complete sign-in");
  return {
    address: (data.address ?? "0x") as `0x${string}`,
    walletId: data.walletId ?? null,
    seeded: Boolean(data.seeded),
    isNew: Boolean(data.isNew),
  };
}

/// One registered passkey, as returned by GET /auth/passkey/list. Used by
/// the profile settings to show the user's enrolled devices.
export interface PasskeyRecord {
  id: string;
  deviceType: string | null;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
}

export async function fetchPasskeys(): Promise<PasskeyRecord[]> {
  try {
    const res = await fetch(`${AUTH_URL}/auth/passkey/list`, { credentials: "include" });
    if (!res.ok) return [];
    const data = (await res.json()) as { passkeys?: PasskeyRecord[] };
    return data.passkeys ?? [];
  } catch {
    return [];
  }
}

/// Enroll a passkey on the current live session. Runs the WebAuthn
/// registration ceremony against the email tied to this session and stores
/// the credential. Supports multi-device: each call from a different
/// device adds a NEW credential without overwriting older ones. Throws on
/// cancellation, mismatched origin, verification failure, or when the
/// authenticator already holds a credential for this email on the same
/// device (the backend's excludeCredentials trips).
export async function enrollPasskey(): Promise<void> {
  const { startRegistration } = await import("@simplewebauthn/browser");

  const beginRes = await fetch(`${AUTH_URL}/auth/passkey/enroll/begin`, {
    method: "POST",
    credentials: "include",
  });
  const begin = (await beginRes.json().catch(() => ({}))) as { options?: unknown; error?: string };
  if (!beginRes.ok || !begin.options) {
    throw new Error(begin.error ?? "could not start passkey enrollment");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await startRegistration({ optionsJSON: begin.options as any });

  const finishRes = await fetch(`${AUTH_URL}/auth/passkey/enroll/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ response }),
  });
  const finish = (await finishRes.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!finishRes.ok || !finish.ok) {
    throw new Error(finish.error ?? "passkey enrollment failed");
  }
}

/// Clears the server-side session cookie. The frontend has no token to clear.
export async function logout(): Promise<void> {
  try {
    await fetch(`${AUTH_URL}/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    // A network failure should not block UI sign-out; the cookie will expire on
    // its own and the next /auth/me will return 401.
  }
}

/// One-time cleanup of the pre-cookie token left in localStorage by older
/// versions of the app. Safe no-op otherwise. Called from useAuth on mount.
export function purgeLegacyToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore quota or disabled storage errors */
  }
}

/// Runs the full SIWE login with any signer (a web3 wallet or a Circle smart
/// account). The backend sets the session cookie on success; the caller is
/// expected to refresh useAuth afterwards.
export async function loginWithSigner(
  address: `0x${string}`,
  signMessage: (message: string) => Promise<`0x${string}`>,
): Promise<void> {
  const nonce = await fetchNonce(address);
  const message = buildSiweMessage(address, nonce);
  const signature = await signMessage(message);
  await verifySiwe(message, signature);
}
