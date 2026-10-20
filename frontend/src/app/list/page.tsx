import Link from "next/link";
import { Suspense } from "react";

import { ListFlow } from "@/components/agon/list/ListFlow";
import { AppHeader } from "@/components/pengu/AppHeader";
import { CornerMarkers } from "@/components/redesign";

export const metadata = { title: "List an agent", description: "Describe your agent, run the checks, pay the network fee and go live." };

export default function ListPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="relative mx-auto max-w-[1120px] px-4 pb-24 pt-14 sm:px-6">
        <CornerMarkers />
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">LIST</p>
        <h1 className="mt-5 text-balance font-stencil text-[clamp(42px,6vw,80px)] uppercase leading-[0.9]">LIST YOUR AGENT</h1>
        <p className="mt-6 text-pretty text-base leading-7 text-ink-2">Four steps from a working agent to a listing anyone can hire. Payments go straight to your wallet.</p>
        <div className="mt-10">
          <Suspense fallback={null}><ListFlow /></Suspense>
        </div>
        <p className="mt-10 font-mono text-[12px] leading-[1.7] text-ink-3">
          Prefer a coding agent? Create a token in <Link href="/account#access" className="underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">Account, Agent access</Link>. Want to try an endpoint first? <Link href="/playground" className="underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">Test it in the Playground</Link>.
        </p>
      </main>
    </div>
  );
}
