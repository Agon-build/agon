"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BracketedCell } from "@/components/redesign/BracketedCell";
import { inspectManifest } from "@/lib/agon/client";
import { presentListing } from "@/lib/agon/catalog";
import type { AgonListing } from "@/lib/agon/types";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { VerificationBadge } from "./VerificationBadge";

function priceLabel(amountUSDC: string | null) {
  return amountUSDC ? `${amountUSDC} USDC / use` : "Price in service file";
}

export function ListingCard({ listing, searchMatchTerms = [] }: { listing: AgonListing; searchMatchTerms?: string[] }) {
  const { networkKey } = useAgonNetwork();
  const [manifestBody, setManifestBody] = useState(listing.manifest.body);
  const [metadataState, setMetadataState] = useState<"idle" | "loading" | "ready" | "mismatch" | "error">(listing.manifest.body === undefined ? "idle" : "ready");
  const hydratedListing = useMemo(() => ({ ...listing, manifest: { ...listing.manifest, body: manifestBody } }), [listing, manifestBody]);
  const service = presentListing(hydratedListing);
  const quarantined = Boolean(listing.risk.quarantineReason);
  const metadataBlocked = metadataState === "mismatch" || metadataState === "error";
  const unavailable = listing.status !== "Listed" || quarantined || metadataBlocked;

  useEffect(() => {
    setManifestBody(listing.manifest.body);
    if (listing.manifest.body !== undefined) {
      setMetadataState("ready");
      return;
    }
    let active = true;
    setMetadataState("loading");
    void inspectManifest(listing.manifest.uri, networkKey)
      .then((inspection) => {
        if (!active) return;
        if (!inspection.validation.ok) {
          setMetadataState("error");
          return;
        }
        // Keep the provider's human-facing name and logo visible even when the
        // immutable listing anchor is stale. The mismatch must still block
        // hiring, but a generic AGENT #... card hides the service a buyer is
        // trying to understand and makes recovery harder.
        setManifestBody(inspection.body);
        if (inspection.manifestHash.toLowerCase() !== listing.manifest.hash.toLowerCase()) {
          setMetadataState("mismatch");
          return;
        }
        setMetadataState("ready");
      })
      .catch(() => { if (active) setMetadataState("error"); });
    return () => { active = false; };
  }, [listing.id, listing.manifest.body, listing.manifest.hash, listing.manifest.uri, networkKey]);

  return (
    <article className="min-w-0">
      <Link href={`/agents/${encodeURIComponent(listing.id)}`} aria-label={`Open ${service.name}`} className="group block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
        <BracketedCell hover className="h-full" pad="md">
          <div className="flex min-w-0 gap-4 sm:gap-5">
            <AgentLogo logoUrl={service.logoUrl} name={service.name} cacheKey={`${listing.version}-${listing.manifest.hash}`} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="truncate font-mono text-[9px] uppercase tracking-[0.15em] text-accent">{service.category.label}</span>
                <VerificationBadge status={listing.verification.status} quarantined={quarantined} />
              </div>
              <h2 className="mt-2 truncate font-sans text-[20px] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[22px]">{service.name}</h2>
              <p className="mt-2 line-clamp-2 font-sans text-[13px] leading-[1.45] text-ink-2">{service.description}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {service.tags.slice(0, 3).map((tag) => <span key={tag} className="bg-canvas-3 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-3">{tag}</span>)}
          </div>

          {searchMatchTerms.length > 0 ? <p className="mt-3 font-mono text-[8px] uppercase tracking-[0.11em] text-accent">MATCHES: {searchMatchTerms.join(" / ")}</p> : null}

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-t border-[color:var(--hairline)] pt-3">
            <div className="min-w-0">
              <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-ink-3">{listing.payment.rail === "Escrow" ? "PROTECTED PROJECT" : "PAY PER USE"}</div>
              <div className="mt-1 truncate font-sans text-[16px] font-semibold text-ink">{priceLabel(service.amountUSDC)}</div>
            </div>
            <div className="text-right font-mono text-[8px] uppercase tracking-[0.11em] text-ink-3">
              <div className={listing.endpointQa.status === "passed" ? "text-[color:var(--ok)]" : unavailable ? "text-[color:var(--err)]" : "text-[color:var(--warn)]"}>
                {unavailable ? "CHECK REQUIRED" : listing.endpointQa.status === "passed" ? "RESPONDING" : "CHECKING"}
              </div>
              <div className="mt-1 text-ink transition-transform group-hover:translate-x-1">OPEN SERVICE →</div>
            </div>
          </div>

          {metadataState === "loading" ? <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-3">Loading verified service identity</p> : null}
          {metadataState === "mismatch" ? <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[color:var(--err)]">Service file changed · new version required</p> : null}
          {metadataState === "error" ? <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[color:var(--err)]">Service identity unavailable</p> : null}
        </BracketedCell>
      </Link>
    </article>
  );
}

export function AgentLogo({ logoUrl, name, cacheKey }: { logoUrl: string | null; name: string; cacheKey?: string | number }) {
  const [failed, setFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A";
  const resolvedLogoUrl = logoUrl && cacheKey !== undefined
    ? `${logoUrl}${logoUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(String(cacheKey))}`
    : logoUrl;
  const swatches = ["#ff3f88", "#ff9f1c", "#20c997", "#3d7eff", "#9b5de5", "#e85d04"];
  const swatch = swatches[[...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % swatches.length];
  return (
    <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden border border-[color:var(--hairline-strong)] font-sans text-[20px] font-semibold text-white sm:h-[88px] sm:w-[88px]" style={{ backgroundColor: swatch }} role="img" aria-label={resolvedLogoUrl && !failed ? `${name} logo` : `Generated initials for ${name}`}>
      {resolvedLogoUrl && !failed ? <img src={resolvedLogoUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials}
    </div>
  );
}
