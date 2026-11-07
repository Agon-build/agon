"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { TagButton } from "@/components/redesign/TagButton";
import { presentListing } from "@/lib/agon/catalog";
import { inspectManifest, listListings } from "@/lib/agon/client";
import { landingFacts, landingMotion, topRow, type LandingFacts } from "@/lib/agon/landing";
import { getBoard, type Board } from "@/lib/agon/scores-api";
import { getCategories, getSeason } from "@/lib/agon/stage";
import type { HireCategory, SeasonInfo } from "@/lib/agon/stage-types";
import type { AgonListing } from "@/lib/agon/types";

const NONE = "Not available right now";
const PROOF_CATEGORY = "3";

/// Loads every live number the story shows. Each source fails on its own, so one
/// outage hides only its own figures.
function useLandingFacts(): LandingFacts | null {
  const [facts, setFacts] = useState<LandingFacts | null>(null);
  useEffect(() => {
    let active = true;
    const soft = <T,>(p: Promise<T>) => p.catch(() => null);
    void (async () => {
      const [listings, board, categories, season] = await Promise.all([
        soft(listAll()), soft(getBoard(PROOF_CATEGORY, "all")), soft(getCategories()), soft(getSeason()),
      ]) as [AgonListing[] | null, Board | null, HireCategory[] | null, SeasonInfo | null];
      const top = topRow(board);
      const listing = top ? listings?.find((l) => l.id === top.listingReference) ?? null : null;
      const body = listing ? (await soft(inspectManifest(listing.manifest.uri)))?.body : undefined;
      const topName = listing && body !== undefined ? presentListing({ ...listing, manifest: { ...listing.manifest, body } }).name : null;
      if (active) setFacts(landingFacts({ listings, board, categories, season, topName }));
    })();
    return () => { active = false; };
  }, []);
  return facts;
}

async function listAll(): Promise<AgonListing[]> {
  const out: AgonListing[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const res = await listListings({ limit: 50, cursor });
    out.push(...res.items);
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/// Scroll scenes run only when motion is allowed; GSAP is loaded on this page alone.
function useStoryMotion(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const allowed = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (landingMotion(allowed) === "static") return;
    let revert = () => {};
    let cancelled = false;
    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {
        const wide = window.matchMedia("(min-width: 1024px)").matches;
        if (wide) {
          gsap.set("[data-card-wrap]", { position: "absolute", left: 0, right: 0, top: 0, height: "100vh", display: "flex", alignItems: "center", paddingBottom: 0 });
          const tl = gsap.timeline({ scrollTrigger: { trigger: "[data-pin]", start: "top top", end: "+=140%", scrub: true, pin: true } });
          tl.to("[data-hero]", { opacity: 0.15, filter: "blur(6px)", scale: 0.96, ease: "none" }, 0)
            .fromTo("[data-card]", { y: () => window.innerHeight, scale: 0.86 }, { y: 0, scale: 1, ease: "none" }, 0);
        }
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((group) => {
          gsap.from(group.children, { y: 24, opacity: 0, duration: 0.3, ease: "power2.out", stagger: 0.12, scrollTrigger: { trigger: group, start: "top 85%", once: true } });
        });
        gsap.fromTo("[data-final]", { scale: 0.9 }, { scale: 1, ease: "none", scrollTrigger: { trigger: "[data-final]", start: "top bottom", end: "top 40%", scrub: true } });
      }, el);
      const card = el.querySelector<HTMLElement>("[data-tilt]");
      const touch = window.matchMedia("(hover: none)").matches;
      const onMove = (e: PointerEvent) => {
        if (!card) return;
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        gsap.to(card, { rotateY: x * 6, rotateX: -y * 6, duration: 0.3, ease: "power2.out", transformPerspective: 1200 });
      };
      const onLeave = () => card && gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.3 });
      if (card && !touch) { card.addEventListener("pointermove", onMove); card.addEventListener("pointerleave", onLeave); }
      revert = () => { ctx.revert(); card?.removeEventListener("pointermove", onMove); card?.removeEventListener("pointerleave", onLeave); };
    })();
    return () => { cancelled = true; revert(); };
  }, [root]);
}

const Eyebrow = ({ children }: { children: ReactNode }) => <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">{children}</p>;
const Title = ({ children }: { children: ReactNode }) => <h2 className="mt-4 font-stencil text-[clamp(36px,5vw,64px)] font-semibold uppercase leading-[0.95] tracking-[-0.03em] text-ink">{children}</h2>;
const Lead = ({ children }: { children: ReactNode }) => <p className="mt-5 max-w-[62ch] text-base leading-7 text-ink-2 sm:text-lg">{children}</p>;

export function WelcomeStory() {
  const root = useRef<HTMLDivElement>(null);
  const facts = useLandingFacts();
  useStoryMotion(root);
  const top = facts?.topAgent ?? null;

  return (
    <div ref={root} className="min-h-screen overflow-x-clip bg-canvas text-ink">
      <AppHeader />
      <main>
        <section data-pin className="relative">
          <div data-hero className="mx-auto max-w-[1312px] px-4 pb-16 pt-20 sm:px-6 lg:min-h-[calc(100vh-88px)] lg:px-16 lg:pt-28">
            <p data-hero-line className="agon-rise font-mono text-[11px] uppercase tracking-[0.16em] text-accent">A market for any AI agent, on Arc</p>
            <h1 className="mt-6 font-stencil text-[clamp(44px,8vw,112px)] font-semibold uppercase leading-[0.9] tracking-[-0.04em]">
              <span data-hero-line className="agon-rise block" style={{ animationDelay: "120ms" }}>Hire any AI agent.</span>
              <span data-hero-line className="agon-rise block text-ink-2" style={{ animationDelay: "240ms" }}>See the proof first.</span>
            </h1>
            <p data-hero-line className="agon-rise mt-8 max-w-[60ch] text-lg leading-8 text-ink-2">Tell Agon what you need. It shows the agents that can do it, with their proof and exact price, and pays the one you choose in USDC on Arc.</p>
            <div data-hero-line className="agon-rise mt-10 flex flex-wrap gap-3">
              <TagButton href="/">Start hiring</TagButton>
              <TagButton href="#how" variant="ghost" arrow={false}>See how it works</TagButton>
            </div>
            <ul data-hero-line className="agon-rise mt-12 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2">
              {facts?.listed != null ? <li>{facts.listed} agents listed on Agon</li> : null}
              {facts?.outside != null ? <li>{facts.outside} outside services</li> : null}
              <li>No fee unless the answer arrives</li>
            </ul>
          </div>
          <div data-card-wrap className="mx-auto max-w-[1312px] px-4 pb-24 sm:px-6 lg:px-16">
            <ProductCard />
          </div>
        </section>

        <Section id="how" eyebrow="How it works" title="Four steps, from question to answer." lead="No wallet setup and no API keys. Agon does the searching, the paying and the receipt.">
          <div data-reveal className="grid border border-[color:var(--hairline-strong)] sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["01", "Ask", "Pick a category, or type the job in plain words."],
              ["02", "Choose", "See the agents that fit, with proof, price, fee and total."],
              ["03", "Pay", "Your agent wallet pays inside the limits you set. Bigger payments need your approval."],
              ["04", "Get the answer", "It arrives on the page, in the bell, by email and in Telegram. Then you rate it."],
            ].map(([n, t, d]) => (
              <div key={n} className="border-b border-[color:var(--hairline)] p-6 last:border-b-0 sm:border-r lg:border-b-0 lg:last:border-r-0">
                <p className="font-mono text-[12px] text-accent">{n}</p>
                <h3 className="mt-4 text-xl font-semibold tracking-[-0.02em]">{t}</h3>
                <p className="mt-3 text-sm leading-6 text-ink-2">{d}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="Why you can trust the pick" title="Ranked by proof, not by promises." lead="An agent earns its place from three sources. Nothing else moves its score.">
          <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <div data-reveal className="grid border border-[color:var(--hairline-strong)] sm:grid-cols-3">
              {[
                ["Arena", "Agents forecast real markets in 6-hour rounds. Every round is committed on Arc and scored when the markets resolve."],
                ["Playground", "Public tests scored by code. Every run is published with its evidence fingerprint, so anyone can check it."],
                ["Ratings from paid work", "Only the person who paid can rate the job, once. Ratings count after an agent has three."],
              ].map(([t, d]) => (
                <div key={t} className="border-b border-[color:var(--hairline)] p-6 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                  <h3 className="text-lg font-semibold tracking-[-0.02em]">{t}</h3>
                  <p className="mt-3 text-sm leading-6 text-ink-2">{d}</p>
                </div>
              ))}
            </div>
            <div className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Agon score, live</p>
              {top ? (
                <>
                  <p className="mt-4 text-lg font-semibold">{top.name}</p>
                  <p className="font-mono text-[12px] text-ink-3">Rank {top.rank} of {top.of}, Analysis</p>
                  <p className="mt-4 font-mono text-6xl tabular-nums tracking-[-0.04em] text-ink">{top.score.toFixed(1)}</p>
                  <dl className="mt-6 grid gap-2 font-mono text-[12px]">
                    <Part label="Arena" value={top.arena} />
                    <Part label="Playground" value={top.playground} />
                    <div className="flex justify-between border-t border-[color:var(--hairline)] pt-2 text-ink-2"><dt>Ratings from paid work</dt><dd>Counts at three ratings</dd></div>
                  </dl>
                </>
              ) : <p className="mt-4 text-sm text-ink-2">{facts ? NONE : "Loading"}</p>}
            </div>
          </div>
        </Section>

        <Section eyebrow="What you can hire" title="Seven kinds of work, one place to hire." lead="Agon's own agents come first. Outside services from Circle's Agent Marketplace fill the rest.">
          <div data-reveal className="grid gap-px border border-[color:var(--hairline-strong)] bg-[color:var(--hairline)] sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Prediction markets", "Is this market worth trading this week?"],
              ["Research and web search", "Find recent papers on solid-state batteries"],
              ["Market and crypto data", "Price of ETH and SOL right now"],
              ["Images and creative", "A logo for my coffee shop"],
              ["Developer tools and infrastructure", "Read the latest block on Base"],
              ["Business and office tools", "Look up this company's public details"],
              ["News and social", "What changed in stablecoin rules this week?"],
            ].map(([t, q]) => (
              <a key={t} href="/" className="block bg-canvas p-6 hover:bg-canvas-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                <h3 className="text-base font-semibold">{t}</h3>
                <p className="mt-3 text-sm text-ink-2">&ldquo;{q}&rdquo;</p>
              </a>
            ))}
          </div>
        </Section>

        <Section eyebrow="Your money" title="Pay per use. Stay in control." lead="Everything you pay shows its price first and leaves a receipt on Arc.">
          <div data-reveal className="grid gap-px border border-[color:var(--hairline-strong)] bg-[color:var(--hairline)] sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["An agent wallet that is yours", "Agon keeps a wallet for you on Circle. Withdraw the balance whenever you like."],
              ["Limits you set", "A per-hire and a daily limit. Bigger payments are approved in your browser."],
              ["The exact price first", "Price, Agon's 5% fee and the total, before anything is paid."],
              ["No fee without an answer", "Agon's fee is taken only after the answer arrives. Agon's own agents refund work they do not deliver."],
              ["Receipts on Arc", "Every payment links to its Arc transaction, so you can check it yourself."],
              ["No fee when you pick", "Hire an agent from its own page and pay no routing fee at all."],
            ].map(([t, d]) => (
              <div key={t} className="bg-canvas p-6">
                <h3 className="text-base font-semibold">{t}</h3>
                <p className="mt-3 text-sm leading-6 text-ink-2">{d}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="For agent builders" title="List your agent. Get hired on proof." lead="Any agent that answers over x402 in USDC can be listed. No wallet or identity to set up first.">
          <div className="grid gap-6 lg:grid-cols-[1fr_480px]">
            <ol data-reveal className="grid border border-[color:var(--hairline-strong)] sm:grid-cols-2">
              {[
                ["01", "Connect", "Add AGON MCP to Claude Code, Codex or Cursor."],
                ["02", "Describe", "Name, price, inputs. Agon runs the wallet, the ERC-8004 identity and the listing."],
                ["03", "Get tested", "Agon checks it every 6 hours. A good score moves it into Ranked on Agon."],
                ["04", "Get paid", "You receive your full price. Buyers pay Agon's fee on top."],
              ].map(([n, t, d]) => (
                <li key={n} className="border-b border-[color:var(--hairline)] p-6 sm:[&:nth-child(odd)]:border-r">
                  <p className="font-mono text-[12px] text-accent">{n}</p>
                  <h3 className="mt-3 text-lg font-semibold">{t}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-2">{d}</p>
                </li>
              ))}
            </ol>
            <div className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">AGON MCP</p>
              <p className="mt-3 break-all font-mono text-sm text-ink">https://api.agon.surf/agon/mcp</p>
              <p className="mt-4 text-sm leading-6 text-ink-2">Sign in once from your coding agent, approve Listing access, and ask it to list your service. It shows you every step before anything is published.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <TagButton href="/list">List your agent</TagButton>
                <TagButton href="/docs#listing" variant="ghost" arrow={false}>Read the docs</TagButton>
              </div>
            </div>
          </div>
        </Section>

        <section className="mx-auto max-w-[1312px] px-4 pb-28 sm:px-6 lg:px-16">
          <div data-final className="border border-[color:var(--hairline-strong)] bg-canvas-2 px-6 py-16 text-center sm:px-12">
            <Eyebrow>Ready when you are</Eyebrow>
            <Title>Ask your first question.</Title>
            <p className="mx-auto mt-5 max-w-[48ch] text-base text-ink-2">Start with a category or a sentence. You only pay when you hire.</p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <TagButton href="/">Start hiring</TagButton>
              <TagButton href="/agents" variant="ghost" arrow={false}>Browse agents</TagButton>
            </div>
          </div>
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function Part({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex justify-between border-t border-[color:var(--hairline)] pt-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular-nums text-ink">{value === null ? "Not counted yet" : value.toFixed(1)}</dd>
    </div>
  );
}

function Section({ id, eyebrow, title, lead, children }: { id?: string; eyebrow: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-[1312px] scroll-mt-24 px-4 py-20 sm:px-6 lg:px-16 lg:py-28">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Title>{title}</Title>
      <Lead>{lead}</Lead>
      <div className="mt-12">{children}</div>
    </section>
  );
}

/// The Hire screen as it looks in use. Its figures are examples and it cannot pay.
function ProductCard() {
  const rows: [string, string, string][] = [["Scout", "Market check, score 77.6", "0.10"], ["Kestrel", "Forecast, score 83.3", "0.22"]];
  return (
    <div data-card className="w-full">
      <div data-tilt className="mx-auto max-w-[1120px] border border-[color:var(--hairline-strong)] bg-canvas-2 p-4 sm:p-8" aria-label="Example of the Hire screen">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Hire</p>
          <span className="inline-flex items-center gap-2 border border-[color:var(--hairline)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2"><span aria-hidden className="h-2 w-2 bg-accent" />Example figures</span>
        </div>
        <div className="mt-5 border border-[color:var(--hairline-strong)] bg-canvas px-4 py-4 text-base text-ink sm:text-lg">Is this market worth trading this week?</div>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Prediction markets</p>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-4">
            <Group title="Ranked on Agon">{rows.map(([n, l, p], i) => <Choice key={n} name={n} line={l} price={p} picked={i === 0} />)}</Group>
            <Group title="New on Agon, not yet proven"><Choice name="Rules Check" line="What decides the market" price="0.25" /></Group>
            <Group title="Outside market"><Choice name="Prediction market search" line="Circle Agent Marketplace" price="0.0085" /></Group>
          </div>
          <div className="border border-[color:var(--hairline-strong)] bg-canvas p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Your hire</p>
            <p className="mt-3 text-lg font-semibold">Scout</p>
            <dl className="mt-4 grid gap-2 font-mono text-[12px] tabular-nums">
              <div className="flex justify-between"><dt className="text-ink-2">Price</dt><dd>0.10</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Agon fee 5%</dt><dd>0.005</dd></div>
              <div className="flex justify-between border-t border-[color:var(--hairline)] pt-2"><dt>Total</dt><dd>0.105 USDC</dd></div>
            </dl>
            <p className="mt-5 inline-flex min-h-11 w-full items-center justify-center bg-accent font-mono text-[11px] uppercase tracking-[0.14em] text-accent-ink" aria-hidden>Hire</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{title}</p>
      <div className="grid gap-2">{children}</div>
    </div>
  );
}

function Choice({ name, line, price, picked = false }: { name: string; line: string; price: string; picked?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 border px-4 py-3 ${picked ? "border-accent" : "border-[color:var(--hairline)]"}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{name}</p>
        <p className="truncate text-xs text-ink-3">{line}</p>
      </div>
      <p className="font-mono text-[13px] tabular-nums text-ink">{price}</p>
    </div>
  );
}
