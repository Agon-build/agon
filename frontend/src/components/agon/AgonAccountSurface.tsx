"use client";

import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell } from "@/components/redesign/BracketedCell";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { Footer } from "@/components/redesign/Footer";
import { TagButton } from "@/components/redesign/TagButton";
import { useOperatorAddress } from "@/hooks/useAuth";
import { AgonAlertSubscriptionPanel } from "./AgonAlertSubscriptionPanel";

type SurfaceView = "activity" | "provider" | "compare";

const CONTENT: Record<SurfaceView, { eyebrow: string; heading: string; body: string; action: string; href: string }> = {
  activity: {
    eyebrow: "YOUR WORK",
    heading: "ACCOUNT ACTIVITY",
    body: "Review your service requests, delivery records, and the next action for each job.",
    action: "SIGN IN TO VIEW ACTIVITY",
    href: "/login?returnTo=%2Fmarket%2Factivity",
  },
  provider: {
    eyebrow: "PROVIDER WORKSPACE",
    heading: "LIST YOUR AGENT",
    body: "Publish a service you own, set its price, and build a public record from the exact versions you operate.",
    action: "START A LISTING",
    href: "/docs#mcp",
  },
  compare: {
    eyebrow: "SERVICE REVIEW",
    heading: "COMPARE SERVICES",
    body: "Open services from the marketplace to compare their purpose, price, availability, and evidence before you choose.",
    action: "BROWSE SERVICES",
    href: "/market",
  },
};

export function AgonAccountSurface({ view }: { view: SurfaceView }) {
  const content = CONTENT[view];
  const { isSignedIn, settling } = useOperatorAddress();
  const activityState = settling ? "CHECKING YOUR SESSION" : isSignedIn ? "SESSION CONNECTED" : "SIGN IN REQUIRED";
  const activityHeading = settling ? "CHECKING YOUR ACCOUNT" : isSignedIn ? "YOUR ACTIVITY IS READY" : "SIGN IN TO VIEW YOUR ACTIVITY";
  const activityBody = settling
    ? "Checking the active account before loading private marketplace records."
    : isSignedIn
      ? "Your requests, deliveries, and receipts will appear here as you use services."
      : content.body;
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1120px] px-4 pb-10 pt-14 sm:px-6 sm:pb-12 sm:pt-16">
          <CornerMarkers />
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{content.eyebrow} · ARC TESTNET</p>
          <h1 className="mt-4 max-w-4xl font-stencil text-[clamp(3rem,8vw,6.5rem)] uppercase leading-[0.88]">{content.heading}</h1>
          <p className="mt-5 max-w-2xl font-mono text-[13px] leading-[1.7] text-ink-2">{content.body}</p>
        </section>
        <section className="mx-auto max-w-[1120px] px-4 pb-20 sm:px-6">
          <BracketedCell pad="lg">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">ARC TESTNET</div>
            {view === "activity" ? <>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{activityState}</div>
              <h2 className="mt-3 font-stencil text-3xl uppercase">{activityHeading}</h2>
              <p className="mt-4 max-w-2xl font-mono text-[12px] leading-relaxed text-ink-2">{activityBody}</p>
              {!isSignedIn && !settling ? <TagButton href={content.href} className="mt-6">{content.action}</TagButton> : null}
            </> : <>
              <h2 className="mt-3 font-stencil text-3xl uppercase">KEEP THE NEXT STEP CLEAR</h2>
              <p className="mt-4 max-w-2xl font-mono text-[12px] leading-relaxed text-ink-2">AGON keeps discovery public and wallet actions explicit. Choose one action below to continue.</p>
              <TagButton href={content.href} className="mt-6">{content.action}</TagButton>
            </>}
          </BracketedCell>
          {view === "provider" && isSignedIn ? <AgonAlertSubscriptionPanel /> : null}
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}
