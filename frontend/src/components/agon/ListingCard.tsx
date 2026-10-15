"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BracketedCell } from "@/components/redesign/BracketedCell";
import { inspectManifest } from "@/lib/agon/client";
import { cardFacts, type AgentActivity, type CardBadge } from "@/lib/agon/card-facts";
import type { AgonListing } from "@/lib/agon/types";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";

const BADGE_TONE: Record<CardBadge, string> = {
  "Built by Agon": "bg-accent text-accent-ink",
  Verified: "border border-[color:var(--ok)] text-ink",
  Listed: "border border-[color:var(--hairline-strong)] text-ink-3",
};

export function ListingCard({ listing, arena = null, activity = null, searchMatchTerms = [] }: { listing: AgonListing; arena?: { agentId: string; text: string } | null; activity?: AgentActivity | null; searchMatchTerms?: string[] }) {
  const { networkKey } = useAgonNetwork();
  const [manifestBody, setManifestBody] = useState(listing.manifest.body);
  const [metadataState, setMetadataState] = useState<"idle" | "loading" | "ready" | "mismatch" | "error">(listing.manifest.body === undefined ? "idle" : "ready");
  const hydratedListing = useMemo(() => ({ ...listing, manifest: { ...listing.manifest, body: manifestBody } }), [listing, manifestBody]);
  const facts = cardFacts(hydratedListing, arena, activity);
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
      <Link href={`/agents/${encodeURIComponent(listing.id)}`} aria-label={`Open ${facts.name}`} className="group block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
        <BracketedCell hover className="flex h-full flex-col" pad="md">
          <div className="flex min-w-0 items-start gap-4">
            <CardLogo logoUrl={facts.logoUrl} initials={facts.initials} name={facts.name} cacheKey={`${listing.version}-${listing.manifest.hash}`} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <h2 className="min-w-0 truncate font-sans text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">{facts.name}</h2>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">{quarantined
                  ? <span className="border border-[color:var(--err)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--err)]">Held</span>
                  : facts.badges.map((badge) => <span key={badge} className={`px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] ${BADGE_TONE[badge]}`}>{badge}</span>)}</span>
              </div>
              <p className="mt-1.5 line-clamp-2 font-sans text-[13px] leading-[1.45] text-ink-2">{facts.line}</p>
            </div>
          </div>

          {facts.arena ? <p className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink"><span aria-hidden className="text-accent">■</span>{facts.arena}</p> : null}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {facts.chips.map((chip) => <span key={chip} className="bg-canvas-3 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-2">{chip}</span>)}
          </div>

          {searchMatchTerms.length > 0 ? <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.11em] text-accent">MATCHES: {searchMatchTerms.join(" / ")}</p> : null}

          <div aria-hidden className="min-h-4 flex-1" />
          <div className="flex items-end justify-between gap-4 border-t border-[color:var(--hairline)] pt-3">
            <ActivityLine text={unavailable ? "Check required" : facts.activity} />
            {facts.price ? <span className="font-mono text-[13px] text-ink">{facts.price}</span> : null}
          </div>

          {metadataState === "loading" ? <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">Loading service details</p> : null}
          {metadataState === "mismatch" ? <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--err)]">Service file changed · new version required</p> : null}
          {metadataState === "error" ? <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--err)]">Service details unavailable</p> : null}
        </BracketedCell>
      </Link>
    </article>
  );
}

function ActivityLine({ text }: { text: string | null }) {
  if (!text) return <span />;
  const tone = text === "Online" ? "bg-[color:var(--ok)]" : text === "Offline" || text === "Check required" ? "bg-[color:var(--err)]" : null;
  return (
    <span className="flex min-w-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
      {tone ? <span aria-hidden className={`h-1.5 w-1.5 shrink-0 ${tone}`} /> : null}
      <span className="truncate">{text}</span>
    </span>
  );
}

function CardLogo({ logoUrl, initials, name, cacheKey }: { logoUrl: string | null; initials: string; name: string; cacheKey: string }) {
  const [failed, setFailed] = useState(false);
  const src = logoUrl ? `${logoUrl}${logoUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheKey)}` : null;
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden border border-[color:var(--hairline-strong)] bg-accent font-stencil text-[18px] text-accent-ink" role="img" aria-label={src && !failed ? `${name} logo` : `${name} initials`}>
      {src && !failed ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials}
    </div>
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
