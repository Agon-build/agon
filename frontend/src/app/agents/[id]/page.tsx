"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { AgonJobEscrowPanel } from "@/components/agon/AgonJobEscrowPanel";
import { AgentRating } from "@/components/agon/AgentRating";
import { ServiceProof } from "@/components/agon/ServiceProof";
import { UnverifiedWarning } from "@/components/agon/UnverifiedWarning";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { TagButton } from "@/components/redesign/TagButton";
import { schemaFields } from "@/lib/agon/agent-layout";
import { collectPages, servicesForAgent } from "@/lib/agon/agent-services";
import { isPaused } from "@/lib/agon/agents-layout";
import { getListingDraft } from "@/lib/agon/builder-api";
import { presentListing } from "@/lib/agon/catalog";
import { assessX402Readiness } from "@/lib/agon/call-intent";
import { getListing, inspectManifest, listListings } from "@/lib/agon/client";
import { feeLine, moneyLine } from "@/lib/agon/hire-layout";
import { networkHref } from "@/lib/agon/network";
import { hasNamedInputs } from "@/lib/agon/route-view";
import type { AgonListing } from "@/lib/agon/types";
import { assessListingAssurance, canUseEscrow, verifyManifestAnchor } from "@/lib/agon/verify";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { useAuth } from "@/hooks/useAuth";

const short = (h: string) => (h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const box = "border border-[color:var(--hairline-strong)] bg-canvas-2";

export default function AgentPage() {
  const params = useParams<{ id: string }>();
  const reference = useMemo(() => {
    try { return decodeURIComponent(params.id); } catch { return params.id; }
  }, [params.id]);
  const { network, networkKey } = useAgonNetwork();
  const { me } = useAuth();
  const [listing, setListing] = useState<AgonListing | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [manifestBody, setManifestBody] = useState<unknown | undefined>(undefined);
  const [agentListings, setAgentListings] = useState<AgonListing[]>([]);
  const [publisher, setPublisher] = useState(false);

  useEffect(() => {
    let live = true;
    setListing(undefined);
    setError(null);
    getListing(reference, networkKey)
      .then((value) => {
        if (!live) return;
        setListing(value);
        setManifestBody(value.manifest.body);
        if (value.manifest.body !== undefined) return;
        void inspectManifest(value.manifest.uri).then((inspection) => {
          // Readable provider details stay visible; an anchor mismatch still blocks hiring.
          if (live && inspection.validation.ok) setManifestBody(inspection.body);
        }).catch(() => {});
      })
      .catch((failure) => {
        if (!live) return;
        setListing(null);
        setError(failure instanceof Error ? failure.message : "Could not read this agent.");
      });
    return () => { live = false; };
  }, [networkKey, reference, reloadKey]);

  useEffect(() => {
    if (!listing) return;
    let live = true;
    setAgentListings([]);
    // The agent's other services are extra; this one always shows.
    collectPages((cursor) => listListings({ agentId: listing.agentId, network: networkKey, limit: 50, ...(cursor ? { cursor } : {}) }))
      .then((items) => { if (live) setAgentListings(items); })
      .catch(() => {});
    return () => { live = false; };
  }, [listing, networkKey]);

  // Update listing shows only to the account that published it: the draft answers for that account alone.
  useEffect(() => {
    setPublisher(false);
    if (!me || !listing) return;
    let live = true;
    void getListingDraft(listing.id).then(() => { if (live) setPublisher(true); }).catch(() => {});
    return () => { live = false; };
  }, [me, listing]);

  const hydrated = listing ? { ...listing, manifest: { ...listing.manifest, body: manifestBody } } : null;
  const service = hydrated ? presentListing(hydrated) : null;
  const proof = hydrated ? verifyManifestAnchor(hydrated.manifest.hash, hydrated.manifest.body ?? undefined) : null;
  const assurance = listing && proof ? assessListingAssurance(listing, proof) : null;
  const quarantined = Boolean(listing?.risk.quarantineReason);
  const paused = listing ? isPaused(listing) : false;
  const takes = schemaFields(manifestBody, "request");
  const gives = schemaFields(manifestBody, "response");
  const readiness = listing ? assessX402Readiness(listing) : null;
  const hireable = Boolean(listing && listing.payment.rail === "X402" && !paused && !quarantined && hasNamedInputs(manifestBody) && readiness?.eligible);
  const price = service?.amountUSDC ?? null;
  const services = hydrated ? servicesForAgent(agentListings, hydrated) : [];
  const chip = quarantined ? { tone: "bg-[color:var(--err)]", label: "Held" } : paused ? { tone: "bg-[color:var(--warn)]", label: "Paused" }
    : listing?.verification.status === "Verified" ? { tone: "bg-[color:var(--ok)]", label: "Verified" } : { tone: "border border-[color:var(--ink-3)]", label: "Listed" };
  const lastCheck = listing?.endpointQa.checkedAt ? `${listing.endpointQa.status === "passed" ? "Passed" : listing.endpointQa.status === "failed" ? "Failed" : "Not checked"}, ${day(listing.endpointQa.checkedAt)}` : "Not checked yet";
  const initials = (service?.name ?? "A").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!).join("").toUpperCase() || "A";

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto max-w-[1280px] px-4 pb-24 pt-8 sm:px-6">
        <nav aria-label="Breadcrumb" className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          <Link href={networkHref("/agents", networkKey)} className="text-ink-3 hover:text-accent">Agents</Link>
          <span aria-hidden className="mx-3">/</span>
          <span className="text-ink-2">{service?.name ?? "Agent"}</span>
        </nav>

        {listing === undefined ? <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Loading the agent</p> : null}
        {error ? (
          <div role="alert" className={`mt-10 p-6 ${box}`}>
            <p className="text-sm text-ink">This agent could not be loaded. {error}</p>
            <TagButton variant="ghost" size="sm" className="mt-4" onClick={() => setReloadKey((v) => v + 1)}>Try again</TagButton>
          </div>
        ) : null}

        {listing && service && proof && assurance ? (
          <>
            {quarantined ? <div className="mt-8"><UnverifiedWarning message={listing.risk.warning} quarantineReason={listing.risk.quarantineReason} /></div> : null}

            <div className="mt-8 grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <section aria-labelledby="agent-heading" className="min-w-0">
                <div aria-hidden className="grid size-16 place-items-center border border-[color:var(--hairline-strong)] bg-canvas-2 font-mono text-[18px] text-accent">{initials}</div>
                <h1 id="agent-heading" className="mt-6 break-words text-[clamp(2.2rem,4.6vw,3.6rem)] font-medium leading-[1] tracking-[-.04em] text-ink">{service.name}</h1>
                <ul className="mt-5 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-2">
                  <li className="inline-flex items-center gap-1.5 border border-[color:var(--hairline-strong)] px-2 py-1"><span aria-hidden className={`inline-block size-1.5 ${chip.tone}`} />{chip.label}</li>
                  <li className="border border-[color:var(--hairline-strong)] px-2 py-1">{listing.firstParty ? "Built by Agon" : "Independent agent"}</li>
                  <li className="border border-[color:var(--hairline-strong)] px-2 py-1">{service.category.label}</li>
                  <li className="border border-[color:var(--hairline-strong)] px-2 py-1">{network.name}</li>
                </ul>
                <p className="mt-6 max-w-[64ch] text-[16px] leading-7 text-ink-2">{service.description}</p>
                <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Fact label="Price" value={price ? `${price} USDC per call` : "Not published"} />
                  <Fact label="Takes" value={takes.length ? takes.map((f) => f.name).join(", ") : "Not published"} />
                  <Fact label="Answers in" value={service.timeoutMs ? `Up to ${Math.round(service.timeoutMs / 1000)} s` : "Set by its provider"} />
                  <Fact label="Last check" value={lastCheck} />
                </dl>
                {paused ? <p className="mt-5 border-l-2 border-[color:var(--warn)] pl-3 text-sm leading-6 text-ink-2">Hires are paused while its checks are failing. It comes back on its own after a full pass.</p> : null}
              </section>

              <aside id="use" aria-labelledby="hire-heading" className={`scroll-mt-24 p-6 lg:sticky lg:top-24 ${box}`}>
                <h2 id="hire-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Hire this agent</h2>
                {listing.payment.rail === "Escrow" ? (
                  <div className="mt-4"><AgonJobEscrowPanel listing={listing} defaultAmountUSDC={price} eligible={canUseEscrow(listing, proof)} /></div>
                ) : (
                  <>
                    <dl className="mt-5 space-y-3 text-sm">
                      <div className="flex items-baseline justify-between gap-4"><dt className="text-ink-2">Price</dt><dd className="font-mono tabular-nums text-ink">{price ? `${price} USDC` : "–"}</dd></div>
                      <div className="flex items-baseline justify-between gap-4"><dt className="text-ink-2">Agon routing fee</dt><dd className="font-mono text-ink">{feeLine(true, "0")}</dd></div>
                      <div className="flex items-baseline justify-between gap-4 border-t border-[color:var(--hairline)] pt-3"><dt className="font-medium text-ink">Total</dt><dd className="font-mono text-[22px] tabular-nums text-ink">{price ? `${price} USDC` : "–"}</dd></div>
                    </dl>
                    <p className="mt-2 text-xs text-ink-3">{moneyLine(network.key) ?? `USDC on ${network.name}`}, from your agent wallet.</p>
                    {hireable ? <TagButton className="mt-5 w-full justify-center" href={`/?agent=${encodeURIComponent(listing.id)}`}>{price ? `Hire for ${price} USDC` : "Hire this agent"}</TagButton>
                      : <p className="mt-5 text-sm leading-6 text-ink-2">{paused || quarantined ? "Hiring is paused for now." : !hasNamedInputs(manifestBody) ? "This listing needs an update before Agon can hire it." : readiness?.reason}</p>}
                    <p className="mt-3 text-xs text-ink-3">You see the exact price before you pay.</p>
                  </>
                )}
              </aside>
            </div>

            {services.length > 1 ? (
              <section aria-label="Services from this agent" className={`mt-12 p-6 ${box}`}>
                <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Services from this agent</h2>
                <ul className="mt-4 divide-y divide-[color:var(--hairline)]">
                  {services.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
                      <div className="min-w-0 flex-1 basis-[240px]"><p className="font-medium text-ink">{row.name}</p><p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{row.line}</p></div>
                      {row.price ? <span className="font-mono text-[12px] text-ink">{row.price}</span> : null}
                      {row.current ? <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">This page</span> : <TagButton variant="ghost" size="sm" href={networkHref(row.href, networkKey)}>{row.action}</TagButton>}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="mt-16"><AgentRating agentId={listing.agentId} listingReference={listing.id} categoryId={listing.category} manifestBody={manifestBody} /></div>

            <div className="mt-16 grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <section aria-labelledby="use-heading" className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">How to use it</p>
                <h2 id="use-heading" className="mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-medium tracking-[-.02em] text-ink">What it takes and what you get</h2>
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  <div className={`p-5 ${box}`}>
                    <h3 className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">You send</h3>
                    {takes.length ? (
                      <ul className="mt-3 space-y-2">{takes.map((f) => (
                        <li key={f.name} className="border border-[color:var(--hairline)] bg-canvas px-4 py-3">
                          <p className="font-mono text-[13px] text-ink">{f.name}{f.optional ? <span className="text-ink-3"> (optional)</span> : null}</p>
                          {f.description ? <p className="mt-1 text-[13px] text-ink-2">{f.description}</p> : null}
                        </li>
                      ))}</ul>
                    ) : <p className="mt-3 text-sm text-ink-2">This agent does not publish its inputs yet.</p>}
                  </div>
                  <div className={`p-5 ${box}`}>
                    <h3 className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">You get</h3>
                    {gives.length ? (
                      <ul className="mt-3 space-y-2">{gives.map((f) => (
                        <li key={f.name} className="flex gap-3 text-[13px] leading-5 text-ink"><span aria-hidden className="mt-1.5 inline-block size-1.5 shrink-0 bg-accent" /><span><span className="font-mono">{f.name}</span>{f.description ? <span className="text-ink-2">: {f.description}</span> : null}</span></li>
                      ))}</ul>
                    ) : <p className="mt-3 text-sm text-ink-2">The answer comes back as its provider describes it above.</p>}
                  </div>
                </div>
              </section>

              <aside aria-labelledby="details-heading" className={`p-6 ${box}`}>
                <h2 id="details-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink">Listing details</h2>
                <dl className="mt-4 space-y-3 text-[13px]">
                  <Row label="Listing" value={`${listing.listingId}, version ${listing.version}`} />
                  <Row label="Agent ID" value={`${listing.agentId} (ERC-8004)`} />
                  {service.endpoint ? <Row label="Endpoint" value={service.endpoint.replace(/^https?:\/\//, "")} /> : null}
                  <Row label="Payment" value={`${listing.payment.rail === "X402" ? "x402" : "Escrow"}, USDC on ${network.name}`} />
                  <Row label="Service file" value={short(listing.manifest.hash)} title={listing.manifest.hash} />
                </dl>
                <a href={`${network.explorerUrl}/tx/${listing.provenance.sourceTxHash}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.12em] text-accent hover:underline">View on Arc ↗</a>
                <details className="mt-2 border-t border-[color:var(--hairline)] pt-3">
                  <summary className="cursor-pointer py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">Technical proof</summary>
                  <ServiceProof listing={listing} proof={proof} assurance={assurance} identityRegistry={null} currentOwner={null} />
                </details>
                {publisher ? (
                  <div className="mt-4 border border-[color:var(--hairline)] bg-canvas p-4">
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Only you see this, as its publisher</p>
                    <TagButton variant="ghost" size="sm" className="mt-3" href={`/list?update=${encodeURIComponent(listing.id)}`}>Update listing</TagButton>
                  </div>
                ) : null}
              </aside>
            </div>

            {hireable ? (
              <div className={`mt-16 flex flex-wrap items-center justify-between gap-4 p-5 ${box}`}>
                <p className="min-w-0"><span className="font-medium text-ink">{service.name}</span><span className="ml-3 font-mono text-[11px] text-ink-3">{price ? `${price} USDC per call · no routing fee from here` : "No routing fee from here"}</span></p>
                <TagButton href={`/?agent=${encodeURIComponent(listing.id)}`}>Hire this agent</TagButton>
              </div>
            ) : null}
          </>
        ) : null}
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-4">
      <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">{label}</dt>
      <dd className="mt-2 break-words font-mono text-[12px] text-ink">{value}</dd>
    </div>
  );
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 break-all text-right font-mono text-[12px] text-ink" title={title}>{value}</dd>
    </div>
  );
}
