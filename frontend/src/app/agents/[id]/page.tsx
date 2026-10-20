"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { ServiceProof } from "@/components/agon/ServiceProof";
import { AgentLogo } from "@/components/agon/ListingCard";
import { UnverifiedWarning } from "@/components/agon/UnverifiedWarning";
import { VerificationBadge } from "@/components/agon/VerificationBadge";
import { AgonJobEscrowPanel } from "@/components/agon/AgonJobEscrowPanel";
import { AgentRating } from "@/components/agon/AgentRating";
import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell } from "@/components/redesign/BracketedCell";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { Footer } from "@/components/redesign/Footer";
import { SectionHeader } from "@/components/redesign/SectionHeader";
import { TagButton } from "@/components/redesign/TagButton";
import { presentListing } from "@/lib/agon/catalog";
import { assessX402Readiness } from "@/lib/agon/call-intent";
import { hasNamedInputs } from "@/lib/agon/route-view";
import { getListing, inspectManifest, listListings } from "@/lib/agon/client";
import { collectPages, providerLabel, servicesForAgent } from "@/lib/agon/agent-services";
import { cardBadges } from "@/lib/agon/card-facts";
import { networkHref } from "@/lib/agon/network";
import type { AgonListing } from "@/lib/agon/types";
import { assessListingAssurance, canUseEscrow, verifyManifestAnchor } from "@/lib/agon/verify";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { useAuth } from "@/hooks/useAuth";

export default function ListingDetailPage() {
  return <ArcListingDetailPage />;
}
function ArcListingDetailPage() {
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

  useEffect(() => {
    if (!listing) return;
    let live = true;
    setAgentListings([]);
    // The agent's other services are extra; the current one always shows.
    collectPages((cursor) => listListings({ agentId: listing.agentId, network: networkKey, limit: 50, ...(cursor ? { cursor } : {}) }))
      .then((items) => { if (live) setAgentListings(items); })
      .catch(() => {});
    return () => { live = false; };
  }, [listing, networkKey]);

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
          if (!live || !inspection.validation.ok) return;
          // Keep readable provider metadata visible while still treating an
          // immutable anchor mismatch as unsafe for hiring.
          setManifestBody(inspection.body);
        }).catch(() => { /* The anchor-only view remains safe and usable. */ });
      })
      .catch((failure) => {
        if (!live) return;
        setListing(null);
        setError(failure instanceof Error ? failure.message : "Could not read this service.");
      });
    return () => { live = false; };
  }, [networkKey, reference, reloadKey]);

  const hydratedListing = listing ? { ...listing, manifest: { ...listing.manifest, body: manifestBody } } : null;
  const service = hydratedListing ? presentListing(hydratedListing) : null;
  const proof = hydratedListing ? verifyManifestAnchor(hydratedListing.manifest.hash, hydratedListing.manifest.body ?? undefined) : null;
  const assurance = listing && proof ? assessListingAssurance(listing, proof) : null;
  const escrowEligible = listing && proof ? canUseEscrow(listing, proof) : false;
  const quarantined = Boolean(listing?.risk.quarantineReason);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1400px] px-4 pt-14 sm:px-6 sm:pt-16">
          <CornerMarkers />
          <SectionHeader
            eyebrow={service?.category.label ?? `AGON MARKET / ${network.brand} SERVICE`}
            heading={service?.name ?? "SERVICE DETAILS"}
            subDeck={service?.description ?? "Reading this service from the Agon catalog."}
            right={<><TagButton variant="ghost" href="/agents">BACK TO AGENTS</TagButton>{me && listing ? <TagButton variant="ghost" href={`/list?update=${encodeURIComponent(listing.id)}`}>UPDATE LISTING</TagButton> : null}{listing?.verification.status !== "Verified" && listing ? <TagButton href={`/playground?listing=${encodeURIComponent(listing.id)}`}>TEST IN THE PLAYGROUND</TagButton> : null}</>}
          />
        </section>

        <section className="mx-auto max-w-[1400px] px-4 py-10 pb-20 sm:px-6">
          {listing === undefined ? <DetailLoading /> : null}
          {error ? (
            <BracketedCell tone="cream">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--err)]">SERVICE UNAVAILABLE</div>
              <p className="mt-3 font-mono text-sm text-ink-2">{error}</p>
              <button onClick={() => setReloadKey((value) => value + 1)} className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink underline decoration-accent underline-offset-4">RETRY</button>
            </BracketedCell>
          ) : null}

          {listing && service && proof && assurance ? (
            <div className="space-y-6">
              {quarantined ? (
                <UnverifiedWarning message={listing.risk.warning} quarantineReason={listing.risk.quarantineReason} />
              ) : listing.risk.unverified ? null : (
                <div className="border-l-[3px] border-[color:var(--ok)] bg-canvas-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3"><VerificationBadge status={listing.verification.status} /><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Exact version scope</span></div>
                  <p className="mt-3 max-w-[90ch] font-mono text-[11px] leading-relaxed text-ink-2">Agon tested Agent #{listing.agentId}, version {listing.version}, for {service.category.label}. A later version needs a new test.</p>
                </div>
              )}

              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-5">
                  <BracketedCell pad="lg">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--hairline)] pb-5">
                      <div className="flex items-center gap-4">
                        <AgentLogo logoUrl={service.logoUrl} name={service.name} cacheKey={listing.version} />
                        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em]">{cardBadges(listing).map((badge) => <span key={badge} className={badge === "Built by Agon" ? "bg-accent px-2 py-1 text-accent-ink" : badge === "Verified" ? "border border-[color:var(--ok)] px-2 py-1 text-ink" : "border border-[color:var(--hairline-strong)] px-2 py-1 text-ink-2"}>{badge === "Listed" ? "Being checked" : badge}</span>)}<span className="text-ink-3">Agent #{listing.agentId}</span></div>
                      </div>
                    </div>

                    <dl className="mt-7 grid gap-px bg-[color:var(--hairline)] sm:grid-cols-2">
                      <OverviewFact label="CATEGORY" value={service.category.label} note={service.category.description} />
                      <OverviewFact label="PROVIDER" value={providerLabel(listing)} note={listing.firstParty ? "Agon builds and runs this agent." : "The provider owns and operates this agent."} />
                      <OverviewFact label="DELIVERY" value={service.endpoint ? "Public service endpoint" : "Delivery details loading"} note={service.endpoint ? "The provider receives requests through its public endpoint." : "Open the service file to inspect delivery details."} />
                      <OverviewFact label="DELIVERY TIME" value={service.timeoutMs ? `Up to ${Math.round(service.timeoutMs / 1000)} seconds` : "Provider terms"} note="The service declares its maximum response time." />
                    </dl>

                    {visibleTags(service.tags, service.category.slug).length ? (
                      <div className="mt-6">
                        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">SKILLS AND SEARCH TERMS</div>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase text-ink-2">
                          {visibleTags(service.tags, service.category.slug).map((tag) => <span key={tag}>#{tag}</span>)}
                        </div>
                      </div>
                    ) : null}

                    {!service.hasIndexedManifest ? (
                      <div className="mt-6 border-l-[3px] border-[color:var(--warn)] bg-canvas-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
                        AGON can confirm the published record, but the full service description is not available yet. Review the original service file before use.
                      </div>
                    ) : null}
                  </BracketedCell>

                  {servicesForAgent(agentListings, hydratedListing!).length > 1 ? <BracketedCell pad="lg">
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">SERVICES</div>
                    <ul className="mt-4 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
                      {servicesForAgent(agentListings, hydratedListing!).map((row) => (
                        <li key={row.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 py-4">
                          <div className="min-w-0 flex-1 basis-[240px]">
                            <div className="font-sans text-[15px] font-semibold text-ink">{row.name}</div>
                            <p className="mt-1 line-clamp-2 font-sans text-[13px] leading-[1.45] text-ink-2">{row.line}</p>
                          </div>
                          {row.price ? <span className="font-mono text-[12px] text-ink">{row.price}</span> : null}
                          {row.current
                            ? <a href="#use" className="inline-flex min-h-11 items-center bg-accent px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-ink hover:bg-accent-press">{row.action}</a>
                            : <Link href={networkHref(row.href, networkKey)} className="inline-flex min-h-11 items-center border border-ink px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-ink hover:text-[color:var(--canvas)]">{row.action}</Link>}
                        </li>
                      ))}
                    </ul>
                  </BracketedCell> : null}

                  <BracketedCell pad="lg">
                    <div id="rating" className="scroll-mt-24">
                      <AgentRating agentId={listing.agentId} listingReference={listing.id} categoryId={listing.category} />
                    </div>
                  </BracketedCell>

                  <details className="border border-[color:var(--hairline-strong)] bg-canvas">
                    <summary className="cursor-pointer px-5 py-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink sm:px-6">VIEW TECHNICAL PROOF AND PROVENANCE</summary>
                    <div className="grid gap-px border-b border-[color:var(--hairline)] bg-[color:var(--hairline)] sm:grid-cols-2">
                      <OverviewFact label="AGENT ID" value={`ERC-8004 #${listing.agentId}`} note="The identity that owns this service listing." />
                      <OverviewFact label="VERSION" value={`Current version ${listing.version}`} note="The immutable service version used for evidence." />
                    </div>
                    <ServiceProof listing={listing} proof={proof} assurance={assurance} identityRegistry={null} currentOwner={null} />
                    <div className="border-t border-[color:var(--hairline)] px-5 py-5 sm:px-6">
                      <TagButton variant="ghost" href={`/list/version?listingId=${encodeURIComponent(listing.listingId)}&manifestUri=${encodeURIComponent(listing.manifest.uri)}`}>UPDATE THIS SERVICE</TagButton>
                    </div>
                  </details>
                </div>

                <aside id="use" className="scroll-mt-24 lg:sticky lg:top-24">
                  <BracketedCell tone="ink" pad="lg">
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">PRICE AND USE</div>
                    <div className="mt-4 font-stencil text-[36px] uppercase leading-none sm:text-[42px]">{service.amountUSDC ? `${service.amountUSDC} USDC` : "PRICE NOT INDEXED"}</div>
                    <div className="mt-7 space-y-4 border-t border-current pt-5">
                      <Readiness label="LISTING ACTIVE" state={listing.status === "Listed" ? "ready" : "blocked"} value={listing.status === "Listed" ? "YES" : listing.status.toUpperCase()} />
                      <Readiness
                        label="PAY PER USE"
                        state={quarantined || listing.endpointQa.status === "failed" ? "blocked" : listing.endpointQa.status === "passed" ? "ready" : "caution"}
                        value={quarantined ? "BLOCKED" : listing.endpointQa.status === "passed" ? "AVAILABLE" : listing.endpointQa.status === "failed" ? "BLOCKED" : listing.payment.directX402 ? "CHECK REQUIRED" : "NO"}
                      />
                    </div>

                    <div className="mt-5 border-t border-current pt-4 font-mono text-[10px] leading-relaxed opacity-70">
                      <div className="uppercase tracking-[0.12em]">SERVICE AVAILABILITY</div>
                      <p className="mt-2">{availabilityMessage(listing.endpointQa.status)}</p>
                      {listing.endpointQa.status === "passed" && listing.endpointQa.attempts > 0 ? <p className="mt-1 uppercase tracking-[0.08em]">{listing.endpointQa.successRate}% recent reliability</p> : null}
                    </div>

                    {listing.payment.rail === "X402" ? (
                      <div className="mt-7 border-t border-current pt-5">
                        <div className="font-mono text-[10px] uppercase tracking-[0.14em]">HIRE THIS AGENT</div>
                        {hasNamedInputs(manifestBody) && assessX402Readiness(listing).eligible ? (
                          <>
                            <p className="mt-2 max-w-[42ch] font-mono text-[10px] leading-relaxed opacity-70">Describe your task. You see the price before anything is paid, with no Agon routing fee.</p>
                            <TagButton className="mt-4" href={`/?agent=${encodeURIComponent(listing.id)}`}>HIRE {service.name.toUpperCase()}</TagButton>
                          </>
                        ) : (
                          <p className="mt-2 max-w-[42ch] font-mono text-[10px] leading-relaxed opacity-70">{hasNamedInputs(manifestBody) ? assessX402Readiness(listing).reason : "This agent's listing needs an update before Agon can hire it."}</p>
                        )}
                      </div>
                    ) : (
                      <AgonJobEscrowPanel listing={listing} defaultAmountUSDC={service.amountUSDC} eligible={escrowEligible} />
                    )}

                    <div className="mt-7 border-t border-current pt-5 font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] opacity-55">
                      Test USDC on {network.name}
                    </div>
                  </BracketedCell>
                </aside>
              </div>
            </div>
          ) : null}
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function OverviewFact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-canvas-2 p-4">
      <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">{label}</dt>
      <dd className="mt-2 font-mono text-[12px] text-ink">{value}</dd>
      <dd className="mt-1 break-all font-mono text-[9px] leading-relaxed text-ink-3">{note}</dd>
    </div>
  );
}

function Readiness({ label, state, value }: { label: string; state: "ready" | "caution" | "blocked"; value: string }) {
  const color = state === "ready" ? "var(--ok)" : state === "caution" ? "var(--warn)" : "var(--err)";
  return <div className="flex items-center justify-between gap-4 font-mono text-[10px]"><span className="opacity-65">{label}</span><span className="inline-flex items-center gap-2 uppercase"><span className="h-2 w-2" style={{ background: color }} />{value}</span></div>;
}

function availabilityMessage(status: AgonListing["endpointQa"]["status"]): string {
  if (status === "passed") return "The service is responding to availability checks.";
  if (status === "failed") return "The service did not respond reliably. Try again later.";
  return "Agon is checking whether this service is ready.";
}

function DetailLoading() {
  return (
    <div aria-label="Loading service" className="border-y border-[color:var(--hairline)] py-10">
      <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-2">LOADING SERVICE...</div>
      <div className="mt-4 h-0.5 w-full overflow-hidden bg-canvas-3"><div className="h-full w-1/3 animate-pulse bg-accent" /></div>
    </div>
  );
}

/// Search terms worth showing: not bare numbers, not just the category name again.
function visibleTags(tags: string[], categorySlug: string): string[] {
  return tags.filter((tag) => !/^\d+$/.test(tag) && tag.toLowerCase() !== categorySlug.toLowerCase());
}
