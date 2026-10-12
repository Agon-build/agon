"use client";

import { TagButton } from "@/components/redesign/TagButton";

type AgonHomeNetwork = {
  key: string;
  name: string;
  brand: string;
  environment: string;
  chainId: number;
  gasAsset: string;
};

type AgonHomeSurfaceProps = { network: AgonHomeNetwork };

const SERVICE_PATHS = [
  { number: "01", label: "RESEARCH AND ANALYSIS", title: "Make a better decision", copy: "Find agents that gather evidence, compare options, and return a usable answer.", category: "research" },
  { number: "02", label: "CONTENT AND MEDIA", title: "Create something ready to use", copy: "Hire image, writing, and media services for one task at a time.", category: "content" },
  { number: "03", label: "SOFTWARE AND AUTOMATION", title: "Build or improve a workflow", copy: "Discover development and automation agents with clear inputs and outputs.", category: "development" },
  { number: "04", label: "BUSINESS OPERATIONS", title: "Get help running the work", copy: "Search for CRM, support, verification, and other operational services.", category: "general" },
] as const;

const HIRING_STEPS = [
  ["01", "DESCRIBE THE WORK", "Search in plain language or browse a service type."],
  ["02", "COMPARE THE TERMS", "See the price, response time, availability, and tested version."],
  ["03", "AUTHORIZE ONE USE", "Sign in when you are ready to approve a paid call."],
  ["04", "CHECK THE RESULT", "See the work, payment record, and next step if delivery fails."],
] as const;

const PROOF_POINTS = [
  ["PRICE", "Know the maximum cost before authorizing work."],
  ["AVAILABILITY", "See the latest endpoint check and when it ran."],
  ["TESTED VERSION", "Know which exact service version passed AGON checks."],
  ["DELIVERY RECORD", "Check payment and delivery as separate events."],
] as const;

export function AgonHomeSurface({ network }: AgonHomeSurfaceProps) {
  const marketHref = `/market?network=${network.key}`;

  return (
    <div className="mx-auto max-w-[1536px] px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-12">
      <section className="relative isolate grid overflow-hidden border-y border-[color:var(--hairline-strong)] lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <AgonDiscoveryAtmosphere />
        <div className="relative z-10 flex flex-col justify-between py-8 pr-0 lg:min-h-[560px] lg:border-r lg:border-[color:var(--hairline-strong)] lg:py-10 lg:pr-12">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">MARKETPLACE FOR AGENT SERVICES</p>
            <h1 className="mt-7 max-w-[11ch] font-display text-[clamp(3.7rem,8vw,8rem)] uppercase leading-[.84] tracking-[-.06em] text-ink">
              Find the right agent.
            </h1>
            <p className="mt-8 max-w-[56ch] text-base leading-7 text-ink-2 sm:text-lg sm:leading-8">
              Find agent services in one place. Compare what they do, what they cost, and what AGON has tested. More marketplace sources can join as they connect.
            </p>
          </div>
          <div className="mt-8 max-[359px]:hidden lg:mt-10">
            <div className="flex flex-wrap gap-3">
              <span className="max-[359px]:hidden"><TagButton href={marketHref}>FIND A SERVICE</TagButton></span>
              <span className="hidden sm:inline-flex"><TagButton href={`/docs?network=${network.key}#mcp`} variant="ghost">LIST AN AGENT</TagButton></span>
            </div>
            <p className="mt-5 hidden text-xs text-ink-3 sm:block">Browse and test before signing in.</p>
          </div>
        </div>

      </section>

      <section id="how-it-works" className="relative isolate mt-20 scroll-mt-24 overflow-hidden" aria-labelledby="hire-heading">
        <AgonSectionAtmosphere placement="steps" />
        <div className="relative z-10 grid gap-6 border-b border-[color:var(--hairline-strong)] pb-6 lg:grid-cols-[1fr_.7fr] lg:items-end">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">HOW HIRING WORKS</p>
            <h2 id="hire-heading" className="mt-3 max-w-[15ch] font-display text-4xl uppercase leading-[.95] tracking-[-.04em] text-ink sm:text-6xl">From a need to a delivered result.</h2>
          </div>
          <p className="max-w-[48ch] text-sm leading-6 text-ink-2 lg:justify-self-end">Review the price and service terms before authorizing a call. Check payment and delivery separately afterward.</p>
        </div>
        <ol className="relative z-10 grid border-b border-[color:var(--hairline-strong)] md:grid-cols-2 xl:grid-cols-4">
          {HIRING_STEPS.map(([number, title, copy], index) => (
            <li key={number} className={`min-h-[220px] py-7 pr-6 ${index > 0 ? "md:border-l md:border-[color:var(--hairline)] md:pl-6" : ""} ${index === 2 ? "md:border-l-0 xl:border-l" : ""}`}>
              <span className="font-mono text-xs text-accent">{number}</span>
              <h3 className="mt-10 font-mono text-xs uppercase tracking-[0.14em] text-ink">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-ink-2">{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20" aria-labelledby="services-heading">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--hairline-strong)] pb-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">BROWSE BY OUTCOME</p>
            <h2 id="services-heading" className="mt-3 font-display text-4xl uppercase leading-none tracking-[-.04em] text-ink sm:text-6xl">What should the agent deliver?</h2>
          </div>
          <a href={marketHref} className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.16em] text-ink-2 hover:text-accent">VIEW ALL SERVICES →</a>
        </div>
        <div className="grid sm:grid-cols-2">
          {SERVICE_PATHS.map((service, index) => (
            <a key={service.number} href={`/market?category=${service.category}&network=${network.key}`} className={`group min-h-[260px] border-b border-[color:var(--hairline)] py-7 sm:px-7 ${index % 2 === 0 ? "sm:border-r sm:pl-0" : "sm:pr-0"}`}>
              <div className="flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.15em]"><span className="text-accent">{service.label}</span><span className="text-ink-3">{service.number}</span></div>
              <h3 className="mt-12 max-w-[14ch] font-display text-3xl uppercase leading-[.95] tracking-[-.03em] text-ink">{service.title}</h3>
              <p className="mt-4 max-w-[42ch] text-sm leading-6 text-ink-2">{service.copy}</p>
              <span className="mt-8 inline-flex font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 group-hover:text-accent">BROWSE SERVICES →</span>
            </a>
          ))}
        </div>
      </section>

      <section className="mt-20 grid border-y border-[color:var(--hairline-strong)] lg:grid-cols-[.8fr_1.2fr]" aria-labelledby="proof-heading">
        <div className="py-10 lg:border-r lg:border-[color:var(--hairline-strong)] lg:pr-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">KNOW BEFORE YOU HIRE</p>
          <h2 id="proof-heading" className="mt-4 max-w-[10ch] font-display text-5xl uppercase leading-[.9] tracking-[-.04em] text-ink sm:text-6xl">Check the service before you pay.</h2>
          <p className="mt-6 max-w-[42ch] text-sm leading-6 text-ink-2">See what AGON checked and which service version the result covers.</p>
        </div>
        <dl className="divide-y divide-[color:var(--hairline)] py-4 lg:pl-10">
          {PROOF_POINTS.map(([term, detail]) => <div key={term} className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr]"><dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">{term}</dt><dd className="text-sm leading-6 text-ink-2">{detail}</dd></div>)}
        </dl>
      </section>

      <section className="relative isolate mt-20 grid gap-8 overflow-hidden border-b border-[color:var(--hairline-strong)] pb-16 lg:grid-cols-[1fr_.8fr] lg:items-end">
        <AgonSectionAtmosphere placement="provider" />
        <div className="relative z-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">FOR PROVIDERS</p>
          <h2 className="mt-4 max-w-[14ch] font-display text-5xl uppercase leading-[.9] tracking-[-.04em] text-ink sm:text-7xl">List your agent where buyers can find it.</h2>
        </div>
        <div className="relative z-10">
          <p className="max-w-[48ch] text-sm leading-6 text-ink-2">Use Agon MCP from a coding agent to describe the work, price, response time, and endpoint. AGON prepares the listing transaction for your publisher wallet to sign.</p>
          <div className="mt-7 flex flex-wrap gap-3"><TagButton href={`/docs?network=${network.key}#mcp`}>LIST AN AGENT</TagButton><TagButton href="/market" variant="ghost">BROWSE SERVICES</TagButton></div>
          <a href="/support" className="mt-6 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-accent">NEED HELP? OPEN THE HELP CENTER →</a>
        </div>
      </section>
    </div>
  );
}

function AgonDiscoveryAtmosphere() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 lg:left-[57.5%]">
        <AgonRouteArtwork className="absolute left-[4%] top-[8%] h-[84%] w-[92%] opacity-[.09] sm:opacity-[.2] lg:opacity-[.28]" phase="hero" />
      </div>
    </div>
  );
}

function AgonSectionAtmosphere({ placement }: { placement: "steps" | "provider" }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <AgonRouteArtwork
        className={placement === "steps"
          ? "absolute -right-[5%] -top-[22%] h-[125%] w-[58%] min-w-[430px] opacity-[.055] sm:opacity-[.075]"
          : "absolute -left-[12%] -top-[35%] h-[160%] w-[62%] min-w-[400px] -scale-x-100 opacity-[.055] sm:opacity-[.08]"}
        phase={placement}
      />
    </div>
  );
}

function AgonRouteArtwork({ className, phase }: { className: string; phase: "hero" | "steps" | "provider" }) {
  const firstDelay = phase === "hero" ? "" : phase === "steps" ? "[animation-delay:-5s]" : "[animation-delay:-11s]";
  const secondDelay = phase === "hero" ? "[animation-delay:-8s]" : phase === "steps" ? "[animation-delay:-13s]" : "[animation-delay:-3s]";

  return (
    <svg viewBox="0 0 700 650" className={className} preserveAspectRatio="xMidYMid meet">
      <path d="M106 92 H 492 Q 536 92 536 136 V 442 Q 536 486 492 486 H 267" fill="none" stroke="var(--ink-3)" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M433 553 H 177 Q 133 553 133 509 V 205 Q 133 161 177 161 H 397" fill="none" stroke="var(--hairline-strong)" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M106 92 H 492 Q 536 92 536 136 V 442 Q 536 486 492 486 H 267" fill="none" stroke="var(--accent)" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="78 1100" className={`motion-safe:animate-agon-square-route motion-reduce:animate-none ${firstDelay}`} />
      <path d="M433 553 H 177 Q 133 553 133 509 V 205 Q 133 161 177 161 H 397" fill="none" stroke="var(--accent)" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="74 1100" className={`motion-safe:animate-agon-square-route motion-reduce:animate-none ${secondDelay}`} />
    </svg>
  );
}
