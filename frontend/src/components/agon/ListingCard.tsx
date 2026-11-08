"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { inputNames, isPaused } from "@/lib/agon/agents-layout";
import { networkHref } from "@/lib/agon/network";
import { categoryLabel } from "@/lib/agon/rating-view";
import { hasNamedInputs } from "@/lib/agon/route-view";
import { inspectManifest } from "@/lib/agon/client";
import { cardFacts, type AgentActivity } from "@/lib/agon/card-facts";
import type { AgonListing } from "@/lib/agon/types";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";

const PAUSED_NOTE = "Hires are paused while its checks are failing. It comes back on its own after a full pass.";

function TrustChip({ tone, label }: { tone: "ok" | "warn" | "err" | "none"; label: string }) {
  const square = tone === "ok" ? "bg-[color:var(--ok)]" : tone === "warn" ? "bg-[color:var(--warn)]" : tone === "err" ? "bg-[color:var(--err)]" : "border border-[color:var(--ink-3)]";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-2">
      <span aria-hidden className={`inline-block size-1.5 ${square}`} />{label}
    </span>
  );
}

/// One agent on the Agents page: what it does, its proof and price, and the way to hire it.
/// `score` is undefined while scores load, null when the agent has none yet.
export function ListingCard({ listing, score, activity = null, searchMatchTerms = [] }: { listing: AgonListing; score?: number | null; rating?: { agentId: string; text: string } | null; activity?: AgentActivity | null; searchMatchTerms?: string[] }) {
  const { networkKey } = useAgonNetwork();
  const [manifestBody, setManifestBody] = useState(listing.manifest.body);
  const [metadataState, setMetadataState] = useState<"idle" | "loading" | "ready" | "mismatch" | "error">(listing.manifest.body === undefined ? "idle" : "ready");
  const hydratedListing = useMemo(() => ({ ...listing, manifest: { ...listing.manifest, body: manifestBody } }), [listing, manifestBody]);
  const facts = cardFacts(hydratedListing, null, activity);
  const quarantined = Boolean(listing.risk.quarantineReason);
  const paused = isPaused(listing);
  const metadataBlocked = metadataState === "mismatch" || metadataState === "error";
  const hireable = listing.status === "Listed" && !paused && !quarantined && !metadataBlocked && hasNamedInputs(manifestBody);
  const takes = inputNames(manifestBody);
  const chip = quarantined ? { tone: "err" as const, label: "Held" }
    : paused ? { tone: "warn" as const, label: "Paused" }
      : listing.verification.status === "Verified" ? { tone: "ok" as const, label: "Verified" }
        : { tone: "none" as const, label: "Listed" };
  const href = networkHref(`/agents/${encodeURIComponent(listing.id)}`, networkKey);
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
    <article className={`flex h-full min-w-0 flex-col border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 ${paused || quarantined ? "opacity-90" : ""}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h2 className="min-w-0 text-[17px] font-medium leading-tight tracking-[-0.01em] text-ink"><Link href={href} className="text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{facts.name}</Link></h2>
        <TrustChip {...chip} />
      </div>
      <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{listing.firstParty ? "Built by Agon" : "Listed on Agon"} · {categoryLabel(listing.category)}</p>
      <p className="mt-3 line-clamp-2 text-[13px] leading-[1.5] text-ink-2">{facts.line}</p>
      {searchMatchTerms.length > 0 ? <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.11em] text-accent">Matches: {searchMatchTerms.join(" / ")}</p> : null}

      <dl className="mt-4 grid grid-cols-3 gap-3">
        <div><dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Agon score</dt><dd className="mt-1 font-mono text-[17px] tabular-nums text-ink">{score === undefined ? "–" : score === null ? <span className="text-[11px] text-ink-3">Not yet</span> : score.toFixed(1)}</dd></div>
        <div><dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Price</dt><dd className="mt-1 font-mono text-[12px] tabular-nums text-ink">{facts.price ?? "–"}</dd></div>
        <div className="min-w-0"><dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Takes</dt><dd className="mt-1 truncate font-mono text-[12px] text-ink" title={takes ?? undefined}>{takes ?? "–"}</dd></div>
      </dl>

      {paused ? <p className="mt-4 border border-[color:var(--hairline)] bg-canvas px-3 py-2 text-[12px] leading-5 text-ink-2">{PAUSED_NOTE}</p> : null}
      {facts.activity && !paused ? <div className="mt-3"><ActivityLine text={facts.activity} /></div> : null}
      {metadataState === "loading" ? <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">Loading service details</p> : null}
      {metadataState === "mismatch" ? <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--err)]">Service file changed · new version required</p> : null}
      {metadataState === "error" ? <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--err)]">Service details unavailable</p> : null}

      <div aria-hidden className="min-h-4 flex-1" />
      <div className="flex flex-wrap gap-2">
        {hireable ? <TagButton size="sm" href={`/?agent=${encodeURIComponent(listing.id)}`}>Hire</TagButton> : null}
        <TagButton size="sm" variant="ghost" href={href}>View agent</TagButton>
      </div>
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
