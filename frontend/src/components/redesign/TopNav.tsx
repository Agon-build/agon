"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useAuth } from "@/hooks/useAuth";
import { LoginButton } from "@/components/pengu/LoginButton";
import { ProfileLink } from "@/components/pengu/ProfileLink";
import { ArcChainChip } from "@/components/redesign/ArcChainChip";
import { WalletBalanceChip } from "@/components/redesign/WalletBalanceChip";
import { ArcRunMark } from "@/components/redesign/ArcRunMark";
import { AgonMark } from "@/components/redesign/AgonMark";
import { NotificationBell } from "@/components/redesign/NotificationBell";
import { LiveMissionBanner } from "@/components/redesign/LiveMissionBanner";
import { ThemeToggle } from "@/components/redesign/ThemeToggle";
import { AgonHelpButton } from "@/components/agon/AgonHelpButton";
import { AgonNetworkSelector } from "@/components/redesign/AgonNetworkSelector";
import { IS_AGON_DEPLOYMENT } from "@/lib/product";
import { useDisconnect } from "wagmi";
import { isAgonRoute, isLegacyArcRunRoute } from "@/lib/agon/routes";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { networkHref } from "@/lib/agon/network";
import { AGON_NAV } from "@/lib/agon/nav";

/// The product nav. Left: â–  ARCRUN mono wordmark with the pink square mark.
/// Center: mono caps route links separated by 32px on desktop. Right: the
/// login button (which becomes the operator profile chip once signed in).
/// Bottom hairline. 64px tall.
///
/// Mobile (<768px): the centre route list collapses into a hamburger that
/// opens a full-width drawer below the nav. Without this users on phones
/// could not navigate at all.

// Bridge is intentionally not a top-level nav item: ArcRun is an agent arena,
// not a bridge. The bridge is reached from the withdraw flow (and direct
// /bridge links), where moving USDC omnichain actually matters to the user.
const LEGACY_ROUTES = [
  { href: "/agents", label: "AGON AGENTS" },
  { href: "/dashboard", label: "DASHBOARD" },
  { href: "/contests", label: "CONTESTS" },
  { href: "/challenges", label: "CHALLENGES" },
  { href: "/missions", label: "MISSIONS" },
  { href: "/live", label: "LIVE" },
  { href: "/leaderboard", label: "LEADERBOARD" },
  { href: "/syndicates", label: "SYNDICATES" },
];


export function TopNav({ hideSignOut = false }: { hideSignOut?: boolean } = {}) {
  const pathname = usePathname() ?? "/";
  const isLogin = pathname === "/login";
  const isLegacyRoute = isLegacyArcRunRoute(pathname);
  const isAgon = !isLegacyRoute && (IS_AGON_DEPLOYMENT || isAgonRoute(pathname));
  const { networkKey } = useAgonNetwork();
  const { isSignedIn, settling } = useOperatorAddress();
  const routes: { href: string; label: string; exact?: boolean }[] = isAgon ? [...AGON_NAV] : LEGACY_ROUTES;
  const [open, setOpen] = useState(false);
  const { signOut } = useAuth();
  const { disconnect } = useDisconnect();
  const showRoutes = !isLogin && (isAgon || isSignedIn);

  // Close the drawer on route change so users don't see a stale open state
  // after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
    <header className="sticky top-0 z-20 border-b border-[color:var(--hairline)] bg-canvas" onKeyDown={(event) => { if (event.key === "Escape" && open) { setOpen(false); event.currentTarget.querySelector<HTMLButtonElement>('[aria-controls="agon-mobile-menu"]')?.focus(); } }}>
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
        <Link href="/" className="inline-flex min-w-0 shrink-0 items-center text-ink" aria-label="Agon home">
          {isAgon ? <AgonMark /> : <ArcRunMark />}
        </Link>

        {showRoutes ? (
        <nav className="hidden items-center gap-5 xl:flex">
          {routes.map((r) => {
            const active = r.exact ? pathname === r.href : pathname === r.href || pathname.startsWith(`${r.href}/`);
            return (
              <Link
                key={r.href}
                href={isAgon ? networkHref(r.href, networkKey) : r.href}
                className={`font-mono text-[11px] uppercase tracking-[0.16em] transition-colors duration-120 ${
                  active ? "text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {r.label}
              </Link>
            );
          })}
          {isSignedIn && !isAgon ? <ProfileLink /> : null}
        </nav>
        ) : null}

        <div className="flex shrink-0 items-center gap-2 max-[359px]:gap-1">
          {isSignedIn ? (
            <>
              {!isAgon ? <WalletBalanceChip /> : null}
              {!isAgon ? <ArcChainChip /> : null}
              <div className={isAgon ? "hidden xl:block" : ""}><NotificationBell /></div>
              {!hideSignOut && !isAgon ? <button
                type="button"
                onClick={async () => {
                  await signOut();
                  disconnect();
                }}
                className="hidden min-h-11 items-center border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 transition-colors hover:bg-canvas-3 hover:text-ink sm:inline-flex"
              >
                SIGN OUT
              </button> : null}
            </>
          ) : null}
          {isAgon ? <AgonNetworkSelector /> : null}
          {isAgon && isSignedIn ? <details className="relative hidden xl:block" onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}><summary className="flex min-h-11 cursor-pointer items-center border border-[color:var(--hairline-strong)] px-3 font-mono text-[10px] uppercase">Account</summary><nav aria-label="Account" className="absolute right-0 top-full z-50 mt-2 grid w-56 border border-[color:var(--hairline-strong)] bg-canvas p-2"><Link className="min-h-11 p-3 text-sm" href={networkHref("/account", networkKey)}>Wallet and hires</Link><button className="min-h-11 p-3 text-left text-sm" onClick={async () => { await signOut(); disconnect(); }}>Sign out</button></nav></details> : null}
          <div className={isAgon ? "hidden xl:block" : ""}>{!isLogin && (!isAgon || !isSignedIn) && (settling ? null : <LoginButton />)}</div>
          {!isAgon ? <ThemeToggle /> : null}
          {!isLogin && (isAgon || isSignedIn) ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "close menu" : "open menu"}
              aria-expanded={open}
              aria-controls="agon-mobile-menu"
              className="flex h-11 min-h-11 min-w-11 items-center justify-center px-2 border border-[color:var(--hairline-strong)] bg-canvas font-mono text-[14px] text-ink transition-colors hover:bg-canvas-3 xl:hidden"
            >
              <span className="font-mono text-[10px] uppercase">{open ? "Close" : "Menu"}</span>
            </button>
          ) : null}
        </div>
      </div>

      {open && showRoutes ? (
        <div id="agon-mobile-menu" className="border-t border-[color:var(--hairline)] bg-canvas xl:hidden">
          <nav className="mx-auto flex max-w-[1600px] flex-col px-3 py-2 sm:px-6">
            {/* The nav chip is hidden on phones, so this is where mobile users
                see the selected network's payment-token state. */}
            {isSignedIn && !isAgon ? <WalletBalanceChip variant="row" /> : null}
            {isAgon ? <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--hairline)] py-3">{!isSignedIn ? <LoginButton /> : <NotificationBell />}</div> : null}
            {isAgon && isSignedIn ? <Link className="inline-flex min-h-11 items-center py-3 text-sm" href={networkHref("/account", networkKey)}>Wallet and hires</Link> : null}
            {routes.map((r) => {
              const active = r.exact ? pathname === r.href : pathname === r.href || pathname.startsWith(`${r.href}/`);
              return (
                <Link
                  key={r.href}
                  href={isAgon ? networkHref(r.href, networkKey) : r.href}
                  className={`inline-flex min-h-11 items-center border-b border-[color:var(--hairline)] py-3 font-mono text-[12px] uppercase tracking-[0.16em] transition-colors last:border-0 ${
                    active ? "text-ink" : "text-ink-3"
                  }`}
                >
                  {r.label}
                </Link>
              );
            })}
            {isSignedIn ? (
              <div className="border-b border-[color:var(--hairline)] py-3 last:border-0">
                <ProfileLink />
              </div>
            ) : null}
            {isSignedIn ? (
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  disconnect();
                  setOpen(false);
                }}
                className="inline-flex min-h-11 items-center border-b border-[color:var(--hairline)] py-3 text-left font-mono text-[12px] uppercase tracking-[0.16em] text-ink-2 last:border-0 hover:text-ink"
              >
                SIGN OUT
              </button>
            ) : null}
          </nav>
        </div>
      ) : null}

      {isAgon ? null : <LiveMissionBanner />}
    </header>
    {isAgon ? <AgonHelpButton /> : null}
    </>
  );
}
