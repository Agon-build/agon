"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { fetchMe, logout, purgeLegacyToken, type Me } from "@/lib/auth";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";

interface AuthContextValue {
  me: Me | null; loading: boolean; settling: boolean;
  refresh: () => Promise<void>; signOut: () => Promise<void>;
  sessionEndedReason: string | null; clearSessionEndedReason: () => void; siwePrompting: boolean;
}
const AuthContext = createContext<AuthContextValue | null>(null);

/** A cookie never authenticates a different network. Only explicit sign-in
 * requests a signature; public browsing never does. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { network } = useAgonNetwork();
  const scope = network.chainId;
  const [state, setState] = useState<{ scope: number; me: Me | null; loading: boolean }>({ scope, me: null, loading: true });
  const [sessionEndedReason, setSessionEndedReason] = useState<string | null>(null);
  const { address: wallet, status } = useAccount();
  const generation = useRef(0);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const me = state.scope === scope ? state.me : null;
  const loading = state.scope !== scope || state.loading;
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, me: null, loading: true });
    let next: Me | null = null;
    try {
      next = await fetchMe();
    } catch { /* Never carry a previous network identity through a failure. */ }
    if (request === generation.current && activeScope.current === scope) setState({ scope, me: next, loading: false });
  }, [scope]);
  const signOut = useCallback(async () => {
    ++generation.current;
    setState({ scope, me: null, loading: false });
    await logout();
  }, [scope]);
  useEffect(() => { purgeLegacyToken(); void refresh(); return () => { ++generation.current; }; }, [refresh]);
  useEffect(() => {
    if (me?.walletKind === "wagmi" && wallet && status === "connected" && wallet.toLowerCase() !== me.address.toLowerCase()) {
      setSessionEndedReason("You switched wallet accounts. Sign in with the new one.");
      void signOut().catch(() => {});
    }
  }, [me, wallet, status, signOut]);
  const clearSessionEndedReason = useCallback(() => setSessionEndedReason(null), []);
  return <AuthContext.Provider value={{ me, loading, settling: loading || status === "reconnecting", refresh, signOut, sessionEndedReason, clearSessionEndedReason, siwePrompting: false }}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
export function useOperatorAddress(): { address: `0x${string}` | undefined; isSignedIn: boolean; settling: boolean } {
  const { me, settling } = useAuth();
  const { address: wallet } = useAccount();
  return { address: (me?.address ?? wallet) as `0x${string}` | undefined, isSignedIn: !!me, settling };
}
