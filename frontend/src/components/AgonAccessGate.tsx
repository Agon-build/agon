"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AgonMark } from "@/components/redesign/AgonMark";
import { useOperatorAddress } from "@/hooks/useAuth";
import { IS_AGON_DEPLOYMENT } from "@/lib/product";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { loginHref, networkHref } from "@/lib/agon/network";
import { isAgonPublicRoute, isLegacyArcRunRoute } from "@/lib/agon/routes";

/**
 * Agon has a public discovery layer. Keep Hire, Agents, the Arena, List and
 * Docs readable without an account; individual
 * write/execute surfaces remain protected and ask for sign-in at the action.
 */
export function AgonAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { isSignedIn, settling } = useOperatorAddress();
  const { networkKey } = useAgonNetwork();
  const isLogin = pathname === "/login";
  const isProtocolDocument = pathname.startsWith("/.well-known/");
  const isPublic = isAgonPublicRoute(pathname);
  // Admin has its own in-memory ADMIN_TOKEN gate. It must reach the token
  // screen without entering the wallet/email session flow.
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const isSupportRoute = pathname === "/support" || pathname.startsWith("/support/");
  const isLegacyRoute = isLegacyArcRunRoute(pathname);
  const isPublicDiscovery = isPublic || isLogin || isProtocolDocument || isAdminRoute || isSupportRoute;
  const shouldGate = IS_AGON_DEPLOYMENT && !isPublicDiscovery;

  useEffect(() => {
    if (IS_AGON_DEPLOYMENT && isLegacyRoute) {
      router.replace(networkHref("/", networkKey));
      return;
    }
    if (shouldGate && !settling && !isSignedIn) router.replace(loginHref(networkKey, `${pathname}${window.location.search}`));
  }, [isLegacyRoute, isSignedIn, networkKey, pathname, router, settling, shouldGate]);

  if (IS_AGON_DEPLOYMENT && isLegacyRoute) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-6 text-ink">
        <div className="w-full max-w-[560px] border border-[color:var(--hairline-strong)] bg-canvas-2 p-8 text-center">
          <AgonMark />
          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">AGON</p>
          <h1 className="mt-3 font-stencil text-[42px] uppercase leading-none">OPENING AGON</h1>
          <p className="mx-auto mt-5 max-w-[42ch] font-mono text-[12px] leading-relaxed text-ink-2">That page is not part of Agon. Taking you to Hire.</p>
        </div>
      </main>
    );
  }

  if (!shouldGate || isSignedIn) return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 text-ink">
      <div className="w-full max-w-[560px] border border-[color:var(--hairline-strong)] bg-canvas-2 p-8 text-center">
        <AgonMark />
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">SIGN IN REQUIRED</p>
        <h1 className="mt-3 font-stencil text-[42px] uppercase leading-none">SIGN IN TO ENTER AGON</h1>
        <p className="mx-auto mt-5 max-w-[42ch] font-mono text-[12px] leading-relaxed text-ink-2">
          Connect a wallet or continue with email to publish a service or approve a protected action.
        </p>
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Redirecting to sign in...</p>
      </div>
    </main>
  );
}
