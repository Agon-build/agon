import { encodeFunctionData, type Abi } from "viem";
import {
  createCircleUserControlledContractChallenge,
  getCircleUserControlledContractStatus,
} from "./auth";
import type { CircleWriteArgs } from "@/hooks/useCircleExecute";

type CircleSdk = {
  setAuthentication(auth: { userToken: string; encryptionKey: string }): void;
  execute(challengeId: string, onCompleted?: (error: unknown, result: unknown) => void): void;
};

type ActiveCircleSession = {
  sdk: CircleSdk;
  userToken: string;
  encryptionKey: string;
  walletId: string;
  address: string;
};

let activeSession: ActiveCircleSession | null = null;

export function registerCircleUserControlledSession(session: ActiveCircleSession): void {
  activeSession = { ...session, address: session.address.toLowerCase() };
}

export function activeCircleUserControlledAddress(): string | null {
  return activeSession?.address ?? null;
}

export function clearCircleUserControlledSession(): void {
  activeSession = null;
}

export async function executeCircleUserControlledContract(args: CircleWriteArgs): Promise<`0x${string}`> {
  const session = activeSession;
  if (!session) throw new Error("sign in with Circle on the wallet page before using this principal");
  const callData = encodeFunctionData({
    abi: args.abi,
    functionName: args.functionName,
    args: (args.args ?? []) as never,
  });
  const challenge = await createCircleUserControlledContractChallenge({
    userToken: session.userToken,
    walletId: session.walletId,
    address: session.address,
    contractAddress: args.address,
    callData,
    idempotencyKey: crypto.randomUUID(),
    ...(args.value ? { amount: args.value } : {}),
    ...(args.refId ? { refId: args.refId } : {}),
  });
  session.sdk.setAuthentication({ userToken: session.userToken, encryptionKey: session.encryptionKey });
  await new Promise<void>((resolve, reject) => {
    session.sdk.execute(challenge.challengeId, (error, result) => {
      if (error) return reject(new Error("Circle approval was not completed"));
      const status = (result as { status?: unknown } | undefined)?.status;
      if (status !== "COMPLETE") return reject(new Error("Circle approval was not completed"));
      resolve();
    });
  });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    const status = await getCircleUserControlledContractStatus({
      userToken: session.userToken,
      walletId: session.walletId,
      address: session.address,
      challengeId: challenge.challengeId,
    });
    if (status.txHash && /^0x[a-fA-F0-9]{64}$/.test(status.txHash)) return status.txHash as `0x${string}`;
    if (["FAILED", "DENIED", "CANCELLED"].includes(status.state)) {
      throw new Error(status.errorReason ?? `Circle transaction ${status.state.toLowerCase()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("Circle transaction is still pending; check the Arc explorer and retry later");
}

export type { CircleSdk };
